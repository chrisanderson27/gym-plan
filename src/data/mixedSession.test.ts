import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildExport, ImportError, importExport, parseExport } from './backup';
import { exerciseById } from '../content';
import { coachedSchedule, initialCoached, projectCoached } from '../engine/block/coached';
import { GymDb } from './db';
import { loadSessionPRs } from './history';
import { findOpenLiftSession, findStaleOpenLifts } from './lift';
import { findOpenMixedSession, mixedOptions, rateMixedSession, startMixedSession, updateMixedSession } from './mixedSession';
import { COACHED_TEMPLATE, MIXED_AT, MIXED_TEMPLATE, PRIOR_LIFT, PRIOR_SET } from './mixedSession.test-fixture';
import { settings } from './p4-test-utils';
import { WORKOUT_PRESETS } from './presets';
import { loadRingInput } from './plan';
import { saveAsMine } from './templates';
import { openTestDb } from './test-utils';
import type { MixedExecution } from './types';
import { validateRows } from './validate';
import { weeklyGoal } from '../engine/plan/ring';
import { FULL_WORKOUT_MIN_SEC, orderedDurationSec } from '../engine/templates';

const source = { templateId: MIXED_TEMPLATE.id };
type Blocks = NonNullable<typeof MIXED_TEMPLATE.ordered>['blocks'];
/** A leading inert recovery block keeps short fixtures above the 45-minute Start floor. */
const padFloor = (blocks: Blocks): Blocks => {
  const need = Math.min(3600, Math.max(0, FULL_WORKOUT_MIN_SEC - orderedDurationSec(blocks)));
  return need > 0 ? [{ id: 'floor-pad', kind: 'recovery', durationSec: need, instructions: 'Easy.' }, ...blocks] : blocks;
};
const at = (ms = 0) => new Date(MIXED_AT.getTime() + ms);
let db: GymDb;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(2_000_000));
  db = openTestDb();
  await db.settings.put(settings({ programStart: '2026-07-03', activities: ['lift', 'run'] }));
  await db.templates.put(MIXED_TEMPLATE);
});
afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

const current = async (id: string) => (await db.sessions.get(id))!;
const action = async (id: string, next: Parameters<typeof updateMixedSession>[3], ms = 0) =>
  updateMixedSession(db, id, (await current(id)).mixed!.cursor, next, at(ms));

test.each(['strength', 'self-paced'] as const)('restored %s IDs retain their own block state on Start and Repeat', async (kind) => {
  const block = { ...MIXED_TEMPLATE.ordered!.blocks.find((row) => row.kind === kind)!, id: '__proto__' };
  const template = { ...MIXED_TEMPLATE, ordered: { name: MIXED_TEMPLATE.name, blocks: padFloor([block]) }, blocks: [] };
  await db.templates.put(template);
  const file = parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file;
  await db.templates.delete(source.templateId);
  await importExport(db, file);
  const started = await startMixedSession(db, source, at());
  await action(started, { type: 'skip' });
  await action(started, { type: 'continue' });
  const assertBlockState = async (id: string) => {
    const mixed = (await current(id)).mixed!;
    const maps = kind === 'strength' ? [mixed.strength] : [mixed.stations, mixed.drafts];
    expect(maps.every((map) => Object.hasOwn(map, block.id))).toBe(true);
    const exported = await buildExport(db, at(10_000), 'test');
    expect(() => parseExport(JSON.stringify(exported))).not.toThrow();
  };
  await assertBlockState(started);
  await action(started, { type: 'skip' }, 1000);
  await action(started, { type: 'continue' }, 2000);
  await assertBlockState(await startMixedSession(db, { sessionId: started }, at(3000)));
});

const roundTap = (mixed: MixedExecution) => ({
  type: 'round' as const,
  expectedTapped: mixed.drafts.circuit!.tapped,
  expectedStations: mixed.stations.circuit!,
});

