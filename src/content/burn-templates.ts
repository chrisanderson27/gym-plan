import type { CircuitBlock, StationUnit } from '../data/types';

export interface BurnTemplate {
  id: string;
  name: string;
  summary: string;
  blocks: { label: string; minutes: number; role: CircuitBlock['role']; stations: { exerciseId: string; unit?: StationUnit }[] }[];
}

function block(label: string, minutes: number, ...stations: (string | [string, StationUnit])[]): BurnTemplate['blocks'][number] {
  return {
    label, minutes, role: label === 'Finisher' ? 'finisher' : 'block',
    stations: stations.map((station) => typeof station === 'string'
      ? { exerciseId: station } : { exerciseId: station[0], unit: station[1] }),
  };
}

export const BURN_TEMPLATES: BurnTemplate[] = [
  {
    id: 'burn-tread-floor',
    name: 'Sprint + floor',
    summary: '55 min on the turf with sprints, rig work and kettlebells.',
    blocks: [
      block('Block A', 12, ['curve-sprint', 'sec'], 'goblet-squat', 'standing-cable-row', 'push-up'),
      block('Block B', 8, ['air-bike', 'cal'], 'kb-press', 'kb-deadlift'),
      block('Block C', 8, ['rower', 'm'], 'suspension-row', 'step-up'),
      block('Block D', 8, ['ski-erg', 'cal'], 'pallof-press', 'push-up'),
      block('Finisher', 4, 'kb-swing', ['battle-ropes', 'sec'], 'farmer-carry'),
    ],
  },
  {
    id: 'burn-station-circuit',
    name: 'Station circuit',
    summary: '54 min on the turf with ergs, strength work and a medicine-ball finisher.',
    blocks: [
      block('Block A', 12, 'kb-swing', ['ski-erg', 'cal'], 'push-up', 'face-pull'),
      block('Block B', 12, 'goblet-squat', ['rower', 'cal'], 'kb-press', 'suspension-row'),
      block('Block C', 12, 'sled-push', 'step-up', ['air-bike', 'cal'], 'standing-cable-row'),
      block('Finisher', 4, 'med-ball-slam', 'kb-clean', 'push-up'),
    ],
  },
  {
    id: 'burn-strength-hybrid',
    name: 'Strength-biased',
    summary: '55 min on the turf with kettlebells, cables, biking and rowing.',
    blocks: [
      block('Block A', 8, 'goblet-squat', 'standing-cable-row', 'kb-press'),
      block('Block B', 12, ['air-bike', 'cal'], 'step-up', 'push-up', 'suspension-row'),
      block('Block C', 8, 'kb-deadlift', 'face-pull', 'cable-woodchop'),
      block('Block D', 8, ['rower', 'm'], 'farmer-carry', 'bulgarian-split-squat'),
      block('Finisher', 4, 'wall-ball', 'kb-swing', 'pallof-press'),
    ],
  },
];
