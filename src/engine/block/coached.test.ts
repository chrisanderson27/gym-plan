import { expect, it } from 'vitest';
import type { StationTarget } from '../../data/types';
import {
  COACHED_REST_SEC, COACHED_TRANSITION_SEC, COACHED_WORK_SEC,
  advancePhase, blockRemainingSec, initialCoached, nextCoached, nextStation, projectCoached, stationPhasePlan, stationWorkSec,
  type CoachedCursor,
} from './coached';
import { elapsedClamped, pauseClock, resumeClock } from './session';

const sec = (amount: number): StationTarget => ({ unit: 'sec', amount });

it('uses the blank coached defaults and omits a zero rest or transition', () => {
  expect(COACHED_WORK_SEC).toBe(30);
  expect(COACHED_REST_SEC).toBe(0);
  expect(COACHED_TRANSITION_SEC).toBe(10);
  expect(stationPhasePlan(30, 0, 10)).toEqual([{ role: 'work', sec: 30 }, { role: 'transition', sec: 10 }]);
  expect(stationPhasePlan(45, 0, 0)).toEqual([{ role: 'work', sec: 45 }]);
  expect(stationWorkSec(sec(45), 30)).toBe(45);
  expect(stationWorkSec({ unit: 'reps', amount: 10 }, 30)).toBe(30);
});

it('runs the 12-minute fixture without a skip credit', () => {
  const plan = stationPhasePlan(45, 0, 0);
  let cursor: CoachedCursor = { station: 0, phase: 'work' };
  let rotations = 0;
  for (let step = 0; step < 16; step++) {
    const next = advancePhase(cursor, 4, plan);
    if (next.rotationCompleted) rotations += 1;
    cursor = { station: next.station, phase: next.phase };
  }
  expect(rotations).toBe(4);
  expect(4 * 45).toBe(180);
  // Eight seconds in: 712 left on the 720s clock, 37 left of the 45s station. Next does not move either number.
  const read = () => blockRemainingSec(0, 0, null, 720, 8000);
  const before = read();
  nextStation({ station: 1, phase: 'work' }, 4);
  expect(before).toBe(712);
  expect(read()).toBe(before);
  expect(stationWorkSec(sec(45), COACHED_WORK_SEC) - 8).toBe(37);
  expect(blockRemainingSec(0, 2000, null, 720, 10_000)).toBe(712);
  expect(blockRemainingSec(0, 0, 8000, 720, 8000 + 60_000)).toBe(712);
});

it('expires at the adjusted deadline after a resumed pause', () => {
  expect(blockRemainingSec(0, 2250, null, 720, 722_249)).toBe(1);
  expect(blockRemainingSec(0, 2250, null, 720, 722_250)).toBe(0);
  expect(blockRemainingSec(0, 2250, null, 720, 823_000)).toBe(0);
});

it('wraps Next only when it leaves the last station', () => {
  expect(nextStation({ station: 3, phase: 'work' }, 4)).toEqual({ station: 0, phase: 'work', rotationCompleted: true });
  expect(nextStation({ station: 1, phase: 'work' }, 4)).toEqual({ station: 2, phase: 'work' });
  expect(advancePhase({ station: 3, phase: 'work' }, 4, stationPhasePlan(45, 0, 0))).toEqual({
    station: 0, phase: 'work', rotationCompleted: true,
  });
});

it('projects all sixteen automatic boundaries and counts the exact-deadline wrap', () => {
  const schedule = Array.from({ length: 4 }, () => stationPhasePlan(45, 0, 0));
  for (let i = 1; i <= 16; i++) {
    const end = i * 45_000;
    expect(projectCoached(schedule, initialCoached, end - 1).at).toMatchObject({ station: (i - 1) % 4, rotations: Math.floor((i - 1) / 4) });
    expect(projectCoached(schedule, initialCoached, end).at).toEqual({ station: i % 4, rotations: Math.floor(i / 4), phase: 'work', phaseStartMs: end });
  }
  expect(projectCoached(schedule, initialCoached, 719_999).at.rotations).toBe(3);
});

it('consumes complete cycles from a fractional phase checkpoint with a bounded remainder', () => {
  const schedule = [stationPhasePlan(1.125, 0.25, 0.5), stationPhasePlan(0.625, 0, 0)];
  const read = (ms: number) => projectCoached(schedule, initialCoached, ms).at;
  expect(read(1124).phase).toBe('work');
  expect(read(1125).phase).toBe('rest');
  expect(read(1375).phase).toBe('transition');
  expect(read(1875)).toMatchObject({ phase: 'work', station: 1 });
  expect(read(3_599_999)).toMatchObject({ station: 1, rotations: 1439 });
  expect(projectCoached(schedule, read(1125), 3_600_000).at).toEqual(read(3_600_000));
  expect(projectCoached([stationPhasePlan(0.001, 0, 0)], initialCoached, 3_600_000).at.rotations).toBe(3_600_000);
});

it.each([1124, 1125])('freezes the phase and total at %i ms through pause and resume', (time) => {
  const schedule = [stationPhasePlan(1.125, 0.25, 0.5)];
  const clock = { startedAt: 0, pausedAt: null, pausedMs: 0, durationMs: 60_000 };
  const paused = pauseClock(clock, time);
  const resumed = resumeClock(paused, 20_000);
  const before = projectCoached(schedule, initialCoached, time);
  expect(projectCoached(schedule, initialCoached, elapsedClamped(paused, 20_000))).toEqual(before);
  expect(projectCoached(schedule, initialCoached, elapsedClamped(resumed, 20_000))).toEqual(before);
  expect(blockRemainingSec(0, 0, time, 60, 20_000)).toBe(blockRemainingSec(0, resumed.pausedMs, null, 60, 20_000));
  expect(nextCoached(before.at, 1, time)).toEqual({ station: 0, phase: 'work', phaseStartMs: time, rotations: 1 });
});
