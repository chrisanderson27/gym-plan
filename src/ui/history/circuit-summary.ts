import type { CircuitBlock } from '../../data/types';
import { circuitWork } from '../../engine/block/work';

export function circuitSummary(block: CircuitBlock): string {
  const { log } = block;
  if (!log) return 'not logged';
  const summary = [`${log.completedRounds} rounds`];
  if (log.partialReps) {
    const partial = circuitWork({ ...block, log: { ...log, completedRounds: 0 } });
    for (const { amount, unit } of partial?.perStation ?? []) {
      if (amount > 0) summary.push(`${amount} ${unit}`);
    }
  }
  return summary.join(' + ');
}