async function logCurrentSet(id: string, weight: number) {
  const { strength, cursor } = (await current(id)).mixed!;
  const accepted = strength[cursor.blockId]!;
  return action(id, { type: 'set', weight, reps: 10, expectedExerciseId: accepted.exerciseId, expectedEquipmentId: accepted.equipmentId });
}

async function startBlocks(...blocks: Blocks) {
  const need = Math.min(3600, Math.max(0, FULL_WORKOUT_MIN_SEC - orderedDurationSec(blocks)));
  // A leading pad that is skipped immediately keeps the block under test first, above the 45-minute Start floor.
  const pad = need > 0 ? [{ id: 'floor-pad', kind: 'recovery' as const, durationSec: need, instructions: 'Easy.' }] : [];
  await db.templates.put({ ...MIXED_TEMPLATE, blocks: [], ordered: { name: 'Test workout', blocks: [...pad, ...blocks] } });
  const id = await startMixedSession(db, source, at());
  if (pad.length) {
    await action(id, { type: 'skip' });
    await action(id, { type: 'continue' });
  }
  return id;
}

async function roundTrip(id: string, now = MIXED_AT) {
  const snapshot = JSON.stringify(await current(id));
  const portable = parseExport(JSON.stringify(await buildExport(db, now, 'test'))).file;
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

const coachedFixture = () => {
  const block = COACHED_TEMPLATE.ordered!.blocks[2]!;
  if (block.kind !== 'coached' || !block.stations) throw new Error('Missing coached fixture');
  return block;
};

test('reconciles stale and duplicate Next, pause, expiry and Continue across backup and replay', async () => {
  const block = coachedFixture();
  const id = await startBlocks(block);
  const entry = (await current(id)).mixed!.cursor;
  await Promise.all([0, 10].map((ms) => updateMixedSession(db, id, entry, { type: 'start' }, at(ms))));
  const active = (await current(id)).mixed!;
  expect(active.timers.rotation?.coached).toEqual(initialCoached);
  await roundTrip(id);
  await Promise.all([0, 1].map(() => updateMixedSession(db, id, active.cursor, { type: 'next', observed: initialCoached }, at(8_000))));
  let clock = (await current(id)).mixed!.timers.rotation!;
  expect(clock).toMatchObject({ startedAt: at().getTime(), pausedMs: 0, durationMs: 720_000, coached: { station: 1, phaseStartMs: 8000 } });
  await roundTrip(id, at(8_000));
  const stale = { type: 'next', observed: clock.coached! } as const;
  await action(id, stale, 53_000);
  expect((await current(id)).mixed!.timers.rotation).toEqual(clock);
  const schedule = coachedSchedule(block, block.stations);
  await action(id, { type: 'pause' }, 53_000);
  clock = (await current(id)).mixed!.timers.rotation!;
  expect(clock.coached).toEqual(projectCoached(schedule, stale.observed, 53_000).at);
  await action(id, { type: 'expire' }, 900_000);
  await roundTrip(id, at(900_000));
  await action(id, { type: 'resume' }, 900_000);
  const deadline = 720_000 + 900_000 - 53_000;
  await Promise.all([stale, { type: 'expire' } as const].map((incoming) => updateMixedSession(db, id, active.cursor, incoming, at(deadline))));
  const review = (await current(id)).mixed!;
  expect(review.cursor.stage).toBe('review');
  expect(review.timers.rotation?.frozenElapsedMs).toBe(720_000);
  expect(review.drafts.rotation?.rounds).toBe(4);
  await roundTrip(id, at(deadline));
  const partial = { slotId: 'cable', unit: 'reps' as const, count: 6 };
  await action(id, { type: 'review', rounds: 2, partial }, deadline + 1);
  const failWrite = () => { throw new Error('result write failed'); };
  db.sessions.hook('updating').subscribe(failWrite);
  await expect(action(id, { type: 'continue' }, deadline + 2)).rejects.toThrow('result write failed');
  db.sessions.hook('updating').unsubscribe(failWrite);
  await Promise.all([0, 1].map(() => updateMixedSession(db, id, review.cursor, { type: 'continue' }, at(deadline + 3))));
  expect((await current(id)).mixed!.results).toEqual({ 'floor-pad': expect.anything(), rotation: expect.objectContaining({ status: 'completed', rounds: 2, partial, elapsedMs: 720_000 }) });
  await roundTrip(id, at(deadline + 3));
  const restored = openTestDb();
  try {
    await importExport(restored, parseExport(JSON.stringify(await buildExport(db, at(deadline + 4), 'test'))).file);
    const replay = await startMixedSession(restored, { sessionId: id }, at(deadline + 10));
    const fresh = (await restored.sessions.get(replay))!.mixed!;
    expect(fresh.timers).toEqual({});
    expect(fresh.drafts.rotation).toEqual({ rounds: null, tapped: 0 });
    expect(fresh.results).toEqual({});
    await updateMixedSession(restored, replay, fresh.cursor, { type: 'skip' }, at(deadline + 50));
    const skipped = (await restored.sessions.get(replay))!.mixed!;
    await updateMixedSession(restored, replay, skipped.cursor, { type: 'continue' }, at(deadline + 60));
    const started = await updateMixedSession(restored, replay, (await restored.sessions.get(replay))!.mixed!.cursor, { type: 'start' }, at(deadline + 100));
    expect(started?.mixed?.timers.rotation).toMatchObject({ coached: initialCoached, startedAt: at(deadline + 100).getTime() });
  } finally {
    await restored.delete();
  }
});

test('keeps skipped slots, live replacement windows and completed lineup history', async () => {
  const block = coachedFixture();
  await db.settings.update('settings', { unavailableEquipment: ['plyo-box'] });
  const id = await startBlocks(block);
  await expect(action(id, { type: 'start' })).rejects.toThrow('Replace or skip');
  await action(id, { type: 'swap-station', slotId: 'box', exerciseId: null, expectedExerciseId: 'box-step-up' });
  await action(id, { type: 'start' });
  const active = (await current(id)).mixed!;
  expect(active.stations.rotation?.[0]?.skipped).toBe(true);
  expect(active.timers.rotation?.coached).toEqual(initialCoached);
  await action(id, { type: 'swap-station', slotId: 'squat', exerciseId: 'leg-press', expectedExerciseId: 'goblet-squat' }, 137_000);
  const swapped = (await current(id)).mixed!;
  expect(swapped.drafts.rotation?.stationChanges).toEqual([{ afterRound: 1, stations: active.stations.rotation }]);
  expect(swapped.stations.rotation?.[2]).toMatchObject({ exerciseId: 'leg-press', target: { unit: 'reps', amount: 12 } });
  expect(swapped.timers.rotation?.coached).toMatchObject({ station: 0, phase: 'work', phaseStartMs: 135_000 });
  expect(swapped.timers.rotation?.durationMs).toBe(720_000);
  await roundTrip(id, at(137_000));
  await action(id, { type: 'finish' }, 138_000);
  const saved = await action(id, { type: 'continue' }, 139_000);
  expect(saved?.mixed?.results.rotation).toMatchObject({ rounds: 1, stations: swapped.stations.rotation });
  await roundTrip(id, at(139_000));
});

test('active coached imports verify seeded equipment and imported machine instances', async () => {
  const block = coachedFixture();
  const machine = {
    id: 'legacy-leg-press', name: `${exerciseById.get('leg-press')!.name} — Plate-loaded machine`,
    kind: 'machine' as const, steps: [100],
  };
  await db.equipment.add(machine);
  const stations = block.stations.map((s) => s.slotId === 'squat' ? { ...s, exerciseId: 'leg-press', equipmentId: machine.id } : s);
  const id = await startBlocks({ ...block, stations });
  await action(id, { type: 'start' });
  const session = await current(id);
  const backup = await buildExport(db, at(1_000), 'test');
  const parse = (row = session, equipment = [machine]) => parseExport(JSON.stringify({
    ...backup, stores: { sessions: [row], equipment },
  }));
  expect(parse().file.stores.sessions).toEqual(JSON.parse(JSON.stringify([session])));
  expect(() => parse(session, [{ ...machine, name: 'Other machine' }])).toThrow(ImportError);
  expect(() => parse(session, [])).toThrow(ImportError);
  const wrongBike = structuredClone(session);
  wrongBike.mixed!.stations.rotation!.find((s) => s.slotId === 'bike')!.equipmentId = 'bodyweight';
  expect(() => parse(wrongBike)).toThrow(ImportError);

  await action(id, { type: 'finish' }, 8_000);
  const finished = (await action(id, { type: 'continue' }, 8_000))!;
  const historical = parse(finished, []).file.stores.sessions;
  expect(historical).toEqual(JSON.parse(JSON.stringify([finished])));
});

test('active coached checkpoint must exist at export time and can catch up after import', async () => {
  const id = await startBlocks(coachedFixture());
  await action(id, { type: 'start' });
  const backup = await buildExport(db, at(1_000), 'test');
  const parse = (file: unknown) => parseExport(JSON.stringify(file));
  const invalidClock = (mutate: (timer: MixedExecution['timers'][string]) => void) => {
    const row = structuredClone(backup.stores.sessions![0]) as Awaited<ReturnType<typeof current>>;
    mutate(row.mixed!.timers.rotation!);
    expect(() => parse({ ...backup, stores: { sessions: [row] } })).toThrow(ImportError);
  };
  invalidClock((clock) => { clock.coached!.phaseStartMs = 600_000; });
  invalidClock((clock) => { clock.startedAt = at(1_001).getTime(); });
  invalidClock((clock) => { clock.pausedAt = at(1_001).getTime(); });
  invalidClock((clock) => { clock.pausedMs = 1_001; });
  for (const exportedAt of [undefined, '2026-11-22', '2026-11-31T16:00:01Z']) {
    expect(() => parse({ ...backup, exportedAt })).toThrow(ImportError);
  }
  const restored = openTestDb();
  try {
    await importExport(restored, parse(backup).file);
    const cursor = (await restored.sessions.get(id))!.mixed!.cursor;
    const expired = await updateMixedSession(restored, id, cursor, { type: 'expire' }, at(900_000));
    expect(expired?.mixed?.cursor.stage).toBe('review');
    expect(expired?.mixed?.timers.rotation?.frozenElapsedMs).toBe(720_000);
    expect(expired?.mixed?.drafts.rotation?.rounds).toBe(4);
  } finally {
    await restored.delete();
  }
});

test.each<[string, Partial<MixedExecution['timers'][string]>]>([
  ['phase checkpoint', { coached: { ...initialCoached, phaseStartMs: 600_000 } }],
  ['start', { startedAt: at(600_000).getTime() }],
  ['pause', { pausedAt: at(1_001).getTime() }],
  ['resume', { pausedMs: 600_000 }],
])('rejects a coached %s after restore time even with a later export timestamp', async (_, anchor) => {
  const id = await startBlocks(coachedFixture());
  const session = (await action(id, { type: 'start' }))!;
  Object.assign(session.mixed!.timers.rotation!, anchor);
  const backup = await buildExport(db, at(600_000), 'test');
  backup.stores.sessions = [session];

  vi.setSystemTime(at(1_000));
  expect(() => parseExport(JSON.stringify(backup))).toThrow(ImportError);
});

test('exports a concurrent pause with a coherent snapshot and restores it paused', async () => {
  const id = await startBlocks(coachedFixture());
  const cursor = (await action(id, { type: 'start' }))!.mixed!.cursor;
  const writer = new GymDb(db.name);
  const restored = openTestDb();
  try {
    vi.setSystemTime(at(1_000));
    const { pending } = await writer.transaction('rw', writer.tables, async () => {
      await writer.sessions.get(id);
      const pending = Dexie.ignoreTransaction(() => buildExport(db, undefined, 'test'));
      vi.setSystemTime(at(1_001));
      await updateMixedSession(writer, id, cursor, { type: 'pause' });
      return { pending };
    });
    const backup = await pending;
    expect(backup.stores.sessions).toMatchObject([{ mixed: { timers: { rotation: { pausedAt: at(1_001).getTime() } } } }]);
    expect(backup.exportedAt).toBe(at(1_001).toISOString());

    vi.setSystemTime(at(900_000));
    await importExport(restored, parseExport(JSON.stringify(backup)).file);
    const paused = await updateMixedSession(restored, id, cursor, { type: 'expire' });
    expect(paused?.mixed?.cursor.stage).toBe('active');
    const resumed = await updateMixedSession(restored, id, cursor, { type: 'resume' });
    expect(resumed?.mixed?.timers.rotation).toMatchObject({ pausedAt: null, pausedMs: 898_999 });
  } finally {
    writer.close();
    await restored.delete();
  }
});

test('distinguishes early zero, skipped, and saved placeholders', async () => {
  const block = coachedFixture();
  const { id: blockId, name, durationSec, kind } = block;
  await expect(startBlocks({ id: blockId, name, durationSec, kind })).rejects.toThrow('without a station schedule');
  expect(await db.sessions.count()).toBe(0);
  const id = await startBlocks(block);
  await action(id, { type: 'start' });
  await action(id, { type: 'finish' }, 8000);
  const zero = (await action(id, { type: 'continue' }, 8000))!;
  expect(zero.mixed?.results.rotation).toMatchObject({ status: 'completed', rounds: 0, elapsedMs: 8000 });
  const skipped = await startBlocks(block);
  await action(skipped, { type: 'skip' });
  expect((await action(skipped, { type: 'continue' }))?.mixed?.results.rotation).toMatchObject({ status: 'skipped', rounds: null });
  await roundTrip(skipped);
});

test('rejects hostile coached timing, result and lineup snapshots', async () => {
  const id = await startBlocks(coachedFixture());
  await action(id, { type: 'start' });
  const snapshot = await current(id);
  const invalid = (mutate: (m: MixedExecution) => void) => {
    const row = structuredClone(snapshot);
    mutate(row.mixed!);
    expect(() => validateRows('sessions', [row])).toThrow('malformed');
  };
  invalid((m) => { delete m.timers.rotation!.coached; });
  invalid((m) => { m.timers.rotation!.coached!.phase = 'transition'; });
  invalid((m) => { m.timers.rotation!.coached!.phaseStartMs = 720_001; });
  invalid((m) => { m.timers.rotation!.coached!.rotations = Number.MAX_SAFE_INTEGER + 1; });
  invalid((m) => { m.timers.rotation!.pausedAt = at(-1).getTime(); });
  invalid((m) => { m.timers.rotation!.frozenElapsedMs = 720_000; });
  invalid((m) => { m.stations.rotation!.reverse(); });
  invalid((m) => { m.stations.rotation![0]!.target = { unit: 'sec', amount: 46 }; });
  invalid((m) => { m.stations.rotation![0]!.poseId = 'goblet-squat'; });
  invalid((m) => { m.stations.rotation![0]!.poseId = 'constructor'; });
  invalid((m) => { m.stations.rotation![3]!.equipmentId = 'bodyweight'; });
  invalid((m) => { m.drafts.rotation!.stationChanges = [{ afterRound: 1, stations: m.stations.rotation! }]; });
  invalid((m) => { m.results.rotation = { status: 'completed', elapsedMs: 0 }; });
});

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
  await action(id, roundTap(mixed), 836_000);
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
  const id = await startBlocks(unsupported);
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
  const id = await startBlocks(circuit);
  await action(id, { type: 'start' });
  const mixed = (await current(id)).mixed!;
  expect((await mixedOptions(db, circuit, mixed, at())).stations?.lunge).toEqual(expect.arrayContaining([expect.objectContaining({ exerciseId: 'step-up' })]));
  await db.settings.update('settings', { unavailableEquipment: ['plyo-box'] });
  await expect(action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: 'step-up', expectedExerciseId: 'reverse-lunge' })).rejects.toThrow('unavailable');
  await Promise.all([0, 1].map(() => updateMixedSession(db, id, mixed.cursor, roundTap(mixed), at(1_000))));
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

