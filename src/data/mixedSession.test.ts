import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildExport, importExport, parseExport } from './backup';
import { exerciseById } from '../content';
import type { GymDb } from './db';
import { loadSessionPRs } from './history';
import { findOpenLiftSession, findStaleOpenLifts } from './lift';
import { findOpenMixedSession, mixedOptions, rateMixedSession, startMixedSession, updateMixedSession } from './mixedSession';
import { MIXED_AT, MIXED_TEMPLATE, PRIOR_LIFT, PRIOR_SET } from './mixedSession.test-fixture';
import { settings } from './p4-test-utils';
import { loadRingInput } from './plan';
import { saveAsMine } from './templates';
import { openTestDb } from './test-utils';
import { weeklyGoal } from '../engine/plan/ring';

const source = { templateId: MIXED_TEMPLATE.id };
const at = (ms = 0) => new Date(MIXED_AT.getTime() + ms);
let db: GymDb;
beforeEach(async () => {
  db = openTestDb();
  await db.settings.put(settings({ programStart: '2026-07-03', activities: ['lift', 'run'] }));
  await db.templates.put(MIXED_TEMPLATE);
});
afterEach(async () => { await db.delete(); });

const current = async (id: string) => (await db.sessions.get(id))!;
const action = async (id: string, next: Parameters<typeof updateMixedSession>[3], ms = 0) =>
  updateMixedSession(db, id, (await current(id)).mixed!.cursor, next, at(ms));

async function logCurrentSet(id: string, weight: number) {
  const { strength, cursor } = (await current(id)).mixed!;
  const accepted = strength[cursor.blockId]!;
  return action(id, { type: 'set', weight, reps: 10, expectedExerciseId: accepted.exerciseId, expectedEquipmentId: accepted.equipmentId });
}

async function startBlocks(...blocks: NonNullable<typeof MIXED_TEMPLATE.ordered>['blocks']) {
  await db.templates.put({ ...MIXED_TEMPLATE, blocks: [], ordered: { name: 'Test workout', blocks } });
  return startMixedSession(db, source, at());
}

async function roundTrip(id: string) {
  const snapshot = JSON.stringify(await current(id));
  const portable = parseExport(JSON.stringify(await buildExport(db, MIXED_AT, 'test'))).file;
  const restored = openTestDb();
  try {
    await importExport(restored, portable);
    expect(JSON.stringify(await restored.sessions.get(id))).toBe(snapshot);
    expect(await restored.sets.toArray()).toEqual(await db.sets.toArray());
    expect(await restored.templates.get(source.templateId)).toEqual(await db.templates.get(source.templateId));
  } finally {
    await restored.delete();
  }
}

test('concurrent saved Starts and stale legacy readers leave one durable ordered session', async () => {
  const [id, same] = await Promise.all([startMixedSession(db, source, at()), startMixedSession(db, source, at())]);
  expect(same).toBe(id);
  expect(await db.sessions.count()).toBe(1);
  expect(await findOpenLiftSession(db, at(1))).toBeUndefined();
  const later = at(10 * 86_400_000);
  expect(await findStaleOpenLifts(db, later)).toEqual([]);
  expect((await findOpenMixedSession(db))?.id).toBe(id);
  await db.templates.update(source.templateId, { ordered: { ...MIXED_TEMPLATE.ordered!, name: 'Edited' } });
  expect(await startMixedSession(db, source, later)).toBe(id);
  expect((await current(id)).mixed!.prescription.name).toBe('Legs & Core');
});

