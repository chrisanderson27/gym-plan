import { db, type GymDb } from '../data/db';
import { auth, type createAuth } from './auth';
import { clearLocalData } from './clear';
import { sync, type createSyncEngine } from './engine';

export type SignOutResult = { kind: 'done' } | { kind: 'pending'; count: number } | { kind: 'error' };
export type DeleteResult = { kind: 'done' } | { kind: 'offline' } | { kind: 'error' };

export function createAccount({ db, sync, auth, win }: {
  db: GymDb;
  sync: Pick<ReturnType<typeof createSyncEngine>, 'pause' | 'flush' | 'resume'>;
  auth: Pick<ReturnType<typeof createAuth>, 'signOut' | 'deleteAccount'>;
  win?: { navigator: Pick<Navigator, 'onLine'> };
}) {
  return {
    async signOut({ discardUpTo }: { discardUpTo?: number } = {}): Promise<SignOutResult> {
      try {
        await sync.pause();
        if (discardUpTo === undefined) await sync.flush();
        const { cleared, pending } = await clearLocalData(db, { maxPending: discardUpTo ?? 0 });
        if (!cleared) return { kind: 'pending', count: pending };
        await auth.signOut();
        return { kind: 'done' };
      } catch {
        await sync.resume();
        return { kind: 'error' };
      }
    },
    cancelSignOut: () => sync.resume(),
    async deleteAccount(): Promise<DeleteResult> {
      if (win?.navigator.onLine === false) return { kind: 'offline' };
      await sync.pause();
      const result = await auth.deleteAccount(() => clearLocalData(db));
      if (result.ok) return { kind: 'done' };
      await sync.resume();
      return { kind: result.error === 'offline' ? 'offline' : 'error' };
    },
  };
}

export const account = createAccount({ db, sync, auth, win: globalThis.window });
