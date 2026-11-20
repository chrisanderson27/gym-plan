import { BLOCK_BEEP_AT_SEC, TIMER_MAX_BEEP_GAP_SEC } from '../config';

export function remainingSec(startedAtMs: number, durationSec: number, nowMs: number): number {
  return Math.max(0, Math.ceil(durationSec - Math.max(0, nowMs - startedAtMs) / 1000));
}

export function blockBeeps(prevRemaining: number, remaining: number): ('tick' | 'go')[] {
  if (remaining >= prevRemaining || prevRemaining - remaining > TIMER_MAX_BEEP_GAP_SEC) return [];
  const out = BLOCK_BEEP_AT_SEC.filter((at) => at < prevRemaining && at >= remaining).map(() => 'tick' as const);
  return remaining === 0 ? [...out, 'go'] : out;
}

export const restRemaining = remainingSec;
