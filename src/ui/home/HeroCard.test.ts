import { expect, test } from 'vitest';
import type { OrderedBlock } from '../../data/types';
import { durationLabel, orderedDurationLabel } from '../labels';

test('scheduled duration labels distinguish the full-workout boundary from adjacent seconds', () => {
  expect([2699, 2700, 2701].map(durationLabel)).toEqual(['44 min 59 s', '45 min', '45 min 1 s']);
  expect(durationLabel(0)).toBe('0 s');
});

test('only strength work marks an ordered duration as estimated', () => {
  const timed: OrderedBlock = { id: 'prep', kind: 'preparation', durationSec: 600, instructions: 'Warm up' };
  const strength: OrderedBlock = { id: 'lift', kind: 'strength', exerciseId: 'leg-press', sets: 1, repMin: 8, repMax: 10 };
  expect(orderedDurationLabel([timed])).toBe('10 min');
  expect(orderedDurationLabel([timed, strength])).toBe('10 min 30 s estimated');
});
