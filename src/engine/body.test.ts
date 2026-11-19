import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { etaToGoal, rateBand, waistDue, weeklyRate, weightTrend } from './body';

const TODAY = '2026-03-12';
const series = (n: number, start: number, perDay: number) =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(TODAY, -(n - 1 - i)), weightLb: start + perDay * i }));

describe('body trend', () => {
  it('EMA seeds with the first weight and steps by 0.1', () => {
    const t = weightTrend([{ date: '2026-03-01', weightLb: 250 }, { date: '2026-03-02', weightLb: 248 }, { date: '2026-03-03', weightLb: 249 }]);
    expect(t.map((p) => p.trend.toFixed(2))).toEqual(['250.00', '249.80', '249.72']);
  });
  it('skips rows with no weight and does not fill gaps', () => {
    const t = weightTrend([{ date: '2026-03-01', weightLb: 250 }, { date: '2026-03-02' }, { date: '2026-03-09', weightLb: 248 }]);
    expect(t).toHaveLength(2);
    expect(t[1]!.trend).toBeCloseTo(249.8);
  });
  it('a constant -0.25 lb/day series converges to -1.75 lb/wk, in band', () => {
    // The EMA lags the weight, so a short series under-reads the slope; it converges after ~6 weeks.
    expect(weeklyRate(weightTrend(series(14, 250, -0.25)), TODAY)!).toBeGreaterThan(-1.25);
    const rate = weeklyRate(weightTrend(series(60, 260.75, -0.25)), TODAY)!;
    expect(rate).toBeCloseTo(-1.75, 1);
    expect(rateBand(rate)).toBe('in');
    expect(rateBand(-1.75)).toBe('in');
    expect(rateBand(-1)).toBe('below');
    expect(rateBand(-3)).toBe('above');
    expect(rateBand(0.2)).toBe('gaining');
    expect(rateBand(null)).toBeNull();
  });
  it('is null with under 7 days of span or fewer than 2 points', () => {
    expect(weeklyRate(weightTrend(series(5, 250, -0.25)), TODAY)).toBeNull();
    expect(weeklyRate(weightTrend(series(1, 250, 0)), TODAY)).toBeNull();
  });
  it('ETA: 248.1 to 220 at -1.6/wk is +123 days', () => {
    expect(etaToGoal(248.1, 220, -1.6, TODAY)).toBe(addDays(TODAY, 123));
  });
  it('ETA is null when gaining or unknown, reached at or below goal', () => {
    expect(etaToGoal(248, 220, 0.4, TODAY)).toBeNull();
    expect(etaToGoal(248, 220, null, TODAY)).toBeNull();
    expect(etaToGoal(219.5, 220, -1, TODAY)).toBe('reached');
  });
  it('gain needs to reach the target from below and projects with a positive rate', () => {
    expect(etaToGoal(205, 220, -1.5, TODAY, 'gain')).toBeNull();
    expect(etaToGoal(205, 220, 1.5, TODAY, 'gain')).toBe(addDays(TODAY, 70));
    expect(etaToGoal(220, 220, null, TODAY, 'gain')).toBe('reached');
  });
  it('lose treats a trend below the target as reached', () => {
    expect(etaToGoal(205, 220, null, TODAY, 'lose')).toBe('reached');
  });
  it('maintain has a two-pound band and no ETA', () => {
    expect(etaToGoal(218, 220, -1, TODAY, 'maintain')).toBe('reached');
    expect(etaToGoal(222, 220, 1, TODAY, 'maintain')).toBe('reached');
    expect(etaToGoal(222.1, 220, -1, TODAY, 'maintain')).toBeNull();
  });
  it('waist is due when none was logged in the last 7 days', () => {
    expect(waistDue([], TODAY)).toBe(true);
    expect(waistDue([{ date: addDays(TODAY, -3), waistIn: 40 }], TODAY)).toBe(false);
    expect(waistDue([{ date: addDays(TODAY, -7), waistIn: 40 }], TODAY)).toBe(true);
  });
});
