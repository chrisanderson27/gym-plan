import type { RunBlock } from '../../data/types';
import { runToIntervals } from './to-timer';

export interface RunPhase { role: string; label: string; startMs: number; endMs: number }

/** Flattens the run's interval blocks into one timeline on the single block clock. */
export function runPhases(block: RunBlock, warmupSec?: number, cooldownSec?: number): RunPhase[] {
  const out: RunPhase[] = [];
  let at = 0;
  for (const interval of runToIntervals(block, { warmupSec, cooldownSec })) {
    for (let round = 0; round < interval.rounds; round++) {
      for (const phase of interval.phases) {
        const endMs = at + phase.sec * 1000;
        out.push({ role: phase.role, label: phase.label ?? phase.role, startMs: at, endMs });
        at = endMs;
      }
    }
  }
  return out;
}

/** The segment holding `elapsedMs`. A boundary instant belongs to the segment that starts there. */
export function runSegmentAt(phases: readonly RunPhase[], elapsedMs: number) {
  if (!phases.length) return { index: -1, current: undefined, next: undefined, remainingMs: 0 };
  const found = phases.findIndex((p) => elapsedMs >= p.startMs && elapsedMs < p.endMs);
  const index = found < 0 ? (elapsedMs < 0 ? 0 : phases.length - 1) : found;
  const current = phases[index]!;
  return { index, current, next: phases[index + 1], remainingMs: Math.max(0, current.endMs - Math.max(elapsedMs, current.startMs)) };
}

export const runTotalMs = (phases: readonly RunPhase[]) => phases.at(-1)?.endMs ?? 0;
