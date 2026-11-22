import { EQUIPMENT_PREFS } from '../../content/equipment-prefs';

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
  return any ? any.label : 'Bodyweight';
}
