import { expect, it } from 'vitest';
import type { StationTarget } from '../../data/types';
import {
  COACHED_REST_SEC, COACHED_TRANSITION_SEC, COACHED_WORK_SEC,
  advancePhase, blockRemainingSec, nextStation, stationPhasePlan, stationWorkSec,
  type CoachedCursor,
} from './coached';

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

it('wraps Next only when it leaves the last station', () => {
  expect(nextStation({ station: 3, phase: 'work' }, 4)).toEqual({ station: 0, phase: 'work', rotationCompleted: true });
  expect(nextStation({ station: 1, phase: 'work' }, 4)).toEqual({ station: 2, phase: 'work' });
  expect(advancePhase({ station: 3, phase: 'work' }, 4, stationPhasePlan(45, 0, 0))).toEqual({
    station: 0, phase: 'work', rotationCompleted: true,
  });
});
