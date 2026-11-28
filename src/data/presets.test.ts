import { afterEach, beforeEach, expect, test } from 'vitest';
import { BLOCK_ROUNDS, blockBalanceIssues, blockRoundSeconds, orderedDurationSec, FULL_WORKOUT_MIN_SEC } from '../engine/templates';
import { blockExerciseOf } from './liftday';
import { PRESET_ACTIVITY_LABEL, WORKOUT_PRESETS, currentPresetFor, matchingSuggestion, presetById } from './presets';
import { mixedOptions, planOrderedRun, prepareOrderedStart, loadMixedGym, startMixedSession, workoutPreview } from './mixedSession';
import { loadCardioSnapshot } from './cardio';
import { settings } from './p4-test-utils';
import { openTestDb } from './test-utils';
import { validAuthoredWorkout } from './validate';
import { coolDown, copyWorkoutBlock, refusedBlock, rotation, starterStations, strength, warmUp, workoutBlockContent } from './workoutChoices';
import type { OrderedRunBlock } from './types';

let db: ReturnType<typeof openTestDb>;
beforeEach(() => { db = openTestDb(); });
afterEach(async () => { await db.delete(); });

test('the catalog has at least ten distinct presets that each meet the 45-minute floor', () => {
  expect(WORKOUT_PRESETS.length).toBeGreaterThanOrEqual(10);
  expect(new Set(WORKOUT_PRESETS.map((p) => p.id)).size).toBe(WORKOUT_PRESETS.length);
  expect(new Set(WORKOUT_PRESETS.map((p) => p.name)).size).toBe(WORKOUT_PRESETS.length);
  const fingerprints = WORKOUT_PRESETS.map((p) => JSON.stringify(p.blocks.map(workoutBlockContent)));
  expect(new Set(fingerprints).size).toBe(WORKOUT_PRESETS.length);
  const movements = WORKOUT_PRESETS.map((p) => JSON.stringify(p.blocks.flatMap((b) => b.kind === 'strength' ? [b.exerciseId]
    : b.kind === 'run' ? [b.runKind, b.modality, String(b.durationSec)] : 'stations' in b && b.stations ? b.stations.map((s) => s.exerciseId) : [])));
  expect(new Set(movements).size).toBe(WORKOUT_PRESETS.length);
  for (const preset of WORKOUT_PRESETS) {
    const sec = orderedDurationSec(preset.blocks);
    expect(sec, preset.id).toBeGreaterThanOrEqual(FULL_WORKOUT_MIN_SEC);
    expect(sec, preset.id).toBeLessThanOrEqual(3600);
    expect(validAuthoredWorkout({ name: preset.name, blocks: preset.blocks }), preset.id).toBe(true);
    expect(preset.blocks[0]!.kind).toBe('preparation');
    expect(preset.blocks.at(-1)!.kind).toBe('recovery');
    expect(PRESET_ACTIVITY_LABEL[preset.activity]).toBeTruthy();
  }
  expect(WORKOUT_PRESETS.filter((p) => p.activity === 'hybrid').length).toBeGreaterThanOrEqual(2);
});

test('every preset starts on the seed gym with every station resolved, and a second Start returns the open session', async () => {
  await db.settings.put(settings());
  const now = new Date('2026-11-22T12:00:00.000Z');
  for (const preset of WORKOUT_PRESETS) {
    const id = await startMixedSession(db, { presetId: preset.id }, now);
    expect(await startMixedSession(db, { presetId: preset.id }, now)).toBe(id);
    const session = (await db.sessions.get(id))!;
    expect(session.mixed!.sourceId).toBe('preset:' + preset.id);
    for (const block of preset.blocks) expect((await mixedOptions(db, block, session.mixed!, now)).ready, `${preset.id}:${block.id}`).toBe(true);
    const demos = await workoutPreview(db, preset.blocks, now);
    for (const demo of demos.flat()) expect(demo.status, `${preset.id}:${demo.exerciseId}`).toBeUndefined();
    await db.sessions.update(id, { endedAt: now.toISOString() });
  }
});

