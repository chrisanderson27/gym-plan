import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { isRampInWeek, weekIndex } from './week';

const start = '2026-11-01';

describe('weekIndex', () => {
  it('counts calendar weeks from programStart', () => {
    expect(weekIndex(start, start)).toBe(1);
    expect(weekIndex(addDays(start, 6), start)).toBe(1);
    expect(weekIndex(addDays(start, 7), start)).toBe(2);
    expect(weekIndex(addDays(start, 13), start)).toBe(2);
  });
  it('clamps dates before the start to week 1', () => {
    expect(weekIndex('2026-10-01', start)).toBe(1);
  });
  it('is DST-safe across the March change', () => {
    expect(weekIndex('2026-03-15', '2026-03-08')).toBe(2);
    expect(weekIndex('2026-03-14', '2026-03-08')).toBe(1);
  });
  it('still advances across a 3-week gap', () => {
    expect(weekIndex(addDays(start, 21), start)).toBe(4);
  });
  it('flags ramp-in weeks', () => {
    expect(isRampInWeek(2)).toBe(true);
    expect(isRampInWeek(3)).toBe(false);
  });
});
