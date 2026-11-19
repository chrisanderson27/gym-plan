import { expect, expectTypeOf, it } from 'vitest';
import { EXERCISE_ALIASES } from '../../../scripts/gen-gym.mjs';
import type { StationUnit as DataStationUnit } from '../../data/types';
import { exerciseById } from '../index';
import type { StationUnit } from '../types';
import { HOME_GYM } from './home-gym';

it('shares station units with the persisted contract', () => {
  expectTypeOf<StationUnit>().toEqualTypeOf<DataStationUnit>();
});

it('contains only allowlisted fields, with a boolean verification marker and library exercise ids', () => {
  expect(Object.keys(HOME_GYM).sort()).toEqual(['id', 'items', 'pods', 'zones']);
  expect(HOME_GYM.id).toBe('home-gym');
  for (const zone of HOME_GYM.zones) expect(Object.keys(zone).sort()).toEqual(['floor', 'id', 'neighbours']);
  for (const pod of HOME_GYM.pods) expect(Object.keys(pod).sort()).toEqual(['id', 'items', 'zone']);
  for (const item of HOME_GYM.items) {
    const keys = ['confidence', 'count', 'exercises', 'floor', 'id', 'type', 'verified', 'zone'];
    if (item.pending) keys.push('pending');
    expect(Object.keys(item).sort()).toEqual(keys.sort());
    expect(typeof item.verified).toBe('boolean');
    for (const id of item.exercises) expect(exerciseById.has(id), id).toBe(true);
  }
  for (const id of Object.values(EXERCISE_ALIASES)) if (id !== null) expect(exerciseById.has(id), id).toBe(true);
});
