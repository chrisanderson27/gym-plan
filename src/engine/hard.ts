import type { RunKind, SessionType } from '../data/types';
import { HARD_RPE } from './config';

/**
 * The weekly budget's "<=2 hard cardio" line counts `hardCardio`. The "hard sessions >=48 h apart"
 * rule uses `hard`. `sessions.rpe` is the canonical session RPE:
 * - single-activity run/swim: the logger writes the same value to `runs.rpe` / `swims.rpe`;
 * - lift: one optional end-of-session RPE tap, `null` when skipped. Never derived from RIR, because
 *   the progression target RIR <=2 would otherwise make every normal lift "hard";
 * - hybrid: hard only if its run part is intervals or its session RPE is >= 8.
 */
export function classifyHard({
  type,
  rpe,
  runKinds,
}: {
  type: SessionType;
  rpe: number | null;
  runKinds: RunKind[];
}): { hard: boolean; hardCardio: boolean } {
  const hardCardio = type === 'burn' || runKinds.includes('intervals');
  const hard = hardCardio || (rpe !== null && rpe >= HARD_RPE);
  return { hard, hardCardio };
}
