import { backupBannerDays } from '../engine/backup-age';
import type { Settings } from '../data/types';

export function BackupBanner({ settings }: { settings: Settings }) {
  const days = backupBannerDays(new Date(), settings.backupAt, settings.onboardedAt);
  if (days === null) return null;
  return (
    <div class="banner" role="status">
      Last backup {days} days ago — <a href="#/settings">Export now</a>
    </div>
  );
}
