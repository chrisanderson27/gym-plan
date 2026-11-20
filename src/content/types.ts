import type { MovementGroup, StationUnit } from '../data/types';

export type { MovementGroup, StationUnit } from '../data/types';

export type Muscle =
  | 'quads'
  | 'glutes'
  | 'hamstrings'
  | 'adductors'
  | 'abductors'
  | 'calves'
  | 'chest'
  | 'front-delts'
  | 'side-delts'
  | 'rear-delts'
  | 'lats'
  | 'mid-back'
  | 'traps'
  | 'rotator-cuff'
  | 'biceps'
  | 'brachialis'
  | 'triceps'
  | 'forearms-grip'
  | 'erectors'
  | 'abs'
  | 'obliques'
  | 'deep-core'
  | 'hip-flexors'
  | 'cardio';

export type EquipmentTag =
  | 'machine'
  | 'plate-loaded'
  | 'barbell'
  | 'trap-bar'
  | 'smith'
  | 'ez-bar'
  | 'db'
  | 'kb'
  | 'cable'
  | 'bodyweight'
  | 'bench'
  | 'box'
  | 'sandbag'
  | 'sled'
  | 'trx'
  | 'band'
  | 'med-ball'
  | 'rope'
  | 'cardio-machine'
  | 'pool';

export type Prescription =
  | { unit: 'reps'; min: number; max: number }
  | { unit: 'sec' | 'cal' | 'm' | 'steps' | 'amrap'; min?: number; max?: number };

export interface Exercise {
  /** Permanent kebab-case slug. User rows reference it forever; never rename, flag `retired` instead. */
  id: string;
  name: string;
  group: MovementGroup;
  equipment: EquipmentTag[];
  primary: Muscle[];
  secondary: Muscle[];
  repClass: 'compound' | 'machine' | 'isolation' | 'other';
  prescription: Prescription;
  targets?: StationUnit[];
  jointFriendly: boolean;
  impact: 'none' | 'low' | 'med' | 'high';
  cues: string[];
  substitutes: string[];
  poseId?: string;
  retired?: boolean;
}

export type GymConfidence = 'C' | 'L' | 'G';
export interface GymZone {
  id: string;
  floor: number;
  label?: 'turf' | 'free weights' | 'cardio deck' | 'rack room';
  neighbours: string[];
}
export interface GymItem {
  id: string;
  floor: number;
  zone: string;
  type: string;
  count: number;
  confidence: GymConfidence;
  exercises: string[];
  verified: boolean;
  pending?: true;
}
export interface GymPod { id: string; zone: string; items: string[] }
export interface GymProfile { id: 'home-gym'; zones: GymZone[]; items: GymItem[]; pods: GymPod[] }

export interface Drill {
  id: string;
  name: string;
  cue: string;
  focus: 'catch' | 'rotation' | 'kick' | 'breathing' | 'recovery' | 'feel';
  finsRecommended: 'yes' | 'no' | 'optional';
  difficulty: 1 | 2 | 3;
}

// ---- Poses: mirror of engine/pose.ts, kept structural by the eslint fence (content may not import engine) ----
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
  prop?: 'bench' | 'incline' | 'seat' | 'floor' | 'none';
  cable?: { x: number; y: number };
}
