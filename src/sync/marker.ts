import type Dexie from 'dexie';
import type { DBCoreTransaction, Table, Transaction } from 'dexie';

export const SYNC_APPLY = Symbol('gym-plan:sync-apply');

type MarkedTransaction = DBCoreTransaction & { [SYNC_APPLY]?: boolean };

export function markSyncApply(tx: Transaction): void {
  (tx.idbtrans as MarkedTransaction)[SYNC_APPLY] = true;
}

export function isSyncApply(trans: DBCoreTransaction): boolean {
  return (trans as MarkedTransaction)[SYNC_APPLY] === true;
}

export function withSyncApply<T>(db: Dexie, tables: Table[], fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, async (tx) => {
    markSyncApply(tx);
    return fn(tx);
  });
}
