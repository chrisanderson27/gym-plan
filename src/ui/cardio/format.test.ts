import { expect, it } from 'vitest';
import { DRILLS } from '../../content/drills';
import type { SwimItem } from '../../data/types';
import { itemLine } from './format';

const swim: SwimItem = {
  reps: 4, distance: 150, swimKind: 'swim', stroke: 'FR', intensity: 'MOD', equipment: [], mode: 'rest', seconds: 20,
};

it('writes repeats, pool units, stroke, effort and rest in plain language', () => {
  expect(itemLine(swim, 'yd')).toBe('4 × 150 yd freestyle · steady · 20 s rest');
});

it('writes send-offs as a leave interval', () => {
  expect(itemLine({ ...swim, mode: 'sendoff', seconds: 125 }, 'yd')).toBe('4 × 150 yd freestyle · steady · leave every 2:05');
});

it('omits effort for kick sets', () => {
  expect(itemLine({ ...swim, swimKind: 'kick' }, 'm')).toBe('4 × 150 m kick · 20 s rest');
});

it('uses the drill name without an effort word', () => {
  const drill = DRILLS[0]!;
  expect(itemLine({ ...swim, swimKind: 'drill', drillId: drill.id }, 'm')).toBe(`4 × 150 m ${drill.name} · 20 s rest`);
});

it('omits the repetition prefix for a single rep', () => {
  expect(itemLine({ ...swim, reps: 1, distance: 300, intensity: 'EZ', seconds: undefined }, 'yd')).toBe('300 yd freestyle · easy');
});
