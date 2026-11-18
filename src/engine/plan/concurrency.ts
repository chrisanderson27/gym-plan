import {
  BUDGET, HARD_RUN_AFTER_HEAVY_LEGS_H, HARD_SPACING_H, LONG_AFTER_HARD_RUN_H, LOWER_AFTER_HARD_RUN_H, LOWER_AFTER_LOWER_H,
} from '../config';
import type { weeklyBudget } from './budget';
import type { CandidateId, PlanInput, PlanSession, Status } from './types';

export interface CandidateFlags {
  id: CandidateId;
  lower: boolean;
  hardRun: boolean;
  hard: boolean;
  hardCardio: boolean;
  longRun: boolean;
}

const HOUR = 3_600_000;
const name = (s: PlanSession) => {
  if (!s.variant) return s.type[0]!.toUpperCase() + s.type.slice(1);
  const [half, letter] = s.variant.split('-') as [string, string];
  return `${half[0]!.toUpperCase()}${half.slice(1)} ${letter.toUpperCase()}`;
};

/** Hours since a prior session ended (never negative). */
const hoursSince = (s: PlanSession, now: string) => Math.max(0, (new Date(now).getTime() - new Date(s.end).getTime()) / HOUR);

export function concurrency(
  c: CandidateFlags,
  input: PlanInput,
  week: ReturnType<typeof weeklyBudget>,
): { status: Status; reason: string }[] {
  const out: { status: Status; reason: string }[] = [];
  const within = (pred: (s: PlanSession) => boolean, hours: number) =>
    input.sessions.filter(pred).map((s) => ({ s, h: hoursSince(s, input.now) })).filter((x) => x.h < hours).sort((a, b) => a.h - b.h)[0];
  const msg = (x: { s: PlanSession; h: number }, wait: number, what: string) => `${name(x.s)} ${Math.round(x.h)} h ago — ${what} ${wait} h`;

  if (c.lower) {
    const a = within((s) => s.lower, LOWER_AFTER_LOWER_H);
    if (a) out.push({ status: 'blocked', reason: msg(a, LOWER_AFTER_LOWER_H, 'legs wait') });
    const b = within((s) => s.hardRun, LOWER_AFTER_HARD_RUN_H);
    if (b) out.push({ status: 'blocked', reason: msg(b, LOWER_AFTER_HARD_RUN_H, 'legs wait after a hard run') });
  }
  if (c.hardRun) {
    const a = within((s) => s.heavyLegs, HARD_RUN_AFTER_HEAVY_LEGS_H);
    if (a) out.push({ status: 'blocked', reason: msg(a, HARD_RUN_AFTER_HEAVY_LEGS_H, 'no hard run for') });
  }
  if (c.hard) {
    const a = within((s) => s.hard, HARD_SPACING_H);
    if (a) out.push({ status: 'blocked', reason: msg(a, HARD_SPACING_H, 'hard sessions 48 h apart —') });
  }
  if (c.hardCardio) {
    const hard = week.lines.find((l) => l.id === 'hard');
    if (hard && hard.done >= BUDGET.hardCardioMax) out.push({ status: 'blocked', reason: `${hard.done}/${BUDGET.hardCardioMax} hard sessions used this week` });
  }
  if (c.id === 'burn') {
    const a = within((s) => s.heavyLegs, 24);
    if (a) out.push({ status: 'warned', reason: `${name(a.s)} ${Math.round(a.h)} h ago — treadmill blocks after leg day` });
  }
  if (c.longRun) {
    const a = within((s) => s.hardRun, LONG_AFTER_HARD_RUN_H);
    if (a) out.push({ status: 'warned', reason: msg(a, LONG_AFTER_HARD_RUN_H, 'hard run; long run waits') });
  }
  return out;
}
