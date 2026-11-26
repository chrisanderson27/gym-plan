import { SEED_EQUIPMENT } from '../content/equipment';
import type { GymDb } from '../data/db';
import { withSyncApply } from './marker';

export function clearLocalData(db: GymDb, { reseedEquipment = true } = {}): Promise<void> {
  return withSyncApply(db, db.tables, async () => {
    for (const table of db.tables) await table.clear();
    if (reseedEquipment) await db.equipment.bulkAdd(SEED_EQUIPMENT);
  });
}
