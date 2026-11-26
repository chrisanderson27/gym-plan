import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureDefaultSettings } from '../data/settings';
import { STORE_NAMES } from '../data/stores';
import { openTestDb } from '../data/test-utils';
import type { AuthState } from './auth';
import { createSyncEngine } from './engine';
import { createFakeServer } from './fake-server.test-fixture';
import { withSyncApply } from './marker';
import { ADOPTION, installOutbox, pendingCount } from './outbox';
import type { SyncRow } from './transport';

const epoch = new Date(0).toISOString();
const later = '2090-01-01T00:00:00.000Z';
const remote = (id: string, data: SyncRow['data'] = { id }, client_updated_at = later) =>
  ({ id, data, client_updated_at, deleted_at: null });
const bodyLog = (date: string, weightLb = 150) => ({ date, weightLb, protein: false });

let db: ReturnType<typeof openTestDb>;
let server: ReturnType<typeof createFakeServer>;
beforeEach(() => {
  db = openTestDb();
  server = createFakeServer();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

function setup({ user = 'a', online = true, capture = true }: { user?: string; online?: boolean; capture?: boolean } = {}) {
  const handlers = new Set<() => void>();
  const win = Object.assign(new EventTarget(), {
    navigator: { onLine: online },
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' as const }),
  });
  let state: AuthState;
  function setUser(id: string) {
    state = { status: id ? 'signed-in' : 'guest', user: id ? { id, email: null, name: null } : null, notice: null, recovery: false };
    for (const handler of handlers) handler();
  }
  setUser(user);
  const signOut = vi.fn(async () => {
    setUser('');
    return { ok: true } as const;
  });
  const engine = createSyncEngine({
    db, transport: server.transport, win, now: () => new Date(later),
    auth: {
      getState: () => state, signOut,
      subscribe(listener) {
        handlers.add(listener);
        return () => { handlers.delete(listener); };
      },
    },
  });
  if (capture) installOutbox(db);
  return { engine, setUser, signOut, win };
}

const owner = (id = 'a') => db.syncMeta.put({ id: 'owner', ownerId: id });

it('pull applies without requeueing, and overlap replay is idempotent', async () => {
  const { engine } = setup();
  await owner();
  server.seed('sessions', [remote('s')]);
  const push = vi.spyOn(server.transport, 'push');
  const pull = vi.spyOn(server.transport, 'pull');
  await engine.syncNow();
  expect(await db.sessions.get('s')).toEqual({ id: 's' });
  expect(await db.syncOutbox.count()).toBe(0);
  await engine.syncNow();
  expect(await db.sessions.toArray()).toEqual([{ id: 's' }]);
  expect(await db.syncOutbox.count()).toBe(0);
  expect(push).not.toHaveBeenCalled();
  expect(pull).toHaveBeenCalledWith('sessions', { since: '2025-12-31T23:59:00.000Z' }, 1000, expect.any(AbortSignal));
  expect(await db.syncMeta.get('owner')).toMatchObject({ lastSyncedAt: later });
  expect(await db.syncMeta.get('cursor:sets')).toBeUndefined();
});

it('drops an older rejected push and refetches the newer remote row behind the cursor', async () => {
  const { engine } = setup();
  await owner();
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  server.seed('body_logs', [remote('2026-01-01', bodyLog('2026-01-01', 152))]);
  await db.syncMeta.put({ id: 'cursor:bodyLogs', cursor: { updatedAt: '2026-01-03T00:00:00+00:00', id: 'ahead' } });
  const fetch = vi.spyOn(server.transport, 'fetchByIds');
  await engine.syncNow();
  expect(fetch).toHaveBeenCalledWith('body_logs', ['2026-01-01'], expect.any(AbortSignal));
  expect(await db.bodyLogs.get('2026-01-01')).toHaveProperty('weightLb', 152);
  expect(await db.syncOutbox.count()).toBe(0);
  expect(await db.syncMeta.get('deferred')).toBeUndefined();
});

it.each([
  { versions: epoch, expectedWeight: 151, pending: 1, name: 'skips an incoming row older than a pending edit' },
  { versions: later, expectedWeight: 152, pending: 0, name: 'applies a newer incoming row and drops the pending edit' },
])('$name', async ({ versions, expectedWeight, pending }) => {
  const { engine } = setup();
  await owner();
  const date = '2026-01-01';
  server.seed('body_logs', [remote(date, bodyLog(date, 152), versions)]);
  const pull = server.transport.pull;
  vi.spyOn(server.transport, 'pull').mockImplementationOnce(async (...args) => {
    await db.bodyLogs.put(bodyLog(date, 151));
    return pull(...args);
  });
  await engine.syncNow();
  expect(await db.bodyLogs.get(date)).toHaveProperty('weightLb', expectedWeight);
  expect(await db.syncOutbox.count()).toBe(pending);
});

it('sends empty-data tombstones for deletes and removes local rows on incoming tombstones', async () => {
  const { engine } = setup();
  await owner();
  const deleted = '2026-01-01';
  const remoteDeleted = '2026-01-02';
  await withSyncApply(db, [db.bodyLogs], () => db.bodyLogs.bulkAdd([bodyLog(deleted), bodyLog(remoteDeleted)]));
  await db.bodyLogs.delete(deleted);
  const [entry] = await db.syncOutbox.toArray();
  server.seed('body_logs', [{ ...remote(remoteDeleted, {}), deleted_at: later }]);
  await engine.syncNow();
  expect(server.rows('body_logs').get(deleted)).toMatchObject({ data: {}, deleted_at: entry!.clientUpdatedAt });
  expect(await db.bodyLogs.count()).toBe(0);
  expect(await db.syncOutbox.count()).toBe(0);
});

it('adopts legacy data at epoch or updatedAt and leaves newer server data intact', async () => {
  const { engine } = setup();
  const date = '2026-01-01';
  const changedAt = '2026-02-01T00:00:00.000Z';
  await ensureDefaultSettings(db);
  await withSyncApply(db, [db.bodyLogs, db.settings, db.libraryBlocks], async () => {
    await db.bodyLogs.bulkAdd([bodyLog(date), bodyLog('2026-01-02')]);
    await db.settings.update('settings', { updatedAt: changedAt });
    await db.table('libraryBlocks').put({ id: 'block', updatedAt: changedAt });
  });
  server.seed('body_logs', [remote(date, bodyLog(date, 160))]);
  await engine.syncNow();
  expect(await db.syncMeta.get('owner')).toMatchObject({ ownerId: 'a' });
  expect(server.rows('body_logs').get(date)?.data.weightLb).toBe(160);
  expect(server.rows('body_logs').get('2026-01-02')?.client_updated_at).toBe(epoch);
  expect(server.rows('settings').get('settings')?.client_updated_at).toBe(changedAt);
  expect(server.rows('library_blocks').get('block')?.client_updated_at).toBe(changedAt);
});

it('seeds adoption before a failed push and retries guest edits at their real timestamps', async () => {
  const { engine, setUser } = setup({ user: '' });
  const date = '2026-01-01';
  await db.bodyLogs.add(bodyLog(date));
  const [entry] = await db.syncOutbox.toArray();
  await engine.syncNow();
  expect(server.rows('body_logs').size).toBe(0);
  setUser('a');
  server.failNext('error');
  await engine.syncNow();
  expect(engine.getStatus()).toMatchObject({ state: 'error', pending: 1 });
  expect(await db.syncMeta.get('adoption')).toBeUndefined();
  await engine.syncNow();
  expect(server.rows('body_logs').get(date)?.client_updated_at).toBe(entry!.clientUpdatedAt);
  expect(server.rows('equipment').size).toBeGreaterThan(0);
  expect(server.rows('settings').get('settings')?.client_updated_at).toBe(epoch);
  expect(await db.syncOutbox.count()).toBe(0);
  expect(await db.syncMeta.get('adoption')).toBeUndefined();
});

it('counts the same pending edits before and after seeding legacy rows', async () => {
  const { engine } = setup();
  const queuedDate = '2026-01-01';
  const legacyDate = '2026-01-02';
  await owner();
  await db.syncMeta.put({ id: ADOPTION });
  await db.bodyLogs.add(bodyLog(queuedDate));
  await withSyncApply(db, [db.bodyLogs, db.sessions], async () => {
    await db.bodyLogs.add(bodyLog(legacyDate));
    await db.table('sessions').add({ id: queuedDate });
  });

  const before = await pendingCount(db);
  expect(before).toBe(3);
  server.failNext('error');
  await engine.syncNow();

  expect(await db.syncMeta.get(ADOPTION)).toBeUndefined();
  const queued = await db.syncOutbox.toArray();
  expect(queued.filter(({ store }) => store === 'bodyLogs' || store === 'sessions')).toHaveLength(before);
  expect(queued.some(({ store }) => store === 'settings')).toBe(true);
  expect(await pendingCount(db)).toBe(before);
  await engine.pause();
});

it('downloads 2500 rows at one updated_at without omissions or duplicates', async () => {
  const { engine } = setup();
  await owner();
  const time = '2026-01-01T00:00:00.412345+00:00';
  const incoming = Array.from({ length: 2500 }, (_, i) => remote(`workout-${String(i).padStart(4, '0')}`));
  server.clock.repeat(time, incoming.length);
  server.seed('sessions', incoming);
  const pull = vi.spyOn(server.transport, 'pull');
  await engine.syncNow();
  expect(await db.sessions.toCollection().primaryKeys()).toEqual(incoming.map((row) => row.id));
  expect(pull).toHaveBeenCalledWith('sessions', { after: { updatedAt: time, id: 'workout-1999' } }, 1000, expect.any(AbortSignal));
  expect(await db.syncMeta.get('cursor:sessions')).toHaveProperty('cursor', { updatedAt: time, id: 'workout-2499' });
});

it('rolls back all related stores and their cursors when applying sets fails', async () => {
  const { engine } = setup();
  await owner();
  server.seed('sessions', [remote('s')]);
  server.seed('sets', [remote('set', { id: 'set', sessionId: 's' })]);
  server.seed('runs', [remote('s', { sessionId: 's' })]);
  server.seed('swims', [remote('s', { sessionId: 's' })]);
  db.sets.hook('creating', () => { throw new Error('injected set write failure'); });

  await engine.syncNow();
  expect(engine.getStatus().state).toBe('error');
  for (const store of ['sessions', 'sets', 'runs', 'swims']) {
    expect(await db.table(store).count(), store).toBe(0);
    expect(await db.syncMeta.get(`cursor:${store}`), store).toBeUndefined();
  }
});

it('preserves a write re-stamped while push is in flight', async () => {
  const { engine } = setup();
  await owner();
  const date = '2026-01-01';
  await db.bodyLogs.add(bodyLog(date));
  const push = server.transport.push;
  vi.spyOn(server.transport, 'push').mockImplementationOnce(async (...args) => {
    await db.bodyLogs.put(bodyLog(date, 151));
    return push(...args);
  });
  await engine.syncNow();
  expect(await db.syncOutbox.count()).toBe(1);
  expect(await db.bodyLogs.get(date)).toHaveProperty('weightLb', 151);
  expect(server.rows('body_logs').get(date)?.data.weightLb).toBe(150);
  await engine.syncNow();
  expect(server.rows('body_logs').get(date)?.data.weightLb).toBe(151);
  expect(await db.syncOutbox.count()).toBe(0);
});

it('parks open session rows, advances the cursor, and refetches behind it on close', async () => {
  const { engine } = setup();
  await owner();
  engine.setOpenSession('s');
  const cursorTime = '2026-01-03T00:00:00.000001+00:00';
  server.seed('sessions', [remote('s'), { ...remote('other'), updated_at: cursorTime }]);
  server.seed('sets', [remote('set', { id: 'set', sessionId: 's' })]);
  server.seed('runs', [remote('s', { sessionId: 's' })]);
  server.seed('swims', [remote('s', { sessionId: 's' })]);
  await engine.syncNow();
  expect(await db.sessions.toArray()).toEqual([{ id: 'other' }]);
  expect(await db.sets.count()).toBe(0);
  expect(await db.runs.count()).toBe(0);
  expect(await db.swims.count()).toBe(0);
  expect(await db.syncMeta.get('deferred')).toHaveProperty('rows', [
    { store: 'sessions', key: 's', reason: 'open-session', sessionId: 's' },
    { store: 'sets', key: 'set', reason: 'open-session', sessionId: 's' },
    { store: 'runs', key: 's', reason: 'open-session', sessionId: 's' },
    { store: 'swims', key: 's', reason: 'open-session', sessionId: 's' },
  ]);
  expect(await db.syncMeta.get('cursor:sessions')).toHaveProperty('cursor', { updatedAt: cursorTime, id: 'other' });
  server.seed('sessions', [
    remote('s', { id: 's', notes: 'latest' }),
    { ...remote('next'), updated_at: '2026-01-04T00:00:00.000001+00:00' },
  ]);
  engine.setOpenSession(null);
  engine.setOpenSession('next');
  await engine.syncNow();
  await engine.pause();
  expect(await db.sessions.get('s')).toHaveProperty('notes', 'latest');
  expect(await db.sessions.get('next')).toBeUndefined();
  expect(await db.sets.count()).toBe(1);
  expect(await db.runs.count()).toBe(1);
  expect(await db.swims.count()).toBe(1);
  expect(await db.syncMeta.get('deferred')).toHaveProperty('rows', [
    { store: 'sessions', key: 'next', reason: 'open-session', sessionId: 'next' },
  ]);
});

it('parks tombstones for the open session and its sets, runs, and swims', async () => {
  const { engine } = setup();
  await owner();
  const groups = [
    ['sessions', 's', { id: 's' }],
    ['sets', 'set', { id: 'set', sessionId: 's' }],
    ['runs', 's', { sessionId: 's' }],
    ['swims', 's', { sessionId: 's' }],
  ] as const;
  await withSyncApply(db, groups.map(([store]) => db.table(store)), async () => {
    for (const [store, , data] of groups) await db.table(store).put(data);
  });
  for (const [store, id] of groups) server.seed(store, [{ ...remote(id, {}), deleted_at: later }]);
  engine.setOpenSession('s');
  await engine.syncNow();
  for (const [store] of groups) expect(await db.table(store).count(), store).toBe(1);
  engine.setOpenSession(null);
  await engine.syncNow();
  await engine.pause();
  for (const [store] of groups) expect(await db.table(store).count(), store).toBe(0);
});

it('silently clears an old owner with no pending entries before pulling the new account', async () => {
  const { engine } = setup({ user: 'b' });
  await owner();
  await withSyncApply(db, [db.sessions], () => db.table('sessions').put({ id: 'old' }));
  server.seed('sessions', [remote('new')]);
  const push = vi.spyOn(server.transport, 'push');
  await engine.syncNow();
  expect(push).not.toHaveBeenCalled();
  expect(await db.sessions.toArray()).toEqual([{ id: 'new' }]);
  expect(await db.syncMeta.get('owner')).toMatchObject({ ownerId: 'b' });
});

it.each(['discard', 'keep'] as const)('blocks push on pending owner mismatch, then handles %s', async (action) => {
  const { engine, signOut } = setup({ user: 'b' });
  await owner();
  await db.table('sessions').put({ id: 'old' });
  server.seed('sessions', [remote('new')]);
  const push = vi.spyOn(server.transport, 'push');
  await engine.syncNow();
  expect(engine.getStatus()).toMatchObject({ state: 'owner-mismatch', pending: 1 });
  await engine.resolveMismatch(action);
  expect(push).not.toHaveBeenCalled();
  if (action === 'discard') {
    expect(await db.sessions.toArray()).toEqual([{ id: 'new' }]);
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncMeta.get('owner')).toMatchObject({ ownerId: 'b' });
  } else {
    expect(signOut).toHaveBeenCalledOnce();
    expect(await db.sessions.toArray()).toEqual([{ id: 'old' }]);
    expect(await db.syncOutbox.count()).toBe(1);
    expect(await db.syncMeta.get('owner')).toMatchObject({ ownerId: 'a' });
  }
});

it('skips and logs mismatched primary keys without blocking the cursor', async () => {
  const { engine } = setup();
  await owner();
  server.seed('sessions', [remote('s', { id: 'wrong' })]);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await engine.syncNow();
  expect(warn).toHaveBeenCalledOnce();
  expect(await db.sessions.count()).toBe(0);
  expect(await db.syncMeta.get('cursor:sessions')).toHaveProperty('cursor.id', 's');
});

it('pause during pull prevents any apply, and a new sign-in resumes sync automatically', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { engine, setUser } = setup({ user: '' });
  await owner();
  engine.start();
  setUser('a');
  server.seed('sessions', [remote('s')]);
  const started = Promise.withResolvers<AbortSignal>();
  const finish = Promise.withResolvers<SyncRow[]>();
  const pull = vi.spyOn(server.transport, 'pull').mockImplementationOnce((_, __, ___, signal) => {
    started.resolve(signal);
    return finish.promise;
  });
  const run = engine.syncNow();
  const signal = await started.promise;
  const paused = engine.pause();
  expect(signal.aborted).toBe(true);
  finish.resolve([remote('s') as SyncRow]);
  await paused;
  await run;
  await engine.syncNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).toHaveBeenCalledOnce();
  expect(await db.sessions.count()).toBe(0);
  expect(engine.getStatus().state).toBe('paused');

  setUser('');
  setUser('a');
  const applied = Promise.withResolvers<void>();
  const unsubscribe = engine.subscribe(() => {
    if (engine.getStatus().lastSyncedAt === later && engine.getStatus().state === 'idle') applied.resolve();
  });
  await vi.advanceTimersByTimeAsync(0);
  await applied.promise;
  await engine.pause();
  unsubscribe();
  expect(await db.sessions.count()).toBe(1);
});

