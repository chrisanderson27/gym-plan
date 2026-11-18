import type { SwimItem } from '../../data/types';
import { SWIM_DRILL_OFFSET_SEC, SWIM_SENDOFF_OFFSET_SEC, SWIM_SENDOFF_ROUND_SEC } from '../config';

/** Always rounds up, so a send-off is never tighter than the maths says. */
export const roundUp5 = (sec: number): number => Math.ceil(sec / SWIM_SENDOFF_ROUND_SEC) * SWIM_SENDOFF_ROUND_SEC;

/** Send-off seconds for one rep, or null when the item is rest-based (kick, sprint). */
export function sendoffSec(item: Pick<SwimItem, 'swimKind' | 'intensity' | 'distance'>, cssPer100: number): number | null {
  if (item.swimKind === 'kick' || item.intensity === 'SPRINT') return null;
  const offset = item.swimKind === 'drill' ? SWIM_DRILL_OFFSET_SEC : SWIM_SENDOFF_OFFSET_SEC[item.intensity];
  return roundUp5(((cssPer100 + offset) * item.distance) / 100);
}

/** 135 → "2:15", 20 → ":20". */
export function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(Math.round(sec % 60)).padStart(2, '0');
  return m > 0 ? `${m}:${s}` : `:${s}`;
}
