import { ImportError } from './errors';
import type { StoreName } from './stores';

type Rec = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str: Check = (v) => typeof v === 'string';
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const bool: Check = (v) => typeof v === 'boolean';
const arr = (item: Check): Check => (v) => Array.isArray(v) && v.every(item);
const oneOf = (...xs: string[]): Check => (v) => typeof v === 'string' && xs.includes(v);
const nullable = (c: Check): Check => (v) => v === null || c(v);
const iso: Check = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const localDate: Check = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const opt = (c: Check): Check => (v) => v === undefined || c(v);

/** Every listed field must be present with the right type; absent/mistyped optional fields are rejected too. */
const shape = (fields: Record<string, Check>): Check => (v) =>
  isRec(v) && Object.entries(fields).every(([k, c]) => c(v[k]));

const SESSION_TYPES = ['lift', 'burn', 'run', 'swim', 'hybrid', 'custom'];
const POOL_UNITS = ['yd', 'm'];
const MODALITIES = ['run', 'treadmill', 'bike', 'row', 'ski', 'stair', 'elliptical'];
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
const block: Check = (v) => {
  if (!isRec(v) || !str(v.id)) return false;
  switch (v.kind) {
    case 'interval': return shape({ rounds: num, phases: arr(phase) })(v);
    case 'lift':
      return shape({
        exerciseId: str, sets: num, repMin: num, repMax: num,
        equipmentId: opt(str), targetWeight: opt(num), restSec: opt(num), rirTarget: opt(num), supersetGroup: opt(str),
      })(v);
    case 'swim': return swimBlock(v);
    case 'run':
      return shape({ runKind: oneOf(...RUN_KINDS), modality: oneOf(...MODALITIES), repeats: num, segments: arr(segment) })(v);
    default: return false;
  }
};

const ROW_SHAPES: Record<StoreName, Check> = {
  exerciseOverrides: shape({ exerciseId: str, notAtMyGym: bool, preferredEquipmentId: opt(str) }),
  equipment: shape({
    id: str, name: str, kind: oneOf('machine', 'barbell', 'db', 'kb', 'cable', 'cardio', 'bodyweight'), steps: arr(num),
  }),
  sessions: shape({
    id: str, date: iso, type: oneOf(...SESSION_TYPES), blocks: arr(block), hard: bool, hardCardio: bool,
    rpe: nullable(num), durationMin: num, notes: str, templateId: opt(str), endedAt: opt(iso),
  }),
  sets: shape({
    id: str, sessionId: str, exerciseId: str, equipmentId: str, idx: num, targetWeight: num, targetReps: num,
    weight: num, reps: num, painFlag: bool, rir: opt(oneOf0(0, 1, 3)), ts: opt(iso),
  }),
  runs: shape({
    sessionId: str, kind: oneOf(...RUN_KINDS), distanceMi: num, durationSec: num, intervals: arr(segment),
    rpe: num, painFlag: bool, modality: opt(oneOf(...MODALITIES)),
  }),
  swims: shape({
    sessionId: str, poolLength: num, poolUnit: oneOf(...POOL_UNITS), distance: num, sets: arr(swimBlock),
    rpe: num, shoulderPainFlag: bool,
  }),
  tests: shape({
    id: str, kind: oneOf('css'), date: iso, poolUnit: oneOf(...POOL_UNITS), t400: opt(num), t200: opt(num), t3x100: opt(num),
  }),
  bodyLogs: shape({ date: localDate, protein: bool, weightLb: opt(num), waistIn: opt(num) }),
  templates: shape({
    id: str, name: str, type: oneOf(...SESSION_TYPES), blocks: arr(block),
    source: oneOf('generated', 'saved', 'built'), createdAt: iso,
  }),
  feedback: shape({
    id: str, v: (x) => x === 1, ts: iso, kind: oneOf('workout', 'exercise', 'set', 'app'), tags: arr(str), text: str,
    context: isRec, ref: opt(str),
  }),
  settings: shape({
    id: oneOf('settings'), goalWeightLb: num, daysPerWeek: num, poolUnit: oneOf(...POOL_UNITS), poolLength: num,
    weightUnit: oneOf('lb'), distanceUnit: oneOf('mi'), programStart: localDate, onboardedAt: iso,
    backupAt: nullable(iso), updatedAt: iso, startWeightLb: opt(num),
  }),
};

function oneOf0(...xs: number[]): Check {
  return (v) => typeof v === 'number' && xs.includes(v);
}

/** Throws ImportError naming the store and row index of the first malformed row. */
export function validateRows(store: StoreName, rows: unknown[]): void {
  const check = ROW_SHAPES[store];
  rows.forEach((row, i) => {
    if (!check(row)) throw new ImportError(`Row ${i + 1} in "${store}" is malformed.`);
  });
}
