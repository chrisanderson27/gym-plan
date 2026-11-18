import type { LocalDate } from '../data/types';
import { RAMP_IN_WEEKS } from './config';
import { daysBetween } from './dates';

/** Calendar-based, 1-indexed, clamped: a skipped week still advances the count. */
export function weekIndex(date: LocalDate, programStart: LocalDate): number {
  return Math.max(1, Math.floor(daysBetween(programStart, date) / 7) + 1);
}

export const isRampInWeek = (i: number): boolean => i <= RAMP_IN_WEEKS;
