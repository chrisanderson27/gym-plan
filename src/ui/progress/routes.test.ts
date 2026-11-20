import { expect, it } from 'vitest';
import { canonicalRoute } from './routes';

it.each([
  ['/history', '/progress/history'],
  ['/weigh-in', '/progress/body'],
  ['/lift/volume', '/progress/volume'],
  ['/history/01HZZ', '/history/01HZZ'],
  ['/history/', '/history/'],
  ['/lift', '/lift'],
  ['/builder', '/builder'],
  ['/', '/'],
])('canonicalises %s to %s', (route, expected) => {
  expect(canonicalRoute(route)).toBe(expected);
});
