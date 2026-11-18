import { describe, expect, it } from 'vitest';
import { anglesAt, BONE_LENGTH, cycleMs, ease, layout, lerpAngle, resolveFrames, skeleton, STANDING, VIEW_ASPECT, type PoseDef } from './pose';

const squat: PoseDef = {
  view: 'side', anchor: 'feet',
  frames: [
    { angles: {} },
    { angles: { thighN: 100, thighF: 100, shinN: 20, shinF: 20, torso: 150, upperArmN: 90, upperArmF: 90 }, ms: 1000 },
  ],
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('pose maths', () => {
  it('lerpAngle takes the shortest arc', () => {
    expect(((lerpAngle(350, 10, 0.5) % 360) + 360) % 360).toBeCloseTo(0);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0);
    expect(lerpAngle(0, 90, 0.5)).toBeCloseTo(45);
  });

  it('ease is smoothstep', () => {
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(1)).toBe(1);
  });

  it('inherits unspecified bones, frame 0 from STANDING', () => {
    const frames = resolveFrames(squat);
    expect(frames[0]).toEqual(STANDING);
    expect(frames[1]!.torso).toBe(150);
    expect(frames[1]!.head).toBe(180);
  });

  it('front view mirrors omitted far limbs', () => {
    const f = resolveFrames({ view: 'front', anchor: 'feet', frames: [{ angles: { thighN: 20 } }] });
    expect(f[0]!.thighF).toBe(-20);
  });

  it('loops: t=0 and t=cycle are frame 0, mid-transition is the eased midpoint', () => {
    expect(cycleMs(squat)).toBe(1800);
    expect(anglesAt(squat, 0)).toEqual(STANDING);
    expect(anglesAt(squat, 1800)).toEqual(STANDING);
    expect(anglesAt(squat, 3600)).toEqual(STANDING);
    expect(anglesAt(squat, 1000).thighN).toBeCloseTo(100);
    expect(anglesAt(squat, 500).thighN).toBeCloseTo(50);
  });

  it('holds at a frame', () => {
    const def: PoseDef = { ...squat, frames: [squat.frames[0]!, { ...squat.frames[1]!, holdMs: 500 }] };
    expect(anglesAt(def, 1200).thighN).toBeCloseTo(100);
    expect(cycleMs(def)).toBe(2300);
  });

  it('a single frame is static and never divides by zero', () => {
    const one: PoseDef = { view: 'side', anchor: 'hip', frames: [{ angles: { torso: 90 } }] };
    expect(cycleMs(one)).toBeGreaterThan(0);
    expect(anglesAt(one, 12345).torso).toBe(90);
    expect(Number.isFinite(layout(one).viewBox.w)).toBe(true);
    const zero: PoseDef = { view: 'side', anchor: 'hip', frames: [{ angles: {}, ms: 0 }, { angles: { torso: 90 }, ms: 0 }] };
    expect(Number.isFinite(anglesAt(zero, 5).torso)).toBe(true);
  });

  it('skeleton keeps bone lengths', () => {
    const s = skeleton(anglesAt(squat, 500), 'feet');
    expect(dist(s.hip, s.kneeN)).toBeCloseTo(BONE_LENGTH.thighN);
    expect(dist(s.kneeN, s.ankleN)).toBeCloseTo(BONE_LENGTH.shinN);
    expect(dist(s.hip, s.neck)).toBeCloseTo(BONE_LENGTH.torso);
  });

  it('the feet anchor stays fixed across the squat while the hips drop', () => {
    const { anchorAt } = layout(squat);
    const top = skeleton(anglesAt(squat, 0), 'feet', anchorAt);
    for (const t of [0, 250, 500, 1000, 1400]) {
      const s = skeleton(anglesAt(squat, t), 'feet', anchorAt);
      expect(s.ankleN.x).toBeCloseTo(anchorAt.x);
      expect(s.ankleN.y).toBeCloseTo(anchorAt.y);
    }
    const bottom = skeleton(anglesAt(squat, 1000), 'feet', anchorAt);
    expect(bottom.hip.y).toBeGreaterThan(top.hip.y);
  });

  it('layout gives a finite non-empty view box', () => {
    const { viewBox } = layout(squat);
    for (const v of Object.values(viewBox)) expect(Number.isFinite(v)).toBe(true);
    expect(viewBox.w).toBeGreaterThan(0);
    expect(viewBox.h).toBeGreaterThan(0);
  });
  it('every layout has the same aspect ratio, so tall and wide poses scale alike', () => {
    const { viewBox } = layout(squat);
    expect(viewBox.w / viewBox.h).toBeCloseTo(VIEW_ASPECT, 5);
  });
});
