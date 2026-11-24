import { afterEach, beforeEach, expect, test } from 'vitest';
import { exerciseById, SEED_EQUIPMENT } from '../content';
import { COACHED_EXERCISE_IDS, coachedEquipmentId, coachedPose, PHASE3_EXERCISE_IDS, phase3EquipmentId, phase3Pose } from '../content/stationDemos';
import { stationUnits } from '../engine/block/progression';
import { orderedDurationMin } from '../engine/templates';
import { setPreferredEquipment } from './lift';
import { toBlockExercise } from './liftday';
import { mixedOptions, startMixedSession, updateMixedSession, workoutPreview } from './mixedSession';
import { settings } from './p4-test-utils';
import { saveOrderedWorkout } from './templates';
import { openTestDb } from './test-utils';
import type { OrderedSelfPacedBlock, OrderedStation } from './types';
import { copyWorkoutBlock, libraryWorkoutBlock, matchingSuggestion, starterWorkoutBlocks, strengthWorkoutChoices, suggestedWorkouts, workoutBlockContent } from './workoutChoices';

let db: ReturnType<typeof openTestDb>;
beforeEach(() => { db = openTestDb(); });
afterEach(async () => {
  await db.delete();
});

test('starter workouts match their durations and all offered movements resolve a verified demo', async () => {
  await db.settings.put(settings());
  expect(suggestedWorkouts.map((workout) => [orderedDurationMin(workout.blocks), workout.blocks.length])).toEqual([[40, 5], [27, 4], [30, 4]]);
  for (const suggestion of suggestedWorkouts) {
    const blocks = suggestion.blocks.map((block) => copyWorkoutBlock(block));
    expect(matchingSuggestion({ ...suggestion, blocks })).toBe(suggestion);
    expect(matchingSuggestion({ ...suggestion, blocks: [...blocks].reverse() })).toBeUndefined();
    const id = await saveOrderedWorkout(db, { name: suggestion.name, blocks });
    const session = (await db.sessions.get(await startMixedSession(db, { templateId: id })))!;
    expect(session.mixed!.prescription.blocks).toEqual(blocks);
    for (const block of blocks) {
      const options = await mixedOptions(db, block, session.mixed!);
      expect(options.ready).toBe(true);
      if ((block.kind === 'coached' || block.kind === 'self-paced') && block.stations) {
        const verified = block.kind === 'coached' ? coachedPose : phase3Pose;
        for (const station of block.stations) {
          for (const swap of options.stations?.[station.slotId] ?? []) {
            const gear = (await db.equipment.get(swap.equipmentId!))!;
            expect(swap.poseId).toBe(verified(swap.exerciseId, gear));
            expect(swap.poseId).toBeTruthy();
            expect(swap.target).toEqual(station.target);
          }
        }
      }
    }
  }
  const demos = await workoutPreview(db, [...starterWorkoutBlocks, ...strengthWorkoutChoices]);
  for (const demo of demos.flat()) {
    expect(demo.poseId, demo.exerciseId).toBeTruthy();
    expect(demo.status).toBeUndefined();
    expect(exerciseById.get(demo.exerciseId)?.cues.length).toBeGreaterThan(0);
  }
});

test('matches only known ordered fields, including nested station targets', () => {
  const suggestion = suggestedWorkouts[0]!;
  const blocks = suggestion.blocks.map((source) => {
    const block = copyWorkoutBlock(source);
    if (block.kind === 'coached') return block;
    const extension = { importMetadata: { originalSource: 'archive' } };
    return block.kind === 'self-paced' ? { ...block, ...extension,
      stations: block.stations.map((station) => ({ ...station, ...extension, target: { ...station.target, ...extension } })),
    } : { ...block, ...extension };
  });
  expect(matchingSuggestion({ name: suggestion.name, blocks })).toBe(suggestion);
  const circuit = blocks.find((block) => block.kind === 'self-paced')!;
  const station = circuit.stations[0]!;
  expect(workoutBlockContent({ ...circuit, stations: [{ ...station, target: { ...station.target, amount: 5 } }, ...circuit.stations.slice(1)] }))
    .not.toEqual(workoutBlockContent(circuit));
  expect(workoutBlockContent({ ...circuit, name: 'x'.repeat(1025) })).toBeUndefined();
  expect(workoutBlockContent({ ...circuit, stations: [{ ...station, exerciseId: 'x'.repeat(1025) }] })).toBeUndefined();
  expect(workoutBlockContent({ id: 'legacy', kind: 'coached', name: 'Older rotation', durationSec: 120 })).toBeDefined();
});

