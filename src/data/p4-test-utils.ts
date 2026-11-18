import type { GymDb } from './db';
import type { LiftBlock, Session, SetRow, Settings } from './types';

export const NOW = new Date('2026-11-12T12:00:00.000Z');

export const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 'settings', goalWeightLb: 220, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
  programStart: '2026-10-12', onboardedAt: '2026-10-12T08:00:00.000Z', backupAt: null, updatedAt: '2026-11-10T08:00:00.000Z', ...over,
});

export const chestBlock = (o: Partial<LiftBlock> = {}): LiftBlock => ({
  id: 'cb', kind: 'lift', exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', sets: 3, repMin: 8, repMax: 12, targetWeight: 100, ...o,
});

export const session = (id: string, hoursAgo: number, o: Partial<Session> = {}): Session => {
  const at = new Date(NOW.getTime() - hoursAgo * 3_600_000);
  return {
    id, date: at.toISOString(), type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 45, notes: '',
    endedAt: new Date(at.getTime() + 45 * 60_000).toISOString(), ...o,
  };
};

/** Three top-of-range chest-press sets at 100 lb, RIR 1 on the last. */
export const topSets = (sessionId: string, hoursAgo: number): SetRow[] =>
  [0, 1, 2].map((idx) => ({
    id: `${sessionId}-s${idx}`, sessionId, exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', idx, targetWeight: 100, targetReps: 12,
    weight: 100, reps: 12, painFlag: false, setKind: 'working' as const, ts: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    ...(idx === 2 ? { rir: 1 as const } : {}),
  }));

export async function seedSettings(db: GymDb, over: Partial<Settings> = {}): Promise<void> {
  await db.settings.put(settings(over));
}