test('clock, actuals, swaps, failure retry, repeat and optional effort survive backup round trips', async () => {
  await db.sessions.add(PRIOR_LIFT);
  await db.sets.add(PRIOR_SET);
  const id = await startMixedSession(db, source, at());
  await action(id, { type: 'start' });
  await action(id, { type: 'pause' }, 10_000);
  await action(id, { type: 'expire' }, 300_000);
  expect((await current(id)).mixed!.cursor.stage).toBe('active');
  await roundTrip(id);
  await action(id, { type: 'resume' }, 300_000);
  await action(id, { type: 'expire' }, 349_999);
  const active = (await current(id)).mixed!.cursor;
  expect(active.stage).toBe('active');
  await Promise.all([0, 120_000].map((lag) => updateMixedSession(db, id, active, { type: 'expire' }, at(350_000 + lag))));
  let mixed = (await current(id)).mixed!;
  expect(mixed.timers.prep?.frozenElapsedMs).toBe(60_000);
  await Promise.all([0, 1].map(() => updateMixedSession(db, id, mixed.cursor, { type: 'continue' }, at(350_000))));
  expect((await current(id)).mixed!.cursor.blockId).toBe('press');

  mixed = (await current(id)).mixed!;
  const set = { type: 'set', weight: 140, reps: 10, expectedExerciseId: 'leg-press', expectedEquipmentId: mixed.strength.press?.equipmentId } as const;
  const failSet = (changes: object) => { if (Object.keys(changes).some((key) => key.startsWith('mixed'))) throw new Error('write failed'); };
  db.sessions.hook('updating').subscribe(failSet);
  await expect(action(id, set, 351_000)).rejects.toThrow('write failed');
  db.sessions.hook('updating').unsubscribe(failSet);
  expect(await db.sets.where({ sessionId: id }).count()).toBe(0);
  await Promise.all([0, 1].map(() => updateMixedSession(db, id, mixed.cursor, set, at(351_000))));
  expect(await db.sets.where({ sessionId: id }).count()).toBe(1);
  await action(id, set, 352_000);
  await action(id, { type: 'continue' }, 353_000);
  await action(id, { ...set, weight: 95, expectedExerciseId: 'hip-thrust', expectedEquipmentId: 'barbell-olympic' }, 354_000);
  await action(id, { type: 'continue' }, 355_000);
  mixed = (await current(id)).mixed!;
  const circuit = mixed.prescription.blocks[3]!;
  const options = await mixedOptions(db, circuit, mixed, at(355_000));
  expect(options.ready).toBe(true);
  expect(options.available?.size).toBe(6);
  expect(options.stations?.lunge?.find((s) => s.exerciseId === 'step-up')?.poseId).toBe('step-up');
  await action(id, { type: 'start' }, 356_000);
  await action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: 'step-up', expectedExerciseId: 'reverse-lunge' }, 358_000);
  mixed = (await current(id)).mixed!;
  expect(mixed.stations.circuit?.[0]).toMatchObject({ exerciseId: 'step-up', poseId: 'step-up', swappedFromExerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 12 } });
  expect(mixed.timers.circuit?.startedAt).toBe(at(356_000).getTime());
  await roundTrip(id);
  await action(id, { type: 'round', expectedTapped: 0 }, 836_000);
  mixed = (await current(id)).mixed!;
  expect(mixed.cursor).toMatchObject({ blockId: 'circuit', stage: 'review' });
  expect(mixed.drafts.circuit?.rounds).toBeNull();
  await action(id, { type: 'review', rounds: 0, partial: { slotId: 'lunge', count: 3, unit: 'reps' } }, 836_100);
  await action(id, { type: 'continue' }, 836_200);
  await action(id, { type: 'start' }, 837_000);
  await action(id, { type: 'finish' }, 844_000);

  const failFinish = (changes: object) => { if (Object.hasOwn(changes, 'endedAt')) throw new Error('finish failed'); };
  db.sessions.hook('updating').subscribe(failFinish);
  await expect(action(id, { type: 'continue' }, 845_000)).rejects.toThrow('finish failed');
  db.sessions.hook('updating').unsubscribe(failFinish);
  mixed = (await current(id)).mixed!;
  expect(mixed.results.recovery).toBeUndefined();
  await Promise.all([0, 1].map((lag) => updateMixedSession(db, id, mixed.cursor, { type: 'continue' }, at(845_000 + lag))));
  const complete = await current(id);
  expect(Object.keys(complete.mixed!.results)).toEqual(['prep', 'press', 'thrust', 'circuit', 'recovery']);
  expect(complete.mixed!.results.circuit).toMatchObject({ rounds: 0, elapsedMs: 480_000, partial: { count: 3 } });
  expect(complete.mixed!.results.recovery?.elapsedMs).toBe(7_000);
  expect(complete.rpe).toBeNull();
  expect(await db.sets.where({ sessionId: id }).count()).toBe(3);
  expect(await loadSessionPRs(db, id)).toContainEqual(expect.objectContaining({ exerciseId: 'leg-press', weight: 140, reps: 10 }));
  const input = await loadRingInput(db, at());
  expect(weeklyGoal(input.sessions, input.today, input.programStart, input.activities)).toMatchObject({ done: 2, target: 3 });
  await rateMixedSession(db, id, 5);
  expect(await current(id)).toEqual({ ...complete, rpe: 5 });
  await rateMixedSession(db, id, 9);
  expect(await current(id)).toEqual({ ...complete, rpe: 9, hard: true });
  await roundTrip(id);

  const copyId = await saveAsMine(db, id, undefined, at());
  expect(await db.templates.get(copyId)).toMatchObject({ source: 'saved', ordered: MIXED_TEMPLATE.ordered });
  const repeated = await startMixedSession(db, { sessionId: id }, at(850_000));
  expect(repeated).not.toBe(id);
  expect((await current(repeated)).mixed).toMatchObject({ prescription: MIXED_TEMPLATE.ordered, cursor: { blockId: 'prep' }, results: {} });
});

