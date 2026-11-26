import Dexie, { type Table } from 'dexie';
import { db, type GymDb } from '../data/db';
import { ensureDefaultSettings } from '../data/settings';
import { STORE_NAMES, USER_STORES, type StoreName } from '../data/stores';
import type { SyncMeta, SyncOutboxEntry } from '../data/types';
import { auth, type createAuth } from './auth';
import { clearLocalData } from './clear';
import { supabase } from './client';
import { withSyncApply } from './marker';
import { pendingCount } from './outbox';
import { RELATED_STORES, SYNC_TABLES, rowUpdatedAt, sessionIdOf } from './tables';
import { SyncError, createSupabaseTransport, type PushRow, type SyncRow, type SyncTransport } from './transport';

export type SyncStatus = {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'paused' | 'owner-mismatch';
  pending: number;
  lastSyncedAt: string | null;
};

type SyncWindow = Pick<Window, 'addEventListener'> & {
  navigator: Pick<Navigator, 'onLine'>;
  document: Pick<Document, 'addEventListener' | 'visibilityState'>;
};
type DeferredRow = NonNullable<SyncMeta['rows']>[number];
type OwnedEntry = SyncOutboxEntry & { seq: number };
type LocalRow = Record<string, unknown>;
type Run = { generation: number; ownerId: string; signal: AbortSignal };

const PUSH_LIMIT = 500;
const PULL_LIMIT = 1000;
const OVERLAP_MS = 60_000;
const ADOPTION = 'adoption';
const cursorId = (store: StoreName) => 'cursor:' + store;
const pair = (row: SyncRow) => ({ updatedAt: row.updated_at, id: row.id });
const deferredKey = (store: StoreName, key: string) => JSON.stringify([store, key]);
const applyGroups = [RELATED_STORES, ...STORE_NAMES.filter((store) => !RELATED_STORES.includes(store)).map((store) => [store])];

class Aborted extends Error {}

