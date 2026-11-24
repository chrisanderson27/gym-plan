import { BUDGET } from '../config';
import { daysBetween } from '../dates';
import { activityOf, enabled } from './activities';
import { weeklyBudget } from './budget';
import { concurrency, type CandidateFlags } from './concurrency';
import type { BudgetLine, Candidate, CandidateId, PlanInput, PlanSession, Status } from './types';

const ORDER: Status[] = ['eligible', 'warned', 'blocked'];
const worst = (a: Status, b: Status): Status => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
const cap = (v: string) => `${v[0]!.toUpperCase()}${v.slice(1, v.indexOf('-'))} ${v.slice(-1).toUpperCase()}`;

interface Def extends CandidateFlags {
  tile: Candidate['tile'];
  title: (i: PlanInput) => string;
  route: (i: PlanInput) => string;
  half?: 'upper' | 'lower';
  advances?: BudgetLine['id'];
  last: (s: PlanSession) => boolean;
}

const f = (id: CandidateId, o: Partial<CandidateFlags> = {}): CandidateFlags => ({ id, lower: false, hardRun: false, hard: false, hardCardio: false, longRun: false, ...o });
const liftSide = (half: 'upper' | 'lower') => (s: PlanSession) => s.lifted && s.lower === (half === 'lower');

const DEFS: Def[] = [
  { ...f('lift-upper'), tile: 'lift', half: 'upper', advances: 'lifts', title: (i) => cap(i.lift.upper.variant), route: (i) => `#/lift/start/${i.lift.upper.variant}`, last: liftSide('upper') },
  { ...f('lift-lower', { lower: true }), tile: 'lift', half: 'lower', advances: 'lifts', title: (i) => cap(i.lift.lower.variant), route: (i) => `#/lift/start/${i.lift.lower.variant}`, last: liftSide('lower') },
  { ...f('hybrid-upper'), tile: 'hybrid', half: 'upper', advances: 'lifts', title: (i) => `Hybrid · ${cap(i.lift.upper.variant)}`, route: (i) => `#/hybrid/${i.lift.upper.variant}`, last: liftSide('upper') },
  { ...f('hybrid-lower', { lower: true }), tile: 'hybrid', half: 'lower', advances: 'lifts', title: (i) => `Hybrid · ${cap(i.lift.lower.variant)}`, route: (i) => `#/hybrid/${i.lift.lower.variant}`, last: liftSide('lower') },
  { ...f('burn', { hard: true, hardCardio: true }), tile: 'burn', title: () => 'Burn class', route: () => '#/burn', last: (s) => s.type === 'burn' },
  { ...f('run-easy'), tile: 'run', title: () => 'Easy run', route: () => '#/run/easy', last: (s) => s.type === 'run' && s.runKind === 'easy' },
  { ...f('run-long', { longRun: true }), tile: 'run', advances: 'long', title: () => 'Long run', route: () => '#/run/long', last: (s) => s.runKind === 'long' },
  { ...f('run-intervals', { hard: true, hardCardio: true, hardRun: true }), tile: 'run', title: () => 'Intervals', route: () => '#/run/intervals', last: (s) => s.type === 'run' && s.runKind === 'intervals' },
  { ...f('swim'), tile: 'swim', advances: 'swims', title: () => 'Swim', route: () => '#/swim', last: (s) => s.type === 'swim' },
  { ...f('rest'), tile: 'rest', title: () => 'Rest day', route: () => '#/weigh-in', last: () => false },
];

export interface Ranked {
  pick: Candidate;
  candidates: Candidate[];
  budget: BudgetLine[];
  why: string;
  reason: string;
}