test('unsupported stations are readable and can be skipped, with untouched rounds saved as null', async () => {
  const block = MIXED_TEMPLATE.ordered!.blocks[3]!;
  if (block.kind !== 'self-paced') throw new Error('Missing circuit fixture');
  const unsupported = { ...block, stations: [{ ...block.stations[0]!, exerciseId: 'old-lunge' }, block.stations[1]!] };
  await db.templates.put({ ...MIXED_TEMPLATE, blocks: [], ordered: { name: 'Circuit', blocks: [unsupported] } });
  const id = await startMixedSession(db, source, at());
  await expect(action(id, { type: 'start' })).rejects.toThrow('Replace or skip');
  await action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: null, expectedExerciseId: 'old-lunge' });
  await action(id, { type: 'start' });
  await action(id, { type: 'expire' }, 3_000_000);
  await action(id, { type: 'continue' }, 3_000_001);
  const result = (await current(id)).mixed!.results.circuit;
  expect(result?.rounds).toBeNull();
  expect(result?.stations?.[0]).toMatchObject({ exerciseId: 'old-lunge', skipped: true });
  expect(await loadSessionPRs(db, id)).toEqual([]);
});

test('coached snapshots remain readable and Start rejects them before writing', async () => {
  const ordered = { name: 'Coached', blocks: [{ id: 'rotation', kind: 'coached' as const, name: 'Rotation', durationSec: 480 }] };
  await db.templates.put({ ...MIXED_TEMPLATE, ordered, blocks: [] });
  await expect(startMixedSession(db, source, at())).rejects.toThrow('Coached blocks');
  expect(await db.sessions.count()).toBe(0);
});

test('a concurrent round retry counts once and replacement is rechecked before writing', async () => {
  const circuit = MIXED_TEMPLATE.ordered!.blocks[3]!;
  await db.templates.put({ ...MIXED_TEMPLATE, blocks: [], ordered: { name: 'Circuit', blocks: [circuit] } });
  const id = await startMixedSession(db, source, at());
  await action(id, { type: 'start' });
  const mixed = (await current(id)).mixed!;
  expect((await mixedOptions(db, circuit, mixed, at())).stations?.lunge).toEqual(expect.arrayContaining([expect.objectContaining({ exerciseId: 'step-up' })]));
  await db.settings.update('settings', { unavailableEquipment: ['plyo-box'] });
  await expect(action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: 'step-up', expectedExerciseId: 'reverse-lunge' })).rejects.toThrow('unavailable');
  await Promise.all([0, 1].map(() => updateMixedSession(db, id, mixed.cursor, { type: 'round', expectedTapped: 0 }, at(1_000))));
  expect((await current(id)).mixed!.drafts.circuit).toMatchObject({ tapped: 1, rounds: 1 });
  expect((await current(id)).mixed!.stations.circuit?.[0]?.exerciseId).toBe('reverse-lunge');
});