it('lets an auth change release the pause during mismatch resolution without syncing until it finishes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { engine, setUser, signOut } = setup({ user: 'b' });
  await owner();
  const row = bodyLog('2026-01-01');
  await db.bodyLogs.put(row);
  engine.start();
  await engine.syncNow();
  expect(engine.getStatus().state).toBe('owner-mismatch');

  const finish = Promise.withResolvers<{ ok: true }>();
  signOut.mockReturnValueOnce(finish.promise);
  const resolving = engine.resolveMismatch('keep');
  setUser('');
  setUser('a');
  await vi.advanceTimersByTimeAsync(0);
  expect(server.rows('body_logs').size).toBe(0);

  finish.resolve({ ok: true });
  await resolving;
  await engine.syncNow();
  expect(server.rows('body_logs').get(row.date)?.data).toEqual(row);
});

it.each(['syncNow', 'flush'] as const)('pause before %s acknowledges a push leaves its outbox entries intact', async (method) => {
  const { engine } = setup();
  await owner();
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  const sending = Promise.withResolvers<AbortSignal>();
  const finish = Promise.withResolvers<[]>();
  vi.spyOn(server.transport, 'push').mockImplementationOnce(async (_table, _rows, signal) => {
    sending.resolve(signal);
    return finish.promise;
  });
  if (method === 'flush') await engine.pause();
  const run = engine[method]();
  const signal = await sending.promise;
  const paused = engine.pause();
  expect(signal.aborted).toBe(true);
  finish.resolve([]);
  await paused;
  await run;
  expect(await db.syncOutbox.count()).toBe(1);
  expect(await db.syncMeta.get('deferred')).toBeUndefined();
});

