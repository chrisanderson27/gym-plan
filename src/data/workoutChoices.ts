import { coachedEquipmentId, PHASE3_EXERCISE_IDS, phase3EquipmentId } from '../content/stationDemos';
import { COACHED_REST_SEC, COACHED_TRANSITION_SEC, COACHED_WORK_SEC } from '../engine/block/coached';
import { BLOCK_MAX_STATIONS, blockBalanceIssues, blockSecondsForRounds, isHardBlockIssue, newLiftBlock, type BlockIssue } from '../engine/templates';
import { newId } from './ids';
import { blockExerciseOf } from './liftday';
import { LIFT_EXERCISES } from './lift';
import type { Block, ExecutableCoachedBlock, LibraryBlock, LibraryStation, OrderedBlock, OrderedPrescription, OrderedRunBlock, OrderedSelfPacedBlock, OrderedStation, OrderedStrengthBlock, OrderedTimedBlock } from './types';

export function copyWorkoutBlock(block: OrderedBlock, makeId = newId): OrderedBlock {
  const copy = structuredClone(block);
  copy.id = makeId();
  if ((copy.kind === 'coached' || copy.kind === 'self-paced') && copy.stations) {
    for (const station of copy.stations) station.slotId = makeId();
  }
  return copy;
}

function stationPrescription({ exerciseId, target, load }: LibraryStation, slotId: string): OrderedStation {
  return { slotId, exerciseId, target: { unit: target.unit, amount: target.amount }, ...(load === undefined ? {} : { load }) };
}

/** Picker rows keep their source identity until they are copied into the workout. */
export function libraryWorkoutBlock(row: LibraryBlock): OrderedBlock {
  const { id, name, durationSec } = row;
  const stations = row.stations.map((station, index) => stationPrescription(station, String(index + 1)));
  if (row.kind === 'self-paced') return { id, name, kind: row.kind, durationSec, stations };
  const { workSec, restSec, transitionSec } = row;
  if (workSec === undefined || restSec === undefined || transitionSec === undefined) return { id, name, kind: row.kind, durationSec };
  return { id, name, kind: row.kind, durationSec, stations, workSec, restSec, transitionSec };
}

export function strength(exerciseId: string, sets?: number): OrderedStrengthBlock {
  const { repMin, repMax } = LIFT_EXERCISES.get(exerciseId)!;
  const lift = newLiftBlock({ id: exerciseId, repMin, repMax }, () => exerciseId);
  return {
    ...lift, kind: 'strength',
    sets: sets ?? lift.sets,
  };
}

export const strengthWorkoutChoices = PHASE3_EXERCISE_IDS.flatMap((id) =>
  id !== 'leg-press' && (LIFT_EXERCISES.get(id)?.repMin ?? 0) > 0 ? [strength(id)] : []);

export function starterStations(rows: LibraryStation[], coached: boolean) {
  return rows.map((row, index) => ({
    ...stationPrescription(row, String(index + 1)),
    equipmentId: coached ? coachedEquipmentId(row.exerciseId) : phase3EquipmentId(row.exerciseId),
  }));
}

export const warmUp: OrderedTimedBlock = {
  id: 'warm-up', kind: 'preparation', durationSec: 300,
  instructions: 'Move at an easy pace, then rehearse the movements you plan to train.',
};
export const coolDown: OrderedTimedBlock = {
  id: 'cool-down', kind: 'recovery', durationSec: 300,
  instructions: 'Slow your pace and breathe comfortably. Use gentle stretches as needed.',
};
// The original built-ins: 2 core moves of 3, and a rotation that loops from air bike straight back to box step-up.
// Kept only so copies saved from the original suggestions still match them.
const legacyRotation: ExecutableCoachedBlock = {
  id: 'four-station-rotation', kind: 'coached', name: 'Four-station rotation', durationSec: 720,
  workSec: COACHED_WORK_SEC, restSec: COACHED_REST_SEC, transitionSec: COACHED_TRANSITION_SEC,
  stations: starterStations([
    { exerciseId: 'box-step-up', target: { unit: 'sec', amount: 45 } },
    { exerciseId: 'seated-cable-row', target: { unit: 'reps', amount: 10 } },
    { exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 12 } },
    { exerciseId: 'air-bike', target: { unit: 'sec', amount: 45 } },
  ], true),
};
const legacyLegsCircuit: OrderedSelfPacedBlock = {
  id: 'legs-core-circuit', kind: 'self-paced', name: 'Legs & core circuit', durationSec: 480,
  stations: starterStations([
    { exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'dead-bug', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'plank', target: { unit: 'sec', amount: 30 } },
  ], false),
};

