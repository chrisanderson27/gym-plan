import type { Equipment } from '../data/types';
import type { EquipmentTag } from './types';

const range = (from: number, to: number, by: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to; v += by) out.push(v);
  return out;
};

export const SEED_EQUIPMENT: Equipment[] = [
  { id: 'dumbbells', name: 'Dumbbells', kind: 'db', steps: [2.5, ...range(5, 100, 5)], builtin: true },
  { id: 'kettlebells', name: 'Kettlebells', kind: 'kb', steps: [10, 15, 18, 20, 25, 30, 35, 40, 44, 50, 53, 62, 70], builtin: true },
  { id: 'barbell-olympic', name: 'Olympic barbell', kind: 'barbell', steps: range(45, 495, 5), builtin: true },
  { id: 'ez-bar', name: 'EZ bar', kind: 'barbell', steps: range(20, 150, 5), builtin: true },
  { id: 'trap-bar', name: 'Trap bar', kind: 'barbell', steps: range(55, 505, 10), builtin: true },
  { id: 'smith-machine', name: 'Smith machine', kind: 'machine', steps: range(0, 400, 10), builtin: true },
  { id: 'cable-stack', name: 'Cable stack', kind: 'cable', steps: range(5, 200, 5), builtin: true },
  { id: 'pin-stack', name: 'Pin-stack machine', kind: 'machine', steps: range(10, 300, 15), builtin: true },
  { id: 'plate-loaded', name: 'Plate-loaded machine', kind: 'machine', steps: range(0, 900, 10), builtin: true },
  { id: 'bodyweight', name: 'Bodyweight', kind: 'bodyweight', steps: [0], builtin: true },
  { id: 'treadmill', name: 'Treadmill', kind: 'cardio', steps: [], builtin: true },
  { id: 'air-bike', name: 'Air bike', kind: 'cardio', steps: [], builtin: true },
  { id: 'rower', name: 'Rower', kind: 'cardio', steps: [], builtin: true },
  { id: 'ski-erg', name: 'SkiErg', kind: 'cardio', steps: [], builtin: true },
  { id: 'stair-climber', name: 'Stair climber', kind: 'cardio', steps: [], builtin: true },
  { id: 'elliptical', name: 'Elliptical', kind: 'cardio', steps: [], builtin: true },
];

/** Which seed equipment to copy when P2 creates a per-machine instance from a tag. Data, not logic. */
const DEFAULT_EQUIPMENT: Record<EquipmentTag, string> = {
  machine: 'pin-stack',
  'plate-loaded': 'plate-loaded',
  barbell: 'barbell-olympic',
  'trap-bar': 'trap-bar',
  smith: 'smith-machine',
  'ez-bar': 'ez-bar',
  db: 'dumbbells',
  sandbag: 'kettlebells',
  kb: 'kettlebells',
  cable: 'cable-stack',
  bodyweight: 'bodyweight',
  bench: 'bodyweight',
  box: 'bodyweight',
  sled: 'plate-loaded',
  trx: 'bodyweight',
  band: 'bodyweight',
  'med-ball': 'bodyweight',
  rope: 'bodyweight',
  'cardio-machine': 'treadmill',
  pool: 'bodyweight',
};

export const defaultEquipmentFor = (tag: EquipmentTag): string => DEFAULT_EQUIPMENT[tag];