test('hybrid presets keep running modality for an upper-body workout and a cold start stays under the 25-minute cap', async () => {
  await db.settings.put(settings());
  const now = new Date('2026-11-22T12:00:00.000Z');
  const g = await loadMixedGym(db, now);
  const cardio = await loadCardioSnapshot(db, now);
  const runs = WORKOUT_PRESETS.filter((p) => p.activity === 'hybrid' && p.blocks.some((b) => b.kind === 'run' && b.modality === 'run'));
  expect(runs.length).toBeGreaterThanOrEqual(2);
  for (const preset of runs) {
    const prepared = prepareOrderedStart(g, { name: preset.name, blocks: preset.blocks }, 'preset:' + preset.id, now, false, cardio)!;
    const run = prepared.blocks.find((b) => b.kind === 'run')!;
    expect(run.kind === 'run' && run.modality).toBe('run');
    const sec = run.kind === 'run' ? run.repeats * run.segments.reduce((n, s) => n + (s.sec ?? 0), 0) : 0;
    expect(sec).toBeLessThanOrEqual(25 * 60);
  }
  const block: OrderedRunBlock = { id: 'r', kind: 'run', name: 'Run', runKind: 'easy', modality: 'run', durationSec: 1200 };
  expect(planOrderedRun(cardio, g.snapshot.programStart, block, true, now).modality).toBe('bike');
});

test('copies of a preset keep its category and description', () => {
  const preset = presetById('lower-strength-core')!;
  const blocks = preset.blocks.map((block) => copyWorkoutBlock(block));
  expect(matchingSuggestion({ name: 'Mine', blocks })).toBe(preset);
});

test('every preset station block runs about three rounds and passes the balance rules', () => {
  const exerciseOf = blockExerciseOf;
  for (const preset of WORKOUT_PRESETS) {
    const sec = orderedDurationSec(preset.blocks);
    expect(sec / 60, preset.id).toBeGreaterThanOrEqual(45);
    expect(sec / 60, preset.id).toBeLessThanOrEqual(62);
    for (const block of preset.blocks) {
      if (block.kind !== 'coached' && block.kind !== 'self-paced') continue;
      const where = `${preset.id}:${block.id}`;
      expect(block.stations?.every(({ exerciseId }) => blockExerciseOf(exerciseId) !== undefined), where).toBe(true);
      expect(blockBalanceIssues(block, exerciseOf), where).toEqual([]);
      const round = blockRoundSeconds(block, exerciseOf)!;
      expect(Math.abs(block.durationSec - BLOCK_ROUNDS.target * round), where).toBeLessThanOrEqual(30);
      expect(block.durationSec % 30, where).toBe(0);
    }
  }
});

test('a copy of a preset saved before blocks were sized by rounds keeps its category', () => {
  const pullRow = { ...rotation, id: 'pull-row', name: 'Pull and row rotation', durationSec: 1260, stations: starterStations([
    { exerciseId: 'seated-cable-row', target: { unit: 'reps', amount: 10 } }, { exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } },
  ], true) };
  const saved = [{ ...warmUp, durationSec: 420 }, strength('chest-press-machine', 6), pullRow, { ...coolDown, durationSec: 360 }];
  expect(matchingSuggestion({ name: 'Mine', blocks: saved.map((block) => copyWorkoutBlock(block)) }))
    .toMatchObject({ category: 'Upper-body strength', description: 'Machine pressing and push-ups, then a seated cable row rotation.' });
});

test('a saved copy of the old Step & Row names its 13-round block and maps to the current preset', () => {
  const coachedRows = (rows: Parameters<typeof starterStations>[0]) => starterStations(rows, true);
  const old = [
    { ...warmUp, durationSec: 420 },
    { ...rotation, id: 'step-row', name: 'Step and row rotation', durationSec: 1380, stations: coachedRows([
      { exerciseId: 'box-step-up', target: { unit: 'sec', amount: 45 } }, { exerciseId: 'rower', target: { unit: 'sec', amount: 45 } },
    ]) },
    { kind: 'self-paced' as const, id: 'step-circuit', name: 'Bodyweight circuit', durationSec: 960, stations: starterStations([
      { exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } }, { exerciseId: 'dead-bug', target: { unit: 'reps', amount: 8 } },
      { exerciseId: 'plank', target: { unit: 'sec', amount: 30 } },
    ], false) },
    { ...coolDown, durationSec: 360 },
  ];
  const saved = { name: 'Step & Row', blocks: old.map((block) => copyWorkoutBlock(block)) };
  expect(refusedBlock(saved.blocks)).toMatchObject({ name: 'Step and row rotation', issue: { kind: 'too-many-rounds' } });
  expect(Math.ceil((refusedBlock(saved.blocks)!.issue as { rounds: number }).rounds)).toBe(13);
  expect(currentPresetFor(saved)).toBe(presetById('step-and-row'));
  for (const preset of WORKOUT_PRESETS) {
    const copy = { name: preset.name, blocks: preset.blocks.map((block) => copyWorkoutBlock(block)) };
    expect(refusedBlock(copy.blocks), preset.id).toBeUndefined();
    expect(currentPresetFor(copy), preset.id).toBeUndefined();
  }
});
