import { describe, expect, it } from 'vitest';
import type { CssTest } from '../../data/types';
import { cssFromTest, latestCss } from './css';

const test = (date: string, over: Partial<CssTest> = {}): CssTest => ({ id: date, kind: 'css', date, poolUnit: 'yd', ...over });

describe('css', () => {
  it('derives per-100 from a 400/200 pair', () => {
    expect(cssFromTest({ t400: 420, t200: 200 })).toEqual({ per100: 110, estimate: false });
  });

  it('warns when the 400 and 200 are too close', () => {
    expect(cssFromTest({ t400: 300, t200: 220 })?.warn).toBeTruthy();
  });

  it('falls back to 3×100 average + 5 s, flagged as an estimate', () => {
    expect(cssFromTest({ t3x100: 115 })).toEqual({ per100: 120, estimate: true });
    expect(cssFromTest({})).toBeNull();
  });

  it('the newest test wins', () => {
    const tests = [test('2026-10-01T00:00:00.000Z', { t400: 480, t200: 220 }), test('2026-11-01T00:00:00.000Z', { t400: 420, t200: 200 })];
    expect(latestCss(tests, 'yd')?.per100).toBe(110);
  });

  it('converts between pool units and marks it approximate', () => {
    const yd = latestCss([test('2026-11-01T00:00:00.000Z', { t400: 420, t200: 200 })], 'm');
    expect(yd?.per100).toBeCloseTo(110 * 1.09);
    expect(yd?.approx).toBe(true);
    const m = latestCss([test('2026-11-01T00:00:00.000Z', { poolUnit: 'm', t400: 420, t200: 200 })], 'yd');
    expect(m?.per100).toBeCloseTo(110 / 1.09);
    expect(m?.approx).toBe(true);
  });

  it('returns null with no tests', () => {
    expect(latestCss([], 'yd')).toBeNull();
  });
});