/** Sized for three rounds, the same rule the presets and the Block Builder use. */
const threeRounds = <T extends ExecutableCoachedBlock | OrderedSelfPacedBlock>(block: T): T =>
  ({ ...block, durationSec: blockSecondsForRounds(block, blockExerciseOf) ?? block.durationSec });

export const rotation: ExecutableCoachedBlock = threeRounds({
  ...legacyRotation,
  stations: starterStations([
    { exerciseId: 'box-step-up', target: { unit: 'sec', amount: 45 } },
    { exerciseId: 'seated-cable-row', target: { unit: 'reps', amount: 10 } },
    { exerciseId: 'air-bike', target: { unit: 'sec', amount: 45 } },
    { exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 12 } },
  ], true),
});
export const legsCircuit: OrderedSelfPacedBlock = threeRounds({
  ...legacyLegsCircuit,
  stations: starterStations([
    { exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'step-up', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'plank', target: { unit: 'sec', amount: 30 } },
  ], false),
});

const legPress = strength('leg-press', 5);
export const starterWorkoutBlocks: OrderedBlock[] = [warmUp, legPress, rotation, legsCircuit, coolDown];

export interface StarterWorkout extends OrderedPrescription {
  category: string;
  description: string;
}

/** The three original suggestions. Kept only so copies users saved earlier keep their category and description. */
export const LEGACY_SUGGESTIONS: StarterWorkout[] = [
  {
    name: 'Legs & Core', category: 'Strength & conditioning',
    description: 'Build lower-body strength, then put it to work with coached intervals and a core-focused finish.',
    blocks: [warmUp, legPress, legacyRotation, legacyLegsCircuit, coolDown],
  },
  {
    name: 'Shoulders & Back', category: 'Upper-body strength',
    description: 'Controlled pulling and pressing with a short alternating finisher.',
    blocks: [warmUp, strength('chest-press-machine'), {
      ...legacyRotation, id: 'pull-and-press', name: 'Pull and press rotation', durationSec: 660,
      stations: starterStations([
        { exerciseId: 'seated-cable-row', target: { unit: 'reps', amount: 10 } },
        { exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } },
      ], true),
    }, coolDown],
  },
  {
    name: 'Full-Body Strength & Conditioning', category: 'Full-body conditioning',
    description: 'A balanced circuit that keeps you moving without rushing your reps.',
    blocks: [warmUp, strength('hip-thrust'), {
      ...legacyLegsCircuit, id: 'full-body-circuit', name: 'Full-body circuit', durationSec: 840,
      stations: starterStations([
        { exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } },
        { exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 8 } },
        { exerciseId: 'rower', target: { unit: 'sec', amount: 30 } },
      ], false),
    }, coolDown],
  },
];

function stationContent({ exerciseId, equipmentId, load, target }: OrderedStation) {
  return [exerciseId, equipmentId, load, target.unit, target.amount];
}

function blockContent(block: OrderedBlock): unknown[] {
  switch (block.kind) {
    case 'strength':
      return [block.kind, block.exerciseId, block.equipmentId, block.sets, block.repMin, block.repMax,
        block.targetWeight, block.restSec, block.rirTarget, block.label];
    case 'coached':
      return [block.kind, block.name, block.durationSec, block.workSec, block.restSec, block.transitionSec,
        block.stations?.map(stationContent)];
    case 'self-paced':
      return [block.kind, block.name, block.durationSec, block.stations.map(stationContent)];
    case 'run':
      return [block.kind, block.name, block.runKind, block.modality, block.durationSec];
    default:
      return [block.kind, block.durationSec, block.instructions, block.exerciseId];
  }
}

export function workoutBlockContent(block: OrderedBlock) {
  // Longer historical text remains readable. It is too long to use for picker or suggestion matching.
  let oversized = false;
  const content = JSON.stringify(blockContent(block), (_, value) => {
    if (typeof value !== 'string' || value.length <= 1024) return value;
    oversized = true;
    return undefined;
  });
  return oversized ? undefined : content;
}

/**
 * The first station block in a saved workout that the Block Builder would now refuse, such as 2 exercises looping for 23
 * minutes. Workouts saved before the limits keep running; this lets the Workouts screen point the problem out.
 */
export function refusedBlock(blocks: readonly OrderedBlock[]): { name: string; issue: BlockIssue } | undefined {
  for (const block of blocks) {
    if ((block.kind !== 'coached' && block.kind !== 'self-paced') || !block.stations) continue;
    const issue = blockBalanceIssues(block, blockExerciseOf).find(isHardBlockIssue);
    if (issue) return { name: block.name, issue };
  }
  return undefined;
}

