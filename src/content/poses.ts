import type { Angles, PoseDef } from './types';

/**
 * Stick-figure poses, static data. Angle convention is documented in engine/pose.ts: absolute degrees,
 * 0 = bone points down, 90 = forward (right), 180 = up, 270 = backward; torso is measured hip→neck
 * (standing = 180). Only the bones that move are authored; the rest inherit from the previous frame.
 * Keep a 180° swing off the vertical: interpolation takes the short arc, so retracted elbows are authored a little
 * below horizontal (285, not 255/260) or the arm sweeps overhead. Poses are shared by exercise family through `Exercise.poseId`.
 */

/** Both arms (near and far) at once, for side-view poses where the far limb mirrors the near one. */
const arms = (upper: number, fore: number): Angles => ({ upperArmN: upper, forearmN: fore, upperArmF: upper, forearmF: fore });
/** Both legs. */
const legs = (thigh: number, shin: number): Angles => ({ thighN: thigh, shinN: shin, thighF: thigh, shinF: shin });
const SEATED: Angles = { ...legs(90, 0), torso: 180, head: 180 };

export const POSES: Record<string, PoseDef> = {
  squat: {
    view: 'side', anchor: 'feet',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(70, 80) } },
      { angles: { torso: 150, head: 160, ...legs(95, 330) }, ms: 900, holdMs: 200 },
    ],
  },
  'goblet-squat': {
    view: 'side', anchor: 'feet', implement: 'db',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(15, 140) } },
      { angles: { torso: 160, head: 170, ...legs(95, 330), ...arms(25, 140) }, ms: 900, holdMs: 200 },
    ],
  },
  'leg-press': {
    view: 'side', anchor: 'hip', prop: 'seat',
    frames: [
      { angles: { torso: 215, head: 215, ...legs(150, 60), ...arms(20, 100), footN: 35, footF: 35 } },
      { angles: { ...legs(125, 120) }, ms: 1000, holdMs: 200 },
    ],
  },
  'leg-extension': {
    view: 'side', anchor: 'hip', prop: 'seat',
    frames: [
      { angles: { ...SEATED, torso: 190, head: 190, ...arms(10, 80), shinN: 10, shinF: 10 } },
      { angles: { shinN: 85, shinF: 85, footN: 140, footF: 140 }, ms: 900, holdMs: 300 },
    ],
  },
  'leg-curl': {
    view: 'side', anchor: 'hip', prop: 'seat',
    frames: [
      { angles: { ...SEATED, torso: 185, head: 185, ...arms(10, 80), shinN: 85, shinF: 85 } },
      { angles: { shinN: 345, shinF: 345 }, ms: 900, holdMs: 300 },
    ],
  },
  hinge: {
    view: 'side', anchor: 'feet', implement: 'bar',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(0, 0) } },
      { angles: { torso: 125, head: 140, ...legs(20, 355) }, ms: 1100, holdMs: 200 },
    ],
  },
  'hip-thrust': {
    view: 'side', anchor: 'feet', implement: 'bar', prop: 'shoulder-bench',
    frames: [
      { angles: { torso: 235, head: 235, ...legs(120, 0), ...arms(60, 90) } },
      { angles: { torso: 265, head: 265, ...legs(85, 0) }, ms: 900, holdMs: 400 },
    ],
  },
  'pull-through': {
    view: 'side', anchor: 'feet', implement: 'handle', cable: { x: -55, y: -4 },
    frames: [
      { angles: { torso: 125, head: 140, ...legs(20, 355), ...arms(340, 340) } },
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(0, 0) }, ms: 900, holdMs: 200 },
    ],
  },
  'split-squat': {
    view: 'side', anchor: 'feet', implement: 'db',
    frames: [
      { angles: { torso: 180, head: 180, thighN: 38, shinN: 28, thighF: 322, shinF: 332, ...arms(0, 0) } },
      { angles: { torso: 175, thighN: 85, shinN: 0, thighF: 345, shinF: 270, footF: 200 }, ms: 1000, holdMs: 200 },
    ],
  },
  'step-up': {
    view: 'side', anchor: 'feet', implement: 'db', prop: 'box',
    frames: [
      { angles: { torso: 175, head: 180, thighN: 70, shinN: 350, thighF: 0, shinF: 0, ...arms(0, 0) } },
      { angles: { torso: 180, thighN: 0, shinN: 0, thighF: 80, shinF: 10 }, ms: 900, holdMs: 300 },
    ],
  },
  'calf-raise': {
    view: 'side', anchor: 'hip',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(0, 0) } },
      { angles: { footN: 40, footF: 40 }, ms: 700, holdMs: 400 },
    ],
  },
  'hip-adduction': {
    view: 'front', anchor: 'hip', prop: 'seat',
    frames: [
      { angles: { torso: 180, head: 180, thighN: 28, shinN: 28, upperArmN: 20, forearmN: 0 } },
      { angles: { thighN: 6, shinN: 6 }, ms: 900, holdMs: 300 },
    ],
  },
  'hip-abduction': {
    view: 'front', anchor: 'hip', prop: 'seat',
    frames: [
      { angles: { torso: 180, head: 180, thighN: 6, shinN: 6, upperArmN: 20, forearmN: 0 } },
      { angles: { thighN: 28, shinN: 28 }, ms: 900, holdMs: 300 },
    ],
  },
  'dead-bug': {
    view: 'side', anchor: 'hip', prop: 'floor',
    frames: [
      { angles: { torso: 270, head: 270, ...arms(180, 180), ...legs(180, 90) } },
      { angles: { upperArmN: 270, forearmN: 270, thighF: 100, shinF: 100 }, ms: 900, holdMs: 200 },
      { angles: { upperArmN: 180, forearmN: 180, thighF: 180, shinF: 90 }, ms: 900 },
      { angles: { upperArmF: 270, forearmF: 270, thighN: 100, shinN: 100 }, ms: 900, holdMs: 200 },
    ],
  },
  'pallof-press': {
    view: 'side', anchor: 'feet', implement: 'handle', cable: { x: -60, y: -115 },
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(20, 100) } },
      { angles: { ...arms(90, 90) }, ms: 800, holdMs: 400 },
    ],
  },
  'cable-crunch': {
    view: 'side', anchor: 'hip', implement: 'handle', cable: { x: 0, y: -190 },
    frames: [
      { angles: { torso: 180, head: 180, thighN: 0, thighF: 0, shinN: 270, shinF: 270, ...arms(60, 180) } },
      { angles: { torso: 120, head: 140, ...arms(100, 140) }, ms: 900, holdMs: 300 },
    ],
  },
  'seated-press': {
    view: 'side', anchor: 'hip', prop: 'seat', implement: 'handle',
    frames: [
      // Hand stays on a level line ~6 units below the shoulder (two-link solution at reach 22 / 37 / 52), so the
      // upper arm foreshortens instead of sweeping through vertical. The mid frame is revisited for the return.
      { angles: { ...SEATED, torso: 190, head: 190, ...arms(14, 144) }, ms: 450 },
      { angles: { ...arms(37, 129) }, ms: 450 },
      { angles: { ...arms(70, 98) }, ms: 450, holdMs: 200 },
      { angles: { ...arms(37, 129) }, ms: 450 },
    ],
  },
  'bench-press': {
    view: 'side', anchor: 'hip', prop: 'bench', implement: 'bar',
    frames: [
      { angles: { torso: 270, head: 270, ...legs(70, 0), ...arms(20, 180) } },
      { angles: { ...arms(180, 180) }, ms: 900, holdMs: 200 },
    ],
  },
  'db-bench': {
    view: 'side', anchor: 'hip', prop: 'bench', implement: 'db',
    frames: [
      { angles: { torso: 270, head: 270, ...legs(70, 0), ...arms(20, 180) } },
      { angles: { ...arms(180, 180) }, ms: 900, holdMs: 200 },
    ],
  },
  'incline-press': {
    view: 'side', anchor: 'hip', prop: 'incline', implement: 'db',
    frames: [
      { angles: { torso: 225, head: 225, ...legs(80, 0), ...arms(10, 150) } },
      { angles: { ...arms(160, 160) }, ms: 900, holdMs: 200 },
    ],
  },
  fly: {
    view: 'front', anchor: 'hip',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), upperArmN: 95, forearmN: 95 } },
      { angles: { upperArmN: 20, forearmN: 10 }, ms: 900, holdMs: 300 },
    ],
  },
  'seated-row': {
    view: 'side', anchor: 'hip', prop: 'seat', implement: 'handle',
    frames: [
      // Same level-hand solution as seated-press, run from reach to pulled-in.
      { angles: { ...SEATED, torso: 175, head: 175, ...arms(70, 98) }, ms: 450 },
      { angles: { torso: 180, head: 180, ...arms(37, 129) }, ms: 450 },
      { angles: { torso: 185, head: 185, ...arms(14, 144) }, ms: 450, holdMs: 300 },
      { angles: { torso: 180, head: 180, ...arms(37, 129) }, ms: 450 },
    ],
  },
  'db-row': {
    view: 'side', anchor: 'feet', implement: 'db',
    frames: [
      { angles: { torso: 110, head: 130, ...legs(20, 350), upperArmN: 0, forearmN: 0, upperArmF: 20, forearmF: 20 } },
      { angles: { upperArmN: 250, forearmN: 0 }, ms: 800, holdMs: 300 },
    ],
  },
  'lateral-raise': {
    view: 'front', anchor: 'feet', implement: 'db',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), upperArmN: 0, forearmN: 0 } },
      { angles: { upperArmN: 85, forearmN: 80 }, ms: 900, holdMs: 300 },
    ],
  },
  'overhead-press': {
    view: 'side', anchor: 'hip', prop: 'seat', implement: 'db',
    frames: [
      { angles: { ...SEATED, ...arms(10, 175) } },
      { angles: { ...arms(175, 178) }, ms: 900, holdMs: 200 },
    ],
  },
  'landmine-press': {
    view: 'side', anchor: 'feet', implement: 'bar',
    frames: [
      { angles: { torso: 175, head: 175, ...legs(0, 0), ...arms(30, 120) } },
      { angles: { ...arms(135, 135) }, ms: 900, holdMs: 200 },
    ],
  },
  pulldown: {
    view: 'side', anchor: 'hip', prop: 'seat', implement: 'bar', cable: { x: 10, y: -190 },
    frames: [
      { angles: { ...SEATED, torso: 190, head: 190, ...arms(175, 180) } },
      { angles: { ...arms(10, 120) }, ms: 1000, holdMs: 300 },
    ],
  },
  'reverse-fly': {
    view: 'front', anchor: 'hip',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), upperArmN: 20, forearmN: 10 } },
      { angles: { upperArmN: 95, forearmN: 95 }, ms: 900, holdMs: 300 },
    ],
  },
  curl: {
    view: 'side', anchor: 'feet', implement: 'db',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(0, 5) } },
      { angles: { ...arms(5, 145) }, ms: 900, holdMs: 300 },
    ],
  },
  'triceps-pushdown': {
    view: 'side', anchor: 'feet', implement: 'handle', cable: { x: 10, y: -190 },
    frames: [
      { angles: { torso: 175, head: 175, ...legs(0, 0), ...arms(5, 100) } },
      { angles: { ...arms(5, 0) }, ms: 800, holdMs: 300 },
    ],
  },
  'overhead-triceps': {
    view: 'side', anchor: 'feet', implement: 'db',
    frames: [
      { angles: { torso: 180, head: 180, ...legs(0, 0), ...arms(175, 340) } },
      { angles: { ...arms(175, 175) }, ms: 900, holdMs: 300 },
    ],
  },
};
