import { SEED_EQUIPMENT } from '../content/equipment';
import type { GymDb } from '../data/db';
import { withSyncApply } from './marker';
import { pendingCount } from './outbox';

export function clearLocalData(db: GymDb, { reseedEquipment = true, maxPending }: {
  reseedEquipment?: boolean;
  maxPending?: number;
} = {}): Promise<{ cleared: boolean; pending: number }> {
  return withSyncApply(db, db.tables, async () => {
    const pending = await pendingCount(db);
    if (maxPending !== undefined && pending > maxPending) return { cleared: false, pending };
    for (const table of db.tables) await table.clear();
    if (reseedEquipment) await db.equipment.bulkAdd(SEED_EQUIPMENT);
    return { cleared: true, pending };
  });
}
