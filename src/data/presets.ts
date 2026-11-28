import { COACHED_REST_SEC, COACHED_TRANSITION_SEC, COACHED_WORK_SEC } from '../engine/block/coached';
import { BLOCK_ROUNDS, blockSecondsForRounds } from '../engine/templates';
import { blockExerciseOf } from './liftday';
import { LEGACY_SUGGESTIONS, coolDown, legsCircuit, matchingStarter, rotation, starterStations, strength, warmUp } from './workoutChoices';
import type { ExecutableCoachedBlock, OrderedBlock, OrderedPrescription, OrderedRunBlock, OrderedSelfPacedBlock, OrderedTimedBlock } from './types';

export type PresetActivity = 'strength' | 'conditioning' | 'hybrid';
export interface WorkoutPreset extends OrderedPrescription {
  id: string;
  activity: PresetActivity;
  category: string;
  description: string;
}

export const PRESET_ACTIVITY_LABEL: Record<PresetActivity, string> = {
  strength: 'Strength', conditioning: 'Conditioning', hybrid: 'Hybrid · Run + strength',
};

const prep = (durationSec: number): OrderedTimedBlock => ({ ...warmUp, durationSec });
const recover = (durationSec: number): OrderedTimedBlock => ({ ...coolDown, durationSec });
type Rows = Parameters<typeof starterStations>[0];
const fixedCoached = (id: string, name: string, durationSec: number, rows: Rows): ExecutableCoachedBlock => ({
  ...rotation, id, name, durationSec, workSec: COACHED_WORK_SEC, restSec: COACHED_REST_SEC, transitionSec: COACHED_TRANSITION_SEC,
  stations: starterStations(rows, true),
});
const fixedCircuit = (id: string, name: string, durationSec: number, rows: Rows): OrderedSelfPacedBlock => ({
  ...legsCircuit, id, name, durationSec, stations: starterStations(rows, false),
});
/** The clock follows the stations: `rounds` passes, never a fixed length that a short lineup would repeat for. */
const sized = <T extends ExecutableCoachedBlock | OrderedSelfPacedBlock>(block: T, rounds: number): T =>
  ({ ...block, durationSec: blockSecondsForRounds(block, blockExerciseOf, rounds)! });
const coached = (id: string, name: string, rows: Rows, rounds: number = BLOCK_ROUNDS.target) => sized(fixedCoached(id, name, 0, rows), rounds);
const circuit = (id: string, name: string, rows: Rows, rounds: number = BLOCK_ROUNDS.target) => sized(fixedCircuit(id, name, 0, rows), rounds);
const run = (id: string, name: string, runKind: OrderedRunBlock['runKind'], modality: OrderedRunBlock['modality'], durationSec: number): OrderedRunBlock =>
  ({ id, kind: 'run', name, runKind, modality, durationSec });
const reps = (exerciseId: string, amount: number) => ({ exerciseId, target: { unit: 'reps' as const, amount } });
const metres = (exerciseId: string, amount: number) => ({ exerciseId, target: { unit: 'm' as const, amount } });
const secs = (exerciseId: string, amount: number) => ({ exerciseId, target: { unit: 'sec' as const, amount } });

const blocks = (...b: OrderedBlock[]) => b;

