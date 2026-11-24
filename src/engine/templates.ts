import type { Block, IntervalBlock, LiftBlock, OrderedBlock } from '../data/types';
import { MIN_PER_SET, REST_DEFAULT_SEC, SEC_PER_UNIT } from './config';

/** Fresh ids; no `result`; lift blocks drop the old target weight and the calibration label; superset groups are remapped. */
export function toTemplateBlocks(blocks: Block[], makeId: () => string): Block[] {
  const groups = new Map<string, string>();
  return blocks.map((b): Block => {
    const { result: _result, ...rest } = b;
    void _result;
    const copy = { ...rest, id: makeId() } as Block;
    if (copy.kind !== 'lift') return copy;
    const { targetWeight: _w, ...lift } = copy;
    void _w;
    if (lift.label === 'Calibration') delete lift.label;
    if (lift.supersetGroup) {
      if (!groups.has(lift.supersetGroup)) groups.set(lift.supersetGroup, makeId());
      lift.supersetGroup = groups.get(lift.supersetGroup)!;
    }
    return lift;
  });
}

export function moveBlock<T extends { id: string }>(blocks: T[], id: string, dir: -1 | 1): T[] {
  const i = blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const out = [...blocks];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function pairWithNext(blocks: LiftBlock[], id: string, makeId: () => string): LiftBlock[] {
  const i = blocks.findIndex((b) => b.id === id);
  const a = blocks[i];
  const b = blocks[i + 1];
  if (!a || !b || a.supersetGroup || b.supersetGroup) return blocks;
  const group = makeId();
  return blocks.map((x) => (x.id === a.id || x.id === b.id ? { ...x, supersetGroup: group } : x));
}

export function unpair(blocks: LiftBlock[], id: string): LiftBlock[] {
  const g = blocks.find((b) => b.id === id)?.supersetGroup;
  if (!g) return blocks;
  return blocks.map((b) => {
    if (b.supersetGroup !== g) return b;
    const { supersetGroup: _g, ...rest } = b;
    void _g;
    return rest;
  });
}

export function removeBlock(blocks: LiftBlock[], id: string): LiftBlock[] {
  const g = blocks.find((b) => b.id === id)?.supersetGroup;
  const rest = blocks.filter((b) => b.id !== id);
  const partner = g ? rest.find((b) => b.supersetGroup === g) : undefined;
  return partner ? unpair(rest, partner.id) : rest;
}

export function newLiftBlock(ex: { id: string; repMin: number; repMax: number }, makeId: () => string): LiftBlock {
  return { id: makeId(), kind: 'lift', exerciseId: ex.id, sets: 3, repMin: ex.repMin, repMax: ex.repMax, restSec: 90 };
}

const intervalSec = (b: IntervalBlock) => b.rounds * b.phases.reduce((n, p) => n + p.sec, 0);

export const FULL_WORKOUT_MIN_SEC = 45 * 60;

export function orderedBlockSeconds(block: OrderedBlock) {
  if (block.kind !== 'strength') return block.durationSec;
  return block.sets * block.repMax * SEC_PER_UNIT.reps
    + Math.max(0, block.sets - 1) * (block.restSec ?? REST_DEFAULT_SEC);
}

export function orderedDurationSec(blocks: readonly OrderedBlock[]) {
  return blocks.reduce((seconds, block) => seconds + orderedBlockSeconds(block), 0);
}

export function orderedBlockMinutes(block: OrderedBlock) {
  return orderedBlockSeconds(block) / 60;
}

export function orderedDurationMin(blocks: readonly OrderedBlock[]) {
  return Math.round(orderedDurationSec(blocks) / 60);
}

export function templateDurationMin(blocks: Block[]): number {
  let min = 0;
  for (const b of blocks) {
    if (b.kind === 'interval') min += intervalSec(b) / 60;
    else if (b.kind === 'lift') min += b.warmup ? 7 : b.sets * MIN_PER_SET.other;
    else if (b.kind === 'circuit') min += b.durationSec / 60;
    else if (b.kind === 'run') min += (b.repeats * b.segments.reduce((n, s) => n + (s.sec ?? 0), 0)) / 60;
  }
  return Math.round(min);
}
