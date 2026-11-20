import { expect, it } from 'vitest';
import { blockBeeps, remainingSec, restRemaining } from './clock';

it('counts down by elapsed seconds and clamps at zero', () => {
  expect(remainingSec(1000, 60, 1999)).toBe(60);
  expect(remainingSec(1000, 60, 2000)).toBe(59);
  expect(remainingSec(1000, 60, 70_000)).toBe(0);
  expect(restRemaining(1000, 90, 2000)).toBe(89);
});

it('beeps once at 60, 30, 3, 2 and 1, then plays go at zero', () => {
  for (const at of [60, 30, 3, 2, 1]) {
    expect(blockBeeps(at + 1, at)).toEqual(['tick']);
    expect(blockBeeps(at, at)).toEqual([]);
  }
  expect(blockBeeps(2, 0)).toEqual(['tick', 'go']);
  expect(blockBeeps(1, 0)).toEqual(['go']);
  expect(blockBeeps(0, 0)).toEqual([]);
  expect(blockBeeps(1, 2)).toEqual([]);
});

it('stays silent across a background jump', () => {
  expect(blockBeeps(65, 55)).toEqual([]);
  expect(blockBeeps(10, 0)).toEqual([]);
});
