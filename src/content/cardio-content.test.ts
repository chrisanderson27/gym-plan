import { describe, expect, it } from 'vitest';
import { BURN_TEMPLATES } from './burn-templates';
import { DRILLS } from './drills';
import { exerciseById } from './index';
import { RUN_FORMATS } from './run-formats';
import { SWIM_WORKOUTS } from './swim-workouts';

const VALID_FORMATS = ['sprint-walk', 'sprint-jog', '30-30', 'norwegian-4x4', 'hill', 'treadmill-incline', 'run-walk'];

describe('cardio content', () => {
  it('every Burn station exercise exists and supports its specified target', () => {
    for (const t of BURN_TEMPLATES) for (const b of t.blocks) for (const s of b.stations) {
      const exercise = exerciseById.get(s.exerciseId);
      expect(exercise, `${t.id}:${s.exerciseId}`).toBeDefined();
      if (s.unit) expect([exercise?.prescription.unit, ...(exercise?.targets ?? [])]).toContain(s.unit);
    }
  });

  it('authors three Burn templates with positive block minutes', () => {
    expect(BURN_TEMPLATES).toHaveLength(3);
    for (const t of BURN_TEMPLATES) for (const b of t.blocks) expect(b.minutes).toBeGreaterThan(0);
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
