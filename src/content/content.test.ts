import { describe, expect, it } from 'vitest';
import { REP_RANGES } from '../engine/config';
import { DRILLS, EXERCISES, LIFT_TEMPLATES, SEED_EQUIPMENT, defaultEquipmentFor, exerciseById } from './index';
import type { EquipmentTag, MovementGroup } from './types';

const GROUPS: MovementGroup[] = ['squat', 'hinge', 'lunge', 'horizontal-push', 'horizontal-pull', 'vertical-push', 'vertical-pull', 'arms', 'carry-core', 'conditioning'];

describe('exercise library', () => {
  it('has unique kebab-case ids', () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('has 70-80 entries covering all 10 groups', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(70);
    expect(EXERCISES.length).toBeLessThanOrEqual(80);
    for (const g of GROUPS) expect(EXERCISES.some((e) => e.group === g)).toBe(true);
  });
  it('has a primary muscle and equipment tag on every entry', () => {
    for (const e of EXERCISES) {
      expect(e.primary.length, e.id).toBeGreaterThanOrEqual(1);
      expect(e.equipment.length, e.id).toBeGreaterThanOrEqual(1);
      expect(e.cues.length, e.id).toBeGreaterThanOrEqual(1);
      expect(e.cues.length, e.id).toBeLessThanOrEqual(3);
    }
  });
  it('uses the PRD rep range for each rep class', () => {
    for (const e of EXERCISES) {
      if (e.prescription.unit !== 'reps' || e.repClass === 'other') continue;
      expect([e.prescription.min, e.prescription.max], e.id).toEqual([...REP_RANGES[e.repClass]]);
    }
  });
  it('resolves substitutes and keeps a joint-friendly option for risky lifts', () => {
    for (const e of EXERCISES) {
      for (const s of e.substitutes) {
        expect(exerciseById.has(s), `${e.id} -> ${s}`).toBe(true);
        expect(s).not.toBe(e.id);
      }
      if (!e.jointFriendly) {
        expect(e.substitutes.some((s) => exerciseById.get(s)?.jointFriendly), e.id).toBe(true);
      }
    }
  });
  it('has a joint-friendly entry in each non-conditioning group', () => {
    for (const g of GROUPS.filter((g) => g !== 'conditioning')) {
      expect(EXERCISES.some((e) => e.group === g && e.jointFriendly), g).toBe(true);
    }
  });
});

describe('lift templates', () => {
  it('only reference live, rep-based, non-conditioning exercises', () => {
    for (const [variant, t] of Object.entries(LIFT_TEMPLATES)) {
      expect(t.slots.length, variant).toBeGreaterThanOrEqual(5);
      for (const slot of t.slots) {
        for (const id of slot.candidates) {
          const e = exerciseById.get(id);
          expect(e, `${variant}: ${id}`).toBeDefined();
          expect(e?.retired, id).toBeFalsy();
          expect(e?.prescription.unit, id).toBe('reps');
          expect(e?.group, id).not.toBe('conditioning');
        }
      }
    }
  });
});

describe('drills and equipment', () => {
  it('has 20 unique drills', () => {
    expect(DRILLS.length).toBe(20);
    expect(new Set(DRILLS.map((d) => d.id)).size).toBe(20);
  });
  it('has unique equipment with strictly ascending steps', () => {
    expect(new Set(SEED_EQUIPMENT.map((e) => e.id)).size).toBe(SEED_EQUIPMENT.length);
    for (const e of SEED_EQUIPMENT) {
      for (let i = 1; i < e.steps.length; i++) expect(e.steps[i]!, e.id).toBeGreaterThan(e.steps[i - 1]!);
    }
  });
  it('maps every equipment tag to an existing seed', () => {
    const tags = new Set<EquipmentTag>(EXERCISES.flatMap((e) => e.equipment));
    for (const t of tags) expect(SEED_EQUIPMENT.some((e) => e.id === defaultEquipmentFor(t)), t).toBe(true);
  });
});
