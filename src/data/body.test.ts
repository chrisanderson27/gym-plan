import { afterEach, describe, expect, it } from 'vitest';
import { loadBodyLogs, saveBodyLog } from './body';
import type { GymDb } from './db';
import { completeOnboarding } from './settings';
import { openTestDb } from './test-utils';

const dbs: GymDb[] = [];
const open = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

describe('saveBodyLog', () => {
  it('patching protein keeps the weight', async () => {
    const db = open();
    await saveBodyLog(db, '2026-11-12', { weightLb: 247.2 });
    await saveBodyLog(db, '2026-11-12', { protein: true });
    expect(await db.bodyLogs.get('2026-11-12')).toEqual({ date: '2026-11-12', weightLb: 247.2, protein: true });
  });
  it('rejects an out-of-range weight or waist without writing', async () => {
    const db = open();
    await expect(saveBodyLog(db, '2026-11-12', { weightLb: 5 })).rejects.toThrow('Weight must be between 50 and 700 lb');
    await expect(saveBodyLog(db, '2026-11-12', { waistIn: 400 })).rejects.toThrow('Waist');
    expect(await loadBodyLogs(db)).toEqual([]);
  });
  it('merges into the onboarding row', async () => {
    const db = open();
    const now = new Date('2026-11-12T09:00:00');
    await completeOnboarding(db, { bodyweightLb: 250, goalWeightLb: 220, goalDirection: 'lose', activities: ['lift'] }, now);
    await saveBodyLog(db, '2026-11-12', { waistIn: 44 });
    expect(await db.bodyLogs.get('2026-11-12')).toEqual({ date: '2026-11-12', weightLb: 250, waistIn: 44, protein: false });
  });
});
