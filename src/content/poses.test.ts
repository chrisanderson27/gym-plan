import { describe, expect, it } from 'vitest';
import { anglesAt, cycleMs, HEAD_RADIUS, layout, skeleton } from '../engine/pose';
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

  it('hip adduction brings the knees together on the work stroke', () => {
    const exercise = EXERCISES.find((entry) => entry.id === 'hip-adduction')!;
    const def = POSES[exercise.poseId!]!;
    const { anchorAt } = layout(def);
    const kneesApart = (ms: number) => {
      const { kneeN, kneeF } = skeleton(anglesAt(def, ms), def.anchor, anchorAt);
      return Math.abs(kneeN.x - kneeF.x);
    };
    expect(kneesApart(900)).toBeLessThan(kneesApart(0));
  });

  it('every def lays out to a finite, non-empty view box', () => {
    for (const [id, def] of Object.entries(POSES)) {
      const { viewBox } = layout(def);
      for (const v of Object.values(viewBox)) expect(Number.isFinite(v), id).toBe(true);
      expect(viewBox.w, id).toBeGreaterThan(0);
      expect(viewBox.h, id).toBeGreaterThan(0);
    }
  });

  it('keeps the step-up trailing foot behind the box throughout the rep', () => {
    const def = POSES['step-up']!;
    const { anchorAt, propRect: box } = layout(def);
    for (let t = 0; t < cycleMs(def); t += 10) {
      const { ankleF, toeF } = skeleton(anglesAt(def, t), def.anchor, anchorAt);
      // The foot and box outlines extend 2 and 1.5 SVG units, respectively.
      expect(Math.max(ankleF.x, toeF.x) + 3.5, `foot @${t}ms`).toBeLessThan(box!.x);
    }
  });

  it('keeps the hip-thrust bench under the shoulders and clear of the head and torso', () => {
    const def = POSES['hip-thrust']!;
    const { anchorAt, propRect } = layout(def);
    const { x, y, w, h } = propRect!;
    const distanceToBench = (px: number, py: number) =>
      Math.hypot(Math.max(x - px, 0, px - x - w), Math.max(y - py, 0, py - y - h));
    for (let t = 0; t < cycleMs(def); t += 10) {
      const { hip, neck, head } = skeleton(anglesAt(def, t), def.anchor, anchorAt);
      expect(neck.y, `shoulders @${t}ms`).toBeLessThan(y);
      expect(distanceToBench(neck.x, neck.y), `shoulder support @${t}ms`).toBeLessThan(6);
      expect(distanceToBench(head.x, head.y), `head @${t}ms`).toBeGreaterThan(HEAD_RADIUS + 3);
      let torsoClearance = Infinity;
      for (let i = 0; i <= 100; i++) {
        const fraction = i / 100;
        torsoClearance = Math.min(torsoClearance, distanceToBench(
          neck.x + (hip.x - neck.x) * fraction, neck.y + (hip.y - neck.y) * fraction,
        ));
      }
      expect(torsoClearance, `torso @${t}ms`).toBeGreaterThan(3.5);
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
