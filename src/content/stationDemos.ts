import { exerciseById } from './index';
import { POSES } from './poses';

/**
 * Movements this phase can put on a live card or offer as a swap.
 * Leg press and dead bug keep their reviewed cycles. Hip thrust stays the barbell bench setup.
 * Reverse lunge is its own backward step, not the split-squat cycle.
 */
export const PHASE3_EXERCISE_IDS = [
  'calf-raise',
  'leg-press',
  'hip-thrust',
  'reverse-lunge',
  'step-up',
  'bulgarian-split-squat',
  'push-up',
  'chest-press-machine',
  'rower',
  'dead-bug',
  'farmer-carry',
  'plank',
] as const;

const EQUIPMENT_KINDS: Record<string, readonly string[]> = {
  'calf-raise': ['machine'],
  'leg-press': ['machine'],
  'hip-thrust': ['barbell'],
  'reverse-lunge': ['db'],
  'step-up': ['db'],
  'bulgarian-split-squat': ['db'],
  'push-up': ['bodyweight'],
  'chest-press-machine': ['machine'],
  'rower': ['cardio'],
  'dead-bug': ['bodyweight'],
  'farmer-carry': ['db'],
  'plank': ['bodyweight'],
};

/** Pose plus cues. The block picker uses this and keeps every illustrated exercise. */
export function stationDemo(exercise: { poseId?: string; cues: readonly string[] }): { poseId: string } | null {
  if (!exercise.poseId || exercise.cues.length === 0) return null;
  return POSES[exercise.poseId] ? { poseId: exercise.poseId } : null;
}

/** Verified pose for a live station or swap. Unknown ids and unverified equipment kinds return undefined. */
export function phase3Pose(exerciseId: string, equipmentKind?: string): string | undefined {
  const kinds = EQUIPMENT_KINDS[exerciseId];
  if (!kinds) return undefined;
  if (equipmentKind && !kinds.includes(equipmentKind)) return undefined;
  const exercise = exerciseById.get(exerciseId);
  return exercise ? stationDemo(exercise)?.poseId : undefined;
}
