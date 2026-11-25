import { expect, test } from 'vitest';
import { nextChoice, resolvePlaying } from './playback';

const ids = ['a', 'b', 'c'];

test('plays the first card, or the active one, by default', () => {
  expect(resolvePlaying({ scope: 's', ids, choice: null })).toBe('a');
  expect(resolvePlaying({ scope: 's', ids, active: 'b', choice: null })).toBe('b');
  expect(resolvePlaying({ scope: 's', ids: [], choice: null })).toBeNull();
});

test('an explicit pause persists across rerenders of the same lineup', () => {
  const paused = nextChoice({ scope: 's', ids, choice: null }, 'a');
  expect(paused.id).toBeNull();
  for (let tick = 0; tick < 5; tick++) expect(resolvePlaying({ scope: 's', ids, choice: paused })).toBeNull();
  expect(resolvePlaying({ scope: 's', ids, choice: nextChoice({ scope: 's', ids, choice: paused }, 'a') })).toBe('a');
});

test('choosing another card moves playback to it', () => {
  expect(resolvePlaying({ scope: 's', ids, choice: nextChoice({ scope: 's', ids, choice: null }, 'c') })).toBe('c');
});

test('a changed identity falls back to autoplay', () => {
  const paused = nextChoice({ scope: 's', ids, choice: null }, 'a');
  const swapped = ['a2', 'b', 'c'];
  expect(resolvePlaying({ scope: 's', ids: swapped, choice: paused })).toBe('a2');
  const picked = nextChoice({ scope: 's', ids, choice: null }, 'c');
  expect(resolvePlaying({ scope: 's', ids: ['a', 'b'], choice: picked })).toBe('a');
});

test('a changed scope resets the choice', () => {
  const paused = nextChoice({ scope: 's', ids, choice: null }, 'a');
  expect(resolvePlaying({ scope: 'other', ids, choice: paused })).toBe('a');
});
