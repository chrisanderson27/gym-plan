import { BUDGET, RING_FALLBACK_MIN_DAYS } from '../config';
import { addDays } from '../dates';
import { programWeekRange } from '../lift/volume';
import { activityOf, enabled, type Activity } from './activities';
import type { PlanInput, PlanSession } from './types';

type Range = ReturnType<typeof programWeekRange>;
interface RingSegment { activity: Activity; done: number; min: number }

/** The program-week activity goal Today, Progress, and the finish summary already share. */
export function weeklyGoal(
  sessions: readonly PlanSession[],
  day: Range['from'],
  programStart: Range['from'],
  activities?: PlanInput['activities'],
) {
  const range = programWeekRange(day, programStart);
  return { range, ...weekRing(sessions, range, activities) };
}

export function weekRing(sessions: readonly PlanSession[], { from, to }: Range, activities?: PlanInput['activities']) {
  const week = sessions.filter((s) => s.finished && s.day >= from && s.day <= to);
  const lines: RingSegment[] = [
    { activity: 'lift', done: week.filter((s) => s.lifted).length, min: BUDGET.liftsMin },
    { activity: 'run', done: week.filter((s) => s.runKind === 'long').length, min: BUDGET.longRunMin },
    { activity: 'swim', done: week.filter((s) => s.type === 'swim').length, min: BUDGET.swimsMin },
  ];
  const active = enabled(activities);
  const segments = lines.filter((line) => active.includes(line.activity));
  if (!segments.length) {
    const days = new Set(week.filter((s) => activityOf(s.type) === 'burn' && active.includes('burn')).map((s) => s.day));
    segments.push({ activity: 'burn', done: days.size, min: RING_FALLBACK_MIN_DAYS });
  }
  const done = segments.reduce((sum, line) => sum + Math.min(line.done, line.min), 0);
  const target = segments.reduce((sum, line) => sum + line.min, 0);
  return { segments, done, target, closed: done >= target };
}

export function streak(sessions: readonly PlanSession[], programStart: Range['from'], today: Range['from'], activities?: PlanInput['activities']) {
  const current = programWeekRange(today, programStart);
  const weeks: (Range & { closed: boolean; frozen: boolean })[] = [];
  let count = 0;
  let nextFreeze = programStart;
  for (let from = programStart; from < current.from; from = addDays(from, 7)) {
    const to = addDays(from, 6);
    const { closed } = weekRing(sessions, { from, to }, activities);
    const frozen = !closed && from >= nextFreeze;
    if (frozen) nextFreeze = addDays(from, 28);
    weeks.push({ from, to, closed, frozen });
    count = closed || frozen ? count + 1 : 0;
  }
  if (weekRing(sessions, current, activities).closed) count++;
  return { weeks, count, freezeAvailable: current.from >= nextFreeze };
}