/** Bundled, offline presets. Run-plus-strength hybrids pair the run with upper-body strength so the run is not swapped to a machine. */
export const WORKOUT_PRESETS: WorkoutPreset[] = [
  {
    id: 'lower-strength-core', name: 'Lower Strength & Core', activity: 'strength', category: 'Lower-body strength',
    description: 'Heavy leg press and hip thrusts, then a six-station legs, upper and core circuit.',
    blocks: blocks(prep(420), strength('leg-press', 5), strength('hip-thrust', 4), strength('calf-raise', 3),
      circuit('legs-core', 'Legs & core circuit', [reps('reverse-lunge', 10), reps('push-up', 8), secs('plank', 40),
        reps('step-up', 10), reps('one-arm-db-row', 10), reps('dead-bug', 8)]), recover(360)),
  },
  {
    id: 'upper-push-pull', name: 'Upper Push & Pull', activity: 'strength', category: 'Upper-body strength',
    description: 'Machine pressing, a pull and press rotation, then a push-up circuit.',
    blocks: blocks(prep(420), strength('chest-press-machine', 6),
      coached('pull-row', 'Pull and press rotation', [reps('seated-cable-row', 10), reps('goblet-squat', 12), reps('seated-db-press', 8),
        secs('plank', 30), reps('one-arm-db-row', 10), reps('reverse-lunge', 8)]),
      circuit('push-circuit', 'Push-up circuit', [reps('push-up', 8), reps('step-up', 10), reps('dead-bug', 8),
        reps('bulgarian-split-squat', 8), secs('rower', 45)]), recover(360)),
  },
  {
    id: 'full-body-strength', name: 'Full-Body Strength', activity: 'strength', category: 'Full-body strength',
    description: 'Hip thrusts and chest press, a seven-station rotation and a dumbbell circuit.',
    blocks: blocks(prep(360), strength('hip-thrust', 5), strength('chest-press-machine', 4),
      coached('rotation', 'Rotation', [reps('goblet-squat', 12), reps('seated-cable-row', 10), secs('air-bike', 40), reps('push-up', 8),
        secs('plank', 30), reps('step-up', 10), reps('one-arm-db-row', 10)]),
      circuit('db-circuit', 'Dumbbell circuit', [reps('reverse-lunge', 8), reps('seated-db-press', 8), reps('dead-bug', 8),
        reps('bulgarian-split-squat', 8), secs('rower', 45)]), recover(300)),
  },
  {
    id: 'single-leg-strength', name: 'Single-Leg Strength', activity: 'strength', category: 'Unilateral strength',
    description: 'Bulgarian split squats, step-ups and calf raises with an upper and core circuit.',
    blocks: blocks(prep(420), strength('bulgarian-split-squat', 5), strength('step-up', 4), strength('calf-raise', 4),
      circuit('core-circuit', 'Upper & core circuit', [reps('push-up', 8), reps('reverse-lunge', 8), secs('plank', 30),
        reps('seated-db-press', 8), reps('one-arm-db-row', 10), reps('dead-bug', 8)]), recover(360)),
  },
  {
    id: 'two-rotations', name: 'Two Rotations', activity: 'conditioning', category: 'Coached conditioning',
    description: 'Two coached eight-station rotations with a steady pace.',
    blocks: blocks(prep(420),
      coached('rotation-a', 'Rotation A', [secs('box-step-up', 45), reps('seated-cable-row', 10), reps('goblet-squat', 12), reps('seated-db-press', 8),
        secs('air-bike', 45), reps('one-arm-db-row', 10), reps('reverse-lunge', 8), secs('plank', 30)]),
      coached('rotation-b', 'Rotation B', [reps('push-up', 8), secs('rower', 40), reps('step-up', 10), reps('dead-bug', 8),
        reps('chest-press-machine', 10), reps('bulgarian-split-squat', 8), metres('farmer-carry', 30), reps('calf-raise', 12)]), recover(360)),
  },
  {
    id: 'rower-intervals-circuit', name: 'Rower & Bike Intervals', activity: 'conditioning', category: 'Machine intervals',
    description: 'Two coached rower and air-bike rotations around a self-paced dumbbell circuit.',
    blocks: blocks(prep(420),
      coached('machines', 'Rower and bike', [secs('rower', 45), reps('goblet-squat', 12), secs('air-bike', 45), reps('seated-cable-row', 10),
        secs('plank', 30), reps('push-up', 8)]),
      circuit('finish-circuit', 'Dumbbell circuit', [reps('step-up', 10), reps('seated-db-press', 8), metres('farmer-carry', 30), reps('one-arm-db-row', 10)]),
      coached('machines-2', 'Bike and rower', [secs('air-bike', 45), reps('reverse-lunge', 8), secs('rower', 45), reps('chest-press-machine', 10),
        reps('dead-bug', 8), reps('calf-raise', 12)]), recover(360)),
  },
  {
    id: 'core-carry-circuit', name: 'Core & Carry Circuit', activity: 'conditioning', category: 'Core and carries',
    description: 'Farmer carries, planks and dead bugs spread through three balanced circuits.',
    blocks: blocks(prep(360),
      circuit('carry-a', 'Carry circuit A', [metres('farmer-carry', 30), reps('reverse-lunge', 8), reps('push-up', 8), secs('plank', 30),
        reps('one-arm-db-row', 10), secs('rower', 45)]),
      circuit('carry-b', 'Carry circuit B', [reps('dead-bug', 10), reps('step-up', 10), reps('seated-db-press', 10), metres('farmer-carry', 30),
        reps('bulgarian-split-squat', 8), reps('chest-press-machine', 10)]),
      circuit('carry-c', 'Carry circuit C', [secs('plank', 40), reps('reverse-lunge', 8), reps('one-arm-db-row', 10), reps('dead-bug', 8),
        reps('push-up', 8), secs('rower', 45)]), recover(360)),
  },
  {
    id: 'step-and-row', name: 'Step & Row', activity: 'conditioning', category: 'Step and row',
    description: 'Box step-up and rowing rotations around a self-paced dumbbell circuit.',
    blocks: blocks(prep(420),
      coached('step-row', 'Step and row rotation', [secs('box-step-up', 45), reps('seated-cable-row', 10), reps('reverse-lunge', 8), secs('rower', 45),
        reps('push-up', 8), secs('plank', 30)]),
      circuit('step-circuit', 'Strength circuit', [reps('step-up', 10), reps('seated-db-press', 8), reps('dead-bug', 8),
        reps('bulgarian-split-squat', 8), reps('one-arm-db-row', 10)]),
      coached('step-row-2', 'Row and step rotation', [secs('rower', 45), reps('goblet-squat', 12), secs('box-step-up', 45), reps('chest-press-machine', 10),
        metres('farmer-carry', 30), reps('seated-cable-row', 10)]), recover(360)),
  },
  {
    id: 'run-upper-strength', name: 'Run + Upper Strength', activity: 'hybrid', category: 'Run and strength',
    description: 'An easy 20-minute run with chest press and an upper-body circuit.',
    blocks: blocks(prep(420), run('run', 'Easy run', 'easy', 'run', 1200), strength('chest-press-machine', 6),
      circuit('upper-finish', 'Upper circuit', [reps('push-up', 8), reps('reverse-lunge', 8), reps('one-arm-db-row', 10), secs('plank', 30),
        reps('step-up', 10)]), recover(360)),
  },
  {
    id: 'run-intervals-upper', name: 'Run Intervals + Upper', activity: 'hybrid', category: 'Intervals and strength',
    description: 'Run intervals, a six-station row rotation and chest press.',
    blocks: blocks(prep(420), run('run', 'Run intervals', 'intervals', 'run', 1200),
      coached('row-rotation', 'Row rotation', [reps('seated-cable-row', 10), reps('goblet-squat', 12), reps('push-up', 8), secs('plank', 30),
        reps('one-arm-db-row', 10), reps('reverse-lunge', 8)]), strength('chest-press-machine', 5), recover(360)),
  },
  {
    id: 'strength-then-run', name: 'Strength then Run', activity: 'hybrid', category: 'Strength then run',
    description: 'Upper strength and a six-station circuit first, then an easy 15-minute run.',
    blocks: blocks(prep(420), strength('chest-press-machine', 6),
      circuit('upper-core', 'Upper and core circuit', [reps('push-up', 8), reps('reverse-lunge', 8), reps('one-arm-db-row', 10), reps('dead-bug', 8),
        reps('seated-db-press', 8), reps('step-up', 10)]),
      run('run', 'Easy run', 'easy', 'run', 900), recover(360)),
  },
  {
    id: 'bike-lower-strength', name: 'Bike + Lower Strength', activity: 'hybrid', category: 'Bike and strength',
    description: 'Leg press and hip thrusts with a bike segment (the leg-day machine option).',
    blocks: blocks(prep(420), run('bike', 'Bike', 'easy', 'bike', 1200), strength('leg-press', 5), strength('hip-thrust', 4),
      circuit('bike-circuit', 'Legs & core circuit', [reps('reverse-lunge', 8), reps('push-up', 8), reps('dead-bug', 8), reps('step-up', 10),
        reps('one-arm-db-row', 10), secs('plank', 30)]), recover(360)),
  },
];

