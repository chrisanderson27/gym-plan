import { LIFT_TEMPLATES, exerciseById } from '../content';
import type { EquipmentTag, Muscle } from '../content';
import type { CardioModality, RunKind } from '../data/types';
import { CARDIO_MODALITY_LABELS } from '../engine/config';

/** Display helpers: ids stay in storage, they are mapped to names only when rendered. */

const VARIANT_RE = /\b(?:upper|lower)-[ab]\b/g;

export const variantName = (v: string): string => (v in LIFT_TEMPLATES ? LIFT_TEMPLATES[v as keyof typeof LIFT_TEMPLATES].name : v);

export const exerciseName = (id: string): string => exerciseById.get(id)?.name ?? id;

/** "After lower-a: upper-b" -> "After Lower A: Upper B". Free text passes through otherwise unchanged. */
export const humanize = (text: string): string => text.replace(VARIANT_RE, (m) => variantName(m));

/** "too-easy" -> "Too easy". */
export const tagLabel = (tag: string): string => {
  const s = tag.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const sessionTypeLabel = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

export const MUSCLE_LABELS: Record<Muscle, string> = {
  quads: 'Quads',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  adductors: 'Adductors',
  abductors: 'Abductors',
  calves: 'Calves',
  chest: 'Chest',
  'front-delts': 'Front delts',
  'side-delts': 'Side delts',
  'rear-delts': 'Rear delts',
  lats: 'Lats',
  'mid-back': 'Mid back',
  traps: 'Traps',
  'rotator-cuff': 'Rotator cuff',
  biceps: 'Biceps',
  brachialis: 'Brachialis',
  triceps: 'Triceps',
  'forearms-grip': 'Forearms and grip',
  erectors: 'Erectors',
  abs: 'Abs',
  obliques: 'Obliques',
  'deep-core': 'Deep core',
  'hip-flexors': 'Hip flexors',
  cardio: 'Cardio',
};

export const EQUIPMENT_TAG_LABELS: Record<EquipmentTag, string> = {
  machine: 'Machine',
  'plate-loaded': 'Plate-loaded',
  barbell: 'Barbell',
  'trap-bar': 'Trap bar',
  smith: 'Smith machine',
  'ez-bar': 'EZ bar',
  db: 'Dumbbell',
  kb: 'Kettlebell',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  bench: 'Bench',
  box: 'Box',
  sandbag: 'Sandbag',
  sled: 'Sled',
  trx: 'TRX',
  band: 'Band',
  'med-ball': 'Medicine ball',
  rope: 'Rope',
  'cardio-machine': 'Cardio machine',
  pool: 'Pool',
};

export const MODALITY_LABELS: Record<CardioModality, string> = CARDIO_MODALITY_LABELS;

export const RUN_KIND_LABELS: Record<RunKind, string> = { easy: 'Easy', long: 'Long', intervals: 'Intervals' };

export const muscleName = (id: string): string => MUSCLE_LABELS[id as Muscle] ?? tagLabel(id);
export const equipmentTagName = (id: string): string => EQUIPMENT_TAG_LABELS[id as EquipmentTag] ?? tagLabel(id);
export const modalityName = (id: string): string => MODALITY_LABELS[id as CardioModality] ?? tagLabel(id);
export const runKindName = (id: string): string => RUN_KIND_LABELS[id as RunKind] ?? tagLabel(id);

/** Whole minutes read as "30 min", sub-minute as "45 s", the rest as "1 min 30 s". */
export function durationLabel(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}

const SCREEN_NAMES: [RegExp, string][] = [
  [/^\/lift\/session(\/|$)/, 'Lift session'],
  [/^\/lift\/volume/, 'Weekly volume'],
  [/^\/lift\/gym/, 'My gym'],
  [/^\/lift/, 'Lift'],
  [/^\/hybrid\/cardio(\/|$)/, 'Hybrid cardio'],
  [/^\/hybrid\/session(\/|$)/, 'Hybrid session'],
  [/^\/hybrid/, 'Hybrid'],
  [/^\/burn/, 'Burn'],
  [/^\/run/, 'Run'],
  [/^\/swim\/css/, 'CSS test'],
  [/^\/swim/, 'Swim'],
  [/^\/history\/.+/, 'History detail'],
  [/^\/history/, 'History'],
  [/^\/builder/, 'Builder'],
  [/^\/mine\//, 'Saved workout'],
  [/^\/again\//, 'Do this again'],
  [/^\/weigh-in/, 'Weigh-in'],
  [/^\/progress/, 'Progress'],
  [/^\/settings/, 'Settings'],
];

/** "#/lift/session/01M7…" -> "Lift session". Never leaks ids or hashes. */
export function screenName(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') return 'Home';
  return SCREEN_NAMES.find(([re]) => re.test(path))?.[1] ?? 'App';
}