test.each([0, 1])('continuing from legacy block %s recovers the later strength prescription before exposing its next set', async (index) => {
  const id = await startBlocks(MIXED_TEMPLATE.ordered!.blocks[index]!, calf);
  if (index === 1) {
    await logCurrentSet(id, 140);
    await logCurrentSet(id, 145);
  } else {
    await action(id, { type: 'skip' });
  }
  const beforeSwap = await current(id);
  await action(id, { type: 'continue' });
  await action(id, { type: 'swap-strength', expectedExerciseId: calf.exerciseId, exerciseId: 'reverse-lunge' });
  await logCurrentSet(id, 20);

  await db.sessions.put(beforeSwap);
  await action(id, { type: 'continue' });
  const { mixed, blocks } = await current(id);
  expect(mixed!.cursor).toEqual({ blockId: 'calf', stage: 'active', setSlot: 1 });
  expect(mixed!.strength.calf).toMatchObject({ exerciseId: 'reverse-lunge', equipmentId: 'dumbbells' });
  expect(blocks.find((block) => block.id === 'calf')).toMatchObject({ exerciseId: 'reverse-lunge', equipmentId: 'dumbbells' });
  await logCurrentSet(id, 25);
  expect(await db.sets.where({ sessionId: id }).filter((row) => row.exerciseId === 'reverse-lunge').sortBy('idx')).toMatchObject([
    { exerciseId: 'reverse-lunge', weight: 20 }, { exerciseId: 'reverse-lunge', weight: 25 },
  ]);
});

