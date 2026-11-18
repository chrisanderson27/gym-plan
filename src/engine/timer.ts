import type { IntervalBlock, TimedPhase } from '../data/types';
import { TIMER_BEEP_LEAD_SEC, TIMER_MAX_BEEP_GAP_SEC } from './config';

export interface TimerStep {
  blockIdx: number;
  round: number;
  phaseIdx: number;
  role: TimedPhase['role'];
  sec: number;
  label: string;
  exerciseId?: string;
  startSec: number;
  endSec: number;
}

/** Expand `rounds × phases` into one flat, time-anchored list. */
export function flatten(blocks: IntervalBlock[]): TimerStep[] {
  const steps: TimerStep[] = [];
  let t = 0;
  blocks.forEach((b, blockIdx) => {
    for (let round = 0; round < b.rounds; round++) {
      b.phases.forEach((p, phaseIdx) => {
        steps.push({
          blockIdx, round, phaseIdx, role: p.role, sec: p.sec, label: p.label,
          ...(p.exerciseId ? { exerciseId: p.exerciseId } : {}),
          startSec: t, endSec: t + p.sec,
        });
        t += p.sec;
      });
    }
  });
  return steps;
}

const totalSecOf = (steps: TimerStep[]) => steps[steps.length - 1]?.endSec ?? 0;

/** Wall-clock anchors only: a suspended tab must never lose time. */
export interface TimerState {
  startedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  /** Time credited by skipping the rest of a step. */
  creditMs: number;
  skipped: number[];
}
export const initialTimer = (): TimerState => ({ startedAt: null, pausedAt: null, pausedMs: 0, creditMs: 0, skipped: [] });

export type TimerAction = { type: 'start' | 'pause' | 'resume' | 'skip' };

export function elapsedMs(state: TimerState, nowMs: number, steps?: TimerStep[]): number {
  if (state.startedAt === null) return 0;
  const frozen = state.pausedAt !== null ? nowMs - state.pausedAt : 0;
  const raw = nowMs - state.startedAt - state.pausedMs - frozen + state.creditMs;
  const max = steps ? totalSecOf(steps) * 1000 : Infinity;
  return Math.min(Math.max(0, raw), max);
}

export function stepIndexAt(steps: TimerStep[], elapsedSec: number): number {
  const i = steps.findIndex((s) => elapsedSec < s.endSec);
  return i === -1 ? steps.length - 1 : i;
}

export function timerReducer(state: TimerState, action: TimerAction, nowMs: number, steps: TimerStep[] = []): TimerState {
  switch (action.type) {
    case 'start':
      return state.startedAt === null ? { ...state, startedAt: nowMs } : state;
    case 'pause':
      return state.startedAt === null || state.pausedAt !== null ? state : { ...state, pausedAt: nowMs };
    case 'resume':
      return state.pausedAt === null ? state : { ...state, pausedAt: null, pausedMs: state.pausedMs + (nowMs - state.pausedAt) };
    case 'skip': {
      if (state.startedAt === null || steps.length === 0) return state;
      const el = elapsedMs(state, nowMs, steps);
      const idx = stepIndexAt(steps, el / 1000);
      const step = steps[idx];
      if (!step || el >= totalSecOf(steps) * 1000) return state;
      return { ...state, creditMs: state.creditMs + (step.endSec * 1000 - el), skipped: [...state.skipped, idx] };
    }
  }
}

export interface TimerView {
  stepIdx: number;
  step: TimerStep | undefined;
  remainingSec: number;
  elapsedSec: number;
  totalSec: number;
  done: boolean;
  roundLabel: string;
  next: string | undefined;
  paused: boolean;
  started: boolean;
}

export function timerView(blocks: IntervalBlock[], steps: TimerStep[], state: TimerState, nowMs: number): TimerView {
  const totalSec = totalSecOf(steps);
  const el = elapsedMs(state, nowMs, steps);
  const done = state.startedAt !== null && el >= totalSec * 1000;
  const stepIdx = stepIndexAt(steps, el / 1000);
  const step = steps[stepIdx];
  const rounds = step ? (blocks[step.blockIdx]?.rounds ?? 1) : 1;
  return {
    stepIdx,
    step,
    remainingSec: step ? Math.max(0, Math.ceil(step.endSec - el / 1000)) : 0,
    elapsedSec: el / 1000,
    totalSec,
    done,
    roundLabel: step ? `${step.round + 1} / ${rounds}` : '',
    next: done ? undefined : steps[stepIdx + 1]?.label,
    paused: state.pausedAt !== null,
    started: state.startedAt !== null,
  };
}

/** Beeps owed for moving from `prevMs` to `nowElapsedMs`. A long jump (resume after suspension) is silent. */
export function beepsBetween(steps: TimerStep[], prevMs: number, elapsedMs_: number): ('tick' | 'go')[] {
  if (elapsedMs_ <= prevMs || elapsedMs_ - prevMs > TIMER_MAX_BEEP_GAP_SEC * 1000) return [];
  const out: ('tick' | 'go')[] = [];
  for (const s of steps) {
    const b = s.endSec * 1000;
    for (let lead = TIMER_BEEP_LEAD_SEC; lead >= 1; lead--) {
      const at = b - lead * 1000;
      if (at > prevMs && at <= elapsedMs_ && at > s.startSec * 1000) out.push('tick');
    }
    if (b > prevMs && b <= elapsedMs_) out.push('go');
  }
  return out;
}

/** Executed copy of the blocks with a `result` on each. */
export function summarize(blocks: IntervalBlock[], steps: TimerStep[], state: TimerState, nowMs: number): IntervalBlock[] {
  const el = elapsedMs(state, nowMs, steps);
  const elSec = el / 1000;
  return blocks.map((b, blockIdx) => {
    const mine = steps.filter((s) => s.blockIdx === blockIdx);
    const start = mine[0]?.startSec ?? 0;
    const end = mine[mine.length - 1]?.endSec ?? 0;
    let spent = 0;
    for (const s of mine) {
      const idx = steps.indexOf(s);
      if (state.skipped.includes(idx)) continue; // skipped time is credit, not effort
      spent += Math.max(0, Math.min(elSec, s.endSec) - s.startSec);
    }
    const skipped = mine.some((s) => state.skipped.includes(steps.indexOf(s)));
    const roundsDone = Array.from({ length: b.rounds }, (_, r) => mine.filter((s) => s.round === r)).filter(
      (rs) => rs.length > 0 && elSec >= (rs[rs.length - 1]?.endSec ?? Infinity) && !rs.some((s) => state.skipped.includes(steps.indexOf(s))),
    ).length;
    return {
      ...b,
      result: { completed: elSec >= end && end > start - 1 && !skipped, actualSec: Math.round(spent), completedRounds: roundsDone, skipped },
    };
  });
}
