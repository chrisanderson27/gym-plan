import { expect, it } from 'vitest';
import { seedFrom } from './rng';

it('computes unsigned 32-bit FNV-1a', () => {
  expect(seedFrom('')).toBe(0x811c9dc5);
  expect(seedFrom('hello')).toBe(0x4f9f2cab);
});

it('keys the same lift day consistently and rerolls on a new date', () => {
  const key = '2026-11-19|upper-a|60';
  expect(seedFrom(key)).toBe(seedFrom(key));
  expect(seedFrom(key)).not.toBe(seedFrom('2026-11-20|upper-a|60'));
});
