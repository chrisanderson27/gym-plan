import { describe, expect, it } from 'vitest';
import { anglesAt, cycleMs, layout, skeleton } from '../engine/pose';
import { EXERCISES } from './exercises';
import { LIFT_TEMPLATES } from './lift-templates';
import { POSES } from './poses';

const BONES = new Set([
  'torso', 'head', 'upperArmN', 'forearmN', 'upperArmF', 'forearmF', 'thighN', 'shinN', 'footN', 'thighF', 'shinF', 'footF',
]);

describe('poses', () => {
  it('every def has 1–4 frames (2–4 animated) of finite angles on known bones', () => {
    for (const [id, def] of Object.entries(POSES)) {
      expect(def.frames.length, id).toBeGreaterThanOrEqual(2);
      expect(def.frames.length, id).toBeLessThanOrEqual(4);
      for (const f of def.frames) {
        for (const [bone, v] of Object.entries(f.angles)) {
          expect(BONES.has(bone), `${id}.${bone}`).toBe(true);
          expect(Number.isFinite(v), `${id}.${bone}`).toBe(true);
        }
      }
    }
  });

  it('every Exercise.poseId resolves to a pose', () => {
    for (const e of EXERCISES) if (e.poseId) expect(POSES[e.poseId], `${e.id} → ${e.poseId}`).toBeDefined();
  });

  it('every exercise in a lift template slot has a pose (41 of them)', () => {
    const ids = new Set(Object.values(LIFT_TEMPLATES).flatMap((t) => t.slots.flatMap((s) => s.candidates)));
    expect(ids.size).toBe(41);
    for (const id of ids) expect(EXERCISES.find((e) => e.id === id)?.poseId, id).toBeTruthy();
  });

  it('every def lays out to a finite, non-empty view box', () => {
    for (const [id, def] of Object.entries(POSES)) {
      const { viewBox } = layout(def);
      for (const v of Object.values(viewBox)) expect(Number.isFinite(v), id).toBe(true);
      expect(viewBox.w, id).toBeGreaterThan(0);
      expect(viewBox.h, id).toBeGreaterThan(0);
    }
  });

  it('seated press and row keep the hand at chest height and the elbow off the backrest', () => {
    for (const id of ['seated-press', 'seated-row']) {
      const def = POSES[id]!;
      const { anchorAt } = layout(def);
      const c = cycleMs(def);
      for (let t = 0; t <= c; t += 20) {
        const sk = skeleton(anglesAt(def, t), def.anchor, anchorAt);
        const handBelowShoulder = sk.wristN.y - sk.neck.y; // y is down
        expect(handBelowShoulder, `${id} hand @${t}ms`).toBeGreaterThanOrEqual(-2);
        expect(handBelowShoulder, `${id} hand @${t}ms`).toBeLessThanOrEqual(14);
        // The backrest is drawn 12 units behind the hip.
        expect(sk.elbowN.x, `${id} elbow @${t}ms`).toBeGreaterThanOrEqual(sk.hip.x - 12);
      }
    }
  });
});
