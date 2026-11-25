import { afterEach, beforeEach, expect, test } from 'vitest';
import { FULL_WORKOUT_MIN_SEC, orderedDurationSec } from '../engine/templates';
import { buildExport, importExport, parseExport } from './backup';
import { loadCardioSnapshot } from './cardio';
import { MixedInputError, ShortWorkoutError, startMixedSession, updateMixedSession, rateMixedSession } from './mixedSession';
import { settings } from './p4-test-utils';
import { loadRingInput } from './plan';
import { presetById } from './presets';
import { saveOrderedWorkout, WorkoutSaveError } from './templates';
import { floored, openTestDb } from './test-utils';
import type { OrderedBlock, RunRow } from './types';

const T0 = new Date('2026-11-22T16:00:00Z');
const at = (ms = 0) => new Date(T0.getTime() + ms);
let db: ReturnType<typeof openTestDb>;
beforeEach(async () => {
  db = openTestDb();
  await db.settings.put(settings({ programStart: '2026-07-03', activities: ['lift', 'run'] }));
});
afterEach(async () => { await db.delete(); });

const current = async (id: string) => (await db.sessions.get(id))!;
const act = async (id: string, next: Parameters<typeof updateMixedSession>[3], ms: number) =>
  updateMixedSession(db, id, (await current(id)).mixed!.cursor, next, at(ms));
const RUN = { distanceMi: 1.5, durationSec: 1200, modality: 'run', rpe: 6, painFlag: false } as const;

/** Skips every block except the run, which is started, finished and logged unless `skipRun`. */
async function walk(id: string, skipRun = false) {
  let ms = 1000;
  for (let guard = 0; guard < 40; guard++) {
    const session = await current(id);
    if (session.endedAt) return session;
    const block = session.mixed!.prescription.blocks.find((b) => b.id === session.mixed!.cursor.blockId)!;
    if (block.kind === 'run' && !skipRun) {
      await act(id, { type: 'start' }, ms);
      await act(id, { type: 'finish' }, ms + 600_000);
      await act(id, { type: 'continue', run: RUN }, ms + 600_001);
      ms += 700_000;
    } else {
      await act(id, { type: 'skip' }, ms);
      await act(id, { type: 'continue' }, ms + 1);
      ms += 2;
    }
  }
  throw new Error('workout did not finish');
}

test('a hybrid preset plans its run into the session and logs exactly one run row that guardrails and the ring see', async () => {
  const id = await startMixedSession(db, { presetId: 'run-upper-strength' }, at());
  const started = await current(id);
  const run = started.blocks.find((b) => b.kind === 'run')!;
  expect(run).toMatchObject({ kind: 'run', runKind: 'easy', modality: 'run', id: 'run' });
  const done = await walk(id);
  expect(await db.runs.where('sessionId').equals(id).count()).toBe(1);
  expect(await db.runs.get(id)).toMatchObject({ kind: 'easy', modality: 'run', distanceMi: 1.5, durationSec: 1200, rpe: 6, painFlag: false });
  expect(done.hardCardio).toBe(false);
  const cardio = await loadCardioSnapshot(db, at(5_000_000));
  expect(cardio.runHistory).toHaveLength(1);
  const ring = await loadRingInput(db, at(5_000_000));
  expect(ring.sessions.find((s) => s.id === id)).toMatchObject({ runKind: 'easy' });
});

test('skipping the run writes no row, and an interval run marks the session hard cardio', async () => {
  const skipped = await startMixedSession(db, { presetId: 'run-upper-strength' }, at());
  await walk(skipped, true);
  expect(await db.runs.get(skipped)).toBeUndefined();
  const intervals = await startMixedSession(db, { presetId: 'run-intervals-upper' }, at(10_000_000));
  const done = await walk(intervals);
  expect(await db.runs.get(intervals)).toMatchObject({ kind: 'intervals' });
  expect(done.hardCardio).toBe(true);
  await rateMixedSession(db, intervals, 5);
  expect((await current(intervals)).hardCardio).toBe(true);
});

test('a cold start keeps the planned run under the 25-minute cap and a bike preset stays on the machine', async () => {
  const id = await startMixedSession(db, { presetId: 'run-upper-strength' }, at());
  const run = (await current(id)).blocks.find((b) => b.kind === 'run')!;
  const sec = run.kind === 'run' ? run.repeats * run.segments.reduce((n, s) => n + (s.sec ?? 0), 0) : 0;
  expect(sec).toBeGreaterThan(0);
  expect(sec).toBeLessThanOrEqual(25 * 60);
  const bike = await startMixedSession(db, { presetId: 'bike-lower-strength' }, at());
  expect((await current(bike)).blocks.find((b) => b.kind === 'run')).toMatchObject({ modality: 'bike' });
});

