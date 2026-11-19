import type { Settings } from '../../data/types';
import { BURN_DEFAULT_MIN, DEFAULT_LIFT_BUDGET_MIN, HYBRID_CARDIO_MIN, HYBRID_LIFT_MIN } from '../../engine/config';
import type { Candidate } from '../../engine/plan/types';
import { humanize, sessionTypeLabel } from '../labels';
import { CheckIcon } from '../icons';

export function heroFor(pick: Candidate, settings: Settings) {
  void settings;
  const activity = pick.tile;
  const duration = activity === 'lift' ? DEFAULT_LIFT_BUDGET_MIN : activity === 'burn' ? BURN_DEFAULT_MIN
    : activity === 'hybrid' ? HYBRID_LIFT_MIN + HYBRID_CARDIO_MIN
    : null;
  return { activity, duration, title: pick.title };
}

type HeroProps =
  | { state: 'workout' | 'first-run'; pick: Candidate; reason: string; settings: Settings }
  | { state: 'done'; detail: string; progress: string }
  | { state: 'rest' };

export function HeroCard(props: HeroProps) {
  if (props.state === 'done' || props.state === 'rest') {
    return (
      <section class="hero" data-testid="hero">
        <div data-testid="hero-state" data-state={props.state}>
          {props.state === 'done' ? (
            <>
              <CheckIcon />
              <h2>Done for today</h2>
              <p class="num">{props.detail}</p>
              <p class="num">{props.progress} weekly goal</p>
            </>
          ) : (
            <>
              <h2>Rest day</h2>
              <a class="btn" href="#/weigh-in">Log weigh-in</a>
            </>
          )}
        </div>
      </section>
    );
  }
  const { activity, title, duration } = heroFor(props.pick, props.settings);
  return (
    <section class="hero hero-workout" data-testid="hero" data-activity={activity}>
      <div data-testid="hero-state" data-state={props.state}>
        <p class="hero-activity">{sessionTypeLabel(activity)}</p>
        <h2>{title}</h2>
        {duration !== null && <p class="num">{duration} min</p>}
        <p class="hero-reason">{humanize(props.reason)}</p>
      </div>
    </section>
  );
}
