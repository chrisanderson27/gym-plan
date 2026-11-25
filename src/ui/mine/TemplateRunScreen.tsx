import { useMemo, useRef, useState } from 'preact/hooks';
import { copyWorkoutBlock, legacyWorkoutDraft } from '../../data/workoutChoices';
import { workoutShortfallSec } from '../../engine/templates';
import { loadCardioSnapshot, saveSwim, type CardioSnapshot } from '../../data/cardio';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { useLiveQuery } from '../../data/live';
import { missingCoachedSchedule, startMixedSession } from '../../data/mixedSession';
import { poolOf } from '../../data/settings';
import { loadRunnable, type Runnable } from '../../data/templates';
import type { SwimSetBlock } from '../../data/types';
import { localDate } from '../../engine/dates';
import { latestCss } from '../../engine/swim/css';
import { generateSwim } from '../../engine/swim/generator';
import { weekIndex } from '../../engine/week';
import { SwimCard } from '../cardio/SwimCard';
import { SwimLog } from '../cardio/SwimLog';
import { PoolSheet } from '../PoolSheet';
import { exerciseName, mixedBlockName, orderedDurationLabel, runKindName } from '../labels';
import { navigate } from '../router';
import { MoreMenu } from '../MoreMenu';
import { OrderedStart } from '../workouts/OrderedStart';
import { WorkoutEditor } from '../workouts/WorkoutEditor';

export function TemplateRunScreen(src: { templateId: string } | { sessionId: string }) {
  const key = 'templateId' in src ? src.templateId : src.sessionId;
  const data = useLiveQuery(async () => ({ run: await loadRunnable(db, src), snap: await loadCardioSnapshot(db) }), [key]);
  if (!data) return <main class="screen"><h1>Do this again</h1></main>;
  const { run, snap } = data;
  if (!run) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Not found</h1>
          <a href="#/progress/history">History</a>
          <MoreMenu feedback={{ kind: 'workout', context: {} }} />
        </header>
      </main>
    );
  }
  if (run.ordered) return <MixedAgain source={src} ordered={run.ordered} />;
  const first = run.blocks.find((b) => b.kind !== 'lift' || !b.warmup);
  if (run.type === 'burn' || run.blocks.some((b) => b.kind === 'lift') || first?.kind === 'interval' || first?.kind === 'run') return <LegacyAgain run={run} />;
  if (first?.kind === 'swim') return <SwimAgain run={run} snap={snap} />;
  return <main class="screen"><header class="bar"><h1>Nothing to run</h1><MoreMenu feedback={{ kind: 'workout', context: {} }} /></header></main>;
}

function MixedAgain({ source, ordered }: { source: Parameters<typeof startMixedSession>[1]; ordered: NonNullable<Runnable['ordered']> }) {
  const repair = ordered.blocks.some(missingCoachedSchedule);
  const short = workoutShortfallSec(ordered.blocks) > 0;
  const [extending, setExtending] = useState(false);
  const extend = useRef<HTMLButtonElement>(null);
  const baseline = useMemo(() => ({ name: `${ordered.name} (45 min)`, blocks: ordered.blocks.map((block) => copyWorkoutBlock(block)) }), [ordered]);
  return (
    <main class="screen">
      <header class="bar"><h1>{ordered.name}</h1><a class="gear" href="#/progress">Progress</a></header>
      <p>{orderedDurationLabel(ordered.blocks)}</p>
      <ol class="plan">{ordered.blocks.map((b) => <li key={b.id}>{mixedBlockName(b)}</li>)}</ol>
      {repair && <p>Replace or remove coached blocks missing a station schedule in Workouts.</p>}
      {short ? <>
        <p class="workout-warning">This workout is shorter than 45 minutes. Extend it to start.</p>
        <button type="button" class="primary" ref={extend} data-testid="again-extend" onClick={() => setExtending(true)}>Extend as a new workout</button>
      </> : <OrderedStart source={source} ordered={ordered} testId="again-start">Start</OrderedStart>}
      <a class="btn" href="#/workouts">Workouts</a>
      {extending && <WorkoutEditor initial={baseline} onSaved={(id) => navigate(`/mine/${id}`)} onClose={() => setExtending(false)} fallbackFocus={() => extend.current} />}
    </main>
  );
}