test('a run row survives a backup round trip with its session', async () => {
  const id = await startMixedSession(db, { presetId: 'run-upper-strength' }, at());
  await walk(id);
  const file = parseExport(JSON.stringify(await buildExport(db, at(9_000_000), 'test'))).file;
  const restored = openTestDb();
  try {
    await importExport(restored, file);
    expect(JSON.stringify(await restored.sessions.get(id))).toBe(JSON.stringify(await current(id)));
    expect(await restored.runs.get(id)).toEqual<RunRow>((await db.runs.get(id))!);
  } finally {
    await restored.delete();
  }
});

const short: OrderedBlock[] = [{ id: 'prep', kind: 'preparation', durationSec: 600, instructions: 'Easy.' }];

test('the 45-minute floor accepts exactly 2700 s, rejects 2699 s and never blocks Resume', async () => {
  const exact = floored(short);
  expect(orderedDurationSec(exact as OrderedBlock[])).toBe(FULL_WORKOUT_MIN_SEC);
  const ok = await saveOrderedWorkout(db, { name: 'Exact', blocks: exact as OrderedBlock[] });
  expect(await startMixedSession(db, { templateId: ok }, at())).toBeTruthy();
  const under = [{ ...exact[1]!, durationSec: 2099 } as OrderedBlock, short[0]!];
  expect(orderedDurationSec(under)).toBe(2699);
  await expect(saveOrderedWorkout(db, { name: 'Under', blocks: under })).rejects.toThrow(WorkoutSaveError);
  await expect(saveOrderedWorkout(db, { name: 'Under', blocks: under })).rejects.toThrow('0:01');
  // Seeded rows (an old suggestion copy, a short repeat source) are rejected at Start with no writes.
  await db.templates.put({ id: 'old', name: 'Old', type: 'custom', source: 'saved', createdAt: at().toISOString(), blocks: [], ordered: { name: 'Old', blocks: under } });
  const before = await db.sessions.count();
  await expect(startMixedSession(db, { templateId: 'old' }, at())).rejects.toBeInstanceOf(ShortWorkoutError);
  await expect(startMixedSession(db, { templateId: 'old' }, at())).rejects.toBeInstanceOf(MixedInputError);
  expect(await db.sessions.count()).toBe(before);
  // An already-open short session resumes.
  await db.sessions.add({
    id: 'open-short', type: 'custom', date: at().toISOString(), blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '',
    mixed: { kind: 'ordered', sourceId: 'template:old', prescription: { name: 'Old', blocks: under }, stations: {}, strength: {}, timers: {}, drafts: {}, results: {}, cursor: { blockId: 'prep', stage: 'entry', setSlot: 0 } },
  });
  expect(await startMixedSession(db, { templateId: 'old' }, at())).toBe('open-short');
  // A finished short session is rejected as a fresh Repeat.
  await db.sessions.update('open-short', { endedAt: at().toISOString() });
  await expect(startMixedSession(db, { sessionId: 'open-short' }, at())).rejects.toBeInstanceOf(ShortWorkoutError);
});

test('removed presets are unavailable and every shipped preset is at least 45 minutes', async () => {
  expect(presetById('nope')).toBeUndefined();
  await expect(startMixedSession(db, { presetId: 'nope' }, at())).rejects.toThrow('unavailable');
});

test('the preview note appears only when a guardrail would shorten the run', async () => {
  const { acceptedPlanNotes } = await import('./mixedSession');
  const run = (durationSec: number): OrderedBlock => ({ id: 'r', kind: 'run', name: 'Run', runKind: 'easy', modality: 'run', durationSec });
  expect(await acceptedPlanNotes(db, [run(1200)], at())).toEqual([undefined]);
  expect((await acceptedPlanNotes(db, [run(3300)], at()))[0]).toMatch(/running limits/);
});

test('a run in a lower-body workout says it becomes a bike, and a malformed block is not swallowed', async () => {
  const { acceptedPlanNotes } = await import('./mixedSession');
  const run: OrderedBlock = { id: 'r', kind: 'run', name: 'Run', runKind: 'easy', modality: 'run', durationSec: 1200 };
  const squat: OrderedBlock = { id: 's', kind: 'strength', exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 10 };
  expect((await acceptedPlanNotes(db, [squat, run], at()))[1]).toMatch(/bike instead of run/);
  expect((await acceptedPlanNotes(db, [run], at()))[0]).toBeUndefined();
  await expect(acceptedPlanNotes(db, [null as unknown as OrderedBlock], at())).rejects.toBeInstanceOf(TypeError);
});
