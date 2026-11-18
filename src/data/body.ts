import { BODY_WAIST_RANGE_IN, BODY_WEIGHT_RANGE_LB } from '../engine/config';
import type { GymDb } from './db';
import type { BodyLog, LocalDate } from './types';

const inRange = (n: number, [lo, hi]: readonly [number, number]) => Number.isFinite(n) && n >= lo && n <= hi;

/** Merges into the day's row (onboarding already wrote today's weight), validating before anything is written. */
export async function saveBodyLog(db: GymDb, date: LocalDate, patch: Partial<Omit<BodyLog, 'date'>>): Promise<void> {
  if (patch.weightLb !== undefined && !inRange(patch.weightLb, BODY_WEIGHT_RANGE_LB)) {
    throw new Error(`Weight must be between ${BODY_WEIGHT_RANGE_LB[0]} and ${BODY_WEIGHT_RANGE_LB[1]} lb`);
  }
  if (patch.waistIn !== undefined && !inRange(patch.waistIn, BODY_WAIST_RANGE_IN)) {
    throw new Error(`Waist must be between ${BODY_WAIST_RANGE_IN[0]} and ${BODY_WAIST_RANGE_IN[1]} in`);
  }
  await db.transaction('rw', db.bodyLogs, async () => {
    const cur = await db.bodyLogs.get(date);
    await db.bodyLogs.put({ date, protein: false, ...cur, ...patch });
  });
}

export async function loadBodyLogs(db: GymDb): Promise<BodyLog[]> {
  return db.bodyLogs.toArray();
}
