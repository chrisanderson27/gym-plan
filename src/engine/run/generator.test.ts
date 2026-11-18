import { describe, expect, it } from 'vitest';
import { RUN_FORMATS } from '../../content/run-formats';
import type { RunKind } from '../../data/types';
import { RUN_SPIKE_CAP } from '../config';
import { addDays } from '../dates';
import { generateRun, type RunHistoryItem, type RunInput } from './generator';
import { runToIntervals } from './to-timer';

const START = '2026-11-01';
const dayOf = (week: number, dow = 2) => addDays(START, (week - 1) * 7 + dow);
const iso = (d: string) => `${d}T12:00:00.000Z`;
let n = 0;
const input = (week: number, kind: RunKind, over: Partial<RunInput> = {}): RunInput => ({
  now: iso(dayOf(week)), today: dayOf(week), programStart: START, history: [], kind, formats: RUN_FORMATS, makeId: () => `r${n++}`, ...over,
});
const hist = (week: number, over: Partial<RunHistoryItem> = {}): RunHistoryItem => ({
  date: iso(addDays(dayOf(week), -3)), kind: 'easy', modality: 'run', distanceMi: 0, durationSec: 1200, rpe: 5, painFlag: false, ...over,
});

describe('generateRun', () => {
  it('week 1 easy is run-walk 60:90, within the cold-start cap', () => {
    const p = generateRun(input(1, 'easy'));
    expect(p.block.format).toBe('run-walk');
    expect(p.block.segments).toEqual([{ role: 'run', sec: 60 }, { role: 'walk', sec: 90 }]);
    expect(p.plannedSec).toBeLessThanOrEqual(25 * 60);
    expect(p.reasons.join(' ')).toMatch(/run-walk/);
  });

  it('steps up the ladder after an RPE 4 run-walk and back after pain', () => {
    const up = generateRun(input(2, 'easy', { history: [hist(1, { runWalkRatio: '60:90', rpe: 4 })] }));
    expect(up.block.segments[0]?.sec).toBe(60);
    expect(up.block.segments[1]?.sec).toBe(60);
    const hold = generateRun(input(2, 'easy', { history: [hist(1, { runWalkRatio: '60:90', rpe: 7 })] }));
    expect(hold.block.segments[1]?.sec).toBe(90);
    const back = generateRun(input(2, 'easy', { history: [hist(1, { runWalkRatio: '120:60', rpe: 4, painFlag: true })] }));
    expect([back.block.segments[0]?.sec, back.block.segments[1]?.sec]).toEqual([60, 60]);
  });

  it('week 4 long run is cut back ×0.75', () => {
    const history = [hist(3, { kind: 'long', durationSec: 2400, rpe: 4 })];
    const normal = generateRun(input(3, 'long', { history, today: dayOf(3), now: iso(dayOf(3)) }));
    const cut = generateRun(input(4, 'long', { history: [hist(4, { kind: 'long', durationSec: 2400, rpe: 4, date: iso(dayOf(3)) })] }));
    expect(normal.plannedSec).toBeGreaterThan(cut.plannedSec);
    expect(cut.reasons.join(' ')).toMatch(/cutback/);
  });

  it('week 4 cutback with no prior week does not break', () => {
    expect(() => generateRun(input(4, 'easy'))).not.toThrow();
  });

  it('rejects norwegian-4x4 in week 2 with a reason', () => {
    const p = generateRun(input(2, 'intervals', { format: 'norwegian-4x4' }));
    expect(p.block.format).not.toBe('norwegian-4x4');
    expect(p.reasons.join(' ')).toMatch(/unlocks in week 4/);
  });

  it('stamps sprint RPE 8 through week 6 and 9 from week 7', () => {
    const rpes = (w: number) =>
      generateRun(input(w, 'intervals', { format: 'sprint-walk' })).block.segments.filter((s) => s.role === 'sprint').map((s) => s.rpeTarget);
    expect(rpes(6)).toEqual([8]);
    expect(rpes(7)).toEqual([9]);
  });

  it('cold start is ≤ 25 min even in a late week', () => {
    expect(generateRun(input(7, 'easy')).plannedSec).toBeLessThanOrEqual(25 * 60);
  });

  it('ignores a hybrid bike row in history', () => {
    const base = generateRun(input(7, 'easy'));
    const withBike = generateRun(input(7, 'easy', { history: [hist(7, { modality: 'bike', durationSec: 4000 })] }));
    expect(withBike.plannedSec).toBe(base.plannedSec);
  });

  it('treadmill history counts and a distance of 0 is tolerated', () => {
    const p = generateRun(input(7, 'easy', { history: [hist(7, { modality: 'treadmill', durationSec: 1800, distanceMi: 0 })] }));
    expect(p.plannedSec).toBeLessThanOrEqual(Math.floor(RUN_SPIKE_CAP * 1800));
    expect(p.estMi).toBeUndefined();
  });

  it('a user duration override is still capped', () => {
    const p = generateRun(input(7, 'easy', { history: [hist(7, { durationSec: 1200 })], durationMin: 60 }));
    expect(p.plannedSec).toBeLessThanOrEqual(Math.floor(RUN_SPIKE_CAP * 1200));
    expect(p.reasons.join(' ')).toMatch(/capped at 1.10/);
  });

  it('never prescribes more than 1.10 × the 30-day longest run (time and distance)', () => {
    const kinds: { kind: RunKind; format?: NonNullable<RunInput['format']> }[] = [
      { kind: 'easy' }, { kind: 'long' },
      ...RUN_FORMATS.map((f) => ({ kind: 'intervals' as const, format: f.format })),
    ];
    for (const longestMin of [20, 33, 60]) {
      for (const withDistance of [false, true]) {
        for (const week of [1, 3, 8]) {
          for (const { kind, format } of kinds) {
            const history = [hist(week, {
              durationSec: longestMin * 60, distanceMi: withDistance ? longestMin / 10 : 0,
              ...(week === 3 ? { runWalkRatio: '480:60' } : {}),
            })];
            const p = generateRun(input(week, kind, { history, ...(format ? { format } : {}) }));
            const label = `${kind}/${format}/${longestMin}/${withDistance}/w${week}`;
            expect(p.plannedSec, label).toBeLessThanOrEqual(RUN_SPIKE_CAP * longestMin * 60);
            if (withDistance && p.estMi !== undefined) expect(p.estMi, label).toBeLessThanOrEqual(RUN_SPIKE_CAP * (longestMin / 10) + 1e-9);
          }
        }
      }
    }
  });

  it('weekly soft cap shortens and warns', () => {
    // A 60 min run earlier lifts the spike cap, but last week was only 20 min → this week ≤ 23 min.
    const history = [hist(1, { durationSec: 3600 }), hist(2, { durationSec: 1200, date: iso(dayOf(2, 0)) })];
    const p = generateRun(input(3, 'long', { history, now: iso(dayOf(3)) }));
    expect(p.warnings.join(' ')).toMatch(/weekly soft cap/);
  });
});

