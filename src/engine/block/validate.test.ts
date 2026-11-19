import { expect, it } from 'vitest';
import type { CircuitBlock, CircuitStation, LiftBlock } from '../../data/types';
import type { GymItemShape } from '../gym/types';
import type { BlockExerciseShape } from './rules';
import { validateBlock, validateLiftDay, type BlockContext } from './validate';

const ex = (id: string, group: string, ...equipment: string[]): BlockExerciseShape => ({
  id, group, equipment, primary: [], secondary: [], repClass: 'other', repMin: 8, repMax: 12,
  substitutes: [], jointFriendly: true, unit: 'reps',
});
const exercises = new Map([
  ex('squat', 'squat', 'kb'), ex('push', 'horizontal-push', 'bodyweight'),
  ex('core', 'carry-core', 'bodyweight'), ex('pull', 'horizontal-pull', 'cable'),
  ex('fixed-push', 'horizontal-push', 'machine'), ex('rower', 'conditioning', 'cardio-machine'),
  ex('bike', 'conditioning', 'cardio-machine'), ex('back-squat', 'squat', 'barbell'),
].map((e) => [e.id, e]));
const item = (id: string, fields: Partial<GymItemShape> = {}): GymItemShape => ({
  id, zone: 'turf', floor: 2, type: 'fixture-item', count: 2, exercises: [], confidence: 'C', verified: false, ...fields,
});
const items = new Map([
  item('bell'), item('single', { count: 1 }), item('guess', { confidence: 'G' }),
  item('remote', { zone: 'weights', floor: 1 }), item('pending', { pending: true }),
].map((i) => [i.id, i]));
const ctx: BlockContext = {
  exercise: (id) => exercises.get(id),
  item: (id) => items.get(id),
  podsOfItem: (id) => id === 'remote' ? ['weights'] : ['turf-a', 'turf-b'],
  zoneOfPod: (pod) => pod.startsWith('turf') ? 'turf' : 'weights',
  floorOfPod: (pod) => pod.startsWith('turf') ? 2 : 1,
};
const station = (exerciseId: string, itemId?: string): CircuitStation => ({ exerciseId, itemId, target: { unit: 'reps', amount: 10 } });
const block = (...stations: CircuitStation[]): CircuitBlock => ({
  id: 'b', kind: 'circuit', role: 'block', durationSec: 480, targetRounds: 3, podId: 'turf-a', stations,
});
const valid = () => block(station('squat', 'bell'), station('push'), station('core'));

it('accepts movement across pods in one zone and floor', () => {
  const within = { ...ctx, podsOfItem: () => ['turf-b'] };
  expect(validateBlock(valid(), within, 'lift')).toEqual([]);
  expect(validateLiftDay([valid()], within)).toEqual([]);
});

it.each([
  ['groups<3', block(station('squat'), station('push'))],
  ['adjacent-same-group', block(station('squat'), station('push'), station('core'), station('squat'))],
  ['multi-zone', block(station('squat', 'remote'), station('push'), station('core'))],
  ['banned-lift', block(station('back-squat'), station('push'), station('core'))],
  ['single-count-no-backup', block(station('squat', 'single'), station('push'), station('core'))],
  ['single-count-no-backup', block({ ...station('squat', 'single'), backup: station('squat', 'single') }, station('push'), station('core'))],
  ['anchor-not-ok', block(station('squat', 'guess'), station('push'), station('core'))],
  ['anchor-not-ok', block(station('squat', 'pending'), station('push'), station('core'))],
  ['backup-group-mismatch', block({ ...station('squat', 'single'), backup: station('pull') }, station('push'), station('core'))],
] as const)('rejects %s', (code, invalid) => {
  expect(validateBlock(invalid, ctx, 'lift')).toContain(code);
});

it('accepts two fixed and two cardio stations for Burn only', () => {
  const mix = block(station('pull'), station('rower'), station('fixed-push'), station('bike'));
  expect(validateBlock(mix, ctx, 'burn')).toEqual([]);
  expect(validateBlock(mix, ctx, 'lift')).toEqual(['fixed>max', 'cardio>max']);
});

it('detects a main lift and circuits on different floors', () => {
  const main: LiftBlock = { id: 'main', kind: 'lift', exerciseId: 'squat', sets: 3, repMin: 8, repMax: 12 };
  expect(validateLiftDay([main, valid()], { ...ctx, mainFloor: 1 })).toEqual(['multi-floor']);
});
