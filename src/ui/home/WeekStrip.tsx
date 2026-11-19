import { addDays } from '../../engine/dates';
import { activityOf } from '../../engine/plan/activities';
import type { PlanSession } from '../../engine/plan/types';
import { sessionTypeLabel } from '../labels';

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

export function WeekStrip({ from, today, sessions }: { from: string; today: string; sessions: PlanSession[] }) {
  return (
    <ol class="week-strip" aria-label="Program week" data-testid="week-strip">
      {Array.from({ length: 7 }, (_, offset) => {
        const day = addDays(from, offset);
        const name = weekday.format(new Date(day + 'T12:00:00'));
        const finished = sessions.filter((s) => s.day === day && s.finished);
        const completed = [...new Set(finished.map((s) => s.type))];
        return (
          <li key={day} aria-current={day === today ? 'date' : undefined}>
            <span aria-hidden="true">{name[0]}</span>
            <span class="visually-hidden">{name}, {completed.length ? completed.map(sessionTypeLabel).join(', ') : 'no workout'}</span>
            <span class="week-dots" aria-hidden="true">
              {completed.length ? completed.map((type) => <i key={type} data-activity={activityOf(type)} class="done" />) : <i />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