test.each([
  { scenario: 'falls back to the verified seed', pin: undefined, unavailableEquipment: [], expectedId: 'barbell-olympic', status: undefined },
  { scenario: 'honors an incompatible explicit pin', pin: 'pin-stack', unavailableEquipment: [], expectedId: undefined, status: 'Demo unavailable.' },
  { scenario: 'requires the bench for the verified seed', pin: undefined, unavailableEquipment: ['flat-bench'], expectedId: undefined, status: 'Unavailable at your gym.' },
])('hip thrust with an ordinary pin-stack preference $scenario in Preview and Start', async ({ pin, unavailableEquipment, expectedId, status }) => {
  const now = new Date('2026-11-22T12:00:00.000Z');
  await db.settings.put(settings({ unavailableEquipment }));
  await setPreferredEquipment(db, 'hip-thrust', 'pin-stack');
  const preset = strengthWorkoutChoices.find((block) => block.exerciseId === 'hip-thrust')!;
  expect(preset.equipmentId).toBeUndefined();
  const block = { ...preset, equipmentId: pin };

  const [demos] = await workoutPreview(db, [block], now);
  const demo = demos?.[0];
  expect.soft(demo?.equipmentId).toBe(pin ?? 'barbell-olympic');
  expect.soft(demo?.poseId).toBe(expectedId ? 'hip-thrust' : undefined);
  expect.soft(demo?.status?.split(' Replace')[0]).toBe(status);

  const templateId = await saveOrderedWorkout(db, { name: 'Hip thrust day', blocks: [block] }, undefined, now);
  const session = await db.sessions.get(await startMixedSession(db, { templateId }, now));
  expect(session?.mixed?.strength[block.id]?.equipmentId).toBe(expectedId);
});

test('repeats starter strength on the verified machine that logged the original sets', async () => {
  const now = new Date('2026-11-22T12:00:00.000Z');
  await db.settings.put(settings({ programStart: '2026-07-01' }));
  const block = starterWorkoutBlocks.find((choice) => choice.kind === 'strength')!;
  const ordered = { name: 'Leg press day', blocks: [block] };
  const templateId = await saveOrderedWorkout(db, ordered, undefined, now);
  const sessionId = await startMixedSession(db, { templateId }, now);
  const first = (await db.sessions.get(sessionId))!.mixed!;
  const { equipmentId, sets } = first.strength[block.id]!;
  const seed = phase3EquipmentId(block.exerciseId)!;
  expect(equipmentId).toBeTruthy();
  expect(equipmentId).not.toBe(seed);
  for (let slot = 0; slot < sets; slot++) {
    const { cursor } = (await db.sessions.get(sessionId))!.mixed!;
    await updateMixedSession(db, sessionId, cursor, { type: 'set', weight: 120, reps: 10,
      expectedExerciseId: block.exerciseId, expectedEquipmentId: equipmentId }, new Date(+now + slot * 1000));
  }
  const { cursor } = (await db.sessions.get(sessionId))!.mixed!;
  await updateMixedSession(db, sessionId, cursor, { type: 'continue' }, new Date(+now + 30_000));
  await db.templates.delete(templateId);
  const later = new Date(+now + 86_400_000);
  const repeat = (await db.sessions.get(await startMixedSession(db, { sessionId }, later)))!;
  expect(repeat.mixed!.prescription).toEqual(ordered);
  expect(repeat.mixed!.strength[block.id]).toMatchObject({ equipmentId, targetWeight: 120 });
  expect(await db.sets.where('sessionId').equals(repeat.id).count()).toBe(0);

  const explicit = { name: 'Seed machine', blocks: [{ ...block, equipmentId: seed }] };
  const pinned = await saveOrderedWorkout(db, explicit, undefined, now);
  const ownMachine = (await db.sessions.get(await startMixedSession(db, { templateId: pinned }, later)))!;
  expect(ownMachine.mixed!.prescription).toEqual(explicit);
  expect(ownMachine.mixed!.strength[block.id]).toMatchObject({ equipmentId: seed, targetWeight: 0, label: 'Calibration' });
});

