import { expect, it } from 'vitest';
import type { CircuitBlock, LiftBlock, RunBlock, SetRow } from '../../data/types';
import { resumeIndex, sessionSteps, stepDone, upNext } from './focus';

const lift = (id: string, patch: Partial<LiftBlock> = {}): LiftBlock => ({
  kind: 'lift', id, exerciseId: id, equipmentId: 'eq', sets: 2, repMin: 8, repMax: 10, ...patch,
});
const circuit: CircuitBlock = { kind: 'circuit', id: 'block', role: 'block', podId: 'pod', durationSec: 720, targetRounds: 5, stations: [] };
const warm = lift('warm', { warmup: true });
const cool = lift('cool', { warmup: true, label: 'Cool-down · 5 min' });
const row = (exerciseId: string, idx: number, patch: Partial<SetRow> = {}): SetRow => ({
  id: `${exerciseId}-${idx}`, sessionId: 'session', exerciseId, equipmentId: 'eq', idx, weight: 50, reps: 10,
  targetWeight: 50, targetReps: 10, painFlag: false, ...patch,
});

it('derives the warm-up, main lift, work block and cool-down in order', () => {
  const steps = sessionSteps([warm, lift('main'), circuit, cool]);
  expect(steps.map((step) => step.kind)).toEqual(['note', 'lift', 'circuit', 'note']);
  expect(steps[0]).toMatchObject({ role: 'warmup' });
  expect(steps[3]).toMatchObject({ role: 'cooldown' });
  expect(sessionSteps([warm, cool])[1]).toMatchObject({ role: 'cooldown' });
  expect(upNext(steps, 0)).toEqual(steps.slice(1, 3));
});

it('groups only consecutive working blocks in the same superset', () => {
  const a = lift('a', { supersetGroup: 'pair' });
  const b = lift('b', { supersetGroup: 'pair' });
  const c = lift('c', { supersetGroup: 'pair' });
  expect(sessionSteps([a, b, circuit, c])).toEqual([
    { kind: 'lift', blocks: [a, b] }, { kind: 'circuit', block: circuit }, { kind: 'lift', blocks: [c] },
  ]);
});

it('honours explicit note roles independently of labels and keeps legacy cool-downs', () => {
  const renamed = { ...warm, role: 'cooldown', label: 'Time to stretch' } as const;
  const misleading = { ...warm, role: 'warmup', label: 'Cool-down prep' } as const;
  expect(sessionSteps([misleading, renamed, cool]).map((step) => step.kind === 'note' && step.role))
    .toEqual(['warmup', 'cooldown', 'cooldown']);
});

it('resumes past the furthest finished step even if it skipped an earlier block', () => {
  const logged = { ...circuit, log: { completedRounds: 2, actualDurationSec: 420, stations: [] } };
  const steps = sessionSteps([warm, lift('skipped'), logged, cool]);
  expect(resumeIndex(steps, [row('skipped', 0)])).toBe(3);
  expect(resumeIndex(sessionSteps([warm, lift('main'), circuit]), [])).toBe(0);
});

it('resumes the main lift after one working set and advances only once it is complete', () => {
  const steps = sessionSteps([warm, lift('main'), circuit]);
  expect(resumeIndex(steps, [
    row('main', 0, { setKind: 'warmup' }),
    row('main', 0, { equipmentId: 'other' }),
    row('main', 0, { reps: 0 }),
  ])).toBe(0);
  expect(resumeIndex(steps, [row('main', 0)])).toBe(1);
  expect(resumeIndex(steps, [row('main', 0), row('main', 1)])).toBe(2);
});

it('counts working sets for the exercise and equipment, or one calibration row', () => {
  const step = sessionSteps([lift('main')])[0]!;
  expect(stepDone(step, [row('main', 0), row('main', 1, { equipmentId: 'other' })])).toBe(false);
  expect(stepDone(step, [row('main', 0), row('main', 1, { setKind: 'warmup' })])).toBe(false);
  expect(stepDone(step, [row('main', 0), row('main', 1, { reps: 0 })])).toBe(false);
  expect(stepDone(step, [row('main', 0), row('main', 1)])).toBe(true);
  expect(stepDone(step, [row('main', 0, { setKind: 'calibration' })])).toBe(true);
});

it('puts hybrid cardio after the lift', () => {
  const run: RunBlock = { kind: 'run', id: 'run', modality: 'bike', runKind: 'easy', repeats: 1, segments: [] };
  expect(sessionSteps([warm, lift('main'), run]).at(-1)).toEqual({ kind: 'cardio', block: run });
});
