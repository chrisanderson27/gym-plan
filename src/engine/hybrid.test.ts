import { describe, expect, it } from 'vitest';
import type { RunBlock } from '../data/types';
import { hybridCardio } from './hybrid';
import type { RunPlan } from './run/generator';

const plan = (o: Partial<RunBlock> = {}, plannedSec = 1200): RunPlan => ({
  block: { id: 'b', kind: 'run', runKind: 'easy', modality: 'run', repeats: 10, format: 'run-walk', segments: [{ role: 'run', sec: 60 }, { role: 'walk', sec: 60 }], ...o },
  plannedSec, warmupSec: 0, cooldownSec: 0, reasons: ['capped'], warnings: [],
});

describe('hybridCardio', () => {
  it('keeps the run block as is on an upper day', () => {
    const run = plan();
    const out = hybridCardio({ variant: 'upper-a', run });
    expect(out.block).toBe(run.block);
  });
  it('turns a lower-day run-walk into one continuous bike segment', () => {
    const out = hybridCardio({ variant: 'lower-a', run: plan() });
    expect(out.block).toMatchObject({ modality: 'bike', repeats: 1, segments: [{ role: 'run', sec: 1200 }] });
    expect(out.block.format).toBeUndefined();
    expect(out.reasons).toContain('leg day: bike instead of running');
  });
  it('keeps the interval segment count on the rower', () => {
    const segs = [{ role: 'sprint' as const, sec: 30 }, { role: 'walk' as const, sec: 90 }];
    const out = hybridCardio({ variant: 'lower-b', run: plan({ runKind: 'intervals', format: '30-30', segments: segs, repeats: 8 }), modality: 'row' });
    expect(out.block.segments).toHaveLength(2);
    expect(out.block.repeats).toBe(8);
    expect(out.block.modality).toBe('row');
    expect(out.block.format).toBeUndefined();
  });
  it('never labels a machine session "run-walk"', () => {
    const easy = hybridCardio({ variant: 'lower-a', run: { ...plan(), reasons: ['run-walk 60:90 s (weeks 1–3)'] }, modality: 'row' });
    expect(easy.reasons.join('|')).not.toMatch(/run-walk/);
    expect(easy.reasons).toContain('row steady (no walk breaks)');
    const hard = hybridCardio({ variant: 'lower-b', run: { ...plan({ runKind: 'intervals' }), reasons: ['run-walk 60:90 s'] }, modality: 'bike' });
    expect(hard.reasons).toContain('bike intervals 60:90 s');
    // Upper days really run, so the label stays.
    expect(hybridCardio({ variant: 'upper-a', run: { ...plan(), reasons: ['run-walk 60:90 s'] } }).reasons).toContain('run-walk 60:90 s');
  });
  it('defaults the leg-day machine to the bike', () => {
    expect(hybridCardio({ variant: 'lower-a', run: plan() }).block.modality).toBe('bike');
  });
});
