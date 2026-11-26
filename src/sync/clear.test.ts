import { afterEach, expect, it } from 'vitest';
import { SEED_EQUIPMENT } from '../content/equipment';
import { STORE_NAMES, USER_STORES } from '../data/stores';
import { openTestDb } from '../data/test-utils';
import { clearLocalData } from './clear';
import { installOutbox } from './outbox';

const db = openTestDb();
afterEach(async () => { await db.delete(); });

it('clears every table and reseeds equipment without enqueuing tombstones or puts', async () => {
  installOutbox(db);
  for (const store of STORE_NAMES) await db.table(store).put({ [USER_STORES[store]]: 'local-row' });
  await db.syncMeta.bulkPut([
    { id: 'owner', ownerId: 'old' },
    { id: 'cursor:sessions', cursor: { updatedAt: '2026-01-01T00:00:00Z', id: 'local-row' } },
    { id: 'deferred', rows: [{ store: 'sessions', key: 'local-row', reason: 'open-session' }] },
  ]);
  expect(await db.syncOutbox.count()).toBe(STORE_NAMES.length);

  await clearLocalData(db);
  for (const table of db.tables) {
    if (table.name === 'equipment') {
      expect(await table.toArray()).toEqual([...SEED_EQUIPMENT].sort((a, b) => a.id < b.id ? -1 : 1));
    } else {
      expect(await table.count(), table.name).toBe(0);
    }
  }
});
