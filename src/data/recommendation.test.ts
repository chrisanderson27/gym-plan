import { afterEach, beforeEach, expect, test } from 'vitest';
import { FULL_WORKOUT_MIN_SEC, orderedDurationSec } from '../engine/templates';
import { buildExport, importExport, parseExport } from './backup';
import type { GymDb } from './db';
import { setNotAtMyGym } from './lift';
import { mixedOptions, rateMixedSession, startMixedSession, updateMixedSession } from './mixedSession';
import { session, settings, topSets } from './p4-test-utils';
import { loadTodayRecommendation, startTodayRecommendation } from './recommendation';
import { openTestDb } from './test-utils';
import type { LibraryBlock } from './types';

const at = new Date(2026, 10, 20, 12);
let db: GymDb;
beforeEach(async () => {
  db = openTestDb();
  await db.settings.put(settings({ programStart: '2026-11-19', activities: ['lift'] }));
});
afterEach(async () => db.delete());

async function review(now = at) {
  const decision = await loadTodayRecommendation(db, now);
  if (decision.kind !== 'workout') throw new Error(decision.reason);
  return decision;
}

const checked: LibraryBlock = {
  id: 'checked', name: 'Checked easy circuit', kind: 'self-paced', recommend: true, durationSec: 480,
  createdAt: at.toISOString(), updatedAt: at.toISOString(), stations: [
    { exerciseId: 'plank', target: { amount: 20, unit: 'sec' } },
    { exerciseId: 'dead-bug', target: { amount: 6, unit: 'reps' } },
  ],
};

const stores = () => Promise.all([
  db.sessions.toArray(), db.sets.toArray(), db.equipment.toArray(), db.exerciseOverrides.toArray(),
  db.templates.toArray(), db.libraryBlocks.toArray(), db.runs.toArray(), db.swims.toArray(),
  db.tests.toArray(), db.settings.toArray(), db.bodyLogs.toArray(),
]);

test('starts exactly the fresh reviewed Lower A prescription once, with one safe calibration set', async () => {
  await db.settings.update('settings', { activities: undefined, goalWeightLb: undefined, poolLength: undefined, poolUnit: undefined });
  const settingsBefore = await db.settings.get('settings');
  expect(settingsBefore).not.toHaveProperty('goalWeightLb');
  const expected = await review();
  const { prepared, lineup } = expected.workout;
  const prescription = prepared.mixed.prescription;
  expect(expected.title).toContain('Lower A');
  expect(expected.durationSec).toBe(orderedDurationSec(prescription.blocks));
  expect(expected.durationSec).toBeGreaterThanOrEqual(FULL_WORKOUT_MIN_SEC);
  expect(lineup.flat().every((move) => move.poseId && !move.status)).toBe(true);
  expect(prescription.blocks[1]).toMatchObject({ exerciseId: 'leg-press', sets: 1, label: 'Calibration' });
  expect(await db.sessions.count()).toBe(0);
  const attempts = await Promise.all([startTodayRecommendation(db, expected, at), startTodayRecommendation(db, expected, at)]);
  const [session] = await db.sessions.toArray();
  expect(attempts).toEqual(['started', 'resume'].map((kind) => ({ kind, route: `/workout/session/${session!.id}` })));
  expect(await db.sessions.count()).toBe(1);
  expect(session).toMatchObject({ variant: 'lower-a', mixed: { prescription, stations: prepared.mixed.stations } });
  const strength = session!.mixed!.strength[prescription.blocks[1]!.id]!;
  expect({ ...strength, equipmentId: 'plate-loaded' }).toEqual(prepared.mixed.strength[prescription.blocks[1]!.id]);
  expect(await db.equipment.get(strength.equipmentId!)).toMatchObject({ kind: 'machine', name: 'Leg press — Plate-loaded machine' });
  expect(await db.libraryBlocks.count()).toBe(0);
  expect(await db.templates.count()).toBe(0);
  expect(await db.bodyLogs.count()).toBe(0);
  expect(await db.settings.get('settings')).toEqual(settingsBefore);
  expect(await mixedOptions(db, prescription.blocks[1]!, session!.mixed!, at)).toBeTruthy();
});

