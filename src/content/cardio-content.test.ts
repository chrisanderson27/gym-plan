import { describe, expect, it } from 'vitest';
import { BURN_TEMPLATES } from './burn-templates';
import { DRILLS } from './drills';
import { exerciseById } from './index';
import { RUN_FORMATS } from './run-formats';
import { SWIM_WORKOUTS } from './swim-workouts';

const VALID_FORMATS = ['sprint-walk', 'sprint-jog', '30-30', 'norwegian-4x4', 'hill', 'treadmill-incline', 'run-walk'];

describe('cardio content', () => {
  it('every Burn phase exercise exists', () => {
    for (const t of BURN_TEMPLATES) for (const b of t.blocks) for (const p of b.phases) {
      if (p.exerciseId) expect(exerciseById.has(p.exerciseId), `${t.id}:${p.exerciseId}`).toBe(true);
    }
  });

  it('each Burn template totals 50–60 min with no zero-length phase', () => {
    expect(BURN_TEMPLATES).toHaveLength(3);
    for (const t of BURN_TEMPLATES) {
      const sec = t.blocks.reduce((n, b) => n + b.rounds * b.phases.reduce((m, p) => m + p.sec, 0), 0);
      expect(sec / 60, t.id).toBeGreaterThanOrEqual(50);
      expect(sec / 60, t.id).toBeLessThanOrEqual(60);
      for (const b of t.blocks) for (const p of b.phases) expect(p.sec).toBeGreaterThan(0);
    }
  });

  it('ids are unique and prefixed', () => {
    const ids = [...BURN_TEMPLATES.map((t) => t.id), ...SWIM_WORKOUTS.map((w) => w.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BURN_TEMPLATES) expect(t.id.startsWith('burn-')).toBe(true);
    for (const w of SWIM_WORKOUTS) expect(w.id.startsWith('swim-')).toBe(true);
  });

  it('swim workouts: six, drills known, 25-unit distances, required sections', () => {
    expect(SWIM_WORKOUTS).toHaveLength(6);
    const drills = new Set(DRILLS.map((d) => d.id));
    for (const w of SWIM_WORKOUTS) {
      const sections = w.blocks.map((b) => b.section);
      for (const s of ['warmup', 'main', 'cooldown'] as const) expect(sections, w.id).toContain(s);
      for (const b of w.blocks) for (const i of b.items) {
        expect(i.distance % 25, w.id).toBe(0);
        if (i.drillId) expect(drills.has(i.drillId), i.drillId).toBe(true);
      }
    }
  });

  it('run formats: bands sorted, first band at minWeek, valid format', () => {
    for (const f of RUN_FORMATS) {
      expect(VALID_FORMATS).toContain(f.format);
      const weeks = f.bands.map((b) => b.fromWeek);
      expect(weeks).toEqual([...weeks].sort((a, b) => a - b));
      expect(weeks[0]).toBe(f.minWeek);
    }
  });
});
