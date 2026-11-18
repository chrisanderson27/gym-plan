import { describe, expect, it } from 'vitest';
import type { IntervalBlock } from '../data/types';
import { beepsBetween, elapsedMs, flatten, initialTimer, summarize, timerReducer, timerView } from './timer';

const blocks: IntervalBlock[] = [
  { id: 'a', kind: 'interval', rounds: 1, phases: [{ role: 'warmup', sec: 20, label: 'Warm' }] },
  { id: 'b', kind: 'interval', rounds: 2, phases: [{ role: 'work', sec: 30, label: 'Work' }, { role: 'rest', sec: 10, label: 'Rest' }] },
];
const steps = flatten(blocks); // 20 | 30 10 | 30 10 → 100 s
const T0 = 1_000_000;

describe('timer', () => {
  it('flattens rounds × phases with cumulative times', () => {
    expect(steps.map((s) => [s.startSec, s.endSec])).toEqual([[0, 20], [20, 50], [50, 60], [60, 90], [90, 100]]);
  });

  it('survives a 30 s background jump (drift ±1)', () => {
    let st = timerReducer(initialTimer(), { type: 'start' }, T0);
    const before = timerView(blocks, steps, st, T0 + 5_000);
    expect(before.remainingSec).toBe(15);
    const after = timerView(blocks, steps, st, T0 + 35_000);
    expect(Math.abs(after.remainingSec - 15)).toBeLessThanOrEqual(1); // now in Work: 50 − 35 = 15
    expect(after.step?.label).toBe('Work');
    st = timerReducer(st, { type: 'pause' }, T0 + 35_000);
    expect(st.pausedAt).toBe(T0 + 35_000);
  });

  it('a multi-phase jump lands on the right step with no beep storm', () => {
    expect(timerView(blocks, steps, timerReducer(initialTimer(), { type: 'start' }, T0), T0 + 75_000).step?.label).toBe('Work');
    expect(beepsBetween(steps, 1_000, 75_000)).toEqual([]);
  });

  it('beeps 3-2-1 then go on a 1 s cadence', () => {
    const seq: string[] = [];
    for (let ms = 16_000; ms < 20_000; ms += 1000) seq.push(...beepsBetween(steps, ms, ms + 1000));
    expect(seq).toEqual(['tick', 'tick', 'tick', 'go']);
    expect(beepsBetween(steps, 16_500, 17_000)).toEqual(['tick']);
  });

  it('pausing does not advance time', () => {
    let st = timerReducer(initialTimer(), { type: 'start' }, T0);
    st = timerReducer(st, { type: 'pause' }, T0 + 10_000);
    st = timerReducer(st, { type: 'pause' }, T0 + 20_000); // idempotent
    expect(elapsedMs(st, T0 + 70_000)).toBe(10_000);
    st = timerReducer(st, { type: 'resume' }, T0 + 70_000);
    st = timerReducer(st, { type: 'resume' }, T0 + 80_000); // idempotent
    expect(elapsedMs(st, T0 + 75_000)).toBe(15_000);
  });

  it('pause across a phase boundary keeps the step', () => {
    let st = timerReducer(initialTimer(), { type: 'start' }, T0);
    st = timerReducer(st, { type: 'pause' }, T0 + 19_000);
    expect(timerView(blocks, steps, st, T0 + 500_000).step?.label).toBe('Warm');
  });

  it('skip jumps to the next step and flags the block', () => {
    let st = timerReducer(initialTimer(), { type: 'start' }, T0);
    st = timerReducer(st, { type: 'skip' }, T0 + 5_000, steps);
    const v = timerView(blocks, steps, st, T0 + 5_000);
    expect(v.step?.label).toBe('Work');
    const sum = summarize(blocks, steps, st, T0 + 5_000);
    expect(sum[0]?.result?.skipped).toBe(true);
    expect(sum[0]?.result?.actualSec).toBe(5);
  });

  it('skip keeps effort done before pressing Skip and drops only the credit', () => {
    let st = timerReducer(initialTimer(), { type: 'start' }, T0);
    st = timerReducer(st, { type: 'skip' }, T0 + 12_000, steps);
    const sum = summarize(blocks, steps, st, T0 + 12_000);
    expect(sum[0]?.result?.actualSec).toBe(12);
  });

  it('skip on the last step finishes; skip when done is a no-op', () => {
    let st = timerReducer(initialTimer(), { type: 'start' }, T0);
    st = timerReducer(st, { type: 'skip' }, T0 + 95_000, steps);
    st = timerReducer(st, { type: 'skip' }, T0 + 95_000, steps);
    expect(timerView(blocks, steps, st, T0 + 95_000).done).toBe(true);
    expect(st.skipped).toHaveLength(1);
  });

  it('is done at total and summarises completed blocks', () => {
    const st = timerReducer(initialTimer(), { type: 'start' }, T0);
    const v = timerView(blocks, steps, st, T0 + 500_000);
    expect(v.done).toBe(true);
    expect(v.remainingSec).toBe(0);
    const sum = summarize(blocks, steps, st, T0 + 500_000);
    expect(sum.every((b) => b.result?.completed)).toBe(true);
    expect(sum[1]?.result).toMatchObject({ actualSec: 80, completedRounds: 2, skipped: false });
  });

  it('end early marks later blocks incomplete', () => {
    const st = timerReducer(initialTimer(), { type: 'start' }, T0);
    const sum = summarize(blocks, steps, st, T0 + 55_000);
    expect(sum[0]?.result?.completed).toBe(true);
    expect(sum[1]?.result).toMatchObject({ completed: false, completedRounds: 0, actualSec: 35 });
  });
});
