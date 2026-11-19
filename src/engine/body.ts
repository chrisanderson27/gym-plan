import type { GoalDirection, LocalDate } from '../data/types';
import {
  BODY_EMA_ALPHA, BODY_MAINTAIN_BAND_LB, BODY_RATE_BAND_LB, BODY_RATE_MIN_SPAN_DAYS, BODY_RATE_WINDOW_DAYS, WAIST_EVERY_DAYS,
} from './config';
import { addDays, daysBetween } from './dates';

export interface TrendPoint { date: LocalDate; weight: number; trend: number }

/** Hacker's Diet EMA: seeded with the first weight, one step per logged day, gaps not filled. */
export function weightTrend(logs: { date: LocalDate; weightLb?: number }[], alpha = BODY_EMA_ALPHA): TrendPoint[] {
  const rows = logs.filter((l): l is { date: LocalDate; weightLb: number } => typeof l.weightLb === 'number').sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let t = 0;
  for (const r of rows) {
    t = out.length === 0 ? r.weightLb : t + alpha * (r.weightLb - t);
    out.push({ date: r.date, weight: r.weightLb, trend: t });
  }
  return out;
}

/** Least-squares slope of the trend over the window, in lb per week. */
export function weeklyRate(points: TrendPoint[], today: LocalDate): number | null {
  const from = addDays(today, -BODY_RATE_WINDOW_DAYS);
  const w = points.filter((p) => p.date > from);
  if (w.length < 2) return null;
  const xs = w.map((p) => daysBetween(w[0]!.date, p.date));
  if (xs[xs.length - 1]! < BODY_RATE_MIN_SPAN_DAYS) return null;
  const n = w.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = w.reduce((a, p) => a + p.trend, 0) / n;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (w[i]!.trend - my), 0);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den === 0 ? null : (num / den) * 7;
}

export function rateBand(rate: number | null): 'gaining' | 'below' | 'in' | 'above' | null {
  if (rate === null) return null;
  if (rate >= 0) return 'gaining';
  const loss = -rate;
  if (loss < BODY_RATE_BAND_LB[0]) return 'below';
  return loss <= BODY_RATE_BAND_LB[1] ? 'in' : 'above';
}

export function etaToGoal(
  trend: number, goalLb: number, rate: number | null, today: LocalDate, direction: GoalDirection = 'lose',
): LocalDate | 'reached' | null {
  if (direction === 'maintain') return Math.abs(trend - goalLb) <= BODY_MAINTAIN_BAND_LB ? 'reached' : null;
  const remaining = direction === 'gain' ? goalLb - trend : trend - goalLb;
  if (remaining <= 0) return 'reached';
  const progress = direction === 'gain' ? rate : rate === null ? null : -rate;
  if (progress === null || progress <= 0) return null;
  return addDays(today, Math.ceil(remaining / (progress / 7)));
}

export function waistDue(logs: { date: LocalDate; waistIn?: number }[], today: LocalDate): boolean {
  const from = addDays(today, -WAIST_EVERY_DAYS);
  return !logs.some((l) => typeof l.waistIn === 'number' && l.date > from);
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
