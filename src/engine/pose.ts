/**
 * Stick-figure kinematics (pure). A pose is 1–4 keyframes of absolute bone angles; this module
 * interpolates them on a looped timeline and walks the skeleton by forward kinematics.
 *
 * Angle convention: absolute degrees for a figure facing right (screen right = +x, screen down = +y).
 * 0 = the bone points straight down, 90 = it points forward (right), 180 = straight up, 270 = backward.
 * The torso is measured hip→neck, so standing is 180; the head continues from the neck. `N` is the near
 * limb, `F` the far limb. In `front` view an omitted F angle mirrors the N angle (negated).
 *
 * Timeline: frame 0 is held first, then each frame k≥1 is reached over `ms` (default 800) and held for
 * `holdMs`; finally the figure returns to frame 0 over frame 0's `ms`. The loop length is the sum of all
 * `ms + holdMs`.
 *
 * `PoseDef` is mirrored structurally in content/types.ts (the eslint fence keeps content and engine
 * from importing each other). Props are positioned from frame 0. Cable coordinates are offsets
 * from the anchor point, x right, y down.
 */
export type Bone =
  | 'torso' | 'head'
  | 'upperArmN' | 'forearmN' | 'upperArmF' | 'forearmF'
  | 'thighN' | 'shinN' | 'footN' | 'thighF' | 'shinF' | 'footF';
export type Angles = Partial<Record<Bone, number>>;
export interface Keyframe {
  angles: Angles;
  ms?: number;
  holdMs?: number;
}
export interface PoseDef {
  view: 'side' | 'front';
  anchor: 'feet' | 'hands' | 'hip';
  frames: Keyframe[];
  implement?: 'bar' | 'db' | 'kb' | 'handle' | 'none';
  prop?: 'bench' | 'shoulder-bench' | 'box' | 'incline' | 'seat' | 'floor' | 'rower' | 'none';
  cable?: { x: number; y: number };
}
export interface Pt { x: number; y: number }
export type Joint =
  | 'hip' | 'neck' | 'head'
  | 'elbowN' | 'wristN' | 'elbowF' | 'wristF'
  | 'kneeN' | 'ankleN' | 'toeN' | 'kneeF' | 'ankleF' | 'toeF';
export type Skeleton = Record<Joint, Pt>;
export type FullAngles = Required<Angles>;

export const BONES: Bone[] = [
  'torso', 'head', 'upperArmN', 'forearmN', 'upperArmF', 'forearmF', 'thighN', 'shinN', 'footN', 'thighF', 'shinF', 'footF',
];
export const STANDING: FullAngles = {
  torso: 180, head: 180, upperArmN: 0, forearmN: 0, upperArmF: 0, forearmF: 0, thighN: 0, shinN: 0, footN: 90, thighF: 0, shinF: 0, footF: 90,
};
export const BONE_LENGTH: Record<Bone, number> = {
  torso: 50, head: 16, upperArmN: 28, forearmN: 26, upperArmF: 28, forearmF: 26, thighN: 40, shinN: 38, footN: 10, thighF: 40, shinF: 38, footF: 10,
};
export const HEAD_RADIUS = 8;

const DEFAULT_MS = 800;
const rad = (d: number) => (d * Math.PI) / 180;
const MIRROR: Partial<Record<Bone, Bone>> = {
  upperArmF: 'upperArmN', forearmF: 'forearmN', thighF: 'thighN', shinF: 'shinN', footF: 'footN',
};

/** Each frame inherits unspecified bones from the previous one (frame 0 from STANDING). */
export function resolveFrames(def: PoseDef): FullAngles[] {
  const out: FullAngles[] = [];
  let prev: FullAngles = STANDING;
  for (const f of def.frames) {
    const cur = { ...prev };
    for (const b of BONES) {
      const v = f.angles[b];
      const near = MIRROR[b];
      if (v !== undefined) cur[b] = v;
      else if (def.view === 'front' && near) cur[b] = -cur[near];
    }
    out.push(cur);
    prev = cur;
  }
  return out.length > 0 ? out : [{ ...STANDING }];
}

/** Interpolates along the shortest arc, so 350 → 10 passes through 0. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** Smoothstep. */
export const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const ms = (k: Keyframe) => Math.max(0, k.ms ?? DEFAULT_MS);
const hold = (k: Keyframe) => Math.max(0, k.holdMs ?? 0);

export function cycleMs(def: PoseDef): number {
  const total = def.frames.reduce((s, f) => s + ms(f) + hold(f), 0);
  return total > 0 ? total : DEFAULT_MS;
}

const mix = (a: FullAngles, b: FullAngles, t: number): FullAngles => {
  const out = { ...a };
  for (const bone of BONES) out[bone] = lerpAngle(a[bone], b[bone], t);
  return out;
};

export function anglesAt(def: PoseDef, tMs: number): FullAngles {
  const frames = resolveFrames(def);
  const n = frames.length;
  if (n === 1) return { ...frames[0]! };
  const c = cycleMs(def);
  let t = ((tMs % c) + c) % c;
  const seg = (from: number, to: number, dur: number): FullAngles | null => {
    if (t < dur) return mix(frames[from]!, frames[to]!, dur === 0 ? 1 : ease(t / dur));
    t -= dur;
    return null;
  };
  const f0 = def.frames[0]!;
  const first = seg(0, 0, hold(f0));
  if (first) return first;
  for (let k = 1; k < n; k++) {
    const arrive = seg(k - 1, k, ms(def.frames[k]!));
    if (arrive) return arrive;
    const held = seg(k, k, hold(def.frames[k]!));
    if (held) return held;
  }
  return seg(n - 1, 0, ms(f0)) ?? { ...frames[0]! };
}

