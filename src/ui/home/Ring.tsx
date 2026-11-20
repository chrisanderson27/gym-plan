import { useState } from 'preact/hooks';
import type { weekRing } from '../../engine/plan/ring';
import type { BudgetLine } from '../../engine/plan/types';
import { Sheet } from '../Sheet';

export const RING_ACTIVITY_LABELS = { lift: 'Lifts', run: 'Long runs', swim: 'Swims', burn: 'Training days' };

type RingState = ReturnType<typeof weekRing>;

export function RingGraphic({ ring, previousRing }: { ring: RingState; previousRing?: RingState }) {
  let offset = 0;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      {ring.segments.map(({ activity, done, min }) => {
        const length = min / ring.target * 100;
        const track = length - 3;
        const fill = Math.min(done / min * length, track);
        const previous = previousRing?.segments.find((segment) => segment.activity === activity)?.done ?? 0;
        const previousFill = Math.min(previous / min * length, track);
        const animate = previousRing && previousFill < fill;
        const start = offset;
        offset += length;
        return (
          <g key={activity} data-activity={activity} transform="rotate(-90 16 16)">
            <circle class="ring-track" cx="16" cy="16" r="12" pathLength="100"
              stroke-dasharray={`${track} ${100 - track}`} stroke-dashoffset={-start} />
            {fill > 0 && <circle class={animate ? 'ring-fill ring-filling' : 'ring-fill'} cx="16" cy="16" r="12" pathLength="100"
              style={animate ? { '--ring-fill-from': `${previousFill} ${100 - previousFill}` } : undefined}
              stroke-dasharray={`${fill} ${100 - fill}`} stroke-dashoffset={-start} />}
          </g>
        );
      })}
    </svg>
  );
}

export function Ring({ ring, previousRing, budget, freezeAvailable }: {
  ring: RingState;
  previousRing?: RingState;
  budget: BudgetLine[];
  freezeAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="ring-button num" data-testid="ring" aria-label={`This week, ${ring.done} of ${ring.target} goals`}
        aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <RingGraphic ring={ring} previousRing={previousRing} />
        <span>{ring.done}/{ring.target}</span>
      </button>
      {open && (
        <Sheet label="This week" onClose={() => setOpen(false)}>
          <h2>This week</h2>
          <ul class="plan num">
            {ring.segments.map(({ activity, done, min }) => <li key={activity}>{RING_ACTIVITY_LABELS[activity]}: {done} of {min}</li>)}
            {budget.filter(({ id }) => id === 'hard' || id === 'rest').map(({ id, done, min, max }) => (
              <li key={id}>{id === 'hard' ? `Hard workouts: ${done} of ${max} maximum` : `Rest days: ${done} of ${min} minimum`}</li>
            ))}
          </ul>
          <p>{freezeAvailable ? 'Streak freeze available' : 'Streak freeze used recently'}</p>
          <button type="button" class="btn" onClick={() => setOpen(false)}>Close</button>
        </Sheet>
      )}
    </>
  );
}
