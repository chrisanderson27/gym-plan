import { expect, it } from 'vitest';
import { blockStateKey, restoreBlockState } from './blockState';

it('uses the same storage key as existing running blocks', () => {
  expect(blockStateKey('session', 'work')).toBe('block:session:work');
});

it('restores progress from partial block state and supplies missing maps', () => {
  expect(restoreBlockState({ startedAtMs: 2000, rounds: 2 })).toEqual({
    startedAtMs: 2000, rounds: 2, swapped: {}, loads: {},
  });
});

it('drops malformed block fields without losing valid load edits or swaps', () => {
  expect(restoreBlockState({
    startedAtMs: 'bad', rounds: -1, swapped: { 0: true, 1: 'true' }, loads: { 0: 0, 1: '20', 2: -1 },
  })).toEqual({ startedAtMs: null, rounds: 0, swapped: { 0: true }, loads: { 0: 0 } });
  expect(restoreBlockState({ loads: null, swapped: [true] })).toEqual(restoreBlockState(null));
});
