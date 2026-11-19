import type { StationUnit } from '../../data/types';
import type { LiftExercise } from '../lift/types';

export interface BlockExerciseShape extends LiftExercise {
  unit: StationUnit | 'steps' | 'amrap';
  unitMin?: number;
  unitMax?: number;
  targets?: StationUnit[];
}

type BlockGroup = 'lower' | 'push' | 'pull' | 'core' | 'cardio';

export const BLOCK_GROUP: Record<string, BlockGroup> = {
  squat: 'lower', hinge: 'lower', lunge: 'lower',
  'horizontal-push': 'push', 'vertical-push': 'push',
  'horizontal-pull': 'pull', 'vertical-pull': 'pull',
  'carry-core': 'core', conditioning: 'cardio',
};
export const FIXED_TAGS = ['machine', 'plate-loaded', 'smith', 'cable', 'bench', 'barbell', 'trap-bar', 'ez-bar'];
export const NO_BLOCK_IDS = ['back-squat', 'conventional-deadlift', 'bench-press'];
export const PROFILES = {
  lift: { minGroups: 3, fixedMax: 1, cardioMax: 1 },
  burn: { minGroups: 3, fixedMax: Infinity, cardioMax: 2 },
};

export function groupOf(ex: BlockExerciseShape): BlockGroup {
  if (ex.group === 'arms') return ex.primary.includes('triceps') ? 'push' : 'pull';
  return BLOCK_GROUP[ex.group]!;
}

export function kitOf(ex: BlockExerciseShape): 'fixed' | 'cardio' | 'portable' {
  if (ex.equipment.includes('cardio-machine')) return 'cardio';
  return ex.equipment.some((tag) => FIXED_TAGS.includes(tag)) ? 'fixed' : 'portable';
}
