import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SEED_EQUIPMENT } from '../content/equipment';
import { importExport } from '../data/backup';
import { ensureDefaultSettings } from '../data/settings';
import { openTestDb } from '../data/test-utils';
import { createAccount } from './account';
import type { AuthResult, AuthState } from './auth';
import { createSyncEngine } from './engine';
import { createFakeServer } from './fake-server.test-fixture';
import { withSyncApply } from './marker';
import { installOutbox } from './outbox';
import { SyncError } from './transport';

let db: ReturnType<typeof openTestDb>;
beforeEach(() => { db = openTestDb(); });
afterEach(async () => { await db.delete(); });

const session = { id: 'workout' };

async function setup(online = true) {
  const server = createFakeServer();
  const win = Object.assign(new EventTarget(), {
    navigator: { onLine: online },
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' as const }),
  });
  let state: AuthState = {
    status: 'signed-in', user: { id: 'owner', email: null, name: null }, notice: null, recovery: false,
  };
  const auth = {
    getState: () => state,
    subscribe: () => () => {},
    signOut: vi.fn(async () => {
      state = { ...state, status: 'signed-out', user: null };
      return { ok: true } as const;
    }),
    deleteAccount: vi.fn(async (onDeleted?: () => Promise<unknown>): Promise<AuthResult> => {
      await onDeleted?.();
      return auth.signOut();
    }),
  };
  const sync = createSyncEngine({ db, transport: server.transport, auth, win });
  const account = createAccount({ db, sync, auth, win });
  installOutbox(db);
  await db.syncMeta.put({ id: 'owner', ownerId: 'owner' });
  return { account, auth, server, sync };
}

const saveSession = (id = session.id) => db.table('sessions').put({ id });

it('signs out with an empty outbox, keeping server rows and only reseeding local equipment', async () => {
  const { account, auth, server } = await setup();
  await withSyncApply(db, [db.sessions], () => saveSession());
  server.seed('sessions', [{ id: session.id, data: session, client_updated_at: new Date().toISOString(), deleted_at: null }]);
  const push = vi.spyOn(server.transport, 'push');

  expect(await account.signOut()).toEqual({ kind: 'done' });
  expect(auth.signOut).toHaveBeenCalledOnce();
  for (const table of db.tables) {
    if (table.name === 'equipment') {
      expect(await table.toArray()).toEqual([...SEED_EQUIPMENT].sort((a, b) => a.id < b.id ? -1 : 1));
    } else {
      expect(await table.count(), table.name).toBe(0);
    }
  }
  expect(push).not.toHaveBeenCalled();
  expect(server.rows('sessions').get(session.id)).toMatchObject({ deleted_at: null });
});

it('flushes queued rows before clearing them on sign-out', async () => {
  const { account, server } = await setup();
  await saveSession();
  expect(await account.signOut()).toEqual({ kind: 'done' });
  expect(server.rows('sessions').get(session.id)?.data).toEqual(session);
  expect(await db.sessions.count()).toBe(0);
});

it('warns after an online push failure and resumes with the workout intact on cancel', async () => {
  const { account, auth, server, sync } = await setup();
  await saveSession();
  server.failNext('error');
  expect(await account.signOut()).toEqual({ kind: 'pending', count: 1 });
  expect(await db.sessions.get(session.id)).toEqual(session);
  expect(sync.getStatus().state).toBe('paused');
  expect(auth.signOut).not.toHaveBeenCalled();

  await account.cancelSignOut();
  expect(sync.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
  expect(await db.sessions.get(session.id)).toEqual(session);
});

it.each([
  { online: true, sessions: [session] },
  { online: false, sessions: [session, { id: 'second-workout' }] },
])('warns only about imported workouts after a backup timestamp update (online: $online)', async ({ online, sessions }) => {
  const { account, server } = await setup(online);
  await ensureDefaultSettings(db);
  await importExport(db, {
    schemaVersion: 2, exportedAt: '2026-02-01T00:00:00.000Z', appVersion: 'test',
    stores: { sessions },
  });
  if (online) server.failNext('error');

  expect(await account.signOut()).toEqual({ kind: 'pending', count: sessions.length });
});

it('warns only about the remaining rows after a later push batch fails', async () => {
  const { account, server } = await setup();
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: 'workout-' + i }));
  await db.table('sessions').bulkPut(rows);
  const push = server.transport.push;
  vi.spyOn(server.transport, 'push')
    .mockImplementationOnce(push)
    .mockRejectedValueOnce(new SyncError(new Error('Push unavailable (500)'), false));
  expect(await account.signOut()).toEqual({ kind: 'pending', count: 1 });
  expect(server.rows('sessions').size).toBe(500);
  expect(await db.sessions.count()).toBe(501);
});

