import { EXERCISES, SEED_EQUIPMENT } from '../content';
import { EQUIPMENT_PREF_IDS } from '../content/equipment-prefs';
import { POSES } from '../content/poses';
import { coachedPose } from '../content/stationDemos';
import { coachedSchedule, phaseMs, sameCoachedPhase, projectCoached } from '../engine/block/coached';
import { elapsedClamped } from '../engine/block/session';
import { stationUnits } from '../engine/block/progression';
import { ACTIVITIES } from '../engine/plan/activities';
import { ImportError } from './errors';
import { toBlockExercise } from './liftday';
import type { StoreName } from './stores';
import { APPEARANCES, FEEDBACK_TAGS, GOAL_DIRECTIONS, STATION_UNITS } from './types';

import type { AcceptedStrength, EffectiveStation, MixedDraft, MixedExecution } from './types';
import type { Equipment, ExecutableCoachedBlock, MixedTimer } from './types';

type Rec = Record<string, unknown>;
type Check = (v: unknown) => boolean;
interface BackupSnapshot {
  exportedAt: unknown;
  restoreAt: number;
  equipment: ReadonlyMap<string, Equipment>;
}

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str: Check = (v) => typeof v === 'string';
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const bool: Check = (v) => typeof v === 'boolean';
const arr = (item: Check): Check => (v) => Array.isArray(v) && v.every(item);
const oneOf = (...xs: string[]): Check => (v) => typeof v === 'string' && xs.includes(v);
const nullable = (c: Check): Check => (v) => v === null || c(v);
const opt = (c: Check): Check => (v) => v === undefined || c(v);
const localDate: Check = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const iso = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
  localDate(v.slice(0, 10)) &&
  !Number.isNaN(Date.parse(v));

/** Every listed field must be present with the right type; absent/mistyped optional fields are rejected too. */
const shape = (fields: Record<string, Check>): Check => (v) =>
  isRec(v) && Object.entries(fields).every(([k, c]) => c(v[k]));
const only = (v: Rec, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));

const SESSION_TYPES = ['lift', 'burn', 'run', 'swim', 'hybrid', 'custom'];
const activityArray = arr(oneOf(...ACTIVITIES));
const POOL_UNITS = ['yd', 'm'];
const MODALITIES = ['run', 'treadmill', 'bike', 'row', 'ski', 'stair', 'elliptical'];
const RUN_FORMATS = ['sprint-walk', 'sprint-jog', '30-30', 'norwegian-4x4', 'hill', 'treadmill-incline', 'run-walk'];
const RUN_KINDS = ['easy', 'long', 'intervals'];

const phase = shape({
  role: oneOf('work', 'rest', 'warmup', 'cooldown', 'transition'), sec: num, label: str,
  reps: opt(num), station: opt(num), exerciseId: opt(str), equipmentId: opt(str),
});
const swimItem = shape({
  reps: num, distance: num, stroke: oneOf('FR', 'BK', 'BR', 'FL', 'IM', 'CH'),
  swimKind: oneOf('swim', 'kick', 'pull', 'drill', 'scull'), equipment: arr(str), mode: oneOf('sendoff', 'rest'),
  intensity: oneOf('EZ', 'MOD', 'CSS', 'FAST', 'SPRINT'), seconds: opt(num),
});
const segment = shape({
  role: oneOf('run', 'walk', 'jog', 'sprint', 'recover'),
  sec: opt(num), distanceMi: opt(num), inclinePct: opt(num), rpeTarget: opt(num),
});
const swimBlock = shape({
  id: str, kind: oneOf('swim'), section: oneOf('warmup', 'drill', 'kick', 'pull', 'main', 'cooldown'),
  rounds: num, items: arr(swimItem),
});
const result = shape({ completed: bool, actualSec: opt(num), completedRounds: opt(num), skipped: opt(bool) });
const target = shape({ unit: oneOf(...STATION_UNITS), amount: num });
const stationFields = { exerciseId: str, target, equipmentId: opt(str), itemId: opt(str), load: opt(num) };
const station = shape({ ...stationFields, backup: opt(shape(stationFields)) });
const circuitLog = shape({
  completedRounds: num, actualDurationSec: num, lastRoundRir: opt(num),
  stations: arr(shape({ exerciseId: str, actualLoad: opt(num), swappedFromExerciseId: opt(str) })),
  partialReps: opt(shape({ stationIndex: num, count: num })),
});
const block: Check = (v) => {
  if (!isRec(v) || !str(v.id)) return false;
  if (!opt(str)(v.label) || !opt(str)(v.notes) || !opt(result)(v.result)) return false;
  switch (v.kind) {
    case 'interval': return shape({ rounds: num, phases: arr(phase) })(v);
    case 'lift':
      return shape({
        exerciseId: str, sets: num, repMin: num, repMax: num,
        equipmentId: opt(str), targetWeight: opt(num), restSec: opt(num), rirTarget: opt(num), supersetGroup: opt(str), warmup: opt(bool),
        role: opt(oneOf('warmup', 'cooldown')),
      })(v);
    case 'swim': return swimBlock(v);
    case 'run':
      return shape({ runKind: oneOf(...RUN_KINDS), modality: oneOf(...MODALITIES), repeats: num, segments: arr(segment), format: opt(oneOf(...RUN_FORMATS)) })(v);
    case 'circuit':
      return shape({
        role: oneOf('block', 'finisher'), durationSec: num, targetRounds: num, podId: str,
        stations: arr(station), log: opt(circuitLog),
      })(v);
    default: return false;
  }
};

