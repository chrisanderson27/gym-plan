import { BUDGET } from '../config';
import { addDays, daysBetween } from '../dates';
import { programWeekRange } from '../lift/volume';
import type { BudgetLine, PlanInput } from './types';

const status = (done: number, min: number, max: number): BudgetLine['status'] => (done < min ? 'under' : done > max ? 'over' : 'met');

export function weeklyBudget(input: PlanInput): { lines: BudgetLine[]; trainingDays: number; daysLeft: number; restDays: number } {
  const { from, to } = programWeekRange(input.today, input.programStart);
  const week = input.sessions.filter((s) => s.day >= from && s.day <= to);
  const line = (id: BudgetLine['id'], label: string, done: number, min: number, max: number): BudgetLine => ({ id, label, done, min, max, status: status(done, min, max) });
  const days = new Set(week.map((s) => s.day));
  let restDays = 0;
  for (let d = from; d < input.today; d = addDays(d, 1)) if (!days.has(d)) restDays++;
  const daysLeft = Math.max(0, daysBetween(input.today, to) + 1);
  const lines = [
    line('hard', 'hard', week.filter((s) => s.hardCardio).length, 0, BUDGET.hardCardioMax),
    line('lifts', 'lifts', week.filter((s) => s.lifted).length, BUDGET.liftsMin, BUDGET.liftsMax),
    line('long', 'long run', week.filter((s) => s.runKind === 'long').length, BUDGET.longRunMin, BUDGET.longRunMax),
    line('swims', 'swims', week.filter((s) => s.type === 'swim').length, BUDGET.swimsMin, BUDGET.swimsMax),
    line('rest', 'rest', restDays, BUDGET.restMin, 7),
  ];
  return { lines, trainingDays: days.size, daysLeft, restDays };
}
