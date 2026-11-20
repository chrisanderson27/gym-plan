import { expect, it } from 'vitest';
import type { CircuitBlock, SetRow } from '../data/types';
import type { HistorySession } from './lift/types';
import { comparableBlock, sessionPRs, setPRs } from './pr';

const set = (weight = 45, reps = 8, fields: Partial<SetRow> = {}): SetRow => ({
  id: 'x', sessionId: 's', exerciseId: 'goblet-squat', equipmentId: 'bells', idx: 0,
  targetWeight: weight, targetReps: reps, weight, reps, painFlag: false, ...fields,
});
const session = (id: string, sets: SetRow[] = [], blocks: CircuitBlock[] = []): HistorySession => ({
  session: { id, date: '2026-11-19T12:00:00Z', type: 'lift', blocks, rpe: null, hard: false, hardCardio: false, durationMin: 30, notes: '' },
  sets,
});
const block = (id: string, rounds: number, ids = ['goblet-squat', 'rower', 'push-up']): CircuitBlock => ({
  id, kind: 'circuit', role: 'block', podId: 'turf', durationSec: 480, targetRounds: 5,
  stations: ids.map((exerciseId) => ({ exerciseId, target: { unit: 'reps', amount: 10 } })),
  log: { completedRounds: rounds, actualDurationSec: 480, stations: ids.map((exerciseId) => ({ exerciseId })) },
});

it('finds weight-at-reps and reps-at-weight PRs against working sets for the matching pair', () => {
  const prior = session('prior', [
    set(40, 8), set(45, 6), set(45, 9, { setKind: 'warmup' }), set(50, 8, { equipmentId: 'other' }),
  ]);
  expect(setPRs(set(), [prior], 's')).toEqual([
    { kind: 'weight-at-reps', exerciseId: 'goblet-squat', equipmentId: 'bells', weight: 45, reps: 8, prev: 40 },
    { kind: 'reps-at-weight', exerciseId: 'goblet-squat', equipmentId: 'bells', weight: 45, reps: 8, prev: 6 },
  ]);
});

it('excludes first-ever, unrelated, calibration and same-session sets', () => {
  const current = session('s', [set(45, 8), set(40, 8)]);
  expect(sessionPRs(current, [current])).toEqual([]);
  expect(setPRs(set(), [], 's')).toEqual([]);
  expect(setPRs(set(), [session('other', [set(40, 8, { exerciseId: 'other' })])], 's')).toEqual([]);
  expect(setPRs(set(45, 8, { setKind: 'calibration' }), [session('prior', [set(40, 8)])], 's')).toEqual([]);
});

it('keeps the best PR per exercise, equipment and kind', () => {
  const prior = session('prior', [set(35, 8), set(45, 6)]);
  const current = session('s', [set(40, 8), set(45, 8), set(45, 10)]);
  expect(sessionPRs(current, [prior])).toMatchObject([
    { kind: 'weight-at-reps', weight: 45, reps: 8 },
    { kind: 'reps-at-weight', weight: 45, reps: 10 },
  ]);
});

it('compares work only for the same actual station set regardless of order', () => {
  const current = session('s', [], [block('b', 5)]);
  const prior = session('prior', [], [
    block('reordered', 4, ['push-up', 'rower', 'goblet-squat']),
    block('different', 20, ['push-up', 'rower', 'dead-bug']),
  ]);
  expect(sessionPRs(current, [current, prior])).toEqual([{ kind: 'block-work', blockId: 'b', total: 15, prev: 12 }]);
  expect(sessionPRs(current, [session('none', [], [block('different', 2, ['dead-bug'])])])).toEqual([]);
});

it('excludes swapped or unlogged circuits on either side of a comparison', () => {
  const swapped = block('swapped', 6);
  swapped.log!.stations[0]!.swappedFromExerciseId = 'leg-press';
  const unlogged = { ...block('unlogged', 7), log: undefined };
  const current = session('s', [], [block('b', 5)]);
  expect(sessionPRs(session('s', [], [swapped, unlogged]), [current])).toEqual([]);
  expect(sessionPRs(current, [session('prior', [], [swapped, unlogged])])).toEqual([]);
});

it('keys comparable circuits by deduplicated actual station ids, including a legacy backup', () => {
  const backup = block('backup', 3, ['rower', 'plank', 'air-bike']);
  backup.stations[0]!.backup = { exerciseId: 'air-bike', target: { unit: 'cal', amount: 12 } };
  backup.log!.stations[0]!.exerciseId = 'air-bike';
  const prior = block('prior', 2, ['plank', 'air-bike']);
  expect(comparableBlock(backup)?.key).toBe(comparableBlock(prior)?.key);
  expect(sessionPRs(session('s', [], [backup]), [session('prior', [], [prior])])).toEqual([
    { kind: 'block-work', blockId: 'backup', total: 9, prev: 4 },
  ]);
});