const CATALOG = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const stationUnit = (v: unknown): v is string => typeof v === 'string' && (STATION_UNITS as readonly string[]).includes(v);

/** `shape()` lets extra keys through, so self-paced timing fields have to be rejected here. */
const libraryStation: Check = (v) => {
  if (!isRec(v) || typeof v.exerciseId !== 'string') return false;
  const target = v.target;
  if (!isRec(target) || !stationUnit(target.unit) || !finite(target.amount) || target.amount <= 0) return false;
  if (v.load !== undefined && (!finite(v.load) || v.load < 0)) return false;
  const exercise = CATALOG.get(v.exerciseId);
  // An id the catalog no longer knows stays readable. The picker, not the backup, requires a pose.
  if (!exercise) return true;
  const unit = target.unit;
  return stationUnits(toBlockExercise(exercise)).some((allowed) => allowed === unit);
};
const libraryBlock: Check = (v) => {
  if (!isRec(v) || typeof v.id !== 'string' || v.id === '') return false;
  // Keep schema 2 backups readable when they predate the editor's save rules.
  if (typeof v.name !== 'string' || v.name.length === 0) return false;
  if (v.kind !== 'self-paced' && v.kind !== 'coached') return false;
  if (!finite(v.durationSec) || !Number.isInteger(v.durationSec) || v.durationSec < 60 || v.durationSec > 3600) return false;
  if (!Array.isArray(v.stations) || v.stations.length < 1 || v.stations.length > 6 || !v.stations.every(libraryStation)) return false;
  if (typeof v.recommend !== 'boolean' || !iso(v.createdAt) || !iso(v.updatedAt)) return false;
  if (v.kind === 'self-paced') return v.workSec === undefined && v.restSec === undefined && v.transitionSec === undefined;
  return finite(v.workSec) && v.workSec > 0 && finite(v.restSec) && v.restSec >= 0 && finite(v.transitionSec) && v.transitionSec >= 0;
};

const nonnegative: Check = (v) => finite(v) && v >= 0;
const integer: Check = (v) => finite(v) && Number.isSafeInteger(v) && v >= 0;
const bounded = (min: number, max: number): Check => (v) => finite(v) && Number.isInteger(v) && v >= min && v <= max;
const id: Check = (v) => typeof v === 'string' && v.trim().length > 0;
const keyed = (key: string, min: number, max: number, check: Check): Check => (v) =>
  Array.isArray(v) && v.length >= min && v.length <= max
  && v.every((item) => isRec(item) && id(item[key]) && check(item))
  && new Set(v.map((item: Rec) => item[key])).size === v.length;
const dict = (check: Check): Check => (v) => isRec(v) && Object.entries(v).every(([key, item]) => id(key) && check(item));
const noActuals = (v: Rec) => ['log', 'result', 'skipped', 'swappedFromExerciseId', 'poseId', 'rounds', 'partial', 'stationChanges']
  .every((key) => !Object.hasOwn(v, key));