test('checked source is copied in stable order, unchecked and incompatible rows fall back', async () => {
  const generated = await review();
  await db.libraryBlocks.bulkPut([
    { ...checked, recommend: false },
    { ...checked, id: 'unsupported', stations: [checked.stations[0]!, { exerciseId: 'swim', target: { unit: 'sec', amount: 30 } }] },
    { ...checked, id: 'hard', stations: [checked.stations[0]!, { exerciseId: 'rower', target: { unit: 'cal', amount: 15 } }] },
  ]);
  expect((await review()).revision).toBe(generated.revision);
  await db.libraryBlocks.put(checked);
  const offered = await review();
  expect(offered.workout.libraryId).toBe('checked');
  const block = offered.workout.prepared.mixed.prescription.blocks.find((b) => b.kind === 'self-paced' && b.name === checked.name);
  expect(block).toMatchObject({ durationSec: checked.durationSec, stations: checked.stations.map((s) => ({ ...s, slotId: expect.any(String), equipmentId: 'bodyweight' })) });
  const before = await stores();
  expect(await startTodayRecommendation(db, generated, at)).toMatchObject({ kind: 'stale', current: { revision: offered.revision } });
  expect(await stores()).toEqual(before);
  await setNotAtMyGym(db, 'plank', true);
  const fallback = await review();
  expect(fallback.workout).not.toHaveProperty('libraryId');
  expect(await db.libraryBlocks.get(checked.id)).toEqual(checked);
  await setNotAtMyGym(db, 'plank', false);
  expect((await review()).revision).toBe(offered.revision);
  await startTodayRecommendation(db, offered, at);
  expect((await db.sessions.toArray())[0]!.mixed!.prescription.blocks).toContainEqual(block);
});

test('a checked circuit can fill an eight-minute slot with too few generated stations', async () => {
  for (const id of ['box-step-up', 'reverse-lunge', 'step-up', 'seated-cable-row', 'push-up']) {
    await setNotAtMyGym(db, id, true);
  }
  await db.libraryBlocks.put(checked);
  const offered = await review();
  expect(offered.workout.variant).toBe('lower-a');
  expect(offered.workout.libraryId).toBe(checked.id);
  expect(offered.workout.prepared.mixed.prescription.blocks[3]).toMatchObject({ name: checked.name });
});

test('an upper recommendation avoids recovering lower-body muscles in its accessories', async () => {
  const date = new Date(at.getTime() - 24 * 3_600_000).toISOString();
  await db.settings.update('settings', { programStart: '2026-10-01' });
  await db.sessions.put(session('recent-lower', 1, { date, endedAt: date, variant: 'lower-a' }));
  await db.sets.put({ ...topSets('recent-lower', 1)[0]!, ts: date, exerciseId: 'leg-press', equipmentId: 'plate-loaded' });
  await db.libraryBlocks.put({ ...checked, stations: [
    { exerciseId: 'push-up', target: { amount: 6, unit: 'reps' } },
    { exerciseId: 'reverse-lunge', target: { amount: 6, unit: 'reps' }, load: 10 },
  ] });
  const offered = await review();
  expect(offered.workout.variant).toBe('upper-a');
  expect(offered.workout.libraryId).toBeUndefined();
});

test('generated lower accessories skip push-ups while the chest is recovering', async () => {
  const date = new Date(at.getTime() - 24 * 3_600_000).toISOString();
  await db.settings.update('settings', { programStart: '2026-10-01' });
  await db.sessions.put(session('recent-upper', 1, { date, endedAt: date, variant: 'upper-a' }));
  await db.sets.put({ ...topSets('recent-upper', 1)[0]!, ts: date });
  const offered = await review();
  expect(offered.workout.variant).toBe('lower-a');
  expect(offered.workout.lineup.flat().map((move) => move.exerciseId)).not.toContain('push-up');
});

test('queued Start surfaces Resume when the accepted prescription differs from the clicked review', async () => {
  const oldReview = await review();
  await db.libraryBlocks.put(checked);
  const newReview = await review();
  expect(newReview.sourceId).toBe(oldReview.sourceId);
  const [accepted, stale] = await Promise.all([
    startTodayRecommendation(db, newReview, at), startTodayRecommendation(db, oldReview, at),
  ]);
  const [open] = await db.sessions.toArray();
  expect(accepted.kind).toBe('started');
  expect(stale).toEqual({ kind: 'open', session: open });

  const restored = openTestDb();
  try {
    await importExport(restored, parseExport(JSON.stringify(await buildExport(db, at, 'test'))).file);
    const before = await restored.sessions.toArray();
    expect(await startTodayRecommendation(restored, oldReview, at)).toEqual({ kind: 'open', session: before[0] });
    expect(await restored.sessions.toArray()).toEqual(before);
  } finally {
    await restored.delete();
  }
});

