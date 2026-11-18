import { useMemo, useState } from 'preact/hooks';
import { SWIM_WORKOUTS } from '../../content/swim-workouts';
import { loadCardioSnapshot, saveSwim } from '../../data/cardio';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { useLiveQuery } from '../../data/live';
import { localDate } from '../../engine/dates';
import { latestCss } from '../../engine/swim/css';
import { generateSwim, nextSwimWorkout } from '../../engine/swim/generator';
import { weekIndex } from '../../engine/week';
import { MineRow } from '../mine/MineRow';
import { navigate } from '../router';
import { FeedbackButton } from '../slots/FeedbackButton';
import { dayOf, fmtMSS } from './format';
import { SwimCard } from './SwimCard';
import { SwimLog } from './SwimLog';

export function SwimScreen() {
  const snap = useLiveQuery(() => loadCardioSnapshot(db), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [sessionId] = useState(newId);
  const settings = snap?.settings;
  const weekIdx = settings ? weekIndex(localDate(new Date()), settings.programStart) : 1;
  const workoutId = picked ?? nextSwimWorkout(SWIM_WORKOUTS, weekIdx, snap?.lastDone ?? {});
  const workout = SWIM_WORKOUTS.find((w) => w.id === workoutId) ?? SWIM_WORKOUTS[0]!;
  const css = settings && snap ? latestCss(snap.cssTests, settings.poolUnit) : null;

  const plan = useMemo(
    () => (settings ? generateSwim({ blocks: workout.blocks, css, poolLength: settings.poolLength, poolUnit: settings.poolUnit, weekIdx, makeId: newId }) : null),
    [workout, css?.per100, css?.estimate, css?.approx, settings?.poolLength, settings?.poolUnit, weekIdx],
  );

  if (!snap || !settings || !plan) return <main class="screen"><h1>Swim</h1></main>;
  const lastSwim = snap.lastByType.swim;

  if (logging) {
    return (
      <main class="screen">
        <h1>Log swim</h1>
        <SwimLog
          defaultDistance={plan.totalDistance}
          onSave={async (v) => {
            const startedAt = new Date(Date.now() - v.durationMin * 60_000).toISOString();
            await saveSwim(db, { workoutId: workout.id, blocks: plan.blocks, startedAt, id: sessionId, ...v });
            navigate('/');
          }}
        />
        <FeedbackButton kind="workout" context={{ sessionId, templateId: workout.id }} />
      </main>
    );
  }

  return (
    <main class="screen">
      <header class="bar">
        <h1>Swim</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      <div class="chips">
        {SWIM_WORKOUTS.map((w) => (
          <button key={w.id} type="button" disabled={w.minWeek > weekIdx} class={w.id === workout.id ? 'chip on' : 'chip'} data-testid={`swim-workout-${w.id}`} onClick={() => setPicked(w.id)}>
            {w.name}
            {w.minWeek > weekIdx && <small>week {w.minWeek}</small>}
          </button>
        ))}
      </div>
      <p class="dim">{workout.focus}</p>
      {!css && (
        <p class="warn" data-testid="swim-css-prompt">
          No CSS test yet, so this card uses rest intervals. <a href="#/swim/css">Take the CSS test</a> to get send-offs.
        </p>
      )}
      {css?.estimate && <p class="badge" data-testid="swim-css-estimate">Send-offs from an estimate · CSS {fmtMSS(css.per100)}</p>}
      {css?.approx && <p class="badge">Approximate: your test was in the other pool unit</p>}
      {css && !css.estimate && !css.approx && <p class="dim">CSS {fmtMSS(css.per100)} per 100 · <a href="#/swim/css">retest</a></p>}
      <SwimCard blocks={plan.blocks} totalDistance={plan.totalDistance} poolUnit={settings.poolUnit} />
      <button type="button" class="primary" data-testid="swim-log" onClick={() => setLogging(true)}>Log swim</button>
      <p class="dim">{lastSwim ? `Last swim: ${dayOf(lastSwim)}` : 'No swims yet'}</p>
      <MineRow types={['swim']} />
      <FeedbackButton kind="workout" context={{ templateId: workout.id }} />
    </main>
  );
}
