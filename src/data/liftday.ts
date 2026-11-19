import { EXERCISES, HOME_GYM, LIFT_TEMPLATES, defaultEquipmentFor, exerciseById, type EquipmentTag, type Exercise, type GymProfile } from '../content';
import { generateLiftDay, type LiftDayInput } from '../engine/block/generate';
import type { BlockExerciseShape } from '../engine/block/rules';
import { localDate } from '../engine/dates';
import type { LiftSnapshot } from '../engine/lift/types';
import { weekIndex } from '../engine/week';
import type { GymDb } from './db';
import { loadLiftSnapshot, resolveEquipmentId, toLiftExercise } from './lift';
import type { LiftVariant } from './types';

export function toBlockExercise(e: Exercise): BlockExerciseShape {
  return {
    ...toLiftExercise(e), unit: e.prescription.unit, unitMin: e.prescription.min, unitMax: e.prescription.max,
    targets: e.targets && [...e.targets],
  };
}

export const BLOCK_EXERCISES = new Map(
  EXERCISES.filter((e) => !e.retired && e.id !== 'swim').map((e) => [e.id, toBlockExercise(e)]),
);
// The catalog must provide the attachment for these bodyweight movements.
const KIT_REQUIRED = new Set(['pull-up', 'hanging-knee-raise', 'ab-wheel']);
export const BODYWEIGHT_IDS = [...BLOCK_EXERCISES.values()]
  .filter((e) => !KIT_REQUIRED.has(e.id) && e.equipment.every((tag) => tag === 'bodyweight'))
  .map((e) => e.id);

function equipmentTagFor(itemType: string, tags: EquipmentTag[]): EquipmentTag | undefined {
  if (itemType.startsWith('dumbbell') && tags.includes('db')) return 'db';
  if (itemType.startsWith('kettlebell') && tags.includes('kb')) return 'kb';
  if (itemType.startsWith('plate-loaded') && (tags.includes('machine') || tags.includes('plate-loaded'))) return 'plate-loaded';
  if (itemType.startsWith('selectorized') && !tags.includes('bodyweight')) return 'machine';
  return undefined;
}

export function liftDayInputFrom(
  snapshot: LiftSnapshot, variant: LiftVariant, budgetMin: number, seed: number, profile: GymProfile = HOME_GYM,
): LiftDayInput {
  const weekIdx = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  let id = 0;
  return {
    snapshot, variant, budgetMin, seed, profile, exercises: BLOCK_EXERCISES, bodyweightIds: BODYWEIGHT_IDS,
    mainCandidates: LIFT_TEMPLATES[variant].slots[0]!.candidates,
    notAtMyGym: new Set([...snapshot.overrides.values()].filter((override) => override.notAtMyGym).map((override) => override.exerciseId)),
    resolveEquipmentId: (id, item) => {
      const exercise = exerciseById.get(id)!;
      const resolved = resolveEquipmentId(snapshot, exercise, weekIdx);
      const tag = item && equipmentTagFor(item.type, exercise.equipment);
      if (!tag) return resolved;
      const seedId = defaultEquipmentFor(tag);
      const seed = snapshot.equipment.get(seedId);
      const preferred = snapshot.equipment.get(resolved);
      // Earlier sessions may use the same movement on another kind of kit.
      return preferred && preferred.kind === seed?.kind && (!preferred.builtin || preferred.id === seedId) ? resolved : seedId;
    },
    makeId: () => `b${id++}`,
  };
}

export async function planLiftDay(db: GymDb, variant: LiftVariant, budgetMin: number, seed: number, now = new Date()) {
  const snapshot = await loadLiftSnapshot(db, now);
  return generateLiftDay(liftDayInputFrom(snapshot, variant, budgetMin, seed));
}