it('flush pushes once while paused and leaves ordinary sync triggers blocked', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { engine, win } = setup();
  await owner();
  const row = bodyLog('2026-01-01');
  await db.bodyLogs.put(row);
  const push = vi.spyOn(server.transport, 'push');
  const pull = vi.spyOn(server.transport, 'pull');
  engine.start();
  await engine.pause();

  const flushing = engine.flush();
  const concurrentFlush = engine.flush();
  engine.notifyCapture();
  win.dispatchEvent(new Event('online'));
  win.document.dispatchEvent(new Event('visibilitychange'));
  await engine.syncNow();
  await vi.runAllTimersAsync();

  expect(await Promise.all([flushing, concurrentFlush])).toEqual([0, 0]);
  expect(push).toHaveBeenCalledOnce();
  expect(server.rows('body_logs').get(row.date)?.data).toEqual(row);
  expect(pull).not.toHaveBeenCalled();
  expect(engine.getStatus()).toMatchObject({ state: 'paused', pending: 0 });
});

it.each(['offline', 'error', 'wrong owner'] as const)('flush leaves pending changes on %s', async (condition) => {
  const { engine } = setup({ online: condition !== 'offline' });
  await owner(condition === 'wrong owner' ? 'b' : 'a');
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  if (condition === 'error') server.failNext('error');
  const push = vi.spyOn(server.transport, 'push');
  await engine.pause();

  expect(await engine.flush()).toBe(1);
  expect(push).toHaveBeenCalledTimes(condition === 'error' ? 1 : 0);
  expect(engine.getStatus()).toMatchObject({ state: 'paused', pending: 1 });
});

