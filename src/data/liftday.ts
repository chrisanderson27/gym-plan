import { EXERCISES, HOME_GYM, LIFT_TEMPLATES, defaultEquipmentFor, exerciseById, type EquipmentTag, type Exercise, type GymProfile } from '../content';
import { blockedExerciseIds } from '../content/equipment-prefs';
import { generateLiftDay, type LiftDayInput } from '../engine/block/generate';
import { seedFrom } from '../engine/block/rng';
import { localDate } from '../engine/dates';
import type { BlockExerciseShape } from '../engine/block/rules';
import type { LiftSnapshot } from '../engine/lift/types';
import type { GymDb } from './db';
import { findOpenLiftSession, loadLiftSnapshot, resolveEquipmentId, toLiftExercise, writeLiftSession } from './lift';
import { getSettings } from './settings';
import type { LiftVariant, LocalDate } from './types';

export function toBlockExercise(e: Exercise): BlockExerciseShape {
  return {
    ...toLiftExercise(e), group: e.group, unit: e.prescription.unit, unitMin: e.prescription.min, unitMax: e.prescription.max,
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

export function blockEquipmentResolver(snapshot: LiftSnapshot): LiftDayInput['resolveEquipmentId'] {
  return (id, item, weekIdx) => {
    const exercise = exerciseById.get(id)!;
    const resolved = resolveEquipmentId(snapshot, exercise, weekIdx);
    const tag = item && equipmentTagFor(item.type, exercise.equipment);
    if (!tag) return resolved;
    const seedId = defaultEquipmentFor(tag);
    const seed = snapshot.equipment.get(seedId);
    const preferred = snapshot.equipment.get(resolved);
    // Earlier sessions may use the same movement on another kind of kit.
    return preferred && preferred.kind === seed?.kind && (!preferred.builtin || preferred.id === seedId) ? resolved : seedId;
  };
}

export function liftDayInputFrom(
  snapshot: LiftSnapshot, variant: LiftVariant, budgetMin: number, seed: number, profile: GymProfile = HOME_GYM,
): LiftDayInput {
  let id = 0;
  return {
    snapshot, variant, budgetMin, seed, profile, exercises: BLOCK_EXERCISES, bodyweightIds: BODYWEIGHT_IDS,
    mainCandidates: LIFT_TEMPLATES[variant].slots[0]!.candidates,
    resolveEquipmentId: blockEquipmentResolver(snapshot),
    makeId: () => `b${id++}`,
  };
}

export async function planLiftDay(db: GymDb, variant: LiftVariant, budgetMin: number, seed: number, now = new Date()) {
  const snapshot = await loadLiftSnapshot(db, now);
  const settings = await getSettings(db);
  return generateLiftDay({
    ...liftDayInputFrom(snapshot, variant, budgetMin, seed),
    notAtMyGym: blockedExerciseIds(EXERCISES, settings?.unavailableEquipment ?? []),
  });
}

export function liftDaySeed(day: LocalDate, variant: LiftVariant, budgetMin: number): number {
  return seedFrom(`${day}|${variant}|${budgetMin}`);
}

export function planTodayLift(db: GymDb, variant: LiftVariant, budgetMin: number, now = new Date()) {
  return planLiftDay(db, variant, budgetMin, liftDaySeed(localDate(now), variant, budgetMin), now);
}

export function startOrResumePlannedLift(db: GymDb, variant: LiftVariant, budgetMin: number, now = new Date()): Promise<string> {
  return db.transaction('rw', [db.sessions, db.settings, db.sets, db.equipment, db.exerciseOverrides], async () => {
    const open = await findOpenLiftSession(db, now);
    if (open) return open.id;
    const plan = await planTodayLift(db, variant, budgetMin, now);
    return writeLiftSession(db, {
      type: 'lift', blocks: plan.blocks, variant, calibration: plan.main.mode === 'calibrate', deload: plan.deload,
    }, now);
  });
}
