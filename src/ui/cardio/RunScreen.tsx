import { useMemo, useState } from 'preact/hooks';
import { RUN_FORMATS } from '../../content/run-formats';
import { loadCardioSnapshot, saveRun } from '../../data/cardio';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { useLiveQuery } from '../../data/live';
import type { IntervalBlock, RunKind } from '../../data/types';
import { localDate } from '../../engine/dates';
import { generateRun } from '../../engine/run/generator';
import { runToIntervals } from '../../engine/run/to-timer';
import { weekIndex } from '../../engine/week';
import { navigate } from '../router';
import { FeedbackButton } from '../slots/FeedbackButton';
import { dayOf } from './format';
import { RunLog, type RunLogValues } from './RunLog';
import { TimerScreen } from './TimerScreen';

type Stage = 'plan' | 'timer' | 'log';
const KINDS: { id: RunKind; name: string }[] = [
  { id: 'easy', name: 'Easy' }, { id: 'long', name: 'Long' }, { id: 'intervals', name: 'Intervals' },
];
const SEG_NAMES = { run: 'run', walk: 'walk', jog: 'jog', sprint: 'sprint', recover: 'recover' } as const;

export function RunScreen() {
  const snap = useLiveQuery(() => loadCardioSnapshot(db), []);
  const [kind, setKind] = useState<RunKind>('easy');
  const [format, setFormat] = useState<(typeof RUN_FORMATS)[number]['format'] | undefined>(undefined);
  const [durationMin, setDurationMin] = useState<number | undefined>(undefined);
  const [stage, setStage] = useState<Stage>('plan');
  const [sessionId] = useState(newId);
  const [timed, setTimed] = useState<{ blocks: IntervalBlock[]; startedAt: string; minutes: number } | null>(null);
  const [frozen, setFrozen] = useState<IntervalBlock[]>([]);

  const settings = snap?.settings;
  const today = localDate(new Date());
  const weekIdx = settings ? weekIndex(today, settings.programStart) : 1;

  const plan = useMemo(() => {
    if (!snap || !settings) return null;
    return generateRun({
      now: new Date().toISOString(), today, programStart: settings.programStart, history: snap.runHistory, kind,
      formats: RUN_FORMATS, lastDoneByFormat: snap.lastIntervalFormat, makeId: newId,
      ...(kind === 'intervals' && format ? { format } : {}), ...(durationMin ? { durationMin } : {}),
    });
  }, [snap, settings, kind, format, durationMin, today]);

  if (!snap || !plan || !settings) return <main class="screen"><h1>Run</h1></main>;

  const plannedMin = Math.round(plan.plannedSec / 60);
  // Matches saveRun's templateId.
  const runTemplateId = `run-${plan.block.format ?? plan.block.runKind}`;
  const lastRun = snap.runHistory
    .filter((r) => r.modality === 'run' || r.modality === 'treadmill')
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const record = async (v: RunLogValues, startedAt: string) => {
    await saveRun(db, { block: plan.block, startedAt, id: sessionId, ...v });
    navigate('/');
  };

  if (stage === 'timer') {
    return (
      <TimerScreen
        blocks={frozen}
        feedbackContext={{ sessionId, templateId: runTemplateId }}
        onExit={() => setStage('plan')}
        onFinish={(blocks, startedAt) => {
          const sec = blocks.reduce((n, b) => n + (b.result?.actualSec ?? 0), 0);
          setTimed({ blocks, startedAt, minutes: Math.max(1, Math.round(sec / 60)) });
          setStage('log');
        }}
      />
    );
  }

  if (stage === 'log') {
    const startedAt = timed?.startedAt ?? new Date().toISOString();
    return (
      <main class="screen">
        <h1>{timed ? 'Session complete' : 'Log run'}</h1>
        <RunLog defaultMinutes={timed?.minutes ?? plannedMin} defaultModality={plan.block.modality} onSave={(v) => record(v, startedAt)} />
        <FeedbackButton kind="workout" context={{ sessionId, templateId: runTemplateId }} />
      </main>
    );
  }

  const stepper = (delta: number) => setDurationMin(Math.max(5, plannedMin + delta));

  return (
    <main class="screen">
      <header class="bar">
        <h1>Run</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      <div class="chips">
        {KINDS.map((k) => (
          <button key={k.id} type="button" class={k.id === kind ? 'chip on' : 'chip'} data-testid={`run-kind-${k.id}`} onClick={() => { setKind(k.id); setDurationMin(undefined); }}>
            {k.name}
          </button>
        ))}
      </div>
      {kind === 'intervals' && (
        <div class="chips">
          {RUN_FORMATS.map((f) => {
            const locked = f.minWeek > weekIdx;
            return (
              <button key={f.format} type="button" disabled={locked} class={plan.block.format === f.format ? 'chip on' : 'chip'} data-testid={`run-format-${f.format}`} onClick={() => { setFormat(f.format); setDurationMin(undefined); }}>
                {f.name}
                {locked && <small>week {f.minWeek}</small>}
              </button>
            );
          })}
        </div>
      )}
      <p data-testid="run-planned"><strong>Planned {plannedMin} min</strong>{plan.estMi !== undefined && ` · ≈ ${plan.estMi.toFixed(1)} mi`} · week {weekIdx}</p>
      <div class="chips">
        <button type="button" data-testid="run-minus" onClick={() => stepper(-5)}>−5 min</button>
        <button type="button" data-testid="run-plus" onClick={() => stepper(5)}>+5 min</button>
      </div>
      <p class="dim">
        {plan.block.repeats > 1 || plan.block.segments.length > 1 ? `${plan.block.repeats} × ` : ''}
        {plan.block.segments.map((s) => `${SEG_NAMES[s.role]} ${s.sec ?? 0} s${s.inclinePct !== undefined ? ` @ ${s.inclinePct}%` : ''}${s.rpeTarget ? ` (RPE ${s.rpeTarget})` : ''}`).join(' + ')}
        {plan.block.runKind === 'intervals' && ` · warm-up ${Math.round(plan.warmupSec / 60)} + cool-down ${Math.round(plan.cooldownSec / 60)} min`}
      </p>
      <ul class="plan" data-testid="run-reasons">
        {plan.reasons.map((r) => <li key={r}>{r}</li>)}
        {plan.warnings.map((w) => <li key={w} class="warn">{w}</li>)}
      </ul>
      <button type="button" class="primary" data-testid="run-start" onClick={() => { setFrozen(runToIntervals(plan.block, plan)); setStage('timer'); }}>Start timer</button>
      <button type="button" data-testid="run-log-direct" onClick={() => { setTimed(null); setStage('log'); }}>Log without timer</button>
      <p class="dim">{lastRun ? `Last run: ${dayOf(lastRun.date)} · ${Math.round(lastRun.durationSec / 60)} min` : 'No runs yet'}</p>
      <FeedbackButton kind="workout" context={{ templateId: runTemplateId }} />
    </main>
  );
}