it('flush logs an unexpected push failure and still returns the pending count', async () => {
  const { engine } = setup();
  await owner();
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await engine.pause();

  server.failNext('abort');
  expect(await engine.flush()).toBe(1);
  expect(log).not.toHaveBeenCalled();

  const error = new TypeError('unexpected push failure');
  vi.spyOn(server.transport, 'push').mockRejectedValueOnce(error);
  expect(await engine.flush()).toBe(1);
  expect(log).toHaveBeenCalledExactlyOnceWith('Unexpected sync flush failure', error);
});

it('flush returns its last pending count when IndexedDB is unavailable', async () => {
  const { engine } = setup({ online: false });
  await owner();
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  await engine.syncNow();
  await engine.pause();
  db.close();

  expect(await engine.flush()).toBe(1);
  expect(engine.getStatus().pending).toBe(1);
});

it('protects unqueued legacy rows after interrupted adoption during flush and account switching', async () => {
  const { engine, setUser } = setup();
  await db.transaction('rw', db.syncMeta, async () => {
    await owner();
    await db.syncMeta.put({ id: 'adoption' });
  });
  const row = bodyLog('2026-01-01');
  await withSyncApply(db, [db.bodyLogs], () => db.bodyLogs.put(row));
  expect(await db.syncOutbox.count()).toBe(0);
  await engine.pause();

  expect(await engine.flush()).toBe(1);
  setUser('b');
  await engine.resume();

  expect(engine.getStatus()).toMatchObject({ state: 'owner-mismatch', pending: 1 });
  expect(await db.syncMeta.get('owner')).toMatchObject({ ownerId: 'a' });
  expect(await db.bodyLogs.get(row.date)).toEqual(row);
});