describe('runToIntervals', () => {
  it('wraps intervals in warm-up and cool-down and maps roles', () => {
    const p = generateRun(input(8, 'intervals', { format: 'sprint-walk', history: [hist(8, { durationSec: 3600 })] }));
    const blocks = runToIntervals(p.block, p);
    expect(blocks.map((b) => b.phases[0]?.role)).toEqual(['warmup', 'work', 'cooldown']);
    expect(blocks[1]?.phases.map((x) => x.role)).toEqual(['work', 'rest']);
    expect(blocks[1]?.phases[0]?.label).toMatch(/RPE 9/);
  });

  it('an easy run is the main block only; continuous is one work phase', () => {
    const blocks = runToIntervals({ id: 'x', kind: 'run', runKind: 'easy', modality: 'run', repeats: 1, segments: [{ role: 'run', sec: 1500 }] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.phases).toHaveLength(1);
  });

  it('never exceeds the 1.10× cap when one run-walk cycle is longer than the cap', () => {
    const p = generateRun(input(2, 'easy', { history: [hist(1, { durationSec: 60, rpe: 7 })] }));
    expect(p.plannedSec).toBeLessThanOrEqual(66);
  });

  it('never exceeds the cap when one interval repeat is longer than the cap', () => {
    const p = generateRun(input(4, 'intervals', { format: 'norwegian-4x4', history: [hist(3, { durationSec: 300 })] }));
    expect(p.plannedSec).toBeLessThanOrEqual(330);
  });

  it('a cap smaller than the segment count stays finite, non-empty and bounded', () => {
    const p = generateRun(input(4, 'intervals', { format: '30-30', history: [hist(3, { durationSec: 1 })] }));
    expect(Number.isFinite(p.block.repeats)).toBe(true);
    expect(Number.isFinite(p.plannedSec)).toBe(true);
    expect(p.block.segments.length).toBeGreaterThan(0);
    expect(p.block.segments.every((s) => (s.sec ?? 1) > 0)).toBe(true);
    expect(p.plannedSec).toBeLessThanOrEqual(p.warmupSec + p.cooldownSec + 2);
    const blocks = runToIntervals(p.block, p);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('a 1 s run-walk history stays finite and bounded', () => {
    const p = generateRun(input(2, 'easy', { history: [hist(1, { durationSec: 1, rpe: 7 })] }));
    expect(Number.isFinite(p.plannedSec)).toBe(true);
    expect(p.block.segments.length).toBeGreaterThan(0);
    expect(p.plannedSec).toBeLessThanOrEqual(2);
  });
});