test('restoring an older entry keeps newer sets and resumes each strength block at its next slot', async () => {
  const press = MIXED_TEMPLATE.ordered!.blocks[1]!;
  const thrust = MIXED_TEMPLATE.ordered!.blocks[2]!;
  const id = await startBlocks(press, thrust);
  const older = parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file;
  await logCurrentSet(id, 140);
  const newer = parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file;
  await logCurrentSet(id, 145);
  await action(id, { type: 'continue' });
  await logCurrentSet(id, 95);
  const rows = await db.sets.where({ sessionId: id }).toArray();

  await importExport(db, older);
  expect((await current(id)).mixed!.cursor).toEqual({ blockId: 'press', stage: 'review', setSlot: 2 });
  await action(id, { type: 'continue' });
  expect((await current(id)).mixed!.cursor).toEqual({ blockId: 'thrust', stage: 'review', setSlot: 1 });
  expect(await db.sets.where({ sessionId: id }).toArray()).toEqual(rows);

  const fresh = openTestDb();
  try {
    await importExport(fresh, newer);
    await importExport(fresh, older);
    expect((await fresh.sessions.get(id))!.mixed!.cursor).toEqual({ blockId: 'press', stage: 'active', setSlot: 1 });
    expect(await fresh.sets.where({ sessionId: id }).count()).toBe(1);
  } finally {
    await fresh.delete();
  }
});

const calf = { id: 'calf', kind: 'strength', exerciseId: 'calf-raise', equipmentId: 'pin-stack', sets: 2, repMin: 8, repMax: 12 } as const;

test('retained sets recover the replacement prescription from an older strength restore', async () => {
  const id = await startBlocks(calf);
  const beforeSwap = await current(id);
  const backup = parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file;
  await action(id, { type: 'swap-strength', expectedExerciseId: calf.exerciseId, exerciseId: 'reverse-lunge' });
  const afterSwap = await current(id);
  await logCurrentSet(id, 20);
  await importExport(db, backup);
  expect((await current(id)).blocks).toEqual(afterSwap.blocks);
  expect((await current(id)).mixed!.cursor).toEqual({ blockId: 'calf', stage: 'active', setSlot: 1 });

  // Recover a device that already restored this backup before cursor reconciliation was added.
  await db.sessions.put(beforeSwap);
  await logCurrentSet(id, 999);
  expect(await db.sets.where({ sessionId: id }).toArray()).toMatchObject([{ exerciseId: 'reverse-lunge', weight: 20 }]);
  await logCurrentSet(id, 25);
  expect(await db.sets.where({ sessionId: id }).toArray()).toMatchObject([
    { exerciseId: 'reverse-lunge', weight: 20 }, { exerciseId: 'reverse-lunge', weight: 25 },
  ]);
});

test('an old strength form cannot write to the replacement exercise or equipment', async () => {
  const id = await startBlocks(calf);
  const { cursor, strength } = (await current(id)).mixed!;
  const form = { type: 'set', weight: 80, reps: 10, expectedExerciseId: calf.exerciseId, expectedEquipmentId: strength.calf!.equipmentId! } as const;
  await action(id, { type: 'swap-strength', expectedExerciseId: calf.exerciseId, exerciseId: 'reverse-lunge' });
  await expect(updateMixedSession(db, id, cursor, form, at())).rejects.toThrow('changed');
  await expect(action(id, { ...form, expectedExerciseId: 'reverse-lunge' })).rejects.toThrow('changed');
  expect(await db.sets.where({ sessionId: id }).count()).toBe(0);
  expect((await current(id)).mixed!.cursor).toEqual(cursor);
  await action(id, { ...form, expectedExerciseId: 'reverse-lunge', expectedEquipmentId: 'dumbbells' });
  expect(await db.sets.where({ sessionId: id }).first()).toMatchObject({ exerciseId: 'reverse-lunge', equipmentId: 'dumbbells' });
});

