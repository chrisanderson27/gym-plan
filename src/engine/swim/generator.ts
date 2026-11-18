import type { ISODateTime, PoolUnit, SwimItem, SwimSetBlock } from '../../data/types';
import { SWIM_PADDLES_FROM_WEEK, SWIM_REST_SEC } from '../config';
import type { Css } from './css';
import { sendoffSec } from './sendoff';

export interface SwimInput {
  blocks: SwimSetBlock[];
  css: Css | null;
  poolLength: number;
  poolUnit: PoolUnit;
  weekIdx: number;
  /** Injected: the engine cannot import data/ids. */
  makeId: () => string;
}
export interface SwimPlan {
  blocks: SwimSetBlock[];
  totalDistance: number;
  usesSendoffs: boolean;
  prompts: string[];
}

/** Nearest pool multiple, never less than one length. */
export const roundToPool = (distance: number, poolLength: number): number =>
  Math.max(1, Math.round(distance / poolLength)) * poolLength;

export function generateSwim({ blocks, css, poolLength, weekIdx, makeId }: SwimInput): SwimPlan {
  const prompts: string[] = [];
  let usesSendoffs = false;
  const out = blocks.map((b): SwimSetBlock => ({
    ...b,
    id: makeId(),
    items: b.items.map((it): SwimItem => {
      const distance = roundToPool(it.distance, poolLength);
      const equipment = weekIdx < SWIM_PADDLES_FROM_WEEK ? it.equipment.filter((e) => e !== 'paddles') : [...it.equipment];
      const send = css ? sendoffSec({ ...it, distance }, css.per100) : null;
      if (send !== null) {
        usesSendoffs = true;
        return { ...it, distance, equipment, mode: 'sendoff', seconds: send };
      }
      return { ...it, distance, equipment, mode: 'rest', seconds: SWIM_REST_SEC[it.intensity] };
    }),
  }));
  if (!css) prompts.push('Take the CSS test to get send-offs');
  else if (css.estimate) prompts.push('Send-offs from an estimate');
  else if (css.approx) prompts.push('Send-offs are approximate: your CSS test was in the other pool unit');
  const totalDistance = out.reduce((n, b) => n + b.rounds * b.items.reduce((m, i) => m + i.reps * i.distance, 0), 0);
  return { blocks: out, totalDistance, usesSendoffs, prompts };
}

/** Least recently done workout the current week unlocks; ties go to list order. */
export function nextSwimWorkout(
  defs: { id: string; minWeek: number }[],
  weekIdx: number,
  lastDone: Record<string, ISODateTime | undefined>,
): string {
  const eligible = defs.filter((d) => d.minWeek <= weekIdx);
  const pool = eligible.length > 0 ? eligible : defs.slice(0, 1);
  let best = pool[0]?.id ?? '';
  for (const d of pool.slice(1)) if ((lastDone[d.id] ?? '') < (lastDone[best] ?? '')) best = d.id;
  return best;
}