const orderedStation: Check = (v) => isRec(v) && noActuals(v) && opt(id)(v.equipmentId) && libraryStation(v);
const effectiveStation = shape({ slotId: id, equipmentId: opt(id), poseId: opt(id), skipped: opt(bool), swappedFromExerciseId: opt(id) });
export const validStrengthReps = bounded(1, 1000);
const strengthFields = {
  exerciseId: id, equipmentId: opt(id), sets: bounded(1, 30), repMin: validStrengthReps, repMax: validStrengthReps,
  targetWeight: opt(nonnegative), rirTarget: opt(nonnegative), label: opt(str),
};
export const isAcceptedStrength = (v: unknown): v is AcceptedStrength =>
  isRec(v) && shape(strengthFields)(v) && Number(v.repMin) <= Number(v.repMax);
const orderedBlock: Check = (v) => {
  if (!isRec(v) || !noActuals(v)) return false;
  if (v.kind === 'strength') return isAcceptedStrength(v) && opt(nonnegative)(v.restSec);
  if (!bounded(1, 3600)(v.durationSec)) return false;
  if (v.kind === 'preparation' || v.kind === 'recovery') return id(v.instructions) && opt(id)(v.exerciseId);
  if (v.kind === 'coached') {
    const common = ['id', 'kind', 'name', 'durationSec'];
    if (!bounded(60, 3600)(v.durationSec) || !id(v.name)) return false;
    if (only(v, common)) return true;
    const work = (sec: unknown) => finite(sec) && phaseMs(sec) >= 1 && sec <= 3600;
    const optionalPhase = (sec: unknown) => sec === 0 || work(sec);
    return only(v, [...common, 'stations', 'workSec', 'restSec', 'transitionSec'])
      && work(v.workSec) && optionalPhase(v.restSec) && optionalPhase(v.transitionSec)
      && keyed('slotId', 1, 6, (s) => {
        if (!isRec(s) || !orderedStation(s) || !only(s, ['slotId', 'exerciseId', 'target', 'load', 'equipmentId'])) return false;
        const target = s.target as Rec;
        return only(target, ['unit', 'amount']) && (target.unit !== 'sec' || work(target.amount));
      })(v.stations);
  }
  return v.kind === 'self-paced' && bounded(60, 3600)(v.durationSec) && id(v.name) && keyed('slotId', 1, 6, orderedStation)(v.stations);
};
const ordered = shape({ name: id, blocks: keyed('id', 1, 30, orderedBlock) });
const stations = keyed('slotId', 1, 6, (v) => isRec(v) && effectiveStation(v) && libraryStation(v));
const stationChanges = arr(shape({ afterRound: integer, stations }));
const partial = shape({ slotId: id, unit: stationUnit, count: nonnegative });
const coachedCheckpoint = (v: unknown) => isRec(v) && only(v, ['station', 'phase', 'phaseStartMs', 'rotations'])
  && shape({ station: bounded(0, 5), phase: oneOf('work', 'rest', 'transition'), phaseStartMs: integer, rotations: integer })(v);
const timer = shape({ startedAt: nullable(num), pausedAt: nullable(num), pausedMs: nonnegative, durationMs: nonnegative,
  frozenElapsedMs: opt(nonnegative), coached: opt(coachedCheckpoint) });
const draft = shape({ rounds: nullable(integer), tapped: integer, partial: opt(partial), stationChanges: opt(stationChanges) });
const mixedResult = shape({
  status: oneOf('completed', 'skipped'), elapsedMs: nonnegative, rounds: opt(nullable(integer)),
  partial: opt(partial), stations: opt(stations), stationChanges: opt(stationChanges),
});
const mixedShape = shape({
  kind: oneOf('ordered'), sourceId: id, prescription: ordered,
  stations: dict(stations), strength: dict(isAcceptedStrength), timers: dict(timer), drafts: dict(draft), results: dict(mixedResult),
  cursor: shape({ blockId: id, stage: oneOf('entry', 'active', 'review'), setSlot: integer }),
});

