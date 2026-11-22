import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../../content';
import { blockedExerciseIds } from '../../content/equipment-prefs';
import type { Equipment, ExerciseOverride } from '../../data/types';
import { generateLift, pickSubstitute } from './generator';
import type { LiftExercise, LiftSnapshot } from './types';

const mk = (id: string, o: Partial<LiftExercise> = {}): LiftExercise => ({
  id, group: 'squat', equipment: ['machine'], primary: ['quads'], secondary: [], repClass: 'machine', repMin: 8, repMax: 12, jointFriendly: true, substitutes: [], ...o,
});
const exercises = new Map<string, LiftExercise>(
  [
    mk('leg-press', { substitutes: ['hack-squat'] }),
    mk('hack-squat'),
    mk('rdl', { group: 'hinge', primary: ['hamstrings'], jointFriendly: false, repClass: 'compound' }),
    mk('db-rdl', { group: 'hinge', primary: ['hamstrings'], repClass: 'compound' }),
    mk('leg-curl', { group: 'hinge', primary: ['hamstrings'], repClass: 'isolation' }),
    mk('calf', { group: 'squat', primary: ['calves'], repClass: 'isolation' }),
    mk('lunge', { group: 'lunge', primary: ['glutes'], repClass: 'compound' }),
    mk('air-bike', { group: 'conditioning', primary: [] }),
  ].map((e) => [e.id, e]),
);
const pin: Equipment = { id: 'pin', name: 'Pin', kind: 'machine', steps: [10, 25, 40, 55] };
const template = { slots: [{ candidates: ['leg-press', 'hack-squat'] }, { candidates: ['rdl', 'db-rdl'] }, { candidates: ['lunge'] }, { candidates: ['leg-curl'] }, { candidates: ['calf'] }] };
const snap = (programStart: string, overrides: ExerciseOverride[] = []): LiftSnapshot => ({
  now: '2026-03-01T12:00:00', programStart, history: [], overrides: new Map(overrides.map((o) => [o.exerciseId, o])), equipment: new Map([[pin.id, pin]]),
});
const gen = (s: LiftSnapshot, budgetMin = 90, extra = {}) =>
  generateLift({ variant: 'lower-a', budgetMin, template, exercises, snapshot: s, resolveEquipmentId: () => 'pin', ...extra });
const ids = (p: ReturnType<typeof gen>) => p.blocks.filter((b) => !b.warmup).map((b) => b.exerciseId);

describe('generateLift', () => {
  it('starts with the warm-up block and has unique exercises', () => {
    const p = gen(snap('2026-01-01'));
    expect(p.blocks[0]).toMatchObject({ warmup: true, exerciseId: 'air-bike' });
    expect(new Set(ids(p)).size).toBe(ids(p).length);
  });
  it('notAtMyGym on leg-press picks hack-squat', () => {
    const p = gen(snap('2026-01-01', [{ exerciseId: 'leg-press', notAtMyGym: true }]));
    expect(ids(p)[0]).toBe('hack-squat');
  });
  it('checklist-blocked leg-press substitutes hack-squat', () => {
    const blocked = blockedExerciseIds(EXERCISES, ['leg-press']);
    expect([...blocked].sort()).toEqual(['leg-press']);
    const p = gen(snap('2026-01-01', [...blocked].map((exerciseId) => ({ exerciseId, notAtMyGym: true }))));
    expect(ids(p)[0]).toBe('hack-squat');
  });
  it('weeks 1–4 skip non-joint-friendly exercises', () => {
    expect(ids(gen(snap('2026-02-15')))).toContain('db-rdl');
    expect(ids(gen(snap('2026-02-15')))).not.toContain('rdl');
    expect(ids(gen(snap('2025-12-01')))).toContain('rdl');
  });
  it('a 30-minute budget drops tail slots but keeps ≥ 2', () => {
    const p = gen(snap('2026-01-01'), 30);
    expect(p.dropped.length).toBeGreaterThan(0);
    expect(ids(p).length).toBeGreaterThanOrEqual(2);
    expect(p.estMin).toBeLessThanOrEqual(30 + 6);
  });
  it('ramp-in uses 2 sets; deload (week 6) halves to 2 sets', () => {
    const ramp = gen(snap('2026-02-20'));
    expect(ramp.rampIn).toBe(true);
    expect(ramp.blocks[1]!.sets).toBe(1); // fresh pair → calibration
    const dl = gen(snap('2026-01-25'));
    expect(dl.deload).toBe(true);
  });
  it('forceCalibrate calibrates pairs without working history', () => {
    const p = gen(snap('2026-01-01'), 90, { forceCalibrate: true });
    expect(p.prescriptions.get('b1')?.mode).toBe('calibrate');
  });
  it('drops exercises when the weekly ceiling is already reached', () => {
    const sets = Array.from({ length: 20 }, (_, i) => ({
      id: 'h' + i, sessionId: 'old', exerciseId: 'leg-press', equipmentId: 'pin', idx: i, targetWeight: 10, targetReps: 10, weight: 10, reps: 10, painFlag: false,
    }));
    const s = snap('2026-01-01');
    s.history = [{ session: { id: 'old', date: '2026-03-01T08:00:00', type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '' }, sets }];
    const p = gen(s);
    expect(ids(p)).not.toContain('leg-press');
    expect(ids(p)).not.toContain('hack-squat');
  });
  it('pickSubstitute respects exclusions', () => {
    expect(pickSubstitute('leg-press', exercises, new Map(), { exclude: new Set(['hack-squat']) })).not.toBe('hack-squat');
  });
});
