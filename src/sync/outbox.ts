import type { DBCoreMutateRequest, DBCoreMutateResponse } from 'dexie';
import type { GymDb } from '../data/db';
import { USER_STORES, type StoreName } from '../data/stores';
import type { SyncOutboxEntry } from '../data/types';
import { isSyncApply } from './marker';

export const ADOPTION = 'adoption';

let last = 0;

export function stamp(): string {
  last = Math.max(Date.now(), last + 1);
  return new Date(last).toISOString();
}

export function pendingCount(db: GymDb): Promise<number> {
  return db.transaction('r', [db.syncOutbox, db.syncMeta], async () => {
    const queued = await db.syncOutbox.count();
    return queued + (await db.syncMeta.get(ADOPTION) ? 1 : 0);
  });
}

export function installOutbox(db: GymDb, { onCapture }: { onCapture?: () => void } = {}): void {
  const listening = new WeakSet<IDBTransaction>();
  const mutations = new WeakMap<IDBTransaction, Promise<DBCoreMutateResponse>>();
  db.use({
    stack: 'dbcore',
    name: 'gym-plan-outbox',
    // Run below Hooks (2) and Cache (0), which require the zone native awaits can lose.
    level: -1,
    create(down) {
      return {
        ...down,
        transaction(stores, mode, opts) {
          if (mode === 'readwrite' && !stores.includes('syncOutbox') && stores.some((name) => Object.hasOwn(USER_STORES, name))) {
            stores = [...stores, 'syncOutbox'];
          }
          return down.transaction(stores, mode, opts);
        },
        table(name) {
          const table = down.table(name);
          if (!Object.hasOwn(USER_STORES, name)) return table;

          async function capture(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
            const { trans } = req;
            const put = req.type === 'put' || req.type === 'add';
            const keys: unknown[] = req.type === 'deleteRange'
              ? (await table.query({ trans, values: false, query: { index: table.schema.primaryKey, range: req.range } })).result
              : put
                ? req.keys ?? (req.type === 'put' ? req.updates?.keys : undefined) ??
                  req.values.map((value) => table.schema.primaryKey.extractKey!(value))
                : req.keys;
            const result = await table.mutate(req);
            const changed = new Set(keys.flatMap((key, i) => i in result.failures ? [] : [String(key)]));
            if (!changed.size) return result;

            try {
              const outbox = down.table('syncOutbox');
              const index = outbox.schema.getIndexByKeyPath(['store', 'key'])!;
              const clientUpdatedAt = stamp();
              const entries: SyncOutboxEntry[] = await Promise.all([...changed].map(async (key) => {
                const { result: [previous] } = await outbox.query({
                  trans, values: true, limit: 1, query: { index, range: { type: 1, lower: [name, key], upper: [name, key] } },
                });
                // A new inline auto-increment key must be absent for IndexedDB to generate it.
                return {
                  ...(previous ? { seq: previous.seq } : {}),
                  store: name as StoreName, key, op: put ? 'put' : 'delete', clientUpdatedAt,
                };
              }));
              const captured = await outbox.mutate({ type: 'put', trans, values: entries });
              if (captured.numFailures) throw Object.values(captured.failures)[0];
            } catch (error) {
              trans.abort();
              throw error;
            }
            const idb = trans as IDBTransaction;
            if (onCapture && !listening.has(idb)) {
              listening.add(idb);
              idb.addEventListener('complete', onCapture, { once: true });
            }
            return result;
          }

          return {
            ...table,
            mutate(req) {
              const trans = req.trans as IDBTransaction;
              if (isSyncApply(trans) || trans.mode === 'versionchange') return table.mutate(req);
              // Concurrent calls in one transaction must see one another's compound-index writes.
              const previous = mutations.get(trans);
              const current = previous ? previous.catch(() => {}).then(() => capture(req)) : capture(req);
              mutations.set(trans, current);
              return current;
            },
          };
        },
      };
    },
  });
}
