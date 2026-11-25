import { describe, expect, it } from 'vitest';
import { rangeError } from './limits';

describe('rangeError', () => {
  it('accepts blank and in-range values', () => {
    expect(rangeError('', 'Rounds', 99)).toBeUndefined();
    expect(rangeError('12', 'Rounds', 99, { integer: true })).toBeUndefined();
  });
  it('explains out-of-range, negative, fractional and non-numeric input', () => {
    expect(rangeError('999', 'Rounds', 99, { integer: true })).toBe('Rounds must be between 0 and 99.');
    expect(rangeError('-3', 'Rounds', 99, { integer: true })).toBe('Rounds must be between 0 and 99.');
    expect(rangeError('2.5', 'Rounds', 99, { integer: true })).toBe('Rounds must be a whole number.');
    expect(rangeError('abc', 'Rounds', 99)).toBe('Rounds must be a number.');
  });
});
