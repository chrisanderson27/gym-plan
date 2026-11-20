import { expect, it } from 'vitest';
import { rateLabel } from '../labels';

it.each([
  [-1.26, '−1.3 lb/wk'],
  [1.26, '+1.3 lb/wk'],
  [0, '+0 lb/wk'],
])('formats a weekly rate of %s as %s', (rate, label) => {
  expect(rateLabel(rate)).toBe(label);
});
