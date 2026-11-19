import { expect, it } from 'vitest';
import type { CircuitBlock } from '../../data/types';
import { circuitWork, isLoadedCircuit } from './work';

const block: CircuitBlock = {
  id: 'mixed', kind: 'circuit', role: 'block', podId: 'turf', durationSec: 720, targetRounds: 5,
  stations: [
    { exerciseId: 'goblet-squat', load: 20, target: { unit: 'reps', amount: 10 } },
    { exerciseId: 'rower', target: { unit: 'cal', amount: 15 } },
    { exerciseId: 'sled-push', target: { unit: 'm', amount: 20 } },
  ],
  log: {
    completedRounds: 5, actualDurationSec: 720, partialReps: { stationIndex: 2, count: 6 },
    stations: [{ exerciseId: 'goblet-squat', actualLoad: 25 }, { exerciseId: 'rower' }, { exerciseId: 'sled-push' }],
  },
};

it('normalizes full and partial work across mixed units', () => {
  expect(circuitWork(block)).toEqual({
    perStation: [
      { exerciseId: 'goblet-squat', unit: 'reps', amount: 60 },
      { exerciseId: 'rower', unit: 'cal', amount: 90 },
      { exerciseId: 'sled-push', unit: 'm', amount: 106 },
    ],
    total: 17.3,
  });
  expect(isLoadedCircuit(block)).toBe(true);
});

it('clamps a partial station index beyond the last station', () => {
  const pastEnd = { ...block, log: { ...block.log!, partialReps: { stationIndex: 30, count: 6 } } };
  expect(circuitWork(pastEnd)?.total).toBe(18);
});

it('uses the target of the actual station when a swap changes units', () => {
  const swap = structuredClone(block);
  swap.stations[2]!.backup = { exerciseId: 'pallof-press', target: { unit: 'reps', amount: 10 } };
  swap.log!.stations[2] = { exerciseId: 'pallof-press', swappedFromExerciseId: 'sled-push' };
  expect(circuitWork(swap)?.perStation[2]).toEqual({ exerciseId: 'pallof-press', unit: 'reps', amount: 56 });
});

it('excludes unlogged, unloaded and uncompleted circuits from loaded work', () => {
  expect(circuitWork({ ...block, log: undefined })).toBeNull();
  expect(isLoadedCircuit({ ...block, log: undefined })).toBe(false);
  expect(isLoadedCircuit({ ...block, log: { ...block.log!, completedRounds: 0, partialReps: undefined } })).toBe(false);
  const station = { exerciseId: 'push-up', target: { unit: 'reps' as const, amount: 10 } };
  expect(isLoadedCircuit({ ...block, stations: [station], log: { ...block.log!, stations: [{ exerciseId: 'push-up' }] } })).toBe(false);
});
