import { describe, expect, it } from 'vitest';
import type { SetRow } from '../../data/types';
import { muscleReadiness, variantReadiness } from './readiness';
import type { LiftExercise, LiftSnapshot } from './types';

const press: LiftExercise = { id: 'p', group: 'horizontal-push', equipment: ['machine'], primary: ['chest'], secondary: ['triceps'], repClass: 'machine', repMin: 8, repMax: 12, jointFriendly: true, substitutes: [] };
const exById = new Map([[press.id, press]]);
const base = Date.parse('2026-03-01T08:00:00Z');
const snap = (hoursLater: number, rir?: 0 | 1 | 3): LiftSnapshot => {
  const s: SetRow = { id: 'x', sessionId: 's', exerciseId: 'p', equipmentId: 'e', idx: 0, targetWeight: 1, targetReps: 1, weight: 1, reps: 10, painFlag: false, rir, ts: new Date(base).toISOString() };
  return {
    now: new Date(base + hoursLater * 3_600_000).toISOString(),
    programStart: '2026-01-01',
    history: [{ session: { id: 's', date: new Date(base).toISOString(), type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '' }, sets: [s] }],
    overrides: new Map(),
    equipment: new Map(),
  };
};

describe('readiness', () => {
  it('47 h not ready, 48 h ready', () => {
    expect(muscleReadiness(snap(47), exById).get('chest')?.ready).toBe(false);
    expect(muscleReadiness(snap(48), exById).get('chest')?.ready).toBe(true);
  });
  it('rir 0 on a primary needs 72 h', () => {
    expect(muscleReadiness(snap(71, 0), exById).get('chest')?.ready).toBe(false);
    expect(muscleReadiness(snap(72, 0), exById).get('chest')?.ready).toBe(true);
  });
  it('variantReadiness reports blockers and hours', () => {
    const s = snap(40);
    const v = variantReadiness(['chest', 'quads'], muscleReadiness(s, exById), s.now);
    expect(v).toEqual({ ready: false, hoursLeft: 8, blocking: ['chest'] });
  });
});
