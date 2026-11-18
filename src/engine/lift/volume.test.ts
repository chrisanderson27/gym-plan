import { describe, expect, it } from 'vitest';
import type { SetRow } from '../../data/types';
import { fractionalSets, programWeekRange, weeklyTarget, weeklyVolume } from './volume';
import type { LiftExercise, LiftSnapshot } from './types';

const row: LiftExercise = { id: 'seated-cable-row', group: 'horizontal-pull', equipment: ['cable'], primary: ['mid-back', 'lats'], secondary: ['biceps'], repClass: 'machine', repMin: 8, repMax: 12, jointFriendly: true, substitutes: [] };
const exById = new Map([[row.id, row]]);
const set = (o: Partial<SetRow> = {}): SetRow => ({ id: Math.random().toString(), sessionId: 's', exerciseId: row.id, equipmentId: 'cable-stack', idx: 0, targetWeight: 50, targetReps: 10, weight: 50, reps: 10, painFlag: false, ...o });

describe('volume', () => {
  it('counts primary 1 and secondary 0.5', () => {
    const v = fractionalSets([set(), set(), set()], exById);
    expect(v.get('mid-back')).toBe(3);
    expect(v.get('lats')).toBe(3);
    expect(v.get('biceps')).toBe(1.5);
    expect(v.get('quads')).toBeUndefined();
  });
  it('excludes warm-up and calibration sets', () => {
    const v = fractionalSets([set({ setKind: 'warmup' }), set({ setKind: 'calibration' }), set({ reps: 0 })], exById);
    expect(v.size).toBe(0);
  });
  it('targets step up by week', () => {
    expect(weeklyTarget(1).max).toBe(6);
    expect(weeklyTarget(3).min).toBe(8);
    expect(weeklyTarget(9).max).toBe(16);
  });
  it('uses the program calendar week', () => {
    expect(programWeekRange('2026-01-14', '2026-01-01')).toEqual({ from: '2026-01-08', to: '2026-01-14' });
    expect(programWeekRange('2026-01-15', '2026-01-01')).toEqual({ from: '2026-01-15', to: '2026-01-21' });
  });
  it('only counts sessions inside the week', () => {
    const mk = (date: string, id: string): LiftSnapshot['history'][number] => ({
      session: { id, date, type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '' },
      sets: [set({ sessionId: id })],
    });
    const snap: LiftSnapshot = {
      now: '2026-01-14T12:00:00',
      programStart: '2026-01-01',
      history: [mk('2026-01-07T12:00:00', 'old'), mk('2026-01-10T12:00:00', 'in')],
      overrides: new Map(),
      equipment: new Map(),
    };
    expect(weeklyVolume(snap, exById).find((m) => m.muscle === 'lats')?.done).toBe(1);
  });
});
