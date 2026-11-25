import { GymDb } from './db';
import { FULL_WORKOUT_MIN_SEC, orderedDurationSec } from '../engine/templates';
import { newId } from './ids';
import type { OrderedBlock } from './types';

/** Each test opens its own throwaway database. */
export const openTestDb = (): GymDb => new GymDb('t-' + newId());

/** Appends an inert recovery block so a short fixture clears the 45-minute floor without changing its leading blocks. */
export function floored<T extends OrderedBlock>(blocks: T[]): (T | OrderedBlock)[] {
  const need = Math.min(3600, Math.max(0, FULL_WORKOUT_MIN_SEC - orderedDurationSec(blocks)));
  return need > 0 ? [...blocks, { id: 'floor-pad', kind: 'recovery', durationSec: need, instructions: 'Easy.' }] : blocks;
}
