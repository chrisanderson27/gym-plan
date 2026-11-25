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

const source = (file: string) => readFileSync(join(__dirname, file), 'utf8');

/** Source of `function <name>` up to its closing top-level brace. */
function functionBody(code: string, name: string) {
  const start = code.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf('\n}\n', start);
  return code.slice(start, end < 0 ? undefined : end + 3);
}

it('SessionRunner calls no hook after any top-level early return (Rules of Hooks)', () => {
  const body = functionBody(source('SessionScreen.tsx'), 'SessionRunner');
  const lines = body.split('\n');
  // Top-level statements sit at exactly two spaces; an early return is `if (...) return ...` at that depth.
  const firstEarly = lines.findIndex((line) => /^ {2}if \(.*\) return\b/.test(line));
  expect(firstEarly).toBeGreaterThan(0);
  const hooksBefore = lines.slice(0, firstEarly).join('\n').match(/\buse[A-Z]\w*\(/g) ?? [];
  expect(hooksBefore).toContain('useDemoChoice(');
  const hooksAfter = lines.slice(firstEarly).filter((line) => /\buse[A-Z]\w*\(/.test(line));
  expect(hooksAfter).toEqual([]);
});

it('one lineup drives every card: SessionRunner resolves it once and no card owns playback', () => {
  const runner = functionBody(source('SessionScreen.tsx'), 'SessionRunner');
  expect(runner).toMatch(/demoLineup\(/);
  expect(runner).toMatch(/resolveDemoPlayback\(demoChoice,/);
  expect(runner).toMatch(/<CalibrationCard [^>]*demo=\{demo\}/);
  expect(source('CalibrationCard.tsx')).not.toMatch(/useDemoPlayback\(/);
});