test('manual and imported station equipment/unit matrix only plays verified pairs', async () => {
  await db.settings.put(settings());
  const pairs = [false, true].flatMap((coached) => (coached ? COACHED_EXERCISE_IDS : PHASE3_EXERCISE_IDS).flatMap((id) => {
    const exercise = exerciseById.get(id)!;
    const units = stationUnits(toBlockExercise(exercise));
    const good = (coached ? coachedEquipmentId : phase3EquipmentId)(id)!;
    const wrong = SEED_EQUIPMENT.find((gear) => gear.id !== good && !(coached ? coachedPose : phase3Pose)(id, gear))!.id;
    return units.flatMap((unit) => [good, wrong].map((equipmentId) => ({
      coached, verified: equipmentId === good, station: { exerciseId: id, equipmentId, target: { unit, amount: 10 }, slotId: id },
    })));
  }));
  const blocks = pairs.map(({ coached, station }, index) => {
    const common = { id: String(index), name: 'Imported pair', durationSec: 480, stations: [station] };
    return coached ? { ...common, kind: 'coached' as const, workSec: 30, restSec: 0, transitionSec: 10 }
      : { ...common, kind: 'self-paced' as const };
  });
  const demos = await workoutPreview(db, blocks);
  for (const [index, pair] of pairs.entries()) {
    const demo = demos[index]![0]!;
    expect(!!demo.poseId, JSON.stringify(pair)).toBe(pair.verified);
    if (!pair.verified) expect(demo.status).toMatch(/^Demo unavailable/);
  }

  const stations: OrderedStation[] = [
    { slotId: 'unknown', exerciseId: 'older-movement', target: { unit: 'reps', amount: 7 } },
    { slotId: 'manual', exerciseId: 'romanian-deadlift', target: { unit: 'reps', amount: 7 } },
    { slotId: 'wrong-unit', exerciseId: 'leg-press', target: { unit: 'cal', amount: 7 } },
    { slotId: 'excluded', exerciseId: 'leg-press', target: { unit: 'reps', amount: 7 } },
  ];
  await db.exerciseOverrides.put({ exerciseId: 'leg-press', notAtMyGym: true });
  const circuit: OrderedSelfPacedBlock = { id: 'manual', kind: 'self-paced', durationSec: 480, name: 'Manual', stations };
  const [statuses] = await workoutPreview(db, [circuit]);
  expect(statuses!.map(({ status }) => status?.split('.')[0])).toEqual([
    'Demo unavailable', 'Demo unavailable', 'Demo unavailable', 'Unavailable at your gym',
  ]);
  expect(statuses!.every((demo) => !demo.poseId)).toBe(true);
});

test('copies a recommendation-off library row by value with fresh, independent draft identities', () => {
  const stamp = '2026-11-22T12:00:00Z';
  const row = {
    id: 'stored', name: 'Personal rotation', kind: 'coached' as const, durationSec: 480, recommend: false,
    createdAt: stamp, updatedAt: stamp, workSec: 41, restSec: 9, transitionSec: 3,
    stations: [
      { exerciseId: 'hip-thrust', target: { unit: 'reps' as const, amount: 7 }, load: 95 },
      { exerciseId: 'rower', target: { unit: 'cal' as const, amount: 10 } },
    ],
  };
  const source = libraryWorkoutBlock(row);
  const copy = copyWorkoutBlock(source);
  const other = copyWorkoutBlock(source);
  if (copy.kind !== 'coached' || other.kind !== 'coached') throw new Error('Missing rotations');
  expect(copy).toEqual({
    id: copy.id, name: row.name, kind: row.kind, durationSec: 480, workSec: 41, restSec: 9, transitionSec: 3,
    stations: row.stations.map((station, index) => ({ ...station, slotId: copy.stations![index]!.slotId })),
  });
  expect(copy.id).not.toBe(other.id);
  expect(copy.stations!.map((station) => station.slotId)).not.toEqual(other.stations!.map((station) => station.slotId));
  row.stations[0]!.target.amount = 20;
  expect(copy.stations![0]!.target.amount).toBe(7);
});
