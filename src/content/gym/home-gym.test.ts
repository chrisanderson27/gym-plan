import { expect, it } from 'vitest';
import { EXERCISE_ALIASES } from '../../../scripts/gen-gym.mjs';
import { exerciseById } from '../index';
import { expectPublicGymKeys } from './expectPublicGymKeys';
import { HOME_GYM } from './home-gym';

it('contains only allowlisted fields, with a boolean verification marker and library exercise ids', () => {
  expectPublicGymKeys(HOME_GYM);
  expect(HOME_GYM.id).toBe('home-gym');
  for (const zone of HOME_GYM.zones) {
    if (zone.label !== undefined) {
      expect(['turf', 'free weights', 'cardio deck', 'rack room']).toContain(zone.label);
    }
  }
  expect(HOME_GYM.zones.map((zone) => zone.label)).toContain('turf');
  for (const item of HOME_GYM.items) {
    expect(typeof item.verified).toBe('boolean');
    for (const id of item.exercises) expect(exerciseById.has(id), id).toBe(true);
  }
  for (const id of Object.values(EXERCISE_ALIASES)) if (id !== null) expect(exerciseById.has(id), id).toBe(true);
});
