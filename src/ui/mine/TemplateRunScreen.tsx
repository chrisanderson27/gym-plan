import { useMemo, useState } from 'preact/hooks';
import { BURN_TEMPLATES } from '../../content/burn-templates';
import { RUN_FORMATS } from '../../content/run-formats';
import { burnInputs, loadCardioSnapshot, saveBurn, saveRun, saveSwim, type CardioSnapshot } from '../../data/cardio';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { useLiveQuery } from '../../data/live';
import { MixedInputError, startMixedSession } from '../../data/mixedSession';
import { poolOf } from '../../data/settings';
import { loadRunnable, startFromBlocks, type Runnable } from '../../data/templates';
import type { IntervalBlock, RunBlock, SwimSetBlock } from '../../data/types';
import { localDate } from '../../engine/dates';
import { generateRun } from '../../engine/run/generator';
import { runToIntervals } from '../../engine/run/to-timer';
import { latestCss } from '../../engine/swim/css';
import { generateSwim } from '../../engine/swim/generator';
import { weekIndex } from '../../engine/week';
import { BurnScreen } from '../cardio/BurnScreen';
import { RpeChips } from '../cardio/RpeChips';
import { RunLog } from '../cardio/RunLog';
import { SwimCard } from '../cardio/SwimCard';
import { SwimLog } from '../cardio/SwimLog';
import { TimerScreen } from '../cardio/TimerScreen';
import { PoolSheet } from '../PoolSheet';
import { unlockAudio } from '../../platform/audio';
import { mixedBlockName } from '../labels';
import { navigate } from '../router';
import { MoreMenu } from '../MoreMenu';

const { substitutesOf, labelOf } = burnInputs();

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
  if (run.type === 'burn' && run.blocks.some((b) => b.kind === 'circuit')) {
    return <BurnScreen templateId={BURN_TEMPLATES.some((t) => t.id === run.templateId) ? run.templateId : undefined} />;
  }
  if (run.blocks.some((b) => b.kind === 'lift')) return <LiftAgain run={run} />;
  if (first?.kind === 'interval') return <BurnAgain run={run} snap={snap} />;
  if (first?.kind === 'run') return <RunAgain run={run} block={first} snap={snap} />;
  if (first?.kind === 'swim') return <SwimAgain run={run} snap={snap} />;
  return <main class="screen"><header class="bar"><h1>Nothing to run</h1><MoreMenu feedback={{ kind: 'workout', context: {} }} /></header></main>;
}

function MixedAgain({ source, ordered }: { source: Parameters<typeof startMixedSession>[1]; ordered: NonNullable<Runnable['ordered']> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setBusy(true);
    setError('');
    unlockAudio();
    try { navigate('/workout/session/' + await startMixedSession(db, source)); }
    catch (reason) { setError(reason instanceof MixedInputError ? reason.message : 'Could not start the workout. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <main class="screen">
      <header class="bar"><h1>{ordered.name}</h1><a class="gear" href="#/progress">Progress</a></header>
      <ol class="plan">{ordered.blocks.map((b) => <li key={b.id}>{mixedBlockName(b)}</li>)}</ol>
      {error && <p role="alert">{error}</p>}
      <button type="button" class="primary" data-testid="again-start" disabled={busy} onClick={start}>Start</button>
    </main>
  );
}

function LiftAgain({ run }: { run: Runnable }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const id = await startFromBlocks(db, run);
    navigate((run.type === 'hybrid' ? '/hybrid/session/' : '/lift/session/') + id);
  };
  return (
    <main class="screen">
      <header class="bar">
        <h1>{run.name}</h1>
        <a class="gear" href="#/progress/history">History</a>
        <MoreMenu feedback={{ kind: 'workout', context: { ...(run.templateId ? { templateId: run.templateId } : {}) } }} />
      </header>
      <p class="dim">Weights are re-prescribed from your current history.</p>
      <button type="button" class="primary" data-testid="again-start" disabled={busy} onClick={start}>Start</button>
    </main>
  );
}

function BurnAgain({ run, snap }: { run: Runnable; snap: CardioSnapshot }) {
  const [sessionId] = useState(newId);
  const [stage, setStage] = useState<'preview' | 'timer' | 'log'>('preview');
  const [result, setResult] = useState<{ blocks: IntervalBlock[]; startedAt: string } | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const templateId = run.templateId ?? 'mine';
  // Substitution only (no budget trimming): a re-run keeps its own length.
  const blocks = useMemo(
    () => run.blocks.filter((b): b is IntervalBlock => b.kind === 'interval').map((b): IntervalBlock => {
      const { result: _r, ...rest } = b;
      void _r;
      return {
        ...rest, id: newId(),
        phases: b.phases.map((p) => {
          if (!p.exerciseId || !snap.excluded.has(p.exerciseId)) return { ...p };
          const to = (substitutesOf[p.exerciseId] ?? []).find((s) => !snap.excluded.has(s));
          return to ? { ...p, exerciseId: to, label: labelOf[to] ?? to } : p;
        }),
      };
    }),
    [run, snap.excluded],
  );
  if (stage === 'timer') {
    return (
      <TimerScreen blocks={blocks} feedbackContext={{ sessionId, templateId }} onExit={() => setStage('preview')}
        onFinish={(b, startedAt) => { setResult({ blocks: b, startedAt }); setStage('log'); }} />
    );
  }
  if (stage === 'log' && result) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Session complete</h1>
          <MoreMenu feedback={{ kind: 'workout', context: { sessionId, templateId } }} />
        </header>
        <RpeChips value={rpe} onChange={setRpe} allowSkip />
        <button type="button" class="primary" data-testid="burn-save"
          onClick={async () => { await saveBurn(db, { templateId, blocks: result.blocks, rpe, startedAt: result.startedAt, id: sessionId }); navigate('/'); }}>Save</button>
      </main>
    );
  }
  return (
    <main class="screen">
      <header class="bar">
        <h1>{run.name}</h1>
        <a class="gear" href="#/progress/history">History</a>
        <MoreMenu feedback={{ kind: 'workout', context: { sessionId, templateId } }} />
      </header>
      <ul class="plan">{blocks.map((b) => <li key={b.id}>{b.label ?? 'Block'} · {b.rounds}×</li>)}</ul>
      <button type="button" class="primary" data-testid="again-start" onClick={() => setStage('timer')}>Start timer</button>
    </main>
  );
}

