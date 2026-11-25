import { expect, test } from 'vitest';
import type { OrderedBlock } from '../../data/types';
import { durationLabel, estimatedMinutesLabel, orderedDurationLabel } from '../labels';

test('scheduled duration labels distinguish the full-workout boundary from adjacent seconds', () => {
  expect([2699, 2700, 2701].map(durationLabel)).toEqual(['44 min 59 s', '45 min', '45 min 1 s']);
  expect(durationLabel(0)).toBe('0 s');
});

test('only strength work marks an ordered duration as estimated', () => {
  const timed: OrderedBlock = { id: 'prep', kind: 'preparation', durationSec: 600, instructions: 'Warm up' };
  const strength: OrderedBlock = { id: 'lift', kind: 'strength', exerciseId: 'leg-press', sets: 1, repMin: 8, repMax: 10 };
  expect(orderedDurationLabel([timed])).toBe('10 min');
  expect(orderedDurationLabel([timed, strength])).toBe('11 min estimated');
});

test('estimates drop the seconds', () => {
  expect(estimatedMinutesLabel(2736)).toBe('46 min');
  expect(estimatedMinutesLabel(2700)).toBe('45 min');
});

test('lineup strength rows read whole minutes, never seconds', () => {
  const block: OrderedBlock = { id: 'lift', kind: 'strength', exerciseId: 'leg-press', sets: 1, repMin: 8, repMax: 12 };
  expect(orderedDurationLabel([block])).toBe('1 min estimated');
  expect(estimatedMinutesLabel(36)).toBe('1 min');
});
