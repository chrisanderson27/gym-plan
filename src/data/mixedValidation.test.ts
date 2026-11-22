import { expect, test } from 'vitest';
import { validateRows } from './validate';
import type { Template } from './types';

const template: Template = {
  id: 'legs', name: 'Legs', type: 'custom', source: 'saved', blocks: [], createdAt: '2026-11-22T12:00:00Z',
  ordered: { name: 'Legs', blocks: [{ id: 'prep', kind: 'preparation', durationSec: 60, instructions: 'Warm up' }] },
};

test('ordered imports accept unknown exercise IDs and reject duplicate slots and malformed durations', () => {
  const station = { slotId: 'a', exerciseId: 'old-exercise', target: { unit: 'reps', amount: 10 } };
  const circuit = { id: 'circuit', kind: 'self-paced', name: 'Circuit', durationSec: 480, stations: [station] };
  expect(() => validateRows('templates', [{ ...template, ordered: { name: 'Legs', blocks: [circuit] } }])).not.toThrow();
  expect(() => validateRows('templates', [{
    ...template, ordered: { name: 'Legs', blocks: [{ ...circuit, stations: [station, station] }] },
  }])).toThrow('malformed');
  expect(() => validateRows('templates', [{
    ...template, ordered: { name: 'Legs', blocks: [{ ...circuit, durationSec: Infinity }] },
  }])).toThrow('malformed');
});