const along = (from: Pt, deg: number, len: number): Pt => ({ x: from.x + Math.sin(rad(deg)) * len, y: from.y + Math.cos(rad(deg)) * len });

function place(a: FullAngles): Skeleton {
  const hip = { x: 0, y: 0 };
  const neck = along(hip, a.torso, BONE_LENGTH.torso);
  const head = along(neck, a.head, BONE_LENGTH.head / 2);
  const elbowN = along(neck, a.upperArmN, BONE_LENGTH.upperArmN);
  const wristN = along(elbowN, a.forearmN, BONE_LENGTH.forearmN);
  const elbowF = along(neck, a.upperArmF, BONE_LENGTH.upperArmF);
  const wristF = along(elbowF, a.forearmF, BONE_LENGTH.forearmF);
  const kneeN = along(hip, a.thighN, BONE_LENGTH.thighN);
  const ankleN = along(kneeN, a.shinN, BONE_LENGTH.shinN);
  const toeN = along(ankleN, a.footN, BONE_LENGTH.footN);
  const kneeF = along(hip, a.thighF, BONE_LENGTH.thighF);
  const ankleF = along(kneeF, a.shinF, BONE_LENGTH.shinF);
  const toeF = along(ankleF, a.footF, BONE_LENGTH.footF);
  return { hip, neck, head, elbowN, wristN, elbowF, wristF, kneeN, ankleN, toeN, kneeF, ankleF, toeF };
}

const anchorPoint = (s: Skeleton, anchor: PoseDef['anchor']): Pt => (anchor === 'feet' ? s.ankleN : anchor === 'hands' ? s.wristN : s.hip);

/** Joint points; the figure is translated so the anchor joint sits at `anchorAt` (default: where it is with the hip at 0,0). */
export function skeleton(angles: FullAngles, anchor: PoseDef['anchor'], anchorAt?: Pt): Skeleton {
  const raw = place(angles);
  if (!anchorAt) return raw;
  const here = anchorPoint(raw, anchor);
  const dx = anchorAt.x - here.x;
  const dy = anchorAt.y - here.y;
  const out = {} as Skeleton;
  for (const j of Object.keys(raw) as Joint[]) out[j] = { x: raw[j].x + dx, y: raw[j].y + dy };
  return out;
}

export interface Layout {
  anchorAt: Pt;
  /** Frame 0's hip. */
  hip0: Pt;
  propRect?: { x: number; y: number; w: number; h: number };
  viewBox: { x: number; y: number; w: number; h: number };
}

const SAMPLES = 8;
const PAD = 14;
const MIN_SIDE = 90;
/** Width / height of every figure's view box (CSS `.pose` uses the same ratio). */
export const VIEW_ASPECT = 10 / 7;

export function layout(def: PoseDef): Layout {
  const frames = resolveFrames(def);
  const raw0 = place(frames[0]!);
  const anchorAt = anchorPoint(raw0, def.anchor);
  const hip0 = raw0.hip;
  let propRect: Layout['propRect'];
  if (def.prop === 'box') propRect = { x: anchorAt.x - 10, y: anchorAt.y, w: 32, h: 27 };
  if (def.prop === 'shoulder-bench') propRect = { x: raw0.neck.x - 32, y: raw0.neck.y + 4.5, w: 30, h: 8 };
  if (def.prop === 'rower') {
    const x = Math.min(...frames.map((f) => skeleton(f, def.anchor, anchorAt).hip.x)) - 16;
    propRect = { x, y: hip0.y + 11, w: anchorAt.x + 66 - x, h: 6 };
  }
  const pts: Pt[] = [];
  const collect = (a: FullAngles) => pts.push(...Object.values(skeleton(a, def.anchor, anchorAt)));
  frames.forEach((f, i) => {
    collect(f);
    const next = frames[(i + 1) % frames.length]!;
    for (let s = 1; s < SAMPLES; s++) collect(mix(f, next, s / SAMPLES));
  });
  if (def.cable) pts.push({ x: anchorAt.x + def.cable.x, y: anchorAt.y + def.cable.y });
  if (def.prop && def.prop !== 'none') pts.push({ x: hip0.x - 50, y: hip0.y + 8 }, { x: hip0.x + 50, y: hip0.y - 50 });
  if (propRect) pts.push({ x: propRect.x, y: propRect.y }, { x: propRect.x + propRect.w, y: propRect.y + propRect.h });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let minX = Math.min(...xs) - PAD;
  let maxX = Math.max(...xs) + PAD;
  let minY = Math.min(...ys) - PAD;
  let maxY = Math.max(...ys) + PAD;
  if (maxX - minX < MIN_SIDE) { const m = (maxX + minX) / 2; minX = m - MIN_SIDE / 2; maxX = m + MIN_SIDE / 2; }
  if (maxY - minY < MIN_SIDE) { const m = (maxY + minY) / 2; minY = m - MIN_SIDE / 2; maxY = m + MIN_SIDE / 2; }
  // Every figure gets the same aspect ratio: the bounding box is grown (centred) on its short side, so a
  // tall standing pose and a wide seated pose are drawn at the same scale on screen.
  const w = maxX - minX;
  const h = maxY - minY;
  if (w / h < VIEW_ASPECT) { const grow = h * VIEW_ASPECT - w; minX -= grow / 2; maxX += grow / 2; }
  else { const grow = w / VIEW_ASPECT - h; minY -= grow / 2; maxY += grow / 2; }
  return { anchorAt, hip0, propRect, viewBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
