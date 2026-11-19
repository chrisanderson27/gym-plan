import { afterEach, describe, expect, it } from 'vitest';
import { completeOnboarding, enabledActivities, getSettings, poolOf, saveSettings } from './settings';
import { openTestDb } from './test-utils';

const dbs: ReturnType<typeof openTestDb>[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

describe('settings', () => {
  it.each([
    ['lose', 260, 'below'], ['lose', 250, 'below'],
    ['gain', 240, 'above'], ['gain', 250, 'above'],
  ] as const)('rejects a %s target of %i lb for a 250 lb starter', async (goalDirection, goalWeightLb, side) => {
    const db = openTestDb();
    dbs.push(db);
    await expect(completeOnboarding(db, { bodyweightLb: 250, goalWeightLb, goalDirection, activities: ['lift'] }))
      .rejects.toThrow(`Target weight must be ${side} your bodyweight.`);
    expect(await getSettings(db)).toBeUndefined();
    expect(await db.bodyLogs.count()).toBe(0);
  });

  it('completeOnboarding anchors programStart to the local date and logs bodyweight', async () => {
    const db = openTestDb();
    dbs.push(db);
    const now = new Date(2026, 10, 17, 9, 30); // local time
    await completeOnboarding(db, { bodyweightLb: 247.2, goalWeightLb: 220, goalDirection: 'lose', activities: ['burn'] }, now);
    const s = await getSettings(db);
    expect(s?.programStart).toBe('2026-11-17');
    expect(s?.daysPerWeek).toBe(5);
    expect(s?.goalDirection).toBe('lose');
    expect(enabledActivities(s)).toEqual(['burn']);
    expect(poolOf(s)).toBeNull();
    expect(s).not.toHaveProperty('poolLength');
    expect(s).not.toHaveProperty('poolUnit');
    expect(s?.backupAt).toBeNull();
    expect(s?.onboardedAt).toBe(now.toISOString());
    expect(await db.bodyLogs.get('2026-11-17')).toEqual({ date: '2026-11-17', weightLb: 247.2, protein: false });
  });
  it('saveSettings bumps updatedAt', async () => {
    const db = openTestDb();
    dbs.push(db);
    await completeOnboarding(db, { bodyweightLb: 200, goalWeightLb: 190, goalDirection: 'lose', activities: ['lift', 'run'] }, new Date(2026, 10, 1));
    const later = new Date(2026, 10, 2);
    await saveSettings(db, { goalWeightLb: 185 }, later);
    const s = await getSettings(db);
    expect(s?.goalWeightLb).toBe(185);
    expect(s?.updatedAt).toBe(later.toISOString());
  });
});
