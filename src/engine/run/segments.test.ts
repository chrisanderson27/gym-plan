import { expect, it } from 'vitest';
import { RUN_FORMATS } from '../../content/run-formats';
import { RUN_COOLDOWN_SEC, RUN_WARMUP_SEC } from '../config';
import { generateRun } from './generator';
import { runPhases, runSegmentAt, runTotalMs } from './segments';

const plan = (kind: 'easy' | 'intervals', week = 1) => generateRun({
  now: '2026-11-02T12:00:00.000Z', today: '2026-11-02', programStart: '2026-11-01', history: [], kind, formats: RUN_FORMATS,
  durationMin: 20, makeId: () => 'r', ...(week > 1 ? {} : {}),
});

it('flattens the run-walk ladder into timed segments and reports the segment at each instant', () => {
  const run = plan('easy');
  const phases = runPhases(run.block);
  expect(phases[0]).toMatchObject({ startMs: 0, label: expect.stringMatching(/Run/) });
  expect(runTotalMs(phases)).toBe(run.plannedSec * 1000);
  const first = phases[0]!;
  expect(runSegmentAt(phases, 0)).toMatchObject({ index: 0, remainingMs: first.endMs });
  // The boundary instant belongs to the segment that starts there.
  expect(runSegmentAt(phases, first.endMs).index).toBe(1);
  expect(runSegmentAt(phases, first.endMs - 1).index).toBe(0);
  expect(runSegmentAt(phases, first.endMs).next?.startMs).toBe(phases[1]!.endMs);
});

it('wraps interval sessions in a warm-up and cool-down', () => {
  const run = plan('intervals');
  const phases = runPhases(run.block);
  expect(phases[0]).toMatchObject({ role: 'warmup' });
  expect(phases[0]!.endMs).toBe(RUN_WARMUP_SEC * 1000);
  expect(phases.at(-1)).toMatchObject({ role: 'cooldown' });
  const last = phases.at(-1)!;
  expect(last.endMs - last.startMs).toBe(RUN_COOLDOWN_SEC * 1000);
  expect(runSegmentAt(phases, runTotalMs(phases) + 5000).index).toBe(phases.length - 1);
  expect(runSegmentAt(phases, runTotalMs(phases) + 5000).remainingMs).toBe(0);
});

it('has no segment for an empty timeline', () => {
  expect(runSegmentAt([], 100)).toMatchObject({ index: -1, current: undefined, remainingMs: 0 });
});
