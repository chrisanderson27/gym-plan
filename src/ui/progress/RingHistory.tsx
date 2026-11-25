import { streak, weeklyGoal, weekRing } from '../../engine/plan/ring';
import { weekIndex } from '../../engine/week';
import { RING_ACTIVITY_LABELS, RingGraphic } from '../home/Ring';

import type { RingInput } from './WeekCard';

export function RingHistory({ input }: { input: RingInput }) {
  const { sessions, today, programStart, activities } = input;
  const { count, freezeAvailable, weeks } = streak(sessions, programStart, today, activities);
  const goal = weeklyGoal(sessions, today, programStart, activities);
  const current = goal.range;
  const visible = [...weeks.slice(-7), { ...current, closed: false, frozen: false }];
  return (
    <section class="card ring-card" aria-label="Weekly ring history">
      <p class="streak-big num" data-testid="progress-streak">{count}</p>
      <p>week streak</p>
      <p class="dim">{freezeAvailable ? 'Streak freeze available' : 'Streak freeze used recently'}</p>
      <ol class="ring-history num" data-testid="ring-history">
        {visible.map(({ from, to, closed, frozen }) => {
          const ring = from === current.from ? goal : weekRing(sessions, { from, to }, activities);
          const state = from === current.from ? 'current' : closed ? 'closed' : frozen ? 'frozen' : 'open';
          return (
            <li key={from} data-testid="ring-week" data-state={state} aria-current={state === 'current' ? 'date' : undefined}>
              <span>Wk {weekIndex(from, programStart)}</span>
              <RingGraphic ring={ring} />
              <span>{state === 'closed' ? 'closed' : state === 'frozen' ? 'freeze' : `${ring.done}/${ring.target}`}</span>
              <span class="visually-hidden">Goals. {ring.segments.map(({ activity, done, min }) =>
                `${RING_ACTIVITY_LABELS[activity]} ${Math.min(done, min)} of ${min}`).join(', ')}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
