import { elapsedMs, initialTimer, timerReducer, type TimerState, type TimerStep } from '../timer';

/** Persisted wall-clock for one timed block. Derived seconds are not stored. */
export interface BlockClock {
  startedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  durationMs: number;
  /** Set when work ends. Expiry freezes the scheduled duration, not the late tick. */
  frozenElapsedMs?: number;
}

function steps(durationMs: number): TimerStep[] {
  const sec = durationMs / 1000;
  return [{ blockIdx: 0, round: 0, phaseIdx: 0, role: 'work', sec, label: 'work', startSec: 0, endSec: sec }];
}

function asTimer(clock: BlockClock): TimerState {
  return { ...initialTimer(), startedAt: clock.startedAt, pausedAt: clock.pausedAt, pausedMs: clock.pausedMs };
}

function apply(clock: BlockClock, type: 'start' | 'pause' | 'resume', nowMs: number): BlockClock {
  const next = timerReducer(asTimer(clock), { type }, nowMs, steps(clock.durationMs));
  return { ...clock, startedAt: next.startedAt, pausedAt: next.pausedAt, pausedMs: next.pausedMs };
}

export const startClock = (clock: BlockClock, nowMs: number): BlockClock => apply(clock, 'start', nowMs);
export const pauseClock = (clock: BlockClock, nowMs: number): BlockClock => apply(clock, 'pause', nowMs);
export const resumeClock = (clock: BlockClock, nowMs: number): BlockClock => apply(clock, 'resume', nowMs);

export function elapsedClamped(clock: BlockClock, nowMs: number): number {
  if (clock.frozenElapsedMs !== undefined) return Math.min(Math.max(0, clock.frozenElapsedMs), clock.durationMs);
  return elapsedMs(asTimer(clock), nowMs, steps(clock.durationMs));
}

export function remainingMs(clock: BlockClock, nowMs: number): number {
  return Math.max(0, clock.durationMs - elapsedClamped(clock, nowMs));
}

/** One transition to review. A paused clock and a second call do not move the deadline. */
export function reconcileClock(clock: BlockClock, nowMs: number): { clock: BlockClock; openedReview: boolean } {
  if (clock.frozenElapsedMs !== undefined || clock.startedAt === null || clock.pausedAt !== null) {
    return { clock, openedReview: false };
  }
  const end = clock.startedAt + clock.pausedMs + clock.durationMs;
  if (nowMs < end) return { clock, openedReview: false };
  return { clock: { ...clock, frozenElapsedMs: clock.durationMs }, openedReview: true };
}

/** Finish block: freeze whatever has elapsed, including zero. */
export function finishClock(clock: BlockClock, nowMs: number): BlockClock {
  if (clock.frozenElapsedMs !== undefined) return clock;
  return { ...clock, frozenElapsedMs: elapsedClamped(clock, nowMs) };
}
