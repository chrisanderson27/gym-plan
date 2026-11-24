import { useState } from 'preact/hooks';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { loadRingInput } from '../../data/plan';
import { addDays, localDate } from '../../engine/dates';
import { weeklyGoal, weekRing } from '../../engine/plan/ring';
import { weekIndex } from '../../engine/week';
import { RING_ACTIVITY_LABELS } from '../home/Ring';
import { WeekStrip } from '../home/WeekStrip';
import { ArrowLeftIcon, ArrowRightIcon } from '../icons';
import { useNow } from '../session/hooks';

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export type RingInput = Awaited<ReturnType<typeof loadRingInput>>;

export function useRingInput() {
  const day = localDate(new Date(useNow(15_000)));
  return useLiveQuery(() => loadRingInput(db), [day]);
}

export function WeekCard({ input, browse = false }: { input: RingInput; browse?: boolean }) {
  const [weeksAgo, setWeeksAgo] = useState(0);
  const { sessions, today, programStart, activities } = input;
  const current = weeklyGoal(sessions, today, programStart, activities);
  const offset = Math.min(weeksAgo, weekIndex(today, programStart) - 1);
  const from = addDays(current.range.from, -7 * offset);
  const to = addDays(from, 6);
  const ring = offset ? weekRing(sessions, { from, to }, activities) : current;
  const date = (day: string) => shortDate.format(new Date(day + 'T12:00:00'));
  return <div class="training-week">
    <section class="training-card" aria-label={offset ? 'Previous program week' : 'Current program week'} data-testid="week-card" data-from={from} data-to={to}>
      <header class="training-section-head"><h2>Your week</h2><span class="training-pill num">{date(from)} – {date(to)}</span></header>
      <WeekStrip from={from} today={today} sessions={sessions} />
      <div class="training-week-goal" data-testid="weekly-goal">
        <div><strong>Weekly goal</strong><span><b>{ring.done} of {ring.target}</b> sessions</span></div>
        <ol role="list" aria-label="Activity goals">
          {ring.segments.map(({ activity, done, min }) => <li key={activity} style={{ flexGrow: min }}>
            <span class="visually-hidden">{RING_ACTIVITY_LABELS[activity]} {Math.min(done, min)} of {min}</span>
            <span aria-hidden="true" style={{ width: `${Math.min(done, min) / min * 100}%` }} />
          </li>)}
        </ol>
      </div>
      {!browse && <a class="training-link" href="#/progress" aria-label="View weekly progress">View progress <ArrowRightIcon /></a>}
    </section>
    {browse && <div class="training-week-controls">
      <button type="button" class="training-link" disabled={offset >= weekIndex(today, programStart) - 1} onClick={() => setWeeksAgo(offset + 1)}>
        <ArrowLeftIcon />{offset ? 'Previous week' : 'View last week'}
      </button>
      {offset > 0 && <button type="button" class="training-link" onClick={() => setWeeksAgo(offset - 1)}>Next week <ArrowRightIcon /></button>}
      {offset > 0 && <button type="button" class="training-link" onClick={() => setWeeksAgo(0)}>This week</button>}
    </div>}
  </div>;
}
