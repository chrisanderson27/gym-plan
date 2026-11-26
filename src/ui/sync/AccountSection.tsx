import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { account } from '../../sync/account';
import { sync } from '../../sync/engine';
import { Sheet } from '../Sheet';
import { useAuth } from '../auth/useAuth';
import { ArrowRightIcon, PersonIcon } from '../icons';
import { navigate } from '../router';
import { changesLabel, syncStatusLabel } from './copy';
import { useSyncStatus } from './useSyncStatus';

const signOutHeading = 'Sign out and remove unsynced changes?';
const deleteHeading = 'Delete your account?';

export function AccountSection() {
  const { user } = useAuth();
  const status = useSyncStatus();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<number | null>(null);
  const pendingSignOut = useRef(false);
  const unmounted = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  useLayoutEffect(() => () => {
    unmounted.current = true;
    if (pendingSignOut.current) void account.cancelSignOut();
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const signOut = (discardUpTo?: number) => run(async () => {
    pendingSignOut.current = false;
    const result = await account.signOut({ discardUpTo });
    if (result.kind === 'pending' && unmounted.current) {
      await account.cancelSignOut();
      return;
    }
    pendingSignOut.current = result.kind === 'pending';
    setPending(result.kind === 'pending' ? result.count : null);
    if (result.kind === 'done') navigate('/');
    if (result.kind === 'error') setError("Couldn't sign out. Try again.");
  });

  const cancelSignOut = () => run(async () => {
    pendingSignOut.current = false;
    await account.cancelSignOut();
    setPending(null);
  });

  const deleteAccount = () => run(async () => {
    const result = await account.deleteAccount();
    setConfirmDelete(false);
    if (result.kind === 'done') navigate('/');
    else setError(result.kind === 'offline' ? "You're offline — nothing was deleted."
      : "Couldn't delete your account. Nothing was changed. Try again.");
  });

  const closeDelete = () => { if (!busyRef.current) setConfirmDelete(false); };

  return (
    <section class="card" data-testid="account-card" aria-busy={busy}>
      <div class="pref-head">
        <span class="pref-tile pref-tile-mint" aria-hidden="true"><PersonIcon /></span>
        <div>
          <h2>Account</h2>
          <p class="pref-support pref-account-identity">
            {user ? [user.name, user.email !== user.name ? user.email : null].filter(Boolean).join(' · ')
              : 'Your workouts are saved on this phone only.'}
          </p>
        </div>
      </div>
      {user ? (
        <>
          <div class="check pref-cue">
            <span class="pref-copy">
              <span class="pref-cue-title">Sync</span>
              <span class="pref-cue-sub" role="status">{syncStatusLabel(status, new Date())}</span>
            </span>
            {status.state === 'error' && (
              <button type="button" class="btn" disabled={busy} onClick={() => void sync.syncNow()}>Retry</button>
            )}
          </div>
          <div class="actions pref-account-actions">
            <button type="button" class="btn" disabled={busy} onClick={() => void signOut()}>Sign out</button>
            <button type="button" class="btn pref-danger" disabled={busy || !online}
              aria-describedby={online ? undefined : 'account-delete-offline'}
              onClick={() => { setError(''); setConfirmDelete(true); }}>Delete account</button>
          </div>
          {!online && <p class="pref-cue-sub" id="account-delete-offline">Connect to the internet to delete your account.</p>}
          {error && <p class="warn" role="alert">{error}</p>}
        </>
      ) : (
        <a class="training-link" href="#/sign-in">Sign in to back up your workouts <ArrowRightIcon /></a>
      )}
      {pending !== null && (
        <Sheet label={signOutHeading} onClose={() => void cancelSignOut()}>
          <h2>{signOutHeading}</h2>
          <p>{changesLabel(pending)} {pending === 1 ? "hasn't" : "haven't"} been backed up yet. Signing out removes {pending === 1 ? 'it' : 'them'} from this phone.</p>
          <div class="actions pref-account-actions">
            <button type="button" class="btn primary" disabled={busy} onClick={() => void signOut(pending)}>Sign out anyway</button>
            <button type="button" class="btn" disabled={busy} onClick={() => void cancelSignOut()}>Cancel</button>
          </div>
        </Sheet>
      )}
      {confirmDelete && (
        <Sheet label={deleteHeading} onClose={closeDelete}>
          <h2>{deleteHeading}</h2>
          <p>This permanently deletes your account and every workout saved to it, on all devices. This can't be undone.</p>
          <div class="actions pref-account-actions">
            <button type="button" class="btn primary pref-danger" disabled={busy} onClick={() => void deleteAccount()}>Delete account</button>
            <button type="button" class="btn" disabled={busy} onClick={closeDelete}>Cancel</button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
