import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { loadRingInput } from '../../data/plan';
import { programWeekRange } from '../../engine/lift/volume';
import { streak, weekRing } from '../../engine/plan/ring';
import { weekIndex } from '../../engine/week';

const segmentLabels = { lift: 'Lifts', run: 'Long runs', swim: 'Swims', burn: 'Training days' };

function MiniRing({ ring }: { ring: ReturnType<typeof weekRing> }) {
  let offset = 0;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      {ring.segments.map(({ activity, done, min }) => {
        const length = min / ring.target * 100;
        const track = length - 3;
        const fill = Math.min(done / min * length, track);
        const start = offset;
        offset += length;
        return (
          <g key={activity} data-activity={activity} transform="rotate(-90 16 16)">
            <circle class="ring-track" cx="16" cy="16" r="12" pathLength="100"
              stroke-dasharray={`${track} ${100 - track}`} stroke-dashoffset={-start} />
            {fill > 0 && <circle class="ring-fill" cx="16" cy="16" r="12" pathLength="100"
              stroke-dasharray={`${fill} ${100 - fill}`} stroke-dashoffset={-start} />}
          </g>
        );
      })}
    </svg>
  );
}

export function RingHistory() {
  const input = useLiveQuery(() => loadRingInput(db, new Date()), []);
  if (!input) return null;
  const { sessions, today, programStart, activities } = input;
  const { count, freezeAvailable, weeks } = streak(sessions, programStart, today, activities);
  const current = programWeekRange(today, programStart);
  const visible = [...weeks.slice(-7), { ...current, closed: false, frozen: false }];
  return (
    <section aria-label="Weekly ring history">
      <p class="streak-big num" data-testid="progress-streak">{count}</p>
      <p>week streak</p>
      <p class="dim">{freezeAvailable ? 'Streak freeze available' : 'Streak freeze used recently'}</p>
      <ol class="ring-history num" data-testid="ring-history">
        {visible.map(({ from, to, closed, frozen }) => {
          const ring = weekRing(sessions, { from, to }, activities);
          const state = from === current.from ? 'current' : closed ? 'closed' : frozen ? 'frozen' : 'open';
          return (
            <li key={from} data-testid="ring-week" data-state={state} aria-current={state === 'current' ? 'date' : undefined}>
              <span>Wk {weekIndex(from, programStart)}</span>
              <MiniRing ring={ring} />
              <span>{state === 'closed' ? 'closed' : state === 'frozen' ? 'freeze' : `${ring.done}/${ring.target}`}</span>
              <span class="visually-hidden">Goals. {ring.segments.map(({ activity, done, min }) =>
                `${segmentLabels[activity]} ${Math.min(done, min)} of ${min}`).join(', ')}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
