import type { StationTarget } from '../../data/types';
import { STATION_TARGETS, TRANSITION_SEC } from '../config';
import { remainingSec } from './clock';

/** Blank coached block. Not a rest between strength sets (`REST_DEFAULT_SEC` / `MAIN_REST_SEC`). */
export const COACHED_WORK_SEC = STATION_TARGETS.sec.normal;
export const COACHED_REST_SEC = 0;
export const COACHED_TRANSITION_SEC = TRANSITION_SEC;

export interface CoachedCursor {
  station: number;
  phase: 'work' | 'rest' | 'transition';
}

export interface CoachedPhase {
  role: 'work' | 'rest' | 'transition';
  sec: number;
}

/** A `sec` station uses its own amount. Every other unit shares the block's work window. */
export function stationWorkSec(target: StationTarget, workSec: number): number {
  return target.unit === 'sec' ? target.amount : workSec;
}

/** A zero rest or transition is omitted. A 0-length phase would still be a phase the clock has to step through. */
export function stationPhasePlan(workSec: number, restSec: number, transitionSec: number): CoachedPhase[] {
  const phases: CoachedPhase[] = [{ role: 'work', sec: workSec }];
  if (restSec > 0) phases.push({ role: 'rest', sec: restSec });
  if (transitionSec > 0) phases.push({ role: 'transition', sec: transitionSec });
  return phases;
}

/**
 * Next phase of this station, or the next station's work. Leaving the last station completes one rotation.
 * A block that expires mid-station never reaches this wrap, so it does not complete a rotation. No clock.
 */
export function advancePhase(
  cursor: CoachedCursor,
  stationCount: number,
  plan: readonly CoachedPhase[],
): CoachedCursor & { rotationCompleted?: true } {
  const at = plan.findIndex((phase) => phase.role === cursor.phase);
  const following = at >= 0 ? plan[at + 1] : undefined;
  if (following) return { station: cursor.station, phase: following.role };
  const station = cursor.station + 1;
  if (station >= stationCount) return { station: 0, phase: 'work', rotationCompleted: true };
  return { station, phase: 'work' };
}

/**
 * Jump to the next station's work, skipping any rest or transition still left.
 * Does not take or return a time credit: Next changes which station is current, not how much block time is left.
 */
export function nextStation(cursor: CoachedCursor, stationCount: number): CoachedCursor & { rotationCompleted?: true } {
  const station = cursor.station + 1;
  if (station >= stationCount) return { station: 0, phase: 'work', rotationCompleted: true };
  return { station, phase: 'work' };
}

/**
 * `remainingSec` plus time already spent paused. While `pausedAtMs` is set the elapsed term freezes there.
 * No `creditMs`: skipping a station must not shorten the block.
 */
export function blockRemainingSec(
  startedAtMs: number,
  pausedMs: number,
  pausedAtMs: number | null,
  durationSec: number,
  nowMs: number,
): number {
  const now = pausedAtMs ?? nowMs;
  return Math.min(durationSec, remainingSec(startedAtMs, durationSec, now) + pausedMs / 1000);
}