/** Fresh Repeat of a legacy lift, hybrid, burn or run row. The standard runner needs a 45-minute workout, so the user converts or chooses one. */
function LegacyAgain({ run }: { run: Runnable }) {
  const [editing, setEditing] = useState(false);
  const build = useRef<HTMLButtonElement>(null);
  const { draft, dropped } = useMemo(() => legacyWorkoutDraft(run), [run]);
  return (
    <main class="screen" data-testid="legacy-again">
      <header class="bar">
        <h1>{run.name}</h1>
        <a class="gear" href="#/progress/history">History</a>
        <MoreMenu feedback={{ kind: 'workout', context: { ...(run.templateId ? { templateId: run.templateId } : {}) } }} />
      </header>
      <p>Workouts now start in the standard runner and last at least 45 minutes.</p>
      <ol class="plan">{run.blocks.filter((b) => b.kind !== 'lift' || !b.warmup).map((b) => <li key={b.id}>
        {b.kind === 'lift' ? exerciseName(b.exerciseId) : b.kind === 'run' ? `${runKindName(b.runKind)} run` : b.kind}</li>)}</ol>
      {dropped.length > 0 && <p class="dim">Not carried over: {dropped.join(', ')} blocks.</p>}
      <button type="button" class="primary" ref={build} data-testid="legacy-build" onClick={() => setEditing(true)}>Build a 45-minute version</button>
      <a class="btn" href="#/workouts">Choose a standard workout</a>
      {editing && <WorkoutEditor initial={draft} onSaved={(id) => navigate(`/mine/${id}`)} onClose={() => setEditing(false)} fallbackFocus={() => build.current} />}
    </main>
  );
}

function SwimAgain({ run, snap }: { run: Runnable; snap: CardioSnapshot }) {
  const [sessionId] = useState(newId);
  const [logging, setLogging] = useState(false);
  const settings = snap.settings;
  const pool = poolOf(settings);
  const plan = useMemo(() => {
    if (!settings || !pool) return null;
    const weekIdx = weekIndex(localDate(new Date()), settings.programStart);
    const css = latestCss(snap.cssTests, pool.poolUnit);
    // Send-offs always come from the latest CSS, never from the stored blocks.
    return generateSwim({ blocks: run.blocks.filter((b): b is SwimSetBlock => b.kind === 'swim'), css, ...pool, weekIdx, makeId: newId });
  }, [run, snap, settings, pool?.poolUnit, pool?.poolLength]);
  if (!settings) return <main class="screen"><h1>{run.name}</h1></main>;
  if (!pool || !plan) return <main class="screen"><h1>{run.name}</h1><PoolSheet onClose={() => navigate('/progress')} /></main>;
  const ctx = { sessionId, ...(run.templateId ? { templateId: run.templateId } : {}) };
  if (logging) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Log swim</h1>
          <MoreMenu feedback={{ kind: 'workout', context: ctx }} />
        </header>
        <SwimLog defaultDistance={plan.totalDistance} onSave={async (v) => {
          const startedAt = new Date(Date.now() - v.durationMin * 60_000).toISOString();
          await saveSwim(db, { workoutId: run.templateId ?? 'mine', blocks: plan.blocks, startedAt, id: sessionId, ...v });
          navigate('/');
        }} />
      </main>
    );
  }
  return (
    <main class="screen">
      <header class="bar">
        <h1>{run.name}</h1>
        <a class="gear" href="#/progress/history">History</a>
        <MoreMenu feedback={{ kind: 'workout', context: ctx }} />
      </header>
      <SwimCard blocks={plan.blocks} totalDistance={plan.totalDistance} poolUnit={pool.poolUnit} />
      <button type="button" class="primary" data-testid="again-start" onClick={() => setLogging(true)}>Log swim</button>
    </main>
  );
}
