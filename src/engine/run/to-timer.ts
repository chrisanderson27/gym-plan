import type { IntervalBlock, RunBlock, RunSegment, TimedPhase } from '../../data/types';
import { RUN_COOLDOWN_SEC, RUN_WARMUP_SEC } from '../config';

const NAMES: Record<RunSegment['role'], string> = { run: 'Run', walk: 'Walk', jog: 'Jog', sprint: 'Sprint', recover: 'Recover' };

function phaseOf(s: RunSegment): TimedPhase {
  const bits = [NAMES[s.role]];
  if (s.rpeTarget) bits.push(`RPE ${s.rpeTarget}`);
  if (s.inclinePct !== undefined) bits.push(`@ ${s.inclinePct}%`);
  return { role: s.role === 'sprint' || s.role === 'run' ? 'work' : 'rest', sec: s.sec ?? 60, label: bits.join(' ') };
}

/**
 * Warm-up and cool-down wrap interval sessions only: an easy or long run is already the whole session,
 * so adding 15 min would break the 1.10× cap the generator just enforced.
 */
export function runToIntervals(block: RunBlock, opts: { warmupSec?: number; cooldownSec?: number } = {}): IntervalBlock[] {
  const main: IntervalBlock = {
    id: `${block.id}-main`, kind: 'interval', label: block.format ?? block.runKind, rounds: block.repeats, phases: block.segments.map(phaseOf),
  };
  if (block.runKind !== 'intervals') return [main];
  const warm = opts.warmupSec ?? RUN_WARMUP_SEC;
  const cool = opts.cooldownSec ?? RUN_COOLDOWN_SEC;
  const out: IntervalBlock[] = [];
  if (warm > 0) out.push({ id: `${block.id}-warm`, kind: 'interval', label: 'Warm-up', rounds: 1, phases: [{ role: 'warmup', sec: warm, label: 'Walk → easy jog' }] });
  out.push(main);
  if (cool > 0) out.push({ id: `${block.id}-cool`, kind: 'interval', label: 'Cool-down', rounds: 1, phases: [{ role: 'cooldown', sec: cool, label: 'Walk it off' }] });
  return out;
}