it('resumes push and pull for the same signed-in user after a pause', async () => {
  const { engine } = setup();
  await owner();
  await engine.pause();
  const row = bodyLog('2026-01-01');
  await db.bodyLogs.put(row);
  server.seed('sessions', [remote('s')]);

  await engine.resume();

  expect(server.rows('body_logs').get(row.date)?.data).toEqual(row);
  expect(await db.sessions.get('s')).toEqual({ id: 's' });
  expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
});

it.each(['guest', 'owner-mismatch'] as const)('resume leaves sync blocked for %s', async (state) => {
  const { engine } = setup({ user: state === 'guest' ? '' : 'b' });
  await owner();
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  await engine.syncNow();
  await engine.pause();
  const push = vi.spyOn(server.transport, 'push');
  const pull = vi.spyOn(server.transport, 'pull');

  await engine.resume();

  expect(engine.getStatus().state).toBe(state === 'guest' ? 'paused' : 'owner-mismatch');
  expect(push).not.toHaveBeenCalled();
  expect(pull).not.toHaveBeenCalled();
});

it('debounces capture and runs on coming online and becoming visible', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { engine, win } = setup();
  await owner();
  const pull = vi.spyOn(server.transport, 'pull');
  const idle = () => {
    const done = Promise.withResolvers<void>();
    const unsubscribe = engine.subscribe(() => {
      if (engine.getStatus().state !== 'idle') return;
      unsubscribe();
      done.resolve();
    });
    return done.promise;
  };
  engine.start();
  let done = idle();
  await vi.advanceTimersByTimeAsync(0);
  await done;
  pull.mockClear();
  engine.notifyCapture();
  engine.notifyCapture();
  await vi.advanceTimersByTimeAsync(1999);
  expect(pull).not.toHaveBeenCalled();
  done = idle();
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(pull).toHaveBeenCalledTimes(STORE_NAMES.length);

  for (const [target, event] of [[win, 'online'], [win.document, 'visibilitychange']] as const) {
    pull.mockClear();
    done = idle();
    target.dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(pull).toHaveBeenCalledTimes(STORE_NAMES.length);
  }
  await engine.pause();
});

