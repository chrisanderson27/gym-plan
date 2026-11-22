export interface EquipmentPref {
  id: string;
  label: string;
  /** Exercise ids this row removes on its own. */
  blockIds: readonly string[];
  /** Tags this row marks unavailable. An exercise drops only when every one of its tags is unavailable. */
  blockTags: readonly string[];
}

export const EQUIPMENT_PREFS: readonly EquipmentPref[] = [
  { id: 'exercise-mat', label: 'Exercise mat', blockIds: [], blockTags: [] },
  { id: 'dumbbells', label: 'Dumbbells', blockIds: [], blockTags: ['db'] },
  { id: 'leg-press', label: '45° leg press', blockIds: ['leg-press'], blockTags: [] },
  { id: 'plyo-box', label: 'Plyo box', blockIds: [], blockTags: ['box'] },
  { id: 'seated-cable-row', label: 'Seated cable row', blockIds: ['seated-cable-row'], blockTags: [] },
  { id: 'air-bike', label: 'Air bike', blockIds: ['air-bike'], blockTags: [] },
  { id: 'rower', label: 'Rowing machine', blockIds: ['rower'], blockTags: [] },
  { id: 'resistance-band', label: 'Resistance band', blockIds: [], blockTags: ['band'] },
  { id: 'flat-bench', label: 'Flat bench', blockIds: [], blockTags: ['bench'] },
  { id: 'kettlebell', label: 'Kettlebell', blockIds: [], blockTags: ['kb'] },
  { id: 'treadmill', label: 'Treadmill', blockIds: ['treadmill'], blockTags: [] },
  { id: 'lap-pool', label: 'Lap pool', blockIds: [], blockTags: ['pool'] },
];

export const EQUIPMENT_PREF_IDS: readonly string[] = EQUIPMENT_PREFS.map((row) => row.id);

/** Ids the catalog can no longer offer. Does not touch gym-profile items. */
export function blockedExerciseIds(
  exercises: readonly { id: string; equipment: readonly string[] }[],
  unavailableIds: readonly string[],
): Set<string> {
  const unavailable = new Set(unavailableIds);
  const blockedIds = new Set<string>();
  const blockedTags = new Set<string>();
  for (const row of EQUIPMENT_PREFS) {
    if (!unavailable.has(row.id)) continue;
    for (const id of row.blockIds) blockedIds.add(id);
    for (const tag of row.blockTags) blockedTags.add(tag);
  }
  const blocked = new Set<string>();
  for (const exercise of exercises) {
    // Same rule as exerciseAllowed. This file cannot import engine.
    const tags = exercise.equipment;
    const out = blockedIds.has(exercise.id) || (tags.length > 0 && tags.every((tag) => blockedTags.has(tag)));
    if (out) blocked.add(exercise.id);
  }
  return blocked;
}
