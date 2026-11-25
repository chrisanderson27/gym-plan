import { afterEach, describe, expect, it } from 'vitest';
import { enabledActivities, ensureDefaultSettings, getSettings, poolOf, saveSettings, toggleUnavailableEquipment } from './settings';
import { openTestDb } from './test-utils';

const dbs: ReturnType<typeof openTestDb>[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

const seeded = async (now = new Date(2026, 10, 1)) => {
  const db = openTestDb();
  dbs.push(db);
  await ensureDefaultSettings(db, now);
  return db;
};

describe('settings', () => {
  it('ensureDefaultSettings seeds a local-date row with no goal, activities or weight', async () => {
    const db = await seeded(new Date(2026, 10, 17, 9, 30));
    const s = await getSettings(db);
    expect(s?.programStart).toBe('2026-11-17');
    expect(s?.daysPerWeek).toBe(5);
    expect(s).not.toHaveProperty('goalWeightLb');
    expect(s).not.toHaveProperty('activities');
    expect(enabledActivities(s)).toEqual(['lift', 'burn', 'run', 'swim']);
    expect(poolOf(s)).toBeNull();
    expect(s?.backupAt).toBeNull();
    expect(s?.onboardedAt).toBeTruthy();
    expect(s?.updatedAt).toBe(new Date(0).toISOString());
    expect(await db.bodyLogs.count()).toBe(0);
  });

  it('ensureDefaultSettings leaves an existing row untouched, even for concurrent calls', async () => {
    const db = await seeded();
    const before = await getSettings(db);
    await Promise.all([ensureDefaultSettings(db, new Date(2027, 0, 1)), ensureDefaultSettings(db, new Date(2027, 0, 2))]);
    expect(await getSettings(db)).toEqual(before);
    expect(await db.settings.count()).toBe(1);
  });

  it('saveSettings bumps updatedAt', async () => {
    const db = await seeded();
    const later = new Date(2026, 10, 2);
    await saveSettings(db, { goalWeightLb: 185 }, later);
    const s = await getSettings(db);
    expect(s?.goalWeightLb).toBe(185);
    expect(s?.updatedAt).toBe(later.toISOString());
  });

  it('saveSettings stores sound cues and unavailable equipment', async () => {
    const db = await seeded();
    await saveSettings(db, { soundCues: false, unavailableEquipment: ['dumbbells'] }, new Date(2026, 10, 2));
    const s = await getSettings(db);
    expect(s?.soundCues).toBe(false);
    expect(s?.unavailableEquipment).toEqual(['dumbbells']);
  });

  it('overlapping checklist toggles both persist', async () => {
    const db = await seeded();
    const now = new Date(2026, 10, 2);
    await Promise.all([
      toggleUnavailableEquipment(db, 'dumbbells', true, now),
      toggleUnavailableEquipment(db, 'leg-press', true, now),
    ]);
    expect((await getSettings(db))?.unavailableEquipment).toEqual(['dumbbells', 'leg-press']);
  });
});
