import { localDate } from '../engine/dates';
import { enabled, type Activity } from '../engine/plan/activities';
import type { GymDb } from './db';
import type { GoalDirection, PoolUnit, Settings } from './types';

export const DEFAULT_POOL_LENGTH = 25;

export function poolOf(settings?: Settings): { poolUnit: PoolUnit; poolLength: number } | null {
  const { poolUnit, poolLength } = settings ?? {};
  return poolUnit && poolLength && poolLength > 0 ? { poolUnit, poolLength } : null;
}

export const enabledActivities = (settings?: Settings) => enabled(settings?.activities);

export const getSettings = (db: GymDb): Promise<Settings | undefined> => db.settings.get('settings');

export async function saveSettings(
  db: GymDb,
  patch: Partial<Omit<Settings, 'id'>>,
  now = new Date(),
): Promise<void> {
  await db.settings.update('settings', { ...patch, updatedAt: now.toISOString() });
}

export interface OnboardingInput {
  bodyweightLb: number;
  goalWeightLb: number;
  goalDirection: GoalDirection;
  activities: Activity[];
}

export async function completeOnboarding(db: GymDb, input: OnboardingInput, now = new Date()): Promise<void> {
  const iso = now.toISOString();
  const today = localDate(now);
  await db.transaction('rw', db.settings, db.bodyLogs, async () => {
    await db.settings.put({
      id: 'settings',
      goalWeightLb: input.goalWeightLb,
      startWeightLb: input.bodyweightLb,
      daysPerWeek: 5,
      goalDirection: input.goalDirection,
      activities: input.activities,
      weightUnit: 'lb',
      distanceUnit: 'mi',
      programStart: today,
      onboardedAt: iso,
      backupAt: null,
      updatedAt: iso,
    });
    await db.bodyLogs.put({ date: today, weightLb: input.bodyweightLb, protein: false });
  });
}
