import { exerciseById } from './index';
import { SEED_EQUIPMENT } from './equipment';
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

const VERIFIED_EQUIPMENT = new Map<string, string>([
  ['calf-raise', 'pin-stack'], ['leg-press', 'plate-loaded'], ['hip-thrust', 'barbell-olympic'],
  ['reverse-lunge', 'dumbbells'], ['step-up', 'dumbbells'], ['bulgarian-split-squat', 'dumbbells'],
  ['push-up', 'bodyweight'], ['chest-press-machine', 'pin-stack'], ['rower', 'rower'],
  ['dead-bug', 'bodyweight'], ['farmer-carry', 'dumbbells'], ['plank', 'bodyweight'],
]);

export const phase3EquipmentId = (exerciseId: string) => VERIFIED_EQUIPMENT.get(exerciseId);

/** Pose plus cues. The block picker uses this and keeps every illustrated exercise. */
export function stationDemo(exercise: { poseId?: string; cues: readonly string[] }): { poseId: string } | null {
  if (!exercise.poseId || exercise.cues.length === 0) return null;
  return POSES[exercise.poseId] ? { poseId: exercise.poseId } : null;
}

/** Verified pose for a live station or swap, including exercise-specific instances of the seed machine. */
export function phase3Pose(exerciseId: string, equipment: { id: string; kind: string; name: string }): string | undefined {
  const exercise = exerciseById.get(exerciseId);
  const seed = SEED_EQUIPMENT.find((row) => row.id === phase3EquipmentId(exerciseId));
  if (!exercise || !seed || equipment.kind !== seed.kind) return undefined;
  // Existing per-exercise machines have generated IDs and a name derived from their exercise and seed.
  const instance = seed.kind === 'machine' && equipment.name === `${exercise.name} — ${seed.name}`;
  return equipment.id === seed.id || instance ? stationDemo(exercise)?.poseId : undefined;
}
