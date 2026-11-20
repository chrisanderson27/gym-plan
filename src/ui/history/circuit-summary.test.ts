import { expect, it } from 'vitest';
import type { CircuitBlock } from '../../data/types';
import { circuitSummary } from './circuit-summary';

it('includes finished stations and uses the logged substitute unit in the partial round', () => {
  const block: CircuitBlock = {
    id: 'circuit', kind: 'circuit', role: 'block', podId: 'turf', durationSec: 480, targetRounds: 5,
    stations: [
      { exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 10 } },
      { exerciseId: 'rower', target: { unit: 'm', amount: 100 },
        backup: { exerciseId: 'air-bike', target: { unit: 'cal', amount: 12 } } },
      { exerciseId: 'plank', target: { unit: 'sec', amount: 30 } },
    ],
    log: {
      completedRounds: 3, partialReps: { stationIndex: 1, count: 4 }, actualDurationSec: 480,
      stations: [{ exerciseId: 'goblet-squat' }, { exerciseId: 'air-bike', swappedFromExerciseId: 'rower' }, { exerciseId: 'plank' }],
    },
  };

  expect(circuitSummary(block)).toBe('3 rounds + 10 reps + 4 cal');
});