/** Finds the starter (preset or legacy suggestion) whose block content a saved workout still matches exactly. */
export function matchingStarter<T extends { blocks: OrderedBlock[] }>(starters: readonly T[], ordered: OrderedPrescription): T | undefined {
  const content = ordered.blocks.map(workoutBlockContent);
  return starters.find((starter) => {
    const expected = starter.blocks.map(workoutBlockContent);
    return expected.length === content.length && content.every((block, i) => block !== undefined && block === expected[i]);
  });
}

export const runWorkoutChoices: OrderedRunBlock[] = [
  { id: 'run-easy-15', kind: 'run', name: 'Easy run · 15 min', runKind: 'easy', modality: 'run', durationSec: 900 },
  { id: 'run-easy-20', kind: 'run', name: 'Easy run · 20 min', runKind: 'easy', modality: 'run', durationSec: 1200 },
  { id: 'run-intervals-20', kind: 'run', name: 'Run intervals · 20 min', runKind: 'intervals', modality: 'run', durationSec: 1200 },
];

/** Maps a legacy (non-ordered) saved workout into an editable draft. Circuits become self-paced blocks; interval and swim blocks are not carried over. */
export function legacyWorkoutDraft(runnable: { name: string; blocks: Block[] }, makeId = newId): { draft: OrderedPrescription; dropped: string[] } {
  const blocks: OrderedBlock[] = [];
  const dropped: string[] = [];
  let hasRun = false;
  for (const b of runnable.blocks) {
    if (b.kind === 'lift') {
      if (b.warmup) continue;
      const { id: _id, exerciseId, sets, repMin, repMax, restSec, equipmentId } = b;
      void _id;
      blocks.push({ id: makeId(), kind: 'strength', exerciseId, sets, repMin, repMax, ...(restSec === undefined ? {} : { restSec }),
        ...(equipmentId === undefined ? {} : { equipmentId }) });
    } else if (b.kind === 'run' && !hasRun) {
      hasRun = true;
      const sec = b.repeats * b.segments.reduce((n, seg) => n + (seg.sec ?? 0), 0);
      blocks.push({ id: makeId(), kind: 'run', name: b.runKind === 'intervals' ? 'Run intervals' : 'Easy run', runKind: b.runKind === 'intervals' ? 'intervals' : 'easy',
        modality: b.modality === 'bike' || b.modality === 'row' ? b.modality : 'run', durationSec: Math.min(3600, Math.max(300, Math.round(sec))) });
    } else if (b.kind === 'circuit' && b.stations.length) {
      const stations = b.stations.slice(0, BLOCK_MAX_STATIONS).map(({ exerciseId, equipmentId, load, target }): OrderedStation => ({
        slotId: makeId(), exerciseId, target: { unit: target.unit, amount: target.amount },
        ...(load === undefined ? {} : { load }), ...(equipmentId === undefined ? {} : { equipmentId }) }));
      blocks.push({ id: makeId(), kind: 'self-paced', name: b.label ?? 'Circuit', durationSec: Math.min(3600, Math.max(60, Math.round(b.durationSec))), stations });
    } else dropped.push(b.kind);
  }
  return { draft: { name: runnable.name, blocks }, dropped: [...new Set(dropped)] };
}

/** Accessory stations for a lift day, with compatible alternatives within each training role. */
export const todayAccessorySlots = {
  // Box step-up counts as cardio, so it comes last in the leg role, behind the moves that can sit next to the bike.
  lower: [
    ['reverse-lunge', 'step-up', 'box-step-up'],
    ['seated-cable-row', 'one-arm-db-row', 'push-up'],
    ['dead-bug', 'plank'],
    ['air-bike', 'rower', 'plank'],
  ],
  // A self-paced circuit cannot use the cable row or chest press, so each role has a dumbbell move it can.
  upper: [
    ['seated-cable-row', 'one-arm-db-row', 'push-up'],
    ['push-up', 'seated-db-press', 'chest-press-machine'],
    ['plank', 'dead-bug'],
    ['air-bike', 'rower', 'dead-bug'],
  ],
} as const;

export const todayPreparation = {
  ...warmUp, durationSec: 420,
  instructions: 'Walk or march easily for three minutes. Mobilize your joints and rehearse the first lift without load. Keep the circuits conversational, use light resistance, and pause between rounds.',
};
export const todayRecovery = {
  ...coolDown, durationSec: 360,
  instructions: 'Walk slowly for three minutes. Then breathe comfortably and gently stretch the muscles you trained.',
};
