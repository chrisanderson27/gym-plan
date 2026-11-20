import { expect, it } from 'vitest';
import { HOME_GYM } from '../../content/gym/home-gym';
import { availableOn, defaultBurnPods, floors, zoneOf } from './availability';
import type { GymItemShape, GymProfileShape } from './types';

const item = (id: string, fields: Partial<GymItemShape> = {}): GymItemShape => ({
  id, floor: 2, zone: 'turf', type: 'fixture-machine', count: 1, confidence: 'G', exercises: [id], verified: false, ...fields,
});
const profile: GymProfileShape = {
  id: 'home-gym',
  zones: [{ id: 'turf', floor: 2, neighbours: [] }, { id: 'weights', floor: 1, neighbours: [] }],
  items: [item('guess'), item('verified-guess', { verified: true }), item('pending', { confidence: 'C', pending: true }),
    item('unavailable', { confidence: 'C' }), item('other-floor', { floor: 1, zone: 'weights' })],
  pods: [
    { id: 'turf-a', zone: 'turf', items: ['guess', 'verified-guess', 'pending', 'unavailable'] },
    { id: 'turf-b', zone: 'turf', items: ['verified-guess'] },
    { id: 'weights-a', zone: 'weights', items: ['other-floor'] },
  ],
};

it('returns options per floor, item and pod while applying confidence and user overrides', () => {
  const options = availableOn(profile, 2, { notAtMyGym: new Set(['unavailable', 'push-up']), bodyweightIds: ['plank', 'push-up'] });
  expect(options.map(({ exerciseId, anchorOk }) => [exerciseId, anchorOk])).toEqual([
    ['guess', false], ['verified-guess', true], ['pending', false], ['plank', true], ['verified-guess', true], ['plank', true],
  ]);
  expect(options.filter(({ exerciseId }) => exerciseId === 'plank').map(({ itemId, podId, count }) => [itemId, podId, count]))
    .toEqual([[undefined, 'turf-a', Infinity], [undefined, 'turf-b', Infinity]]);
  expect(floors(profile)).toEqual([2, 1]);
  expect(zoneOf(profile, 'turf-a')).toBe('turf');
});

it('uses the labelled turf pods and otherwise lists floor 2 before floor 1', () => {
  expect(defaultBurnPods(HOME_GYM)).toHaveLength(2);
  expect(defaultBurnPods(profile)).toEqual(['turf-a', 'turf-b', 'weights-a']);
});
