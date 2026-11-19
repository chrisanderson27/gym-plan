import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { session } from './plan-test-utils';
import { streak, weekRing } from './ring';

const start = '2026-03-04';
const day = (n: number) => addDays(start, n);
const range = { from: start, to: day(6) };
const lift = (n: number, finished = true) => session(0, { day: day(n), lifted: true, finished });
const longRun = (n: number) => session(0, { day: day(n), type: 'run', runKind: 'long' });
const burn = (n: number, finished = true) => session(0, { day: day(n), type: 'burn', finished });

describe('weekRing', () => {
  it('counts completed sessions, caps units, and ignores disabled swim', () => {
    const sessions = [lift(0), { ...lift(1), type: 'hybrid' as const }, lift(2), lift(3, false), lift(7), longRun(4)];
    expect(weekRing(sessions, range, ['lift', 'run'])).toEqual({
      segments: [{ activity: 'lift', done: 3, min: 2 }, { activity: 'run', done: 1, min: 1 }],
      done: 3, target: 3, closed: true,
    });
    expect(weekRing(sessions, range)).toMatchObject({ done: 3, target: 4, closed: false });
  });

  it('falls back to two distinct finished days with only Burn enabled', () => {
    expect(weekRing([burn(0), burn(0), burn(1, false), lift(2)], range, ['burn'])).toMatchObject({ done: 1, target: 2, closed: false });
    expect(weekRing([burn(0), burn(1)], range, ['burn'])).toMatchObject({ done: 2, target: 2, closed: true });
  });
});

describe('streak', () => {
  it('covers the first miss then skips three weeks before the next freeze', () => {
    const sessions = [longRun(0), longRun(14), longRun(21)];
    const blocked = streak(sessions, start, day(35), ['run']);
    expect(blocked.weeks.map(({ closed, frozen }) => [closed, frozen])).toEqual([
      [true, false], [false, true], [true, false], [true, false], [false, false],
    ]);
    expect(blocked).toMatchObject({ count: 0, freezeAvailable: true });
    const recovered = streak(sessions, start, day(42), ['run']);
    expect(recovered.weeks.at(-1)).toMatchObject({ from: day(35), frozen: true });
    expect(recovered).toMatchObject({ count: 1, freezeAvailable: false });
  });

  it('adds a closed current week and never freezes an incomplete current week', () => {
    const empty = streak([], start, start, ['run']);
    expect(empty).toEqual({ weeks: [], count: 0, freezeAvailable: true });
    expect(streak([longRun(9)], start, day(9), ['run'])).toEqual({
      weeks: [{ from: day(0), to: day(6), closed: false, frozen: true }], count: 2, freezeAvailable: false,
    });
  });
});