/**
 * The catalog before blocks were sized by rounds. Never offered; kept so workouts users already saved from a preset keep
 * their category and description.
 */
const LEGACY_PRESETS: { category: string; description: string; blocks: OrderedBlock[] }[] = [
  {
    category: 'Lower-body strength',
    description: 'Heavy leg press and hip thrusts, then a legs and core circuit.',
    blocks: blocks(prep(420), strength('leg-press', 5), strength('hip-thrust', 4), strength('calf-raise', 3),
      fixedCircuit('legs-core', 'Legs & core circuit', 720, [reps('reverse-lunge', 8), reps('dead-bug', 8), secs('plank', 30)]), recover(360)),
  },
  {
    category: 'Upper-body strength',
    description: 'Machine pressing and push-ups, then a seated cable row rotation.',
    blocks: blocks(prep(420), strength('chest-press-machine', 6),
      fixedCoached('pull-row', 'Pull and row rotation', 1260, [reps('seated-cable-row', 10), reps('push-up', 8)]), recover(360)),
  },
  {
    category: 'Full-body strength',
    description: 'Hip thrusts and chest press with a rotation to finish.',
    blocks: blocks(prep(360), strength('hip-thrust', 5), strength('chest-press-machine', 4),
      fixedCoached('rotation', 'Rotation', 1200, [reps('goblet-squat', 12), reps('seated-cable-row', 10), secs('air-bike', 40)]), recover(300)),
  },
  {
    category: 'Unilateral strength',
    description: 'Bulgarian split squats, step-ups and calf raises with a core circuit.',
    blocks: blocks(prep(360), strength('bulgarian-split-squat', 5), strength('step-up', 4), strength('calf-raise', 4),
      fixedCircuit('core-circuit', 'Core circuit', 780, [reps('dead-bug', 8), secs('plank', 30), reps('reverse-lunge', 8)]), recover(300)),
  },
  {
    category: 'Coached conditioning',
    description: 'Two coached four-station rotations with a steady pace.',
    blocks: blocks(prep(420), fixedCoached('rotation-a', 'Rotation A', 1200, [secs('box-step-up', 45), reps('seated-cable-row', 10), reps('goblet-squat', 12), secs('air-bike', 45)]),
      fixedCoached('rotation-b', 'Rotation B', 1200, [reps('push-up', 8), secs('rower', 40), reps('reverse-lunge', 8), secs('plank', 30)]), recover(360)),
  },
  {
    category: 'Machine intervals',
    description: 'Coached rower and air-bike intervals, then a self-paced circuit.',
    blocks: blocks(prep(420), fixedCoached('machines', 'Rower and bike', 1500, [secs('rower', 45), secs('air-bike', 45)]),
      fixedCircuit('finish-circuit', 'Finishing circuit', 900, [reps('push-up', 8), reps('reverse-lunge', 8), secs('plank', 30)]), recover(360)),
  },
  {
    category: 'Core and carries',
    description: 'Farmer carries, planks and dead bugs in long, controlled rounds.',
    blocks: blocks(prep(360), fixedCircuit('carry-a', 'Carry circuit A', 1080, [metres('farmer-carry', 30), secs('plank', 30), reps('dead-bug', 8)]),
      fixedCircuit('carry-b', 'Carry circuit B', 1080, [secs('plank', 40), reps('dead-bug', 10), metres('farmer-carry', 30)]), recover(360)),
  },
  {
    category: 'Step and row',
    description: 'Box step-ups and rowing in a rotation, then a bodyweight circuit.',
    blocks: blocks(prep(420), fixedCoached('step-row', 'Step and row rotation', 1380, [secs('box-step-up', 45), secs('rower', 45)]),
      fixedCircuit('step-circuit', 'Bodyweight circuit', 960, [reps('push-up', 8), reps('dead-bug', 8), secs('plank', 30)]), recover(360)),
  },
  {
    category: 'Run and strength',
    description: 'An easy 20-minute run with chest press and push-up strength.',
    blocks: blocks(prep(420), run('run', 'Easy run', 'easy', 'run', 1200), strength('chest-press-machine', 6),
      fixedCircuit('upper-finish', 'Upper circuit', 600, [reps('push-up', 8), secs('plank', 30)]), recover(360)),
  },
  {
    category: 'Intervals and strength',
    description: 'Run intervals, a seated cable row rotation and chest press.',
    blocks: blocks(prep(420), run('run', 'Run intervals', 'intervals', 'run', 1200),
      fixedCoached('row-rotation', 'Row rotation', 720, [reps('seated-cable-row', 10), reps('push-up', 8)]), strength('chest-press-machine', 5), recover(360)),
  },
  {
    category: 'Strength then run',
    description: 'Upper strength first, then an easy 15-minute run.',
    blocks: blocks(prep(420), strength('chest-press-machine', 6),
      fixedCircuit('upper-core', 'Upper and core circuit', 780, [reps('push-up', 8), reps('dead-bug', 8), secs('plank', 30)]),
      run('run', 'Easy run', 'easy', 'run', 900), recover(360)),
  },
  {
    category: 'Bike and strength',
    description: 'Leg press and hip thrusts with a bike segment (the leg-day machine option).',
    blocks: blocks(prep(420), run('bike', 'Bike', 'easy', 'bike', 1200), strength('leg-press', 5), strength('hip-thrust', 4),
      fixedCircuit('bike-circuit', 'Legs & core circuit', 660, [reps('reverse-lunge', 8), reps('dead-bug', 8), secs('plank', 30)]), recover(360)),
  },
];

export const presetById = (id: string) => WORKOUT_PRESETS.find((preset) => preset.id === id);

/** Presets, their pre-rounds versions and the three original suggestions, so copies users saved earlier keep their category and description. */
export const matchingSuggestion = (ordered: OrderedPrescription): { category: string; description: string } | undefined =>
  matchingStarter<{ category: string; description: string; blocks: OrderedBlock[] }>([...WORKOUT_PRESETS, ...LEGACY_PRESETS, ...LEGACY_SUGGESTIONS], ordered);
