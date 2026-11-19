import type { Activity } from '../engine/plan/activities';
/**
 * The data contract. Every row type and the `Block` union live here so that later phases never need
 * a Dexie migration for a missing field.
 *
 * Contract notes for later phases:
 * - Every session writes its *prescription* into `sessions.blocks`. A lift writes its planned
 *   `LiftBlock[]` (executed truth stays in `sets`). A Burn writes executed `IntervalBlock[]` with
 *   `result`. A run writes one `RunBlock`. A swim writes `SwimSetBlock[]`. A hybrid writes
 *   `LiftBlock[]` plus one `RunBlock`.
 * - "Do this again" and "Save as mine" (P4) copy `blocks` straight into `templates.blocks`, so no new
 *   template shape is ever needed.
 * - Superset pairing (P4 builder) shares one `supersetGroup` string across the paired `LiftBlock`s and
 *   copies it onto their `sets` rows.
 * - A hybrid's cardio part is a `runs` row whose `modality` may be bike/row/ski on leg days. It still
 *   counts toward the run guardrails only when `modality` is `run` or `treadmill`.
 *
 * Obligations: P2 flips the `lift`/`pick` tiles, writes `variant`, `flags.calibration` and `setKind`,
 * asks the optional lift RPE and calls `classifyHard` at log time. P3 flips burn/run/swim, copies RPE to
 * `sessions.rpe` and uses `weekIndex`. P4 replaces the static pick; budget uses `hardCardio`, the 48 h
 * spacing rule uses `hard`. P5 adds `poseId` to content and reads the `feedback` store; feedback `context` also carries the optional,
 * non-indexed `screen` (hash route) and `templateId`.
 *
 * Dates are always strings (never `Date`): instants via `toISOString()`, calendar days as local
 * `YYYY-MM-DD`, so the JSON export round-trips.
 */
export type ISODateTime = string;
export type LocalDate = string;
export type SessionType = 'lift' | 'burn' | 'run' | 'swim' | 'hybrid' | 'custom';
export type LiftVariant = 'upper-a' | 'upper-b' | 'lower-a' | 'lower-b';
export type RunKind = 'easy' | 'long' | 'intervals';
export type CardioModality = 'run' | 'treadmill' | 'bike' | 'row' | 'ski' | 'stair' | 'elliptical';
export type PoolUnit = 'yd' | 'm';
export const FEEDBACK_TAGS = [
  'missing-equipment',
  'adjacent-machines',
  'group-these',
  'too-hard',
  'too-easy',
  'pain',
  'form-unclear',
  'animation-wrong',
  'makes-no-sense',
  'other',
] as const;
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

// ---- Block: discriminated union on `kind` ----
interface BlockBase {
  id: string;
  label?: string;
  notes?: string;
  /** Executed copy (Burn) fills this in. */
  result?: { completed: boolean; actualSec?: number; completedRounds?: number; skipped?: boolean };
}
export interface TimedPhase {
  role: 'work' | 'rest' | 'warmup' | 'cooldown' | 'transition';
  sec: number;
  label: string;
  exerciseId?: string;
  equipmentId?: string;
  reps?: number;
  station?: number;
}
export interface IntervalBlock extends BlockBase {
  kind: 'interval';
  rounds: number;
  phases: TimedPhase[];
}
export interface LiftBlock extends BlockBase {
  kind: 'lift';
  exerciseId: string;
  equipmentId?: string;
  sets: number;
  repMin: number;
  repMax: number;
  targetWeight?: number;
  restSec?: number;
  rirTarget?: number;
  supersetGroup?: string;
  warmup?: boolean;
}
export interface SwimItem {
  reps: number;
  distance: number;
  stroke: 'FR' | 'BK' | 'BR' | 'FL' | 'IM' | 'CH';
  swimKind: 'swim' | 'kick' | 'pull' | 'drill' | 'scull';
  equipment: string[];
  mode: 'sendoff' | 'rest';
  seconds?: number;
  intensity: 'EZ' | 'MOD' | 'CSS' | 'FAST' | 'SPRINT';
  drillId?: string;
  notes?: string;
}
export interface SwimSetBlock extends BlockBase {
  kind: 'swim';
  section: 'warmup' | 'drill' | 'kick' | 'pull' | 'main' | 'cooldown';
  rounds: number;
  items: SwimItem[];
}
export interface RunSegment {
  role: 'run' | 'walk' | 'jog' | 'sprint' | 'recover';
  sec?: number;
  distanceMi?: number;
  inclinePct?: number;
  rpeTarget?: number;
}
export interface RunBlock extends BlockBase {
  kind: 'run';
  runKind: RunKind;
  modality: CardioModality;
  repeats: number;
  segments: RunSegment[];
  format?: 'sprint-walk' | 'sprint-jog' | '30-30' | 'norwegian-4x4' | 'hill' | 'treadmill-incline' | 'run-walk';
}
export type Block = IntervalBlock | LiftBlock | SwimSetBlock | RunBlock;

