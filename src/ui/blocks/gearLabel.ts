import { SEED_EQUIPMENT, defaultEquipmentFor } from '../../content/equipment';
import { EQUIPMENT_PREFS } from '../../content/equipment-prefs';
import type { EquipmentTag } from '../../content/types';

/** Gear line under a station. UI only — the engine must not import this. */
export function stationGearLabel(exercise: { id: string; equipment: readonly string[] }): string {
  const byId = EQUIPMENT_PREFS.find((row) => row.blockIds.includes(exercise.id));
  if (byId) return byId.label;
  if (exercise.equipment.every((tag) => tag === 'bodyweight')) return 'Bodyweight';
  for (let i = exercise.equipment.length - 1; i >= 0; i--) {
    const tag = exercise.equipment[i]!;
    if (tag === 'db' || tag === 'kb') continue;
    const pref = EQUIPMENT_PREFS.find((row) => row.blockTags.includes(tag));
    if (pref) return pref.label;
  }
  const any = EQUIPMENT_PREFS.find((row) => exercise.equipment.some((tag) => row.blockTags.includes(tag)));
  if (any) return any.label;
  // No checklist row: name the real equipment (machines, cable stack) instead of calling it bodyweight.
  for (let i = exercise.equipment.length - 1; i >= 0; i--) {
    const seed = SEED_EQUIPMENT.find((row) => row.id === defaultEquipmentFor(exercise.equipment[i] as EquipmentTag));
    if (seed && seed.kind !== 'bodyweight') return seed.name;
  }
  return 'Bodyweight';
}
