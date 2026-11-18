import { BACKUP_STALE_DAYS } from './config';

/** Days since the last backup (or onboarding if never backed up) once stale, else null. */
export function backupBannerDays(now: Date, backupAt: string | null, onboardedAt: string): number | null {
  const since = Date.parse(backupAt ?? onboardedAt);
  const days = Math.floor((now.getTime() - since) / 86_400_000);
  return days >= BACKUP_STALE_DAYS ? days : null;
}