test('Today does not offer or persist an unrestorable calibration target from saved equipment', async () => {
  for (const item of await db.equipment.toArray()) if (item.kind !== 'bodyweight') await db.equipment.update(item.id, { steps: [-10, 20, 30] });
  const decision = await loadTodayRecommendation(db, at);
  console.log('BRANCH', decision.kind);
  // Every loadable machine is corrupt, so the guard must route to the bodyweight main instead of going unavailable.
  expect(decision.kind).toBe('workout');
  if (decision.kind !== 'workout') return;
  expect(decision.workout.prepared.blocks[0]).toMatchObject({ equipmentId: 'bodyweight', targetWeight: 0 });
  expect(await startTodayRecommendation(db, decision, at)).toMatchObject({ kind: 'started' });
  // The recommendation guards against the bad row; imports of such rows are rejected (validate.ts).
  expect((await db.equipment.get('plate-loaded'))!.steps).toEqual([-10, 20, 30]);
});

test('Repeat uses progression on the accepted Today machine instance', async () => {
  const started = await startTodayRecommendation(db, await review(), at);
  if (started.kind !== 'started') throw new Error('Workout not started');
  const id = started.route.split('/').at(-1)!;
  const original = (await db.sessions.get(id))!;
  const { prescription, strength } = original.mixed!;
  const press = prescription.blocks[1]!;
  const equipmentId = strength[press.id]!.equipmentId;
  expect(equipmentId).not.toBe('plate-loaded');
  let elapsed = 0;
  const action = async (next: Parameters<typeof updateMixedSession>[3]) =>
    updateMixedSession(db, id, (await db.sessions.get(id))!.mixed!.cursor, next, new Date(at.getTime() + ++elapsed * 1000));
  await action({ type: 'skip' });
  await action({ type: 'continue' });
  await action({ type: 'set', reps: 9, weight: 70, expectedExerciseId: 'leg-press', expectedEquipmentId: equipmentId });
  await action({ type: 'continue' });
  for (let index = 2; index < prescription.blocks.length; index++) {
    await action({ type: 'skip' });
    await action({ type: 'continue' });
  }
  const date = new Date(at.getTime() - 86_400_000).toISOString();
  await db.sessions.put(session('seed-history', 1, { date, endedAt: date }));
  await db.sets.put({ ...topSets('seed-history', 1)[0]!, ts: date, exerciseId: 'leg-press', equipmentId: 'plate-loaded', weight: 140 });
  const next = await startMixedSession(db, { sessionId: id }, new Date(at.getTime() + 60_000));
  const repeated = (await db.sessions.get(next))!;
  expect(next).not.toBe(id);
  expect(repeated).toMatchObject({ rpe: null, mixed: {
    results: {}, strength: { [press.id]: { exerciseId: 'leg-press', equipmentId, targetWeight: 70 } },
  } });
  expect(await db.sets.where('sessionId').equals(next).count()).toBe(0);
  expect((await db.sessions.get(id))!.mixed!.prescription).toEqual(prescription);
});

test('rollover, checked edit/removal, equipment and activity changes write nothing when stale', async () => {
  await db.libraryBlocks.put(checked);
  const before = await review();
  const afterMidnight = new Date(2026, 10, 21, 0, 1);
  const saved = await stores();
  expect(await startTodayRecommendation(db, before, afterMidnight)).toMatchObject({ kind: 'stale' });
  expect(await stores()).toEqual(saved);
  for (const change of [
    () => db.libraryBlocks.update(checked.id, { name: 'Edited' }),
    () => db.libraryBlocks.delete(checked.id),
    () => db.settings.update('settings', { unavailableEquipment: ['leg-press'] }),
    () => db.settings.update('settings', { activities: [] }),
  ]) {
    const offer = await review();
    await change();
    const afterChange = await stores();
    expect(await startTodayRecommendation(db, offer, at)).toMatchObject({ kind: 'stale' });
    expect(await stores()).toEqual(afterChange);
  }
  expect(await loadTodayRecommendation(db, at)).toMatchObject({ kind: 'unavailable' });
});