test('restoring divergent strength sets opens review and preserves each retained row', async () => {
  const id = await startBlocks({ ...calf, sets: 3 });
  const base = parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file;
  const other = openTestDb();
  try {
    await importExport(other, base);
    await logCurrentSet(id, 80);
    const backup = parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file;
    const incoming = (await db.sets.where({ sessionId: id }).first())!;
    const apply = async (next: Parameters<typeof updateMixedSession>[3]) =>
      updateMixedSession(other, id, (await other.sessions.get(id))!.mixed!.cursor, next, at());
    await apply({ type: 'swap-strength', expectedExerciseId: calf.exerciseId, exerciseId: 'reverse-lunge' });
    const lunge = { type: 'set', reps: 10, expectedExerciseId: 'reverse-lunge', expectedEquipmentId: 'dumbbells' } as const;
    await apply({ ...lunge, weight: 20 });
    await apply({ ...lunge, weight: 25 });
    const retained = (await other.sets.where({ sessionId: id }).sortBy('idx'))[1]!;

    await importExport(other, backup);
    const { cursor, strength } = (await other.sessions.get(id))!.mixed!;
    expect(cursor).toEqual({ blockId: 'calf', stage: 'review', setSlot: 2 });
    await apply({ type: 'set', weight: 85, reps: 10, expectedExerciseId: strength.calf!.exerciseId,
      expectedEquipmentId: strength.calf!.equipmentId });
    expect(await other.sets.where({ sessionId: id }).sortBy('idx')).toEqual([incoming, retained]);
    await apply({ type: 'continue' });
    expect((await other.sessions.get(id))!.mixed!.results.calf?.status).toBe('completed');
  } finally {
    await other.delete();
  }
});