// ---- rows ----
export interface ExerciseOverride {
  exerciseId: string;
  notAtMyGym: boolean;
  preferredEquipmentId?: string;
}
export interface Equipment {
  id: string;
  name: string;
  kind: 'machine' | 'barbell' | 'db' | 'kb' | 'cable' | 'cardio' | 'bodyweight';
  steps: number[];
  builtin?: boolean;
}
export interface Session {
  id: string;
  /** Start instant. */
  date: ISODateTime;
  type: SessionType;
  templateId?: string;
  blocks: Block[];
  hard: boolean;
  hardCardio: boolean;
  rpe: number | null;
  durationMin: number;
  notes: string;
  variant?: LiftVariant;
  endedAt?: ISODateTime;
  flags?: { calibration?: boolean; deload?: boolean; fatigue?: boolean };
}
export interface SetRow {
  id: string;
  sessionId: string;
  exerciseId: string;
  equipmentId: string;
  idx: number;
  targetWeight: number;
  targetReps: number;
  weight: number;
  reps: number;
  /** Buckets: 0, 1-2, 3+. */
  rir?: 0 | 1 | 3;
  painFlag: boolean;
  supersetGroup?: string;
  /** Defaults to working. */
  setKind?: 'working' | 'warmup' | 'calibration';
  ts?: ISODateTime;
}
export interface RunRow {
  sessionId: string;
  kind: RunKind;
  /** Defaults to 'run'. */
  modality?: CardioModality;
  distanceMi: number;
  durationSec: number;
  intervals: RunSegment[];
  runWalkRatio?: string;
  rpe: number;
  painFlag: boolean;
}
export interface SwimRow {
  sessionId: string;
  poolLength: number;
  poolUnit: PoolUnit;
  distance: number;
  sets: SwimSetBlock[];
  rpe: number;
  shoulderPainFlag: boolean;
}
export interface CssTest {
  id: string;
  kind: 'css';
  date: ISODateTime;
  poolUnit: PoolUnit;
  /** Seconds. */
  t400?: number;
  t200?: number;
  t3x100?: number;
}
export interface BodyLog {
  date: LocalDate;
  weightLb?: number;
  waistIn?: number;
  protein: boolean;
}
export interface Template {
  id: string;
  name: string;
  type: SessionType;
  /** Lift variant of a saved lift/hybrid session; keeps leg-day identity and A/B rotation on replay. */
  variant?: LiftVariant;
  blocks: Block[];
  source: 'generated' | 'saved' | 'built';
  createdAt: ISODateTime;
}
export interface FeedbackRow {
  /** ULID. */
  id: string;
  v: 1;
  ts: ISODateTime;
  kind: 'workout' | 'exercise' | 'set' | 'app';
  tags: FeedbackTag[];
  text: string;
  /** Id of the feedback row this corrects. */
  ref?: string;
  context: { sessionId?: string; exerciseId?: string; setId?: string; equipmentId?: string; screen?: string; templateId?: string };
}
export type FeedbackKind = FeedbackRow['kind'];
export const GOAL_DIRECTIONS = ['lose', 'gain', 'maintain'] as const;
export type GoalDirection = typeof GOAL_DIRECTIONS[number];

export interface Settings {
  id: 'settings';
  goalWeightLb: number;
  startWeightLb?: number;
  daysPerWeek: number;
  activities?: Activity[];
  goalDirection?: GoalDirection;
  poolUnit?: PoolUnit;
  poolLength?: number;
  weightUnit: 'lb';
  distanceUnit: 'mi';
  programStart: LocalDate;
  onboardedAt: ISODateTime;
  backupAt: ISODateTime | null;
  updatedAt: ISODateTime;
  /** UI theme preference; absent = 'light'. */
  appearance?: Appearance;
}
