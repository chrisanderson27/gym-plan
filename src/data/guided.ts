import { coachedSchedule } from '../engine/block/coached';
import { selfPacedSchedule } from '../engine/templates';
import { blockExerciseOf } from './liftday';
import type { EffectiveStation, ExecutableCoachedBlock, OrderedBlock } from './types';

/**
 * The phase plan a block's checkpoint walks: a rotation's fixed work windows, or a guided circuit's estimated pace.
 * Skipped stations drop out. Other blocks have no plan.
 */
export function guidedSchedule(block: OrderedBlock, stations: readonly EffectiveStation[]) {
  const lineup = stations.filter((s) => !s.skipped);
  if (block.kind === 'coached' && block.stations) return coachedSchedule(block as ExecutableCoachedBlock, lineup);
  if (block.kind === 'self-paced') return selfPacedSchedule(lineup, blockExerciseOf);
  return undefined;
}
