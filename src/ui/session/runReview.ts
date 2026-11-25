import type { RunActuals } from '../../data/mixedSession';
import type { CardioModality } from '../../data/types';

/** A run block gets the run form only when its timer actually started (call after checking the block is a run). A skipped block has no clock at all. */
export const startedClock = (clock: { startedAt: unknown } | undefined) => !!clock && clock.startedAt !== null;

/** Blank distance means unknown (0), as in RunLog. An effort is required, like RunLog's RPE chips. */
export function runReviewActuals(f: { distance: string; minutes: string; modality: CardioModality; rpe: number | null; pain: boolean }): RunActuals | null {
  const minutes = Number(f.minutes);
  const distance = f.distance === '' ? 0 : Number(f.distance);
  if (f.rpe === null || !(minutes > 0) || !(distance >= 0)) return null;
  return { distanceMi: distance, durationSec: Math.round(minutes * 60), modality: f.modality, rpe: f.rpe, painFlag: f.pain };
}
