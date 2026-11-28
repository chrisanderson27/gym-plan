import { EXERCISES } from './exercises';
import type { Exercise } from './types';

export { EXERCISES } from './exercises';
export { HOME_GYM } from './gym/home-gym';
export { SEED_EQUIPMENT, defaultEquipmentFor } from './equipment';
export { DRILLS } from './drills';
export { LIFT_TEMPLATES } from './lift-templates';
export type * from './types';

export const exerciseById: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));
/** Rep targets for these are per side: "8 reps / side" is 16 reps of work. */
export const PER_SIDE_IDS: ReadonlySet<string> = new Set(['reverse-lunge', 'step-up', 'bulgarian-split-squat', 'dead-bug']);