test.each([0, 1.5, 1001])('restoring a retained set with target reps %s keeps the next export valid', async (targetReps) => {
  const id = await startBlocks(calf);
  const beforeSwap = await current(id);
  await action(id, { type: 'swap-strength', expectedExerciseId: calf.exerciseId, exerciseId: 'reverse-lunge' });
  await logCurrentSet(id, 20);
  const row = (await db.sets.where({ sessionId: id }).first())!;
  await db.sets.update(row.id, { targetReps, targetWeight: -1 });
  // Only the row carries the replacement identity in a legacy restore.
  await db.sessions.put(beforeSwap);
  await importExport(db, parseExport(JSON.stringify(await buildExport(db, at(), 'test'))).file);

  expect((await current(id)).mixed!.strength.calf).toMatchObject({ exerciseId: 'reverse-lunge', repMin: calf.repMin, repMax: calf.repMax });
  await roundTrip(id);
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
  await action(id, roundTap((await current(id)).mixed!), 1_000);
  await action(id, { type: 'swap-station', slotId: 'lunge', exerciseId: 'step-up', expectedExerciseId: 'reverse-lunge' }, 2_000);
  await action(id, roundTap((await current(id)).mixed!), 3_000);
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

test.each(['step-up', null])('a stale round tap is rejected after a station changes to %s', async (exerciseId) => {
  const id = await startBlocks(MIXED_TEMPLATE.ordered!.blocks[3]!);
  await action(id, { type: 'start' });
  await action(id, roundTap((await current(id)).mixed!), 1_000);
  const stale = (await current(id)).mixed!;
  await action(id, { type: 'swap-station', slotId: 'lunge', exerciseId, expectedExerciseId: 'reverse-lunge' }, 2_000);

  await expect(updateMixedSession(db, id, stale.cursor, roundTap(stale), at(3_000))).rejects.toThrow('lineup changed');
  const fresh = (await current(id)).mixed!;
  expect(fresh.drafts.circuit).toMatchObject({ tapped: 1, rounds: 1 });
  await action(id, roundTap(fresh), 4_000);
  expect((await current(id)).mixed!.drafts.circuit).toMatchObject({ tapped: 2, rounds: 2 });
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

test('Start requires the displayed prescription while still resuming an already-open attempt', async () => {
  const baseline = structuredClone(MIXED_TEMPLATE.ordered!);
  const changed = { ...baseline, blocks: [...baseline.blocks].reverse() };
  await db.templates.update(source.templateId, { ordered: changed });
  await expect(startMixedSession(db, source, at(), baseline)).rejects.toThrow('Review the current plan');
  expect(await db.sessions.count()).toBe(0);
  const semanticallyEqual = { blocks: changed.blocks, name: changed.name };
  const id = await startMixedSession(db, source, at(), semanticallyEqual);
  await db.templates.delete(source.templateId);
  expect(await startMixedSession(db, source, at(), baseline)).toBe(id);
  expect((await current(id)).mixed!.prescription).toEqual(changed);
  expect(await db.sessions.count()).toBe(1);
});

test('an active coached block rechecks equipment pairing while keeping its deadline and expiry', async () => {
  const rotation = coachedFixture();
  const id = await startBlocks(rotation);
  await action(id, { type: 'start' });
  const original = (await current(id)).mixed!;
  const station = original.stations[rotation.id]![0]!;
  await db.equipment.update(station.equipmentId!, { kind: 'machine' });
  const options = await mixedOptions(db, rotation, original, at(1000));
  expect(options.ready).toBe(false);
  expect(options.available?.has(station.slotId)).toBe(false);
  await expect(action(id, { type: 'next', observed: initialCoached }, 1000)).rejects.toThrow('Replace unavailable movements');
  expect((await current(id)).mixed!.timers).toEqual(original.timers);
  await action(id, { type: 'expire' }, rotation.durationSec * 1000);
  expect((await current(id)).mixed!.cursor.stage).toBe('review');
});

test('starting another preset discards an untouched open session but keeps one with progress', async () => {
  const [a, b, c] = WORKOUT_PRESETS;
  const first = await startMixedSession(db, { presetId: a!.id }, at());
  const second = await startMixedSession(db, { presetId: b!.id }, at(1000));
  expect(await db.sessions.get(first)).toBeUndefined();
  await action(second, { type: 'skip' }, 2000);
  const third = await startMixedSession(db, { presetId: c!.id }, at(3000));
  expect(await db.sessions.get(second)).toBeDefined();
  expect(await db.sessions.get(third)).toBeDefined();
});
