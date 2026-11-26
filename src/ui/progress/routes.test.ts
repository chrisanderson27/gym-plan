import { expect, it } from 'vitest';
import { canonicalRoute, isLegacyResumeRoute, isMappedRoute } from './routes';

const unchanged = [
  '/', '/sign-in', '/workouts', '/blocks', '/blocks/new', '/blocks/suggest', '/blocks/abc', '/progress', '/progress/history',
  '/history/01HZZ', '/settings', '/workout/session/s1', '/workout/summary/s1', '/mine/t1', '/again/s1', '/swim', '/swim/css',
  '/lift/session/s1', '/burn/session/s1', '/hybrid/session/s1', '/hybrid/cardio/s1',
];

const redirects: [string, string][] = [
  ['/history', '/progress/history'],
  ['/history/', '/progress/history'],
  ['/weigh-in', '/progress'],
  ['/progress/body', '/progress'],
  ['/lift/volume', '/progress'],
  ['/progress/volume', '/progress'],
  ['/lift/gym', '/settings'],
  ['/lift', '/'],
  ['/lift/start/lower-a', '/'],
  ['/lift/calibrate/lower-a', '/'],
  ['/lift/other', '/'],
  ['/lift/session/', '/'],
  ['/burn', '/workouts'],
  ['/burn/class', '/workouts'],
  ['/run', '/workouts'],
  ['/run/long', '/workouts'],
  ['/hybrid', '/workouts'],
  ['/hybrid/lower-a', '/workouts'],
  ['/builder', '/workouts'],
  ['/builder/t1', '/mine/t1'],
  ['/swim/other', '/swim'],
  ['/nope', '/'],
  ['', '/'],
];

it.each(unchanged)('keeps %s', (route) => {
  expect(canonicalRoute(route)).toBe(route);
});

it.each(redirects)('redirects %s to %s', (route, expected) => {
  expect(canonicalRoute(route)).toBe(expected);
});

it.each([...unchanged, ...redirects.map(([route]) => route)])('is idempotent and lands on a mapped route for %s', (route) => {
  const once = canonicalRoute(route);
  expect(canonicalRoute(once)).toBe(once);
  expect(isMappedRoute(once)).toBe(true);
});

it('flags only the four runtime routes as legacy resume', () => {
  expect(unchanged.filter(isLegacyResumeRoute)).toEqual(['/lift/session/s1', '/burn/session/s1', '/hybrid/session/s1', '/hybrid/cardio/s1']);
});