export function rankToday(input: PlanInput, { recommendWorkout = false } = {}): Ranked {
  const cold = !input.hasLiftHistory && input.sessions.length === 0;
  const week = weeklyBudget(input);
  const line = (id: BudgetLine['id']) => week.lines.find((l) => l.id === id)!;

  const activities = enabled(input.activities);
  if (activities.includes('lift') && cold && !recommendWorkout) {
    const pick: Candidate = {
      id: 'lift-lower', tile: 'lift', title: 'Lower A (calibration)', route: '#/lift/calibrate/lower-a', variant: 'lower-a', status: 'eligible',
      reasons: ['No history yet — calibrate first'], score: { unmet: 0, daysSince: Infinity, readyHoursLeft: 0 },
    };
    const reason = pick.reasons[0]!;
    return { pick, candidates: [pick], budget: week.lines, why: reason, reason };
  }

  const trainedToday = input.sessions.some((s) => s.finished && s.day === input.today);
  const full = week.trainingDays >= input.daysPerWeek;

  const candidates: Candidate[] = DEFS.filter(({ id }) => {
    const activity = activityOf(id);
    return !activity || activities.includes(activity);
  }).map((d) => {
    const reasons: string[] = [];
    let status: Status = 'eligible';
    const mark = (s: Status, r: string) => { status = worst(status, s); reasons.push(r); };
    const isRest = d.id === 'rest';

    if (!isRest) {
      for (const c of concurrency(d, input, week)) mark(c.status, c.reason);
      if (d.tile === 'lift' || d.tile === 'hybrid') {
        if (line('lifts').done >= BUDGET.liftsMax) mark('warned', `${line('lifts').done}/${BUDGET.liftsMax} lifts done`);
        const r = input.lift[d.half!];
        if (!r.ready) mark('warned', `ready in ${r.hoursLeft} h${r.blocking.length ? ': ' + r.blocking.join(', ') : ''}`);
      }
      if (d.longRun && line('long').done >= BUDGET.longRunMax) mark('warned', 'long run already done');
      if (d.id === 'swim' && line('swims').done >= BUDGET.swimsMax) mark('warned', `${line('swims').done}/${BUDGET.swimsMax} swims done`);
      if (full) mark('warned', `${week.trainingDays}/${input.daysPerWeek} training days used`);
      if (trainedToday) mark('warned', 'already trained today');
    }

    const lastDay = input.sessions.filter(d.last).map((s) => s.day).sort().at(-1);
    const daysSince = isRest ? 0 : lastDay ? daysBetween(lastDay, input.today) : Infinity;
    const advancing = d.advances ? line(d.advances) : undefined;
    const unmet = advancing?.status === 'under' ? 1 : 0;

    if (isRest) {
      const due = (line('rest').status === 'under' && week.daysLeft <= BUDGET.restMin - week.restDays) || full;
      if (due) reasons.push(full ? 'training days used up' : 'no rest day yet this week');
      else mark('warned', 'rest optional');
      status = due ? 'eligible' : 'warned';
    } else if (status === 'eligible') {
      if (advancing && unmet) reasons.push(`${advancing.done}/${advancing.min} ${advancing.label}`);
      else if (daysSince === Infinity) reasons.push(`never done ${d.tile}`);
      else reasons.push(`${daysSince} days since last ${d.tile}`);
    }

    const half = d.half ? input.lift[d.half] : undefined;
    const variant = d.half ? input.lift[d.half].variant : undefined;
    return {
      id: d.id, tile: d.tile, title: d.title(input), route: d.route(input), ...(variant ? { variant } : {}), status, reasons,
      score: { unmet: isRest ? (status === 'eligible' ? 1 : 0) : unmet, daysSince, readyHoursLeft: half?.hoursLeft ?? 0 },
    };
  });

  const orderOf = (c: Candidate) => DEFS.findIndex((d) => d.id === c.id);
  candidates.sort((a, b) =>
    ORDER.indexOf(a.status) - ORDER.indexOf(b.status)
    || b.score.unmet - a.score.unmet
    || (b.score.daysSince === a.score.daysSince ? 0 : b.score.daysSince > a.score.daysSince ? 1 : -1)
    || a.score.readyHoursLeft - b.score.readyHoursLeft
    || (cold && recommendWorkout ? Number(b.id === 'lift-lower') - Number(a.id === 'lift-lower') : 0)
    || orderOf(a) - orderOf(b));

  const pick = candidates.find((c) => c.status !== 'blocked')!;
  const hard = line('hard');
  const reason = pick.reasons.find((r) => !/\d h ago/.test(r)) ?? pick.reasons[0] ?? 'next up';
  const why = `${reason} · ${hard.done}/${hard.max} hard used`;
  return { pick, candidates, budget: week.lines, why, reason };
}
