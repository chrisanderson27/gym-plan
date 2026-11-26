import { sync } from '../../sync/engine';
import { Sheet } from '../Sheet';
import { useSyncStatus } from './useSyncStatus';

const heading = "This phone has someone else's workouts";

export function OwnerMismatchSheet() {
  const { state, pending } = useSyncStatus();
  if (state !== 'owner-mismatch') return null;

  return (
    <Sheet label={heading} onClose={() => {}}>
      <h2>{heading}</h2>
      <p>{pending} changes from the previous account haven't been backed up. Continue and they'll be removed from this phone.</p>
      <div class="actions">
        <button type="button" class="btn primary" onClick={() => void sync.resolveMismatch('discard')}>
          Remove and continue
        </button>
        <button type="button" class="btn" onClick={() => void sync.resolveMismatch('keep')}>
          Keep them and sign out
        </button>
      </div>
    </Sheet>
  );
}
