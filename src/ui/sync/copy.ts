import type { SyncStatus } from '../../sync/engine';

export function changesLabel(count: number): string {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

export function syncStatusLabel({ state, pending, lastSyncedAt }: SyncStatus, now: Date): string {
  switch (state) {
    case 'idle': {
      if (pending > 0) return `${changesLabel(pending)} waiting`;
      if (!lastSyncedAt) return 'Not synced yet';
      const last = new Date(lastSyncedAt);
      const time = last.toDateString() === now.toDateString()
        ? last.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `Synced · ${time}`;
    }
    case 'syncing': return 'Syncing…';
    case 'offline': return pending > 0 ? `Offline · ${changesLabel(pending)} waiting` : 'Offline';
    case 'error': return "Couldn't sync";
    case 'paused': return 'Paused';
    case 'owner-mismatch': return 'Waiting for your choice';
    case 'off': return '';
  }
}
