import { EQUIPMENT_PREFS } from '../content/equipment-prefs';
import { localDate } from '../engine/dates';
import { enabled } from '../engine/plan/activities';
import { markSyncApply } from '../sync/marker';
import type { GymDb } from './db';
import type { PoolUnit, Settings } from './types';

export const DEFAULT_POOL_LENGTH = 25;

export function poolOf(settings?: Settings): { poolUnit: PoolUnit; poolLength: number } | null {
  const { poolUnit, poolLength } = settings ?? {};
  return poolUnit && poolLength && poolLength > 0 ? { poolUnit, poolLength } : null;
}

export const enabledActivities = (settings?: Settings) => enabled(settings?.activities);

export const getSettings = (db: GymDb): Promise<Settings | undefined> => db.settings.get('settings');

export async function saveSettings(
  db: GymDb,
  patch: Partial<Omit<Settings, 'id'>>,
  now = new Date(),
): Promise<void> {
  await db.settings.update('settings', { ...patch, updatedAt: now.toISOString() });
}

/** One checklist id, read and written inside the settings transaction so overlapping toggles both stick. */
export async function toggleUnavailableEquipment(
  db: GymDb,
  id: string,
  unavailable: boolean,
  now = new Date(),
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const cur = await db.settings.get('settings');
    if (!cur) return;
    const off = new Set(cur.unavailableEquipment ?? []);
    if (unavailable) off.add(id);
    else off.delete(id);
    const unavailableEquipment = EQUIPMENT_PREFS.map((row) => row.id).filter((rowId) => off.has(rowId));
    await saveSettings(db, { unavailableEquipment }, now);
  });
}

/**
 * First launch: seed a default row so Today opens with no setup questions. No goal, activities or weight row are written;
 * Only the first-sign-in upload captures this row, at its epoch updatedAt so imported and remote settings win.
 */
export async function ensureDefaultSettings(db: GymDb, now = new Date()): Promise<void> {
  await db.transaction('rw', db.settings, async (tx) => {
    markSyncApply(tx);
    if (await db.settings.get('settings')) return;
    await db.settings.put({
      id: 'settings',
      daysPerWeek: 5,
      weightUnit: 'lb',
      distanceUnit: 'mi',
      programStart: localDate(now),
      onboardedAt: now.toISOString(),
      backupAt: null,
      updatedAt: new Date(0).toISOString(),
    });
  });
}
