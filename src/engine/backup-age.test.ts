import { describe, expect, it } from 'vitest';
import { backupBannerDays } from './backup-age';

const now = new Date('2026-11-20T12:00:00.000Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('backupBannerDays', () => {
  it('is null when never backed up but onboarded recently', () => {
    expect(backupBannerDays(now, null, daysAgo(3))).toBeNull();
  });
  it('counts from onboarding when never backed up', () => {
    expect(backupBannerDays(now, null, daysAgo(8))).toBe(8);
  });
  it('is null after a recent backup', () => {
    expect(backupBannerDays(now, daysAgo(2), daysAgo(30))).toBeNull();
  });
  it('counts from the last backup when stale', () => {
    expect(backupBannerDays(now, daysAgo(10), daysAgo(30))).toBe(10);
  });
});