function validCoachedClock(block: ExecutableCoachedBlock, effective: EffectiveStation[], t: MixedTimer, row: Rec, latestAnchorAt?: number) {
  const { coached: at, startedAt, pausedAt, pausedMs, frozenElapsedMs, durationMs } = t;
  if (!only(t as unknown as Rec, ['coached', 'startedAt', 'pausedAt', 'pausedMs', 'durationMs', 'frozenElapsedMs'])) return false;
  if (startedAt === null) return !at && pausedMs === 0 && frozenElapsedMs === 0;
  if (!at || !Number.isSafeInteger(startedAt) || !integer(pausedMs) || !Number.isSafeInteger(startedAt + pausedMs + durationMs)
    || (pausedAt !== null && (!Number.isSafeInteger(pausedAt) || pausedAt < startedAt + pausedMs))
    || (frozenElapsedMs !== undefined && !integer(frozenElapsedMs))) return false;
  const elapsedLimit = frozenElapsedMs ?? (pausedAt === null ? durationMs - 1 : elapsedClamped(t, pausedAt));
  if (startedAt < Date.parse(String(row.date)) || (row.endedAt && startedAt + pausedMs + elapsedLimit > Date.parse(String(row.endedAt)))) return false;
  if (at.phaseStartMs > elapsedLimit || at.rotations >= Number.MAX_SAFE_INTEGER - (durationMs - at.phaseStartMs)) return false;
  if (latestAnchorAt !== undefined && (!Number.isFinite(latestAnchorAt) || (pausedAt ?? startedAt + pausedMs) > latestAnchorAt
    || at.phaseStartMs > elapsedClamped(t, latestAnchorAt))) return false;
  if (pausedAt !== null && (elapsedLimit >= durationMs || (frozenElapsedMs !== undefined && frozenElapsedMs !== elapsedClamped({ ...t, frozenElapsedMs: undefined }, pausedAt)))) return false;
  const lineup = effective.filter((s) => !s.skipped);
  if (!lineup.every((s) => s.poseId && s.equipmentId)) return false;
  const schedule = coachedSchedule(block, lineup);
  if (!schedule[at.station]?.some((p) => p.role === at.phase)) return false;
  if (at.phase === 'rest' || at.phase === 'transition') {
    const phases = schedule[at.station]!;
    const before = phases.slice(0, phases.findIndex((p) => p.role === at.phase));
    if (at.phaseStartMs < before.reduce((sum, p) => sum + phaseMs(p.sec), 0)) return false;
  }
  if (pausedAt !== null || frozenElapsedMs !== undefined) return sameCoachedPhase(at, projectCoached(schedule, at, elapsedLimit).at);
  return true;
}