test('unrelated weigh-in and appearance preserve consent and a failed write rolls back prepared equipment', async () => {
  const reviewed = await review();
  await db.bodyLogs.put({ date: '2026-11-20', weightLb: 200, protein: false });
  await db.settings.update('settings', { appearance: 'dark' });
  expect((await review()).revision).toBe(reviewed.revision);
  const fail = () => { throw new Error('abort before session save'); };
  const before = await stores();
  db.sessions.hook('creating').subscribe(fail);
  await expect(startTodayRecommendation(db, reviewed, at)).rejects.toThrow('abort before session save');
  db.sessions.hook('creating').unsubscribe(fail);
  expect(await stores()).toEqual(before);
  const accepted = await startTodayRecommendation(db, reviewed, at);
  expect(accepted.kind).toBe('started');
  expect(await db.sessions.count()).toBe(1);
});

test.each(['burn', 'run', 'swim'] as const)('%s-only preferences do not offer a standalone recommendation', async (activity) => {
  await db.settings.update('settings', { activities: [activity] });
  const before = await stores();
  expect(await loadTodayRecommendation(db, at)).toMatchObject({
    kind: 'unavailable', reason: expect.stringMatching(/Workouts/),
  });
  expect(await stores()).toEqual(before);
});

test('an accepted, running and finished Today workout round-trips through the existing backup shape', async () => {
  const started = await startTodayRecommendation(db, await review(), at);
  if (started.kind !== 'started') throw new Error('Workout not started');
  const id = started.route.split('/').at(-1)!;
  const restore = openTestDb();
  const clock = (offset: number) => new Date(at.getTime() + offset);
  const roundTrip = async (offset: number) => {
    const file = parseExport(JSON.stringify(await buildExport(db, clock(offset), 'test'))).file;
    await importExport(restore, file);
    expect(await restore.sessions.get(id)).toEqual(JSON.parse(JSON.stringify(await db.sessions.get(id))));
  };
  const action = async (action: Parameters<typeof updateMixedSession>[3], offset: number) => {
    const session = (await db.sessions.get(id))!;
    return updateMixedSession(db, id, session.mixed!.cursor, action, clock(offset));
  };
  try {
    await roundTrip(1);
    await action({ type: 'start' }, 10);
    await roundTrip(20);
    await action({ type: 'finish' }, 1000);
    await action({ type: 'continue' }, 1100);
    for (let index = 1; index < 7; index++) {
      await action({ type: 'skip' }, 1200 + index * 10);
      await action({ type: 'continue' }, 2600 + index * 10);
    }
    await rateMixedSession(db, id, 7);
    await roundTrip(3000);
    expect(await restore.sessions.get(id)).toMatchObject({ rpe: 7, endedAt: expect.any(String) });
  } finally {
    await restore.delete();
  }
});

test('revalidates the ranked guard and preserves a legacy open session without writing another', async () => {
  const expected = await review();
  const row = { id: 'legacy-lift', date: new Date(at.getTime() - 2_700_000).toISOString(), type: 'lift' as const, variant: 'lower-a' as const,
    blocks: [], rpe: null, hard: false, hardCardio: false, durationMin: 0, notes: '' };
  await db.sessions.add(row);
  expect(await startTodayRecommendation(db, expected, at)).toEqual({ kind: 'open', session: row });
  await db.sessions.update(row.id, { endedAt: at.toISOString(), durationMin: 45 });
  const before = await stores();
  expect(await startTodayRecommendation(db, expected, at)).toMatchObject({ kind: 'stale' });
  expect(await stores()).toEqual(before);
});

test('established Run and configured Swim stay outside new Today recommendations', async () => {
  const day = new Date(at.getTime() - 8 * 86_400_000).toISOString();
  await db.settings.update('settings', { activities: ['run'], programStart: '2026-10-23' });
  await db.sessions.add({ id: 'past-run', date: day, endedAt: day, type: 'run', blocks: [], rpe: 5,
    hard: false, hardCardio: false, durationMin: 45, notes: '' });
  await db.runs.add({ sessionId: 'past-run', kind: 'long', modality: 'run', distanceMi: 4, durationSec: 2700, intervals: [], rpe: 5, painFlag: false });
  const run = await stores();
  expect(await loadTodayRecommendation(db, at)).toMatchObject({ kind: 'unavailable' });
  expect(await stores()).toEqual(run);

  await db.settings.update('settings', { activities: ['swim'], poolLength: 25, poolUnit: 'yd' });
  await db.tests.add({ id: 'css', kind: 'css', date: new Date(at.getTime() - 86_400_000).toISOString(), poolUnit: 'yd', t200: 360, t400: 720 });
  const swim = await stores();
  expect(await loadTodayRecommendation(db, at)).toMatchObject({ kind: 'unavailable' });
  expect(await stores()).toEqual(swim);
});
