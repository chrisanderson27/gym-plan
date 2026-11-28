import type { Block, IntervalBlock, LiftBlock, OrderedBlock, StationTarget } from '../data/types';
import { stationWorkSec } from './block/coached';
import { secondsFor } from './block/progression';
import { groupOf, PROFILES, type BlockExerciseShape } from './block/rules';
import { MIN_PER_SET, REST_DEFAULT_SEC, SEC_PER_UNIT, TRANSITION_SEC } from './config';

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

/** Whole minutes for a shortfall, rounded up so the hint never undershoots the 45-minute floor. */
export function shortfallLabel(sec: number) {
  return `${Math.max(1, Math.ceil(sec / 60))} min`;
}

export function orderedBlockSeconds(block: OrderedBlock) {
  if (block.kind === 'run') return block.durationSec;
  if (block.kind !== 'strength') return block.durationSec;
  return block.sets * block.repMax * SEC_PER_UNIT.reps
    + Math.max(0, block.sets - 1) * (block.restSec ?? REST_DEFAULT_SEC);
}

export function orderedDurationSec(blocks: readonly OrderedBlock[]) {
  return blocks.reduce((seconds, block) => seconds + orderedBlockSeconds(block), 0);
}

/** Seconds missing from the shared 45-minute floor. Unrounded: 2700 passes, 2699 does not. */
export function workoutShortfallSec(blocks: readonly OrderedBlock[]) {
  return Math.max(0, FULL_WORKOUT_MIN_SEC - orderedDurationSec(blocks));
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

/** Station blocks loop for their whole clock, so length only reads as realistic against how many rounds it holds. */
export const BLOCK_ROUNDS = { min: 2, target: 3, max: 4 } as const;
export const BLOCK_MAX_STATIONS = 9;
/** The builder still saves anything short of these; past them the block is not a workout anyone would run. */
export const BLOCK_HARD_MAX_ROUNDS = 6;
export const BLOCK_HARD_SAME_GROUP_RUN = 3;
// A block's clock is rounded to 30 s, so its rounds can sit that far either side of the range.
export const ROUND_SLACK_SEC = 30;
const MIN_STATIONS = [{ overSec: 720, min: 5 }, { overSec: 480, min: 4 }] as const;

export interface RoundBlock {
  kind: 'coached' | 'self-paced';
  durationSec: number;
  stations?: readonly { exerciseId: string; target: StationTarget }[];
  workSec?: number;
  restSec?: number;
  transitionSec?: number;
}
export type ExerciseLookup = (id: string) => BlockExerciseShape | undefined;
type Group = ReturnType<typeof groupOf>;

export type BlockIssue =
  | { kind: 'duplicate'; exerciseId: string }
  | { kind: 'too-few-exercises'; count: number; min: number }
  | { kind: 'too-many-exercises'; count: number; max: number }
  | { kind: 'too-many-rounds'; rounds: number }
  | { kind: 'too-few-rounds'; rounds: number }
  | { kind: 'adjacent-group'; group: Group; from: number; length: number }
  | { kind: 'too-much-core'; count: number; max: number }
  | { kind: 'too-few-groups'; count: number; min: number };

/**
 * One pass through every station. A coached station runs its own `sec` or the block's work window, then rest and
 * transition; a self-paced one uses the same per-unit pace the Today generator plans rounds with.
 */
export function blockRoundSeconds(block: RoundBlock, exerciseOf: ExerciseLookup): number | undefined {
  const stations = block.stations ?? [];
  if (stations.length === 0) return undefined;
  if (block.kind === 'coached') {
    if (block.workSec === undefined) return undefined;
    const after = (block.restSec ?? 0) + (block.transitionSec ?? 0);
    return stations.reduce((sec, { target }) => sec + stationWorkSec(target, block.workSec!) + after, 0);
  }
  return stations.reduce((sec, { exerciseId, target }) => {
    const ex = exerciseOf(exerciseId);
    return sec + (ex ? secondsFor(target, ex) : target.amount * SEC_PER_UNIT[target.unit] + TRANSITION_SEC);
  }, 0);
}

export function blockRounds(block: RoundBlock, exerciseOf: ExerciseLookup): number | undefined {
  const round = blockRoundSeconds(block, exerciseOf);
  return round && block.durationSec / round;
}

/** The clock for `rounds` passes, rounded to 30 s and kept inside the 1–60 minute block range. */
export function blockSecondsForRounds(block: Omit<RoundBlock, 'durationSec'>, exerciseOf: ExerciseLookup, rounds: number = BLOCK_ROUNDS.target) {
  const round = blockRoundSeconds({ ...block, durationSec: 0 }, exerciseOf);
  if (!round) return undefined;
  return Math.min(3600, Math.max(60, Math.round((round * rounds) / 30) * 30));
}

/** Cyclic: a rotation walks from its last station straight back to the first. */
function sameGroupRuns(groups: (Group | undefined)[]) {
  const n = groups.length;
  if (n < 2) return [];
  if (groups[0] !== undefined && groups.every((g) => g === groups[0])) return [{ group: groups[0], from: 0, length: n }];
  const start = groups.findIndex((g, i) => g === undefined || g !== groups[(i - 1 + n) % n]);
  const runs: { group: Group; from: number; length: number }[] = [];
  for (let k = 0; k < n;) {
    const from = (start + k) % n;
    const group = groups[from];
    let length = 1;
    while (length < n - k && group !== undefined && groups[(from + length) % n] === group) length++;
    if (group !== undefined && length > 1) runs.push({ group, from, length });
    k += length;
  }
  return runs;
}

/** Realism rules for one station block. Hand-authored presets, the builder and tests share these with the generator's group rules. */
export function blockBalanceIssues(block: RoundBlock, exerciseOf: ExerciseLookup): BlockIssue[] {
  const stations = block.stations ?? [];
  const n = stations.length;
  if (n === 0) return [];
  const issues: BlockIssue[] = [];
  const seen = new Set<string>();
  for (const { exerciseId } of stations) {
    if (seen.has(exerciseId)) issues.push({ kind: 'duplicate', exerciseId });
    seen.add(exerciseId);
  }
  const min = MIN_STATIONS.find(({ overSec }) => block.durationSec > overSec)?.min;
  if (min !== undefined && n < min) issues.push({ kind: 'too-few-exercises', count: n, min });
  if (n > BLOCK_MAX_STATIONS) issues.push({ kind: 'too-many-exercises', count: n, max: BLOCK_MAX_STATIONS });
  const round = blockRoundSeconds(block, exerciseOf);
  if (round) {
    const rounds = block.durationSec / round;
    if (block.durationSec > BLOCK_ROUNDS.max * round + ROUND_SLACK_SEC) issues.push({ kind: 'too-many-rounds', rounds });
    else if (block.durationSec < BLOCK_ROUNDS.min * round - ROUND_SLACK_SEC) issues.push({ kind: 'too-few-rounds', rounds });
  }
  const groups = stations.map(({ exerciseId }) => {
    const ex = exerciseOf(exerciseId);
    return ex && groupOf(ex);
  });
  for (const run of sameGroupRuns(groups)) issues.push({ kind: 'adjacent-group', ...run });
  const core = groups.filter((g) => g === 'core').length;
  const coreMax = Math.max(1, Math.floor(n / 3));
  if (core > coreMax) issues.push({ kind: 'too-much-core', count: core, max: coreMax });
  const distinct = new Set(groups.filter((g) => g !== undefined)).size;
  if (n >= 3 && distinct < PROFILES.lift.minGroups) issues.push({ kind: 'too-few-groups', count: distinct, min: PROFILES.lift.minGroups });
  return issues;
}

/** Issues the builder refuses to save. Every other issue is a warning the user may keep. */
export function isHardBlockIssue(issue: BlockIssue): boolean {
  if (issue.kind === 'too-many-rounds') return issue.rounds > BLOCK_HARD_MAX_ROUNDS;
  if (issue.kind === 'adjacent-group') return issue.length >= BLOCK_HARD_SAME_GROUP_RUN;
  return issue.kind === 'duplicate' || issue.kind === 'too-many-exercises';
}