export function createSyncEngine({ db, transport, auth, win, now = () => new Date(), debounceMs = 2000 }: {
  db: GymDb;
  transport: SyncTransport | null;
  auth: Pick<ReturnType<typeof createAuth>, 'getState' | 'subscribe' | 'signOut'>;
  win?: SyncWindow;
  now?: () => Date;
  debounceMs?: number;
}) {
  const listeners = new Set<() => void>();
  let status: SyncStatus = { state: transport ? 'idle' : 'off', pending: 0, lastSyncedAt: null };
  let started = false;
  let paused = false;
  let generation = 0;
  let active: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let again = false;
  let openSession: string | null = null;
  let observedUser: string | null | undefined;
  let resolving = false;

  function update(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch };
    for (const listener of listeners) listener();
  }

  function signedInUser() {
    const state = auth.getState();
    return state.status === 'signed-in' ? state.user?.id ?? null : null;
  }

  function check(run: Run) {
    if (run.generation !== generation || run.signal.aborted || signedInUser() !== run.ownerId) throw new Aborted();
  }

  function write<T>(run: Run, tables: Table[], fn: () => Promise<T>): Promise<T> {
    return withSyncApply(db, tables, async (tx) => {
      check(run);
      const idb = tx.idbtrans as IDBTransaction;
      const abort = () => tx.abort();
      const detach = () => run.signal.removeEventListener('abort', abort);
      idb.addEventListener('complete', detach, { once: true });
      idb.addEventListener('abort', detach, { once: true });
      run.signal.addEventListener('abort', abort, { once: true });
      const result = await fn();
      check(run);
      return result;
    });
  }

  async function checkOwner(run: Run) {
    if ((await db.syncMeta.get('owner'))?.ownerId !== run.ownerId) throw new Aborted();
  }

  async function claim(run: Run, discard = false): Promise<'adopt' | 'ready' | 'mismatch'> {
    const owner = await db.syncMeta.get('owner');
    check(run);
    if (owner?.ownerId === run.ownerId) {
      update({ lastSyncedAt: owner.lastSyncedAt ?? null });
      return await db.syncMeta.get(ADOPTION) ? 'adopt' : 'ready';
    }

    update({ lastSyncedAt: null });
    // Check the pending count and clear under the same lock as local writers.
    return write(run, db.tables, async () => {
      const current = await db.syncMeta.get('owner');
      if (current?.ownerId === run.ownerId) return await db.syncMeta.get(ADOPTION) ? 'adopt' : 'ready';
      if (current?.ownerId) {
        if (!discard && await pendingCount(db) > 0) return 'mismatch';
        check(run);
        // Rotate ownership before this run performs any network work for the new account.
        if (!discard) run.generation = ++generation;
        await clearLocalData(db);
        check(run);
      } else {
        await db.syncMeta.put({ id: ADOPTION });
      }
      await db.syncMeta.put({ id: 'owner', ownerId: run.ownerId });
      return current?.ownerId ? 'ready' : 'adopt';
    });
  }

  function table(store: StoreName): Table<LocalRow, string> {
    return db.table(store);
  }

  function entries(store: StoreName) {
    return db.syncOutbox.where('[store+key]').between([store, Dexie.minKey], [store, Dexie.maxKey], true, true);
  }

  // Keep the adoption marker until the legacy scan commits, across failed pushes and reloads.
  async function seedLegacy(run: Run, sent: Set<string>) {
    await write(run, db.tables, async () => {
      await checkOwner(run);
      if (!await db.syncMeta.get(ADOPTION)) return;
      // A stored sign-in can start before the shell's settings effect.
      await ensureDefaultSettings(db, now());
      for (const store of STORE_NAMES) {
        const existing = new Set((await entries(store).toArray()).map((entry) => entry.key));
        const rows = await table(store).toArray();
        const unqueued = rows.flatMap((row): SyncOutboxEntry[] => {
          const key = String(row[USER_STORES[store]]);
          return existing.has(key) || sent.has(deferredKey(store, key)) ? [] : [{
            store, key, op: 'put', clientUpdatedAt: rowUpdatedAt(store, row),
          }];
        });
        await db.syncOutbox.bulkAdd(unqueued);
      }
      await db.syncMeta.delete(ADOPTION);
    });
  }

  async function push(cloud: SyncTransport, run: Run, sent?: Set<string>) {
    for (const store of STORE_NAMES) {
      check(run);
      const queued = await entries(store).sortBy('seq') as OwnedEntry[];
      for (let start = 0; start < queued.length; start += PUSH_LIMIT) {
        const batch = await db.transaction('r', [table(store), db.syncOutbox, db.syncMeta], async () => {
          check(run);
          await checkOwner(run);
          const live = await db.syncOutbox.bulkGet(queued.slice(start, start + PUSH_LIMIT).map((entry) => entry.seq));
          const outbox = live.filter((entry): entry is OwnedEntry => entry?.store === store);
          const local = await table(store).bulkGet(outbox.map((entry) => entry.key));
          const rows = outbox.map((entry, i): PushRow => {
            const data = local[i];
            return {
              id: entry.key, client_updated_at: entry.clientUpdatedAt,
              ...(entry.op === 'put' && data ? { data } : { data: {}, deleted_at: entry.clientUpdatedAt }),
            };
          });
          return { outbox, rows };
        });
        check(run);
        if (!batch.rows.length) continue;
        const accepted = new Set((await cloud.push(SYNC_TABLES[store], batch.rows, run.signal)).map((row) => row.id));
        await write(run, [db.syncOutbox, db.syncMeta], async () => {
          await checkOwner(run);
          const deferred = await readDeferred();
          const current = await db.syncOutbox.bulkGet(batch.outbox.map((entry) => entry.seq));
          const acked: number[] = [];
          for (const [i, entry] of batch.outbox.entries()) {
            const key = deferredKey(store, entry.key);
            if (!accepted.has(entry.key)) deferred.set(key, { store, key: entry.key, reason: 'refetch' });
            if (current[i]?.clientUpdatedAt === entry.clientUpdatedAt) acked.push(entry.seq);
            sent?.add(key);
          }
          await db.syncOutbox.bulkDelete(acked);
          await saveDeferred(deferred);
        });
      }
    }
  }

  async function readDeferred() {
    const rows = (await db.syncMeta.get('deferred'))?.rows ?? [];
    return new Map(rows.map((row) => [deferredKey(row.store, row.key), row]));
  }

  function saveDeferred(rows: Map<string, DeferredRow>) {
    return rows.size
      ? db.syncMeta.put({ id: 'deferred', rows: [...rows.values()] })
      : db.syncMeta.delete('deferred');
  }

  async function pullPages(cloud: SyncTransport, run: Run, store: StoreName) {
    const cursor = (await db.syncMeta.get(cursorId(store)))?.cursor;
    let from: Parameters<SyncTransport['pull']>[1] = cursor
      ? { since: new Date(Date.parse(cursor.updatedAt) - OVERLAP_MS).toISOString() } : null;
    const rows: SyncRow[] = [];
    for (;;) {
      check(run);
      const page = await cloud.pull(SYNC_TABLES[store], from, PULL_LIMIT, run.signal);
      rows.push(...page);
      if (page.length < PULL_LIMIT) return rows;
      from = { after: pair(page[page.length - 1]!) };
    }
  }

  async function applyRow(store: StoreName, row: SyncRow, deferred: Map<string, DeferredRow>) {
    const key = deferredKey(store, row.id);
    const pending = await db.syncOutbox.get({ store, key: row.id });
    if (pending && Date.parse(pending.clientUpdatedAt) > Date.parse(row.client_updated_at)) return;
    if (!row.deleted_at && row.data?.[USER_STORES[store]] !== row.id) {
      console.warn('Skipping sync row with a mismatched primary key', store);
      deferred.delete(key);
      return;
    }
    if (openSession !== null && RELATED_STORES.includes(store)) {
      // Tombstones carry no data, so use the local set's parent or the session-keyed table's id.
      const sessionId = row.deleted_at
        ? store === 'sets' ? sessionIdOf(store, await table(store).get(row.id) ?? {}) : row.id
        : sessionIdOf(store, row.data);
      if (sessionId === openSession) {
        deferred.set(key, { store, key: row.id, reason: 'open-session', sessionId });
        return;
      }
    }

    if (row.deleted_at) await table(store).delete(row.id);
    else await table(store).put(row.data);
    if (pending?.seq !== undefined) await db.syncOutbox.delete(pending.seq);
    deferred.delete(key);
  }

  async function pull(cloud: SyncTransport, run: Run) {
    const deferred = await readDeferred();
    const pulled = new Map<StoreName, { rows: Map<string, SyncRow>; cursor?: SyncMeta['cursor']; missing: string[] }>();
    for (const store of STORE_NAMES) {
      const pageRows = await pullPages(cloud, run, store);
      const last = pageRows.at(-1);
      const rows = new Map(pageRows.map((row) => [row.id, row]));
      const ids = [...deferred.values()].filter((row) => row.store === store &&
        (row.reason === 'refetch' || openSession === null || row.sessionId !== openSession)).map((row) => row.key);
      check(run);
      if (ids.length) {
        for (const row of await cloud.fetchByIds(SYNC_TABLES[store], ids, run.signal)) rows.set(row.id, row);
      }
      pulled.set(store, { rows, cursor: last && pair(last), missing: ids.filter((id) => !rows.has(id)) });
    }
    for (const group of applyGroups) {
      await write(run, [...group.map(table), db.syncOutbox, db.syncMeta], async () => {
        await checkOwner(run);
        const parked = await readDeferred();
        for (const store of group) {
          const { rows, cursor, missing } = pulled.get(store)!;
          for (const row of rows.values()) await applyRow(store, row, parked);
          for (const id of missing) parked.delete(deferredKey(store, id));
          if (cursor) await db.syncMeta.put({ id: cursorId(store), cursor });
        }
        await saveDeferred(parked);
      });
    }
  }

  function cancel(state: 'paused' | 'owner-mismatch' = 'paused') {
    paused = true;
    generation++;
    again = false;
    clearTimeout(debounce);
    controller?.abort();
    update({ state });
  }

  async function pause() {
    if (!transport) return;
    cancel(status.state === 'owner-mismatch' ? 'owner-mismatch' : 'paused');
    await active;
  }

  async function resume() {
    const ownerId = signedInUser();
    const resumeGen = generation;
    await active;
    if (!transport || !paused || resolving || !ownerId || signedInUser() !== ownerId ||
      generation !== resumeGen || status.state === 'owner-mismatch') return;
    paused = false;
    await syncNow();
  }

  async function runOnce(cloud: SyncTransport, run: Run) {
    let result: Partial<SyncStatus> = {};
    try {
      check(run);
      if (win?.navigator.onLine === false) {
        result = { state: 'offline' };
        return;
      }
      update({ state: 'syncing' });
      const ownership = await claim(run);
      if (ownership === 'mismatch') {
        result = { state: 'owner-mismatch', lastSyncedAt: null };
        return;
      }
      if (ownership === 'adopt') {
        const sent = new Set<string>();
        await push(cloud, run, sent);
        await seedLegacy(run, sent);
      }
      await push(cloud, run);
      await pull(cloud, run);
      const lastSyncedAt = now().toISOString();
      await write(run, [db.syncMeta], async () => {
        await checkOwner(run);
        await db.syncMeta.put({ id: 'owner', ownerId: run.ownerId, lastSyncedAt });
      });
      check(run);
      result = { state: 'idle', lastSyncedAt };
    } catch (error) {
      if (run.generation !== generation) return;
      result = { state: error instanceof Aborted ? 'paused' :
        error instanceof SyncError && error.offline ? 'offline' : 'error' };
    } finally {
      const pending = await readPending();
      update({ ...pending, ...(run.generation === generation ? result : {}) });
    }
  }

  function startRun(ownerId: string, execute: (run: Run) => Promise<void>) {
    controller = new AbortController();
    const run: Run = { generation, ownerId, signal: controller.signal };
    active = execute(run).finally(() => {
      active = undefined;
      controller = undefined;
    });
    return active;
  }

  function syncNow(): Promise<void> {
    const ownerId = signedInUser();
    if (!transport || paused || resolving || !ownerId || status.state === 'owner-mismatch') return Promise.resolve();
    if (active) {
      again = true;
      return active;
    }
    const cloud = transport;
    return startRun(ownerId, async (run) => {
      do {
        again = false;
        await runOnce(cloud, run);
      } while (again && !paused && run.generation === generation && status.state !== 'owner-mismatch');
    });
  }

  // Called after pause(): push the current owner's outbox once, with triggers still paused.
  async function flush(): Promise<number> {
    const cloud = transport;
    const ownerId = signedInUser();
    if (cloud && paused && !resolving && ownerId && status.state !== 'owner-mismatch' && win?.navigator.onLine !== false) {
      if (!active) {
        generation++;
        startRun(ownerId, async (run) => {
          try {
            await checkOwner(run);
            await push(cloud, run);
          } catch {
            // Leave unsent entries for the caller's pending-changes warning.
          }
        });
      }
      await active;
    }
    const pending = await pendingCount(db);
    update({ pending });
    return pending;
  }

  async function readPending(): Promise<Partial<SyncStatus>> {
    try {
      return { pending: await pendingCount(db) };
    } catch {
      // Preserve the last count if IndexedDB is unavailable.
      return {};
    }
  }

  function schedule(delay = 0) {
    if (!transport || paused || resolving || !signedInUser()) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), delay);
  }

  function notifyCapture() {
    if (!transport) return;
    void readPending().then(update);
    schedule(debounceMs);
  }

  function onAuth() {
    const user = signedInUser();
    if (user === observedUser) return;
    const previous = observedUser;
    observedUser = user;
    if (!user || previous) {
      if (previous !== undefined) cancel();
      if (!user) return;
    }
    const resumeGen = generation;
    // The auth store notifies synchronously from Supabase's auth callback.
    setTimeout(async () => {
      await active;
      if (generation !== resumeGen || signedInUser() !== user) return;
      paused = false;
      await syncNow();
    }, 0);
  }

  async function resolveMismatch(action: 'discard' | 'keep') {
    const ownerId = signedInUser();
    if (!transport || !ownerId || status.state !== 'owner-mismatch' || resolving) return;
    resolving = true;
    if (action === 'keep') {
      try {
        await auth.signOut();
      } finally {
        resolving = false;
      }
      return;
    }

    cancel();
    const resetGen = generation;
    try {
      await active;
      // Invalidate the old run before clearing, without waiting on the replacement run itself.
      await claim({ generation: resetGen, ownerId, signal: new AbortController().signal }, true);
    } catch (error) {
      if (generation === resetGen) update({ state: error instanceof Aborted ? 'paused' : 'owner-mismatch' });
      return;
    } finally {
      resolving = false;
      if (generation === resetGen && signedInUser() === ownerId) paused = false;
    }
    await syncNow();
  }

  return {
    start() {
      if (!transport || started) return;
      started = true;
      auth.subscribe(onAuth);
      win?.addEventListener('online', () => schedule());
      win?.document.addEventListener('visibilitychange', () => {
        if (win.document.visibilityState === 'visible') schedule();
      });
      onAuth();
    },
    syncNow,
    pause,
    flush,
    resume,
    getStatus: () => status,
    subscribe(listener: () => void) {
      if (!transport) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notifyCapture,
    setOpenSession(id: string | null) {
      if (!transport) return;
      const previous = openSession;
      openSession = id;
      if (previous && id === null) schedule();
    },
    resolveMismatch,
  };
}

export const sync = createSyncEngine({
  db, transport: supabase ? createSupabaseTransport(supabase) : null, auth, win: globalThis.window,
});
