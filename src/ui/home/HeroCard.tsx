import type { ComponentChildren } from 'preact';
import type { SessionType } from '../../data/types';
import { activityOf } from '../../engine/plan/activities';
import { BurnIcon, CalendarIcon, CheckIcon, LayersIcon, TimerIcon } from '../icons';
import { durationLabel, estimatedMinutesLabel } from '../labels';

export function TrainingHeader({ week }: { week: number }) {
  return <header class="pref-top training-header">
    <div class="pref-brand">
      <span class="pref-mark" aria-hidden="true"><svg width="16" height="19" viewBox="0 0 16 19" focusable="false"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
      <p class="wordmark">Gym Plan.</p>
    </div>
    <p class="week-chip"><CalendarIcon />Week {week}</p>
  </header>;
}

const activityLabels = { lift: 'Strength & conditioning', burn: 'Conditioning', run: 'Run', swim: 'Swim' };

export function HeroCard({ state, title, detail, durationSec, blockCount, estimated, activity, context, children }: {
  state: 'workout' | 'resume' | 'done' | 'rest' | 'unavailable';
  title: string;
  detail?: string;
  durationSec?: number;
  blockCount?: number;
  estimated?: boolean;
  activity?: SessionType;
  context?: string;
  children?: ComponentChildren;
}) {
  const eyebrow = state === 'workout' ? 'Today’s recommendation' : state === 'done' ? 'Session complete' : state === 'resume' ? 'In progress' : null;
  const activityKind = activity && activityOf(activity);
  return <section class="hero today-hero" data-testid="hero" data-activity={activity}>
    {state === 'done' && <span class="today-hero-check" aria-hidden="true"><CheckIcon /></span>}
    <div data-testid="hero-state" data-state={state}>
      {eyebrow && <p class="today-hero-label">{eyebrow}</p>}
      <h2>{title}</h2>
      {detail && <p class="today-hero-detail">{detail}</p>}
      {durationSec !== undefined && <div class="today-hero-meta">
        <div>
          <span><TimerIcon />{estimated ? `${estimatedMinutesLabel(durationSec)} estimated` : durationLabel(durationSec)}</span>
          {blockCount !== undefined && <span><LayersIcon />{blockCount} blocks</span>}
        </div>
        {(activityKind || context) && <div>
          {activityKind && <span class="today-hero-activity"><BurnIcon />{activityLabels[activityKind]}</span>}
          {context && <span>{context}</span>}
        </div>}
      </div>}
      <div class="today-hero-actions">{children}</div>
    </div>
  </section>;
}