function RunAgain({ run, block, snap }: { run: Runnable; block: RunBlock; snap: CardioSnapshot }) {
  const [sessionId] = useState(newId);
  const [stage, setStage] = useState<'plan' | 'timer' | 'log'>('plan');
  const [frozen, setFrozen] = useState<IntervalBlock[]>([]);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const settings = snap.settings;
  // Never replayed verbatim: regenerated so the 1.10× cap and weekly cap still apply.
  const plan = useMemo(() => {
    if (!settings) return null;
    const plannedSec = block.repeats * block.segments.reduce((n, s) => n + (s.sec ?? 0), 0);
    return generateRun({
      now: new Date().toISOString(), today: localDate(new Date()), programStart: settings.programStart, history: snap.runHistory,
      kind: block.runKind, ...(block.format ? { format: block.format } : {}), formats: RUN_FORMATS, lastDoneByFormat: snap.lastIntervalFormat,
      ...(plannedSec > 0 ? { durationMin: Math.max(5, Math.round(plannedSec / 60)) } : {}), makeId: newId,
    });
  }, [block, snap, settings]);
  if (!plan) return <main class="screen"><h1>{run.name}</h1></main>;
  const ctx = { sessionId, ...(run.templateId ? { templateId: run.templateId } : {}) };
  if (stage === 'timer') {
    return (
      <TimerScreen blocks={frozen} feedbackContext={ctx} onExit={() => setStage('plan')}
        onFinish={(_b, at) => { setStartedAt(at); setStage('log'); }} />
    );
  }
  if (stage === 'log') {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Log run</h1>
          <MoreMenu feedback={{ kind: 'workout', context: ctx }} />
        </header>
        <RunLog defaultMinutes={Math.round(plan.plannedSec / 60)} defaultModality={plan.block.modality}
          onSave={async (v) => { await saveRun(db, { block: plan.block, startedAt, id: sessionId, ...v }); navigate('/'); }} />
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
      <p data-testid="run-planned"><strong>Planned {Math.round(plan.plannedSec / 60)} min</strong></p>
      <ul class="plan">
        {plan.reasons.map((r) => <li key={r}>{r}</li>)}
        {plan.warnings.map((w) => <li key={w} class="warn">{w}</li>)}
      </ul>
      <button type="button" class="primary" data-testid="again-start" onClick={() => { setFrozen(runToIntervals(plan.block, plan)); setStage('timer'); }}>Start timer</button>
      <button type="button" data-testid="run-log-direct" onClick={() => setStage('log')}>Log without timer</button>
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