function validMixed(row: Rec, backup?: BackupSnapshot): boolean {
  if (row.mixed === undefined) return true;
  if (row.type !== 'custom' || (!row.endedAt && row.rpe !== null) || !mixedShape(row.mixed)) return false;
  const m = row.mixed as MixedExecution;
  const blocks = m.prescription.blocks;
  const current = blocks.findIndex((b) => b.id === m.cursor.blockId);
  if (current < 0 || (row.endedAt && (current !== blocks.length - 1 || m.cursor.stage !== 'review'))) return false;
  const ids = new Set(blocks.map((b) => b.id));
  if ([m.stations, m.strength, m.timers, m.drafts, m.results].some((map) => Object.keys(map).some((key) => !ids.has(key)))) return false;
  return blocks.every((b, i) => {
    const read = <T,>(map: Record<string, T>) => Object.hasOwn(map, b.id) ? map[b.id] : undefined;
    const accepted = read(m.strength);
    const effective = read(m.stations);
    const d = read(m.drafts);
    const t = read(m.timers);
    const r = read(m.results);
    if (t?.coached && b.kind !== 'coached') return false;
    if (!!r !== (i < current || (i === current && !!row.endedAt))) return false;
    if ((i === current && m.cursor.setSlot > (accepted?.sets ?? 0)) || (i > current && t)) return false;
    if (b.kind === 'strength') {
      if (!accepted || effective || d || t || r?.stations || r?.partial || r?.stationChanges || r?.rounds !== undefined || (r && r.elapsedMs !== 0)) return false;
      if (i === current && r && (r.status === 'skipped') !== (m.cursor.setSlot === 0)) return false;
      return i !== current || (m.cursor.stage === 'entry' ? m.cursor.setSlot === 0 : m.cursor.stage === 'review' || (m.cursor.setSlot > 0 && m.cursor.setSlot < accepted.sets));
    }
    if (accepted) return false;
    if (i === current && m.cursor.stage === 'active' && (!t || t.startedAt === null || t.frozenElapsedMs !== undefined)) return false;
    if (i === current && m.cursor.stage === 'entry' && t) return false;
    if (i === current && m.cursor.stage === 'review' && t?.frozenElapsedMs === undefined) return false;
    if (t && (t.durationMs !== b.durationSec * 1000 || (t.pausedAt !== null && (t.startedAt === null || t.pausedAt < t.startedAt))
      || (t.frozenElapsedMs !== undefined && t.frozenElapsedMs > t.durationMs))) return false;
    if (r && (r.elapsedMs !== t?.frozenElapsedMs || (r.status === 'skipped') !== (t.startedAt === null))) return false;
    if (b.kind === 'coached' && !b.stations) return false;
    if (b.kind !== 'self-paced' && b.kind !== 'coached') return !effective && !d && !r?.stations && !r?.partial && !r?.stationChanges && r?.rounds === undefined;
    const prescribed = b.stations!;
    const matches = (list: EffectiveStation[] | undefined) =>
      list?.length === prescribed.length && list.every((s, k) => {
        const original = prescribed[k]!;
        return s.slotId === original.slotId && (b.kind !== 'coached' || (only(s as unknown as Rec,
          ['slotId', 'exerciseId', 'target', 'load', 'equipmentId', 'poseId', 'skipped', 'swappedFromExerciseId'])
          && only(s.target as unknown as Rec, ['unit', 'amount']) && s.target.amount === original.target.amount
          && s.target.unit === original.target.unit && s.swappedFromExerciseId === (s.exerciseId === original.exerciseId ? undefined : original.exerciseId)
          && (s.poseId === undefined || (CATALOG.get(s.exerciseId)?.poseId === s.poseId && Object.hasOwn(POSES, s.poseId)))));
      });
    const validPartial = (value: MixedDraft['partial'], list: EffectiveStation[] | undefined) =>
      !value || list?.some((s) => !s.skipped && s.slotId === value.slotId && s.target.unit === value.unit);
    const validChanges = (changes: MixedDraft['stationChanges']) => !changes || changes.every((change, k) =>
      change.afterRound > (changes[k - 1]?.afterRound ?? 0) && change.afterRound <= (b.kind === 'coached' ? t?.coached?.rotations ?? 0 : d?.tapped ?? 0)
      && matches(change.stations) && (b.kind !== 'coached' || (only(change as unknown as Rec, ['afterRound', 'stations'])
        && change.stations.every((s, k) => !!s.skipped === !!effective?.[k]?.skipped && (s.skipped || (!!s.poseId && !!s.equipmentId))))));
    if (!matches(effective) || !d || !validPartial(d.partial, effective) || !validChanges(d.stationChanges)
      || (r && (r.rounds === undefined || !matches(r.stations) || !validPartial(r.partial, r.stations) || !validChanges(r.stationChanges)))) return false;
    if (b.kind !== 'coached') return true;
    if (!only(d as unknown as Rec, ['rounds', 'tapped', 'partial', 'stationChanges'])
      || (d.partial && !only(d.partial, ['slotId', 'unit', 'count']))
      || (r && !only(r as unknown as Rec, ['status', 'elapsedMs', 'rounds', 'partial', 'stations', 'stationChanges']))) return false;
    const active = i === current && m.cursor.stage === 'active';
    if (active && !effective!.every((s) => {
      if (s.skipped) return true;
      if (!s.equipmentId || !s.poseId) return false;
      const equipment = backup?.equipment.get(s.equipmentId) ?? SEED_EQUIPMENT.find((e) => e.id === s.equipmentId);
      return equipment && coachedPose(s.exerciseId, equipment) === s.poseId;
    })) return false;
    const latestAnchorAt = active && backup
      ? (iso(backup.exportedAt) ? Math.min(Date.parse(backup.exportedAt), backup.restoreAt) : NaN)
      : undefined;
    if (t && (i < current && t.frozenElapsedMs === undefined || !validCoachedClock(b as ExecutableCoachedBlock, effective!, t, row, latestAnchorAt))) return false;
    if (d.tapped !== 0 || ((!t || t.startedAt === null || t.frozenElapsedMs === undefined) && (d.rounds !== null || d.partial))) return false;
    // The result is a portable copy of the final draft and lineup. Object key order is immaterial.
    const snapshot = (value: unknown): string => JSON.stringify(value, (_, item) => isRec(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
    return !r || (r.rounds === d.rounds && snapshot([r.partial, r.stations, r.stationChanges]) === snapshot([d.partial, effective, d.stationChanges]));
  });
}

const ROW_SHAPES: Record<StoreName, (v: unknown, snapshot?: BackupSnapshot) => boolean> = {
  exerciseOverrides: shape({ exerciseId: str, notAtMyGym: bool, preferredEquipmentId: opt(str) }),
  equipment: shape({
    id: str, name: str, kind: oneOf('machine', 'barbell', 'db', 'kb', 'cable', 'cardio', 'bodyweight'), steps: arr(num),
  }),
  sessions: (v, snapshot) => isRec(v) && validMixed(v, snapshot) && shape({
    id: str, date: iso, type: oneOf(...SESSION_TYPES), blocks: arr(block), hard: bool, hardCardio: bool,
    rpe: nullable(num), durationMin: num, notes: str, templateId: opt(str), endedAt: opt(iso),
    variant: opt(oneOf('upper-a', 'upper-b', 'lower-a', 'lower-b')),
    flags: opt(shape({ calibration: opt(bool), deload: opt(bool), fatigue: opt(bool) })),
  })(v),
  sets: shape({
    id: str, sessionId: str, exerciseId: str, equipmentId: str, idx: num, targetWeight: num, targetReps: num,
    weight: num, reps: num, painFlag: bool, rir: opt(oneOf0(0, 1, 3)), ts: opt(iso), supersetGroup: opt(str),
    setKind: opt(oneOf('working', 'warmup', 'calibration')),
  }),
  runs: shape({
    sessionId: str, kind: oneOf(...RUN_KINDS), distanceMi: num, durationSec: num, intervals: arr(segment),
    rpe: num, painFlag: bool, modality: opt(oneOf(...MODALITIES)), runWalkRatio: opt(str),
  }),
  swims: shape({
    sessionId: str, poolLength: num, poolUnit: oneOf(...POOL_UNITS), distance: num, sets: arr(swimBlock),
    rpe: num, shoulderPainFlag: bool,
  }),
  tests: shape({
    id: str, kind: oneOf('css'), date: iso, poolUnit: oneOf(...POOL_UNITS), t400: opt(num), t200: opt(num), t3x100: opt(num),
  }),
  bodyLogs: shape({ date: localDate, protein: bool, weightLb: opt(num), waistIn: opt(num) }),
  templates: (v) => isRec(v) && (v.ordered === undefined || (v.source === 'saved' && v.type === 'custom' && ordered(v.ordered))) && shape({
    id: str, name: str, type: oneOf(...SESSION_TYPES), blocks: arr(block),
    source: oneOf('generated', 'saved', 'built'), createdAt: iso,
    variant: opt(oneOf('upper-a', 'upper-b', 'lower-a', 'lower-b')),
  })(v),
  feedback: shape({
    id: str, v: (x) => x === 1, ts: iso, kind: oneOf('workout', 'exercise', 'set', 'app'), tags: arr(oneOf(...FEEDBACK_TAGS)), text: str,
    context: shape({ sessionId: opt(str), exerciseId: opt(str), setId: opt(str), equipmentId: opt(str), screen: opt(str), templateId: opt(str) }), ref: opt(str),
  }),
  settings: shape({
    id: oneOf('settings'), goalWeightLb: num, daysPerWeek: num, poolUnit: opt(oneOf(...POOL_UNITS)), poolLength: opt(num),
    activities: opt((v) => Array.isArray(v) && v.length > 0 && activityArray(v)),
    goalDirection: opt(oneOf(...GOAL_DIRECTIONS)),
    weightUnit: oneOf('lb'), distanceUnit: oneOf('mi'), programStart: localDate, onboardedAt: iso,
    backupAt: nullable(iso), updatedAt: iso, startWeightLb: opt(num), appearance: opt(oneOf(...APPEARANCES)),
    soundCues: opt(bool), unavailableEquipment: opt(arr(oneOf(...EQUIPMENT_PREF_IDS))),
  }),
  libraryBlocks: libraryBlock,
};

function oneOf0(...xs: number[]): Check {
  return (v) => typeof v === 'number' && xs.includes(v);
}

/** Throws ImportError naming the store and row index of the first malformed row. */
export function validateRows(store: StoreName, rows: unknown[], snapshot?: BackupSnapshot): void {
  const check = ROW_SHAPES[store];
  rows.forEach((row, i) => {
    if (!check(row, snapshot)) throw new ImportError(`Row ${i + 1} in "${store}" is malformed.`);
  });
}
