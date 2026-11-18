import { useEffect, useRef, useState } from 'preact/hooks';
import { LIFT_TEMPLATES, exerciseById } from '../../content';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { LIFT_EXERCISES, buildLiftPlan, findOpenLiftSession, loadLiftSnapshot, startLiftSession, variantMuscles } from '../../data/lift';
import { MineRow } from '../mine/MineRow';
import type { LiftVariant } from '../../data/types';
import { DEFAULT_LIFT_BUDGET_MIN, LIFT_BUDGETS_MIN } from '../../engine/config';
import { muscleReadiness, variantReadiness } from '../../engine/lift/readiness';
import { nextVariant } from '../../engine/lift/rotation';
import { exerciseName, humanize } from '../labels';
import { navigate } from '../router';

const VARIANTS: LiftVariant[] = ['lower-a', 'upper-a', 'lower-b', 'upper-b'];

export function LiftHome({ autoStart, initial }: { autoStart?: LiftVariant; initial?: LiftVariant }) {
  const data = useLiveQuery(async () => ({ snapshot: await loadLiftSnapshot(db), open: (await findOpenLiftSession(db)) ?? null }), []);
  const [picked, setPicked] = useState<LiftVariant | null>(initial ?? null);
  const [budget, setBudget] = useState<number>(DEFAULT_LIFT_BUDGET_MIN);
  const started = useRef(false);

  const snapshot = data?.snapshot;
  useEffect(() => {
    if (!autoStart || !snapshot || started.current) return;
    started.current = true;
    const plan = buildLiftPlan(snapshot, autoStart, DEFAULT_LIFT_BUDGET_MIN, true);
    startLiftSession(db, plan).then((id) => navigate('/lift/session/' + id));
  }, [autoStart, snapshot]);

  if (!data || !snapshot) return <main class="screen"><h1>Lift</h1></main>;

  const readiness = muscleReadiness(snapshot, LIFT_EXERCISES);
  const ready = (v: LiftVariant) => {
    return variantReadiness(variantMuscles(v), readiness, snapshot.now);
  };
  const suggestion = nextVariant(snapshot.history, (v) => ready(v).ready);
  const variant = picked ?? suggestion.variant;
  const plan = buildLiftPlan(snapshot, variant, budget);

  const start = async () => {
    const id = await startLiftSession(db, plan);
    navigate('/lift/session/' + id);
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>Lift</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      {data.open && (
        <a class="resume" data-testid="resume" href={'#/lift/session/' + data.open.id}>
          Resume {data.open.variant ?? 'session'} →
        </a>
      )}
      <p class="dim">Suggested: {LIFT_TEMPLATES[suggestion.variant].name} — {humanize(suggestion.why)}</p>
      <div class="chips">
        {VARIANTS.map((v) => {
          const r = ready(v);
          return (
            <button key={v} type="button" class={v === variant ? 'chip on' : 'chip'} data-testid={`variant-${v}`} onClick={() => setPicked(v)}>
              {LIFT_TEMPLATES[v].name}
              <small>{r.ready ? 'ready' : `ready in ${r.hoursLeft} h`}</small>
            </button>
          );
        })}
      </div>
      <div class="chips">
        {LIFT_BUDGETS_MIN.map((m) => (
          <button key={m} type="button" class={m === budget ? 'chip on' : 'chip'} data-testid={`budget-${m}`} onClick={() => setBudget(m)}>
            {m} min
          </button>
        ))}
      </div>
      {plan.deload && <p class="badge">Deload week: fewer sets, no raises</p>}
      {plan.rampIn && <p class="badge">Ramp-in: ~60% volume, easy effort</p>}
      <ul class="plan">
        {plan.blocks.map((b) => {
          const p = plan.prescriptions.get(b.id);
          const name = exerciseById.get(b.exerciseId)?.name ?? b.exerciseId;
          return (
            <li key={b.id} data-testid={`preview-${b.exerciseId}`}>
              <strong>{name}</strong>
              <span>{b.warmup ? 'Warm-up · 7 min' : p?.mode === 'calibrate' ? 'calibrate' : `${p?.sets} × ${p?.reps} @ ${p?.weight}`}</span>
            </li>
          );
        })}
      </ul>
      {plan.dropped.length > 0 && <p class="dim">Dropped to fit {budget} min: {plan.dropped.map(exerciseName).join(', ')}</p>}
      <p class="dim">≈ {Math.round(plan.estMin)} min</p>
      <button type="button" class="primary" data-testid="start-lift" onClick={start}>Start</button>
      <MineRow types={['lift', 'custom']} />
      <nav class="linkbar" aria-label="Lift links">
        <a class="btn" href="#/lift/volume">Weekly volume</a>
        <a class="btn" href="#/lift/gym">My gym</a>
        <a class="btn" href="#/">Home</a>
      </nav>
    </main>
  );
}
