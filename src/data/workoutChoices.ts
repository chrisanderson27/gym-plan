import { coachedEquipmentId, PHASE3_EXERCISE_IDS, phase3EquipmentId } from '../content/stationDemos';
import { COACHED_REST_SEC, COACHED_TRANSITION_SEC, COACHED_WORK_SEC } from '../engine/block/coached';
import { newLiftBlock } from '../engine/templates';
import { newId } from './ids';
import { LIFT_EXERCISES } from './lift';
import type { ExecutableCoachedBlock, LibraryBlock, LibraryStation, OrderedBlock, OrderedPrescription, OrderedSelfPacedBlock, OrderedStation, OrderedStrengthBlock, OrderedTimedBlock } from './types';

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

function strength(exerciseId: string, sets?: number): OrderedStrengthBlock {
  const { repMin, repMax } = LIFT_EXERCISES.get(exerciseId)!;
  const lift = newLiftBlock({ id: exerciseId, repMin, repMax }, () => exerciseId);
  return {
    ...lift, kind: 'strength',
    sets: sets ?? lift.sets,
  };
}

export const strengthWorkoutChoices = PHASE3_EXERCISE_IDS.flatMap((id) =>
  id !== 'leg-press' && (LIFT_EXERCISES.get(id)?.repMin ?? 0) > 0 ? [strength(id)] : []);

function starterStations(rows: LibraryStation[], coached: boolean) {
  return rows.map((row, index) => ({
    ...stationPrescription(row, String(index + 1)),
    equipmentId: coached ? coachedEquipmentId(row.exerciseId) : phase3EquipmentId(row.exerciseId),
  }));
}

const warmUp: OrderedTimedBlock = {
  id: 'warm-up', kind: 'preparation', durationSec: 300,
  instructions: 'Move at an easy pace, then rehearse the movements you plan to train.',
};
const coolDown: OrderedTimedBlock = {
  id: 'cool-down', kind: 'recovery', durationSec: 300,
  instructions: 'Slow your pace and breathe comfortably. Use gentle stretches as needed.',
};
const rotation: ExecutableCoachedBlock = {
  id: 'four-station-rotation', kind: 'coached', name: 'Four-station rotation', durationSec: 720,
  workSec: COACHED_WORK_SEC, restSec: COACHED_REST_SEC, transitionSec: COACHED_TRANSITION_SEC,
  stations: starterStations([
    { exerciseId: 'box-step-up', target: { unit: 'sec', amount: 45 } },
    { exerciseId: 'seated-cable-row', target: { unit: 'reps', amount: 10 } },
    { exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 12 } },
    { exerciseId: 'air-bike', target: { unit: 'sec', amount: 45 } },
  ], true),
};
const legsCircuit: OrderedSelfPacedBlock = {
  id: 'legs-core-circuit', kind: 'self-paced', name: 'Legs & core circuit', durationSec: 480,
  stations: starterStations([
    { exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'dead-bug', target: { unit: 'reps', amount: 8 } },
    { exerciseId: 'plank', target: { unit: 'sec', amount: 30 } },
  ], false),
};

const legPress = strength('leg-press', 5);
export const starterWorkoutBlocks: OrderedBlock[] = [warmUp, legPress, rotation, legsCircuit, coolDown];

interface StarterWorkout extends OrderedPrescription {
  category: string;
  description: string;
}

export const suggestedWorkouts: StarterWorkout[] = [
  {
    name: 'Legs & Core', category: 'Strength & conditioning',
    description: 'Build lower-body strength, then put it to work with coached intervals and a core-focused finish.',
    blocks: [warmUp, legPress, rotation, legsCircuit, coolDown],
  },
  {
    name: 'Shoulders & Back', category: 'Upper-body strength',
    description: 'Controlled pulling and pressing with a short alternating finisher.',
    blocks: [warmUp, strength('chest-press-machine'), {
      ...rotation, id: 'pull-and-press', name: 'Pull and press rotation', durationSec: 660,
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
      ...legsCircuit, id: 'full-body-circuit', name: 'Full-body circuit', durationSec: 840,
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

const suggestionContent = suggestedWorkouts.map((suggestion) => suggestion.blocks.map(workoutBlockContent));

export function matchingSuggestion(ordered: OrderedPrescription) {
  const content = ordered.blocks.map(workoutBlockContent);
  return suggestedWorkouts.find((_, index) => {
    const starter = suggestionContent[index]!;
    return starter.length === content.length && content.every((block, i) => block !== undefined && block === starter[i]);
  });
}
