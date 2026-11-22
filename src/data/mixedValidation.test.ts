import { expect, test } from 'vitest';
import { COACHED_TEMPLATE } from './mixedSession.test-fixture';
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

test('coached backups accept complete schedules and old placeholders only', () => {
  const block = COACHED_TEMPLATE.ordered!.blocks[2]!;
  if (block.kind !== 'coached' || !block.stations) throw new Error('Missing coached fixture');
  const { id, kind, name, durationSec } = block;
  const read = (replacement: object) => validateRows('templates', [{ ...COACHED_TEMPLATE, ordered: { name, blocks: [replacement] } }]);
  expect(() => read(block)).not.toThrow();
  expect(() => read({ id, kind, name, durationSec })).not.toThrow();
  expect(() => read({ ...block, restSec: 0.125, transitionSec: 0.999 })).not.toThrow();
  for (const patch of [
    { workSec: undefined }, { restSec: -1 }, { transitionSec: 0.00001 }, { workSec: 0 }, { workSec: Infinity },
    { restSec: 4000 }, { stations: [block.stations[0], block.stations[0]] }, { stations: [] },
    { coached: { rotations: 12 } }, { phases: [] }, { stationChanges: [] },
    { stations: [{ ...block.stations[0], target: { unit: 'sec', amount: 0.00001 } }] },
    { stations: [{ ...block.stations[1], target: { unit: 'm', amount: 10 } }] },
  ]) expect(() => read({ ...block, ...patch })).toThrow('malformed');
});
