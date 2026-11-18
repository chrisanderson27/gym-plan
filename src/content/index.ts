import { EXERCISES } from './exercises';
import type { Exercise } from './types';

export { EXERCISES } from './exercises';
export { SEED_EQUIPMENT, defaultEquipmentFor } from './equipment';
export { DRILLS } from './drills';
export type * from './types';

export const exerciseById: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));
