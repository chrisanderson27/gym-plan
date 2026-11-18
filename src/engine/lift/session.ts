import type { LiftBlock, SetRow } from '../../data/types';
import { FATIGUE_MISSED_EXERCISES } from '../config';
import { isWorking } from './types';

/** An exercise is missed when a working set fell below both its target and the range floor. Unlogged ≠ missed. */
export function summarizeLiftSession(blocks: LiftBlock[], sets: SetRow[]): { missedExercises: string[]; fatigue: boolean } {
  const missedExercises: string[] = [];
  for (const b of blocks) {
    if (b.warmup || missedExercises.includes(b.exerciseId)) continue;
    const mine = sets.filter((s) => s.exerciseId === b.exerciseId && isWorking(s));
    if (mine.some((s) => s.reps < s.targetReps && s.reps < b.repMin)) missedExercises.push(b.exerciseId);
  }
  return { missedExercises, fatigue: missedExercises.length >= FATIGUE_MISSED_EXERCISES };
}
