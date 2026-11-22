import { describe, expect, it } from 'vitest';
import { anglesAt, cycleMs, gobletDumbbellBounds, HEAD_RADIUS, idleAngles, layout, resolveFrames, skeleton } from '../engine/pose';
import { EXERCISES } from './exercises';
import { LIFT_TEMPLATES } from './lift-templates';
import { POSES } from './poses';

const BONES = new Set([
  'torso', 'head', 'upperArmN', 'forearmN', 'upperArmF', 'forearmF', 'thighN', 'shinN', 'footN', 'thighF', 'shinF', 'footF',
]);

describe('poses', () => {
  it('shows the squat and pulled row while their demos are idle', () => {
    const squat = POSES['goblet-squat']!;
    const crouched = skeleton(idleAngles(squat), squat.anchor, layout(squat).anchorAt);
    expect(crouched.kneeN.x - crouched.hip.x).toBeGreaterThan(30);
    expect(crouched.wristN.y).toBeLessThan((crouched.hip.y + crouched.neck.y) / 2);

    const row = POSES['seated-cable-row']!;
    const seated = skeleton(idleAngles(row), row.anchor);
    const reach = skeleton(anglesAt(row, 0), row.anchor);
    expect(seated.neck.x).toBeCloseTo(seated.hip.x);
    expect(seated.ankleN.x - seated.hip.x).toBeGreaterThan(60);
    expect(reach.wristN.x - seated.wristN.x).toBeGreaterThan(16);
  });

  it('keeps the goblet dumbbell visibly ahead of the fists at station-card size', () => {
    const def = POSES['goblet-squat']!;
    expect(def.implement).toBe('goblet-db');
    const { anchorAt, viewBox } = layout(def);
    const { wristN, wristF } = skeleton(idleAngles(def), def.anchor, anchorAt);
    const weight = gobletDumbbellBounds(wristN);
    const cardScale = 75 / viewBox.w;
    const wristStrokeRadius = 1.25;
    const gap = (weight.x - Math.max(wristN.x, wristF.x)) * cardScale - wristStrokeRadius;
    expect(gap).toBeGreaterThan(2);
    expect(weight.x + weight.w).toBeLessThan(viewBox.x + viewBox.w);
  });

  it('shows a side-on plyo box under the raised foot at rest', () => {
    const def = POSES['box-step-up']!;
    const { anchorAt, propRect: box } = layout(def);
    const { ankleN, ankleF, toeN } = skeleton(anglesAt(def, 0), def.anchor, anchorAt);
    expect(def.view).toBe('side');
    expect(def.prop).toBe('plyo-box');
    expect(ankleN.y).toBeLessThan(ankleF.y);
    expect(ankleN.y - box!.y).toBeGreaterThan(0);
    expect(box!.x + box!.w - toeN.x).toBeGreaterThan(25);
    expect(box!.y + box!.h).toBeCloseTo(ankleF.y + 4);
  });

  it('keeps coached setup, action, return and equipment contact inside the compact drawing', () => {
    for (const id of ['box-step-up', 'seated-cable-row', 'goblet-squat', 'air-bike']) {
      const def = POSES[id]!;
      const { anchorAt, propRect, viewBox } = layout(def);
      const key = resolveFrames(def).map((angles) => skeleton(angles, def.anchor, anchorAt));
      expect(key[0]).not.toEqual(key[1]);
      expect(anglesAt(def, cycleMs(def))).toEqual(anglesAt(def, 0));
      for (let t = 0; t < cycleMs(def); t += 10) {
        const sk = skeleton(anglesAt(def, t), def.anchor, anchorAt);
        for (const point of Object.values(sk)) {
          expect(point.x, id).toBeGreaterThan(viewBox.x);
          expect(point.x, id).toBeLessThan(viewBox.x + viewBox.w);
          expect(point.y, id).toBeGreaterThan(viewBox.y);
          expect(point.y, id).toBeLessThan(viewBox.y + viewBox.h);
        }
        if (id === 'box-step-up') {
          expect(sk.ankleN.x).toBeCloseTo(anchorAt.x);
          expect(sk.ankleN.y).toBeCloseTo(anchorAt.y);
          expect(sk.toeN.x).toBeLessThan(propRect!.x + propRect!.w);
          expect(Math.max(sk.ankleF.x, sk.toeF.x) + 3.5).toBeLessThan(propRect!.x);
        }
        if (id === 'goblet-squat') expect(sk.wristN.y).toBeLessThan((sk.hip.y + sk.neck.y) / 2);
        if (id === 'seated-cable-row') {
          expect(sk.ankleN).toEqual(key[0]!.ankleN);
          expect(sk.wristN.x).toBeLessThan(def.cable!.x);
        }
      }
      if (id === 'air-bike') {
        for (const sk of key) {
          expect((sk.ankleN.x + sk.ankleF.x) / 2).toBeCloseTo(35, 0);
          expect((sk.ankleN.y + sk.ankleF.y) / 2).toBeCloseTo(56, 0);
        }
        expect(key[0]!.wristN.x).toBeLessThan(key[0]!.wristF.x);
        expect(key[2]!.wristN.x).toBeGreaterThan(key[2]!.wristF.x);
      }
    }
  });

  it('shows a rower sliding from catch to finish and recovering over fixed foot supports', () => {
    const def = POSES.rower!;
    const { anchorAt, propRect } = layout(def);
    const [catchPose, drive, finish, recovery] = resolveFrames(def).map((a) => skeleton(a, def.anchor, anchorAt));
    expect(def.prop).toBe('rower');
    expect(propRect!.x).toBeLessThan(finish!.hip.x);
    expect(propRect!.x + propRect!.w).toBeGreaterThan(anchorAt.x);
    expect(catchPose!.hip.x - drive!.hip.x).toBeGreaterThan(20);
    expect(finish!.wristN.x - finish!.hip.x).toBeLessThan(drive!.wristN.x - drive!.hip.x);
    expect(recovery!.wristN.x).toBeGreaterThan(finish!.wristN.x);
    for (let t = 0; t < cycleMs(def); t += 20) {
      const pose = skeleton(anglesAt(def, t), def.anchor, anchorAt);
      expect(pose.ankleN).toEqual(anchorAt);
      expect(Math.abs(pose.hip.y - catchPose!.hip.y)).toBeLessThan(4);
    }
  });

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