it('warns about a write committed after the flush', async () => {
  const { account, sync } = await setup();
  const flush = sync.flush;
  vi.spyOn(sync, 'flush').mockImplementation(async () => {
    const pending = await flush();
    await saveSession();
    return pending;
  });
  expect(await account.signOut()).toEqual({ kind: 'pending', count: 1 });
  expect(await db.sessions.get(session.id)).toEqual(session);
});

it('asks again when a change lands after the warning and clears at the confirmed count', async () => {
  const { account, auth, server } = await setup();
  await saveSession();
  server.failNext('error');
  expect(await account.signOut()).toEqual({ kind: 'pending', count: 1 });
  await saveSession('another');
  expect(await account.signOut({ discardUpTo: 1 })).toEqual({ kind: 'pending', count: 2 });
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(await account.signOut({ discardUpTo: 2 })).toEqual({ kind: 'done' });
  expect(await db.sessions.count()).toBe(0);
  expect(server.rows('sessions').size).toBe(0);
});

it('warns offline without pushing and clears after confirmation', async () => {
  const { account, server } = await setup(false);
  const push = vi.spyOn(server.transport, 'push');
  await saveSession();
  expect(await account.signOut()).toEqual({ kind: 'pending', count: 1 });
  expect(await account.signOut({ discardUpTo: 1 })).toEqual({ kind: 'done' });
  expect(push).not.toHaveBeenCalled();
  expect(await db.sessions.count()).toBe(0);
});

it('counts unfinished adoption even without queued changes', async () => {
  const { account, auth } = await setup(false);
  await ensureDefaultSettings(db);
  await withSyncApply(db, [db.sessions], async () => {
    await saveSession();
    await saveSession('legacy-two');
  });
  await db.syncMeta.put({ id: 'adoption' });
  expect(await db.syncOutbox.count()).toBe(0);
  expect(await account.signOut()).toEqual({ kind: 'pending', count: 2 });
  expect(await db.sessions.get(session.id)).toEqual(session);
  expect(auth.signOut).not.toHaveBeenCalled();
});

it('signs out when interrupted adoption contains only seeded defaults', async () => {
  const { account, auth } = await setup(false);
  await ensureDefaultSettings(db);
  await db.syncMeta.put({ id: 'adoption' });

  expect(await account.signOut()).toEqual({ kind: 'done' });
  expect(auth.signOut).toHaveBeenCalledOnce();
});

it('clears only after the delete RPC succeeds and before signing out', async () => {
  const { account, auth, server } = await setup();
  const push = vi.spyOn(server.transport, 'push');
  await saveSession();
  auth.deleteAccount.mockImplementationOnce(async (onDeleted) => {
    expect(await db.sessions.get(session.id)).toEqual(session);
    await onDeleted?.();
    expect(await db.sessions.count()).toBe(0);
    expect(auth.signOut).not.toHaveBeenCalled();
    return auth.signOut();
  });
  expect(await account.deleteAccount()).toEqual({ kind: 'done' });
  expect(auth.signOut).toHaveBeenCalledOnce();
  expect(push).not.toHaveBeenCalled();
});

it('resumes sync and preserves the session and its data after a failed delete RPC', async () => {
  const { account, auth, sync } = await setup();
  await saveSession();
  const resume = vi.spyOn(sync, 'resume');
  auth.deleteAccount.mockResolvedValueOnce({ ok: false, error: 'unknown' });
  expect(await account.deleteAccount()).toEqual({ kind: 'error' });
  expect(resume).toHaveBeenCalledOnce();
  expect(await db.sessions.get(session.id)).toEqual(session);
  expect(auth.getState().status).toBe('signed-in');
});

it('does not pause or call the delete RPC offline', async () => {
  const { account, auth, sync } = await setup(false);
  const pause = vi.spyOn(sync, 'pause');
  expect(await account.deleteAccount()).toEqual({ kind: 'offline' });
  expect(pause).not.toHaveBeenCalled();
  expect(auth.deleteAccount).not.toHaveBeenCalled();
});
