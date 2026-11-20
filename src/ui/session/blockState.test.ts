import { expect, it, vi } from 'vitest';
import { blockStateKey, clearBlockStates, restoreBlockState } from './blockState';

it('uses the same storage key as existing running blocks', () => {
  expect(blockStateKey('session', 'work')).toBe('block:session:work');
});

it('clears only the discarded workout’s circuit clocks and continues after a storage failure', () => {
  const removeItem = vi.fn().mockImplementationOnce(() => { throw new Error('Unavailable'); });
  vi.stubGlobal('localStorage', { removeItem });
  try {
    clearBlockStates({ id: 'discarded', blocks: [
      { id: 'a', kind: 'circuit' }, { id: 'lift', kind: 'lift' }, { id: 'b', kind: 'circuit' },
    ] });
    expect(removeItem.mock.calls).toEqual([['block:discarded:a'], ['block:discarded:b']]);
  } finally {
    vi.unstubAllGlobals();
  }
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
