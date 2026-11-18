import { describe, expect, it } from 'vitest';
import type { Equipment, SetRow } from '../../data/types';
import { prescribe } from './progression';
import type { HistorySession, LiftExercise } from './types';

const pinSteps = [10, 25, 40, 55, 70, 85, 100, 115, 130];
const pin: Equipment = { id: 'pin', name: 'Pin', kind: 'machine', steps: pinSteps };
const cable: Equipment = { id: 'cab', name: 'Cable', kind: 'cable', steps: Array.from({ length: 40 }, (_, i) => 5 + i * 5) };
const bar: Equipment = { id: 'bar', name: 'Bar', kind: 'barbell', steps: [45, 50, 55, 135, 140, 145, 150] };
const ex: LiftExercise = { id: 'x', group: 'horizontal-push', equipment: ['machine'], primary: ['chest'], secondary: [], repClass: 'machine', repMin: 8, repMax: 12, jointFriendly: true, substitutes: [] };
const ctx = { deload: false, rampIn: false, isLowerBarbell: false };

const sess = (eq: Equipment, weight: number, reps: number[], rir?: 0 | 1 | 3, kind?: SetRow['setKind'], e = ex): HistorySession => ({
  session: { id: 's' + Math.random(), date: '2026-03-01T10:00:00Z', type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '' },
  sets: reps.map((r, i) => ({
    id: Math.random().toString(), sessionId: 's', exerciseId: e.id, equipmentId: eq.id, idx: i,
    targetWeight: weight, targetReps: r, weight, reps: r, painFlag: false, setKind: kind,
    rir: i === reps.length - 1 ? rir : undefined,
  })),
});

describe('prescribe (double progression)', () => {
  it('raises one step when every set is at the top at RIR ≤ 2', () => {
    const p = prescribe(ex, pin, [sess(pin, 100, [12, 12, 12], 1)], ctx);
    expect(p).toMatchObject({ mode: 'progress', weight: 115, reps: 8 });
  });
  it('raises at RIR 0 too', () => {
    expect(prescribe(ex, pin, [sess(pin, 100, [12, 12, 12], 0)], ctx).weight).toBe(115);
  });
  it('does not raise when one set is at 11', () => {
    const p = prescribe(ex, pin, [sess(pin, 100, [12, 11, 12], 1)], ctx);
    expect(p).toMatchObject({ mode: 'repeat', weight: 100, reps: 12 });
  });
  it('does not raise at RIR 3', () => {
    expect(prescribe(ex, pin, [sess(pin, 100, [12, 12, 12], 3)], ctx).weight).toBe(100);
  });
  it('does not raise when RIR was skipped', () => {
    expect(prescribe(ex, pin, [sess(pin, 100, [12, 12, 12], undefined)], ctx).weight).toBe(100);
  });
  it('story 2: 140 on a 5-lb cable goes to the next step at the bottom of the range', () => {
    const p = prescribe(ex, cable, [sess(cable, 140, [12, 12, 12], 1)], ctx);
    expect(p).toMatchObject({ weight: 145, reps: 8 });
  });
  it('repeat inside the range pre-fills min+1', () => {
    expect(prescribe(ex, pin, [sess(pin, 100, [10, 9, 9], 1)], ctx)).toMatchObject({ weight: 100, reps: 10 });
  });
  it('holds at the top of the rack', () => {
    expect(prescribe(ex, pin, [sess(pin, 130, [12, 12, 12], 1)], ctx)).toMatchObject({ mode: 'hold', weight: 130 });
  });
  it('missed once holds', () => {
    expect(prescribe(ex, pin, [sess(pin, 100, [8, 7, 6], 0)], ctx)).toMatchObject({ mode: 'hold', weight: 100, reps: 8 });
  });
  it('missed twice reduces 7.5% to the nearest step', () => {
    const h = [sess(pin, 115, [8, 7, 6], 0), sess(pin, 115, [8, 6, 6], 0)];
    expect(prescribe(ex, pin, h, ctx)).toMatchObject({ mode: 'reduce', weight: 100 });
  });
  it('a miss after a reduce restarts the streak', () => {
    const h = [sess(pin, 115, [7, 7, 6]), sess(pin, 115, [7, 6, 6]), sess(pin, 100, [7, 7, 7])];
    expect(prescribe(ex, pin, h, ctx).mode).toBe('hold');
  });
  it('calibrates a fresh pair from the first step', () => {
    expect(prescribe(ex, pin, [], ctx)).toMatchObject({ mode: 'calibrate', weight: 10, reps: 10 });
  });
  it('lands calibration, stepping down when it was hard', () => {
    expect(prescribe(ex, pin, [sess(pin, 85, [10], 3, 'calibration')], ctx)).toMatchObject({ weight: 85, reps: 10, mode: 'repeat' });
    expect(prescribe(ex, pin, [sess(pin, 85, [10], 1, 'calibration')], ctx).weight).toBe(70);
  });
  it('ramp-in uses 2 sets at RIR 3', () => {
    const p = prescribe(ex, pin, [sess(pin, 100, [10, 10, 10], 1)], { ...ctx, rampIn: true });
    expect(p).toMatchObject({ sets: 2, rirTarget: 3 });
  });
  it('deload halves sets (ceil 3/2 = 2) at RIR 3 with no raise', () => {
    const p = prescribe(ex, pin, [sess(pin, 100, [12, 12, 12], 1)], { ...ctx, deload: true });
    expect(p).toMatchObject({ mode: 'deload', sets: 2, rirTarget: 3, weight: 100 });
  });
  it('lower barbell raises by at least 10 lb', () => {
    const squat = { ...ex, id: 'sq', group: 'squat', repClass: 'compound' as const, repMin: 6, repMax: 10 };
    const p = prescribe(squat, bar, [sess(bar, 135, [10, 10, 10], 1, undefined, squat)], { ...ctx, isLowerBarbell: true });
    expect(p.weight).toBe(145);
  });
  it('bodyweight never calibrates', () => {
    const bw: Equipment = { id: 'bw', name: 'BW', kind: 'bodyweight', steps: [0] };
    expect(prescribe(ex, bw, [], ctx)).toMatchObject({ weight: 0, reps: 8 });
  });
});

describe('prescribe — review fixes', () => {
  const withBlock = (h: HistorySession, sets: number): HistorySession => ({
    ...h,
    session: { ...h.session, blocks: [{ id: 'b1', kind: 'lift', exerciseId: ex.id, equipmentId: pin.id, sets, repMin: 8, repMax: 12 }] },
  });
  it('a logged zero-rep set blocks progression', () => {
    const p = prescribe(ex, pin, [sess(pin, 100, [0, 12, 12], 1)], ctx);
    expect(p.mode).not.toBe('progress');
    expect(p.weight).toBe(100);
  });
  it('an all-zero exercise counts as a miss', () => {
    expect(prescribe(ex, pin, [sess(pin, 100, [0, 0, 0], 0)], ctx).mode).toBe('hold');
  });
  it('does not raise when fewer sets were logged than prescribed', () => {
    const h = withBlock(sess(pin, 100, [12], 1), 3);
    expect(prescribe(ex, pin, [h], ctx).weight).toBe(100);
  });
  it('raises when all prescribed sets were logged', () => {
    const h = withBlock(sess(pin, 100, [12, 12, 12], 1), 3);
    expect(prescribe(ex, pin, [h], ctx).weight).toBe(115);
  });
});