it('a signed-in offline launch reports pending changes without touching the network', async () => {
  const { engine } = setup({ online: false });
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  const push = vi.spyOn(server.transport, 'push');
  const pull = vi.spyOn(server.transport, 'pull');
  await engine.syncNow();
  expect(engine.getStatus()).toMatchObject({ state: 'offline', pending: 1 });
  expect(await db.syncMeta.get('owner')).toBeUndefined();
  expect(push).not.toHaveBeenCalled();
  expect(pull).not.toHaveBeenCalled();
});

it('retries idle errors with exponential backoff and cancels the retry on pause', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { engine } = setup();
  await owner();
  await db.bodyLogs.put(bodyLog('2026-01-01'));
  const push = vi.spyOn(server.transport, 'push').mockRejectedValue(new Error('Push unavailable'));
  const nextError = () => new Promise<void>((resolve) => {
    const unsubscribe = engine.subscribe(() => {
      if (engine.getStatus().state !== 'error') return;
      unsubscribe();
      resolve();
    });
  });

  await engine.syncNow();
  expect(engine.getStatus().state).toBe('error');
  expect(push).toHaveBeenCalledTimes(1);
  for (const [delay, calls] of [[30_000, 2], [60_000, 3]] as const) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(push).toHaveBeenCalledTimes(calls - 1);
    const failed = nextError();
    // schedule() hands the retry off to the existing zero-delay debounce.
    await vi.advanceTimersByTimeAsync(2);
    await failed;
    expect(push).toHaveBeenCalledTimes(calls);
  }
  await engine.pause();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(push).toHaveBeenCalledTimes(3);
});

it('starts retry backoff at 30 seconds after signing out and back in', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const { engine, setUser } = setup();
  await owner();
  vi.spyOn(server.transport, 'pull').mockRejectedValue(new Error('Pull unavailable'));
  await engine.syncNow();
  expect(timers).toHaveBeenCalledWith(expect.any(Function), 30_000);

  engine.start();
  setUser('');
  setUser('a');
  timers.mockClear();
  await vi.waitFor(() => expect(engine.getStatus().state).toBe('error'));

  expect(timers).toHaveBeenCalledWith(expect.any(Function), 30_000);
  await engine.pause();
});
