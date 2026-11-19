import { RUN_FORMATS } from '../../content/run-formats';
import { SWIM_WORKOUTS } from '../../content/swim-workouts';
import type { CardioSnapshot } from '../../data/cardio';
import { newId } from '../../data/ids';
import { DEFAULT_POOL_LENGTH, poolOf } from '../../data/settings';
import { BURN_DEFAULT_MIN, DEFAULT_LIFT_BUDGET_MIN, HYBRID_CARDIO_MIN, HYBRID_LIFT_MIN, SWIM_ESTIMATE_YD_SEC_PER_100, SWIM_YD_TO_M_PACE } from '../../engine/config';
import { localDate } from '../../engine/dates';
import type { Candidate } from '../../engine/plan/types';
import { generateRun } from '../../engine/run/generator';
import { latestCss } from '../../engine/swim/css';
import { generateSwim, nextSwimWorkout } from '../../engine/swim/generator';
import { weekIndex } from '../../engine/week';
import { humanize, sessionTypeLabel } from '../labels';
import { CheckIcon } from '../icons';

function cardioMinutes(pick: Candidate, cardio: CardioSnapshot, now: Date): number {
  const today = localDate(now);
  const programStart = cardio.settings?.programStart ?? today;
  if (pick.tile === 'run') {
    const kind = pick.id === 'run-long' ? 'long' : pick.id === 'run-intervals' ? 'intervals' : 'easy';
    const plan = generateRun({
      now: now.toISOString(), today, programStart, kind, formats: RUN_FORMATS,
      history: cardio.runHistory, lastDoneByFormat: cardio.lastIntervalFormat, makeId: newId,
    });
    return Math.max(1, Math.round(plan.plannedSec / 60));
  }

  const pool = poolOf(cardio.settings) ?? { poolUnit: 'yd' as const, poolLength: DEFAULT_POOL_LENGTH };
  const weekIdx = weekIndex(today, programStart);
  const workoutId = nextSwimWorkout(SWIM_WORKOUTS, weekIdx, cardio.lastDone);
  const workout = SWIM_WORKOUTS.find((w) => w.id === workoutId) ?? SWIM_WORKOUTS[0]!;
  const testedCss = latestCss(cardio.cssTests, pool.poolUnit);
  const css = testedCss && testedCss.per100 > 0 ? testedCss : null;
  const pace = css?.per100 ?? SWIM_ESTIMATE_YD_SEC_PER_100 * (pool.poolUnit === 'm' ? SWIM_YD_TO_M_PACE : 1);
  const plan = generateSwim({ blocks: workout.blocks, css, ...pool, weekIdx, makeId: newId });
  let seconds = 0;
  for (const block of plan.blocks) {
    for (const item of block.items) {
      const restOrSendoff = item.seconds ?? 0;
      const repSeconds = item.mode === 'sendoff' ? restOrSendoff : (pace * item.distance) / 100 + restOrSendoff;
      seconds += block.rounds * item.reps * repSeconds;
    }
  }
  return Math.max(1, Math.round(seconds / 60));
}

export function heroFor(pick: Candidate, cardio: CardioSnapshot | null, now: Date) {
  const activity = pick.tile;
  const duration = activity === 'lift' ? DEFAULT_LIFT_BUDGET_MIN : activity === 'burn' ? BURN_DEFAULT_MIN
    : activity === 'hybrid' ? HYBRID_LIFT_MIN + HYBRID_CARDIO_MIN
    : cardio && (activity === 'run' || activity === 'swim') ? cardioMinutes(pick, cardio, now)
    : null;
  return { activity, duration, title: pick.title };
}

type HeroProps =
  | ({ state: 'workout' | 'first-run'; reason: string } & ReturnType<typeof heroFor>)
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
  const { activity, title, duration } = props;
  return (
    <section class="hero hero-workout" data-testid="hero" data-activity={activity}>
      <div data-testid="hero-state" data-state={props.state}>
        <p class="hero-activity">{sessionTypeLabel(activity)}</p>
        <h2>{title}</h2>
        {duration !== null && <p class="num">{activity === 'swim' && '≈ '}{duration} min</p>}
        <p class="hero-reason">{humanize(props.reason)}</p>
      </div>
    </section>
  );
}
