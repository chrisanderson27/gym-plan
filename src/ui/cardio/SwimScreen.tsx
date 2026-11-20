import { useMemo, useState } from 'preact/hooks';
import { SWIM_WORKOUTS } from '../../content/swim-workouts';
import { loadCardioSnapshot, saveSwim } from '../../data/cardio';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { useLiveQuery } from '../../data/live';
import { poolOf } from '../../data/settings';
import { TIMER_TICK_MS } from '../../engine/config';
import { localDate } from '../../engine/dates';
import { latestCss } from '../../engine/swim/css';
import { generateSwim, nextSwimWorkout } from '../../engine/swim/generator';
import { weekIndex } from '../../engine/week';
import { MineRow } from '../mine/MineRow';
import { MoreMenu } from '../MoreMenu';
import { PoolSheet } from '../PoolSheet';
import { navigate } from '../router';
import { useNow } from '../session/hooks';
import { Sheet } from '../Sheet';
import { dayOf, fmtMSS } from './format';
import { SwimCard } from './SwimCard';
import { SwimLog } from './SwimLog';

function SwimElapsed({ startedAt }: { startedAt: number }) {
  const now = useNow(TIMER_TICK_MS);
  return <p class="num" data-testid="swim-elapsed">Elapsed {fmtMSS(Math.floor((now - startedAt) / 1000))}</p>;
}

export function SwimScreen() {
  const snap = useLiveQuery(() => loadCardioSnapshot(db), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [changing, setChanging] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [minutes, setMinutes] = useState<number>();
  const [sessionId] = useState(newId);
  const settings = snap?.settings;
  const pool = poolOf(settings);
  const weekIdx = settings ? weekIndex(localDate(new Date()), settings.programStart) : 1;
  const workoutId = picked ?? nextSwimWorkout(SWIM_WORKOUTS, weekIdx, snap?.lastDone ?? {});
  const workout = SWIM_WORKOUTS.find((w) => w.id === workoutId) ?? SWIM_WORKOUTS[0]!;
  const css = pool && snap ? latestCss(snap.cssTests, pool.poolUnit) : null;

  const plan = useMemo(
    () => (pool ? generateSwim({ blocks: workout.blocks, css, ...pool, weekIdx, makeId: newId }) : null),
    [workout, css?.per100, css?.estimate, css?.approx, pool?.poolLength, pool?.poolUnit, weekIdx],
  );

  if (!snap || !settings) return <main class="screen"><h1>Swim</h1></main>;
  if (!pool || !plan) return <main class="screen"><h1>Swim</h1><PoolSheet onClose={() => navigate('/')} /></main>;
  const lastSwim = snap.lastByType.swim;
  const card = <SwimCard blocks={plan.blocks} totalDistance={plan.totalDistance} poolUnit={pool.poolUnit} />;

  if (logging) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Log swim</h1>
          <MoreMenu feedback={{ kind: 'workout', context: { sessionId, templateId: workout.id } }} />
        </header>
        <SwimLog
          defaultDistance={plan.totalDistance}
          defaultMinutes={minutes}
          onSave={async (v) => {
            const date = new Date(startedAt ?? Date.now() - v.durationMin * 60_000).toISOString();
            await saveSwim(db, { workoutId: workout.id, blocks: plan.blocks, startedAt: date, id: sessionId, ...v });
            navigate('/');
          }}
        />
      </main>
    );
  }

  if (startedAt !== undefined) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Swimming</h1>
          <MoreMenu feedback={{ kind: 'workout', context: { sessionId, templateId: workout.id } }} />
        </header>
        <SwimElapsed startedAt={startedAt} />
        <button type="button" class="primary" data-testid="swim-finish" onClick={() => {
          setMinutes(Math.max(1, Math.round((Date.now() - startedAt) / 60_000)));
          setLogging(true);
        }}>Finish</button>
        {card}
      </main>
    );
  }

  return (
    <main class="screen">
      <header class="bar">
        <h1>Swim</h1>
        <a class="gear" href="#/">Home</a>
        <MoreMenu feedback={{ kind: 'workout', context: { templateId: workout.id } }} />
      </header>
      <section class="plan-card" data-activity="swim" data-testid="swim-plan">
        <h2>{workout.name}</h2>
        <p>{workout.focus}</p>
        {css ? (
          <p class="num" data-testid={css.estimate ? 'swim-css-estimate' : undefined}>
            CSS {fmtMSS(css.per100)} per 100{css.estimate ? ' · estimate' : css.approx ? ' · approximate' : ''}
          </p>
        ) : (
          <p data-testid="swim-css-prompt"><a href="#/swim/css">Take the CSS test</a> for send-offs.</p>
        )}
        {card}
      </section>
      <button type="button" class="btn change-line" data-testid="swim-change" onClick={() => setChanging(true)}>
        {workout.name} · Change
      </button>
      <button type="button" class="primary" data-testid="swim-start" onClick={() => setStartedAt(Date.now())}>Start</button>
      <button type="button" class="btn" data-testid="swim-log" onClick={() => setLogging(true)}>Log a past swim</button>
      <p class="dim">{lastSwim ? `Last swim: ${dayOf(lastSwim)}` : 'No swims yet'}</p>
      <MineRow types={['swim']} />
      {changing && (
        <Sheet label="Change swim" onClose={() => setChanging(false)}>
          <h2>Change swim</h2>
          <div class="chips">
            {SWIM_WORKOUTS.map((w) => (
              <button key={w.id} type="button" disabled={w.minWeek > weekIdx} class={w.id === workout.id ? 'chip on' : 'chip'}
                aria-pressed={w.id === workout.id} data-testid={`swim-workout-${w.id}`} onClick={() => setPicked(w.id)}>
                {w.name}
                {w.minWeek > weekIdx && <small>week {w.minWeek}</small>}
              </button>
            ))}
          </div>
          <a class="btn" href="#/swim/css">Take the CSS test</a>
          <button type="button" class="btn sheet-cancel" onClick={() => setChanging(false)}>Done</button>
        </Sheet>
      )}
    </main>
  );
}