test('a strength swap reserves later accepted working sets under the weekly ceiling', async () => {
  await db.sessions.add(PRIOR_LIFT);
  await db.sets.bulkAdd(Array.from({ length: 17 }, (_, idx) => ({ ...PRIOR_SET, id: `prior-${idx}`, idx })));
  const lastWeek = { ...PRIOR_LIFT, id: 'last-week', date: '2026-11-13T15:00:00Z', endedAt: '2026-11-13T16:00:00Z' };
  await db.sessions.add(lastWeek);
  await db.sets.add({ ...PRIOR_SET, id: 'prior-lunge', sessionId: lastWeek.id, exerciseId: 'reverse-lunge', equipmentId: 'dumbbells' });
  const id = await startBlocks(calf, MIXED_TEMPLATE.ordered!.blocks[1]!);
  await action(id, { type: 'swap-strength', expectedExerciseId: calf.exerciseId, exerciseId: 'reverse-lunge' });
  expect((await current(id)).mixed!.strength).toMatchObject({ calf: { exerciseId: 'reverse-lunge', sets: 1 }, press: { sets: 2 } });
  await logCurrentSet(id, 20);
  await action(id, { type: 'continue' });
  await logCurrentSet(id, 140);
  await logCurrentSet(id, 145);
  expect(await db.sets.where('sessionId').anyOf([id, PRIOR_LIFT.id]).filter((row) => row.setKind === 'working' || !row.setKind).count()).toBe(20);
});

test('station changes preserve tapped rounds across restore without changing the timer', async () => {
  const id = await startBlocks(MIXED_TEMPLATE.ordered!.blocks[3]!);
  await action(id, { type: 'start' });
  await action(id, { type: 'round', expectedTapped: 0 }, 1_000);
  await action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: 'step-up', expectedExerciseId: 'reverse-lunge' }, 2_000);
  await action(id, { type: 'round', expectedTapped: 1 }, 3_000);
  await action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: null, expectedExerciseId: 'step-up' }, 4_000);
  await roundTrip(id);
  await action(id, { type: 'finish' }, 5_000);
  await action(id, { type: 'continue', rounds: 3 });
  const result = (await current(id)).mixed!.results.circuit!;
  expect(result.stations?.[0]).toMatchObject({ exerciseId: 'step-up', skipped: true });
  expect(result).toMatchObject({
    rounds: 3, elapsedMs: 5_000,
    stationChanges: [
      { afterRound: 1, stations: expect.arrayContaining([expect.objectContaining({ slotId: 'lunge', exerciseId: 'reverse-lunge' })]) },
      { afterRound: 2, stations: expect.arrayContaining([expect.objectContaining({ slotId: 'lunge', exerciseId: 'step-up' })]) },
    ],
  });
  await roundTrip(id);
});

test('a restored machine from a different exercise does not enable the leg press demo or logging', async () => {
  const machine = { id: 'legacy-chest-press', name: `${exerciseById.get('chest-press-machine')!.name} — Plate-loaded machine`, kind: 'machine', steps: [100] };
  const press = { ...MIXED_TEMPLATE.ordered!.blocks[1]!, equipmentId: machine.id };
  if (press.kind !== 'strength') throw new Error('Expected strength fixture');
  await importExport(db, parseExport(JSON.stringify({ schemaVersion: 2, stores: { equipment: [machine] } })).file);
  const id = await startBlocks(press);
  const { mixed } = await current(id);
  expect(await mixedOptions(db, press, mixed!, at())).toMatchObject({ ready: false, poseId: undefined });
  expect(mixed!.strength.press?.equipmentId).toBeUndefined();
});
