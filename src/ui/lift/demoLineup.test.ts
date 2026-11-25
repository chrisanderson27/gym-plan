import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { demoLineup, playingIn } from './demoLineup';

const card = (id: string, calibrating: boolean) => ({ blockId: id, exerciseId: id, calibrating, hasPose: true });

it('a superset of two calibrating cards animates exactly one figure', () => {
  const ids = demoLineup([card('squat', true), card('row', true)], undefined);
  expect(ids).toEqual(['squat', 'row']);
  expect(playingIn(ids)).toEqual(['squat']);
});

it('a lone focus card is the one figure, and a mixed step never adds a second', () => {
  expect(playingIn(demoLineup([card('press', false)], 'press'))).toEqual(['press']);
  expect(playingIn(demoLineup([card('press', false), card('squat', true)], 'press'))).toEqual(['squat']);
});

it('SessionRunner calls no hook after its loading early return (Rules of Hooks)', () => {
  const source = readFileSync(join(__dirname, 'SessionScreen.tsx'), 'utf8');
  const body = source.slice(source.indexOf('function SessionRunner'));
  const early = body.indexOf('if (!data) return');
  expect(early).toBeGreaterThan(0);
  expect(body.slice(early).match(/\buse[A-Z]\w*\(/g) ?? []).toEqual([]);
});
