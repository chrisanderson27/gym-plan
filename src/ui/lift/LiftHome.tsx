import { useEffect, useRef, useState } from 'preact/hooks';
import { LIFT_TEMPLATES, exerciseById } from '../../content';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { LIFT_EXERCISES, buildLiftPlan, findOpenLiftSession, loadLiftSnapshot, startLiftSession, variantMuscles } from '../../data/lift';
import { planTodayLift, startOrResumePlannedLift } from '../../data/liftday';
import { MineRow } from '../mine/MineRow';
import type { LiftVariant } from '../../data/types';
import { DEFAULT_LIFT_BUDGET_MIN, LIFT_BUDGETS_MIN } from '../../engine/config';
import { muscleReadiness, variantReadiness } from '../../engine/lift/readiness';
import { nextVariant } from '../../engine/lift/rotation';
import { exerciseName, floorLabel, humanize, variantName } from '../labels';
import { navigate } from '../router';

const VARIANTS: LiftVariant[] = ['lower-a', 'upper-a', 'lower-b', 'upper-b'];

export function LiftHome({ autoStart, initial, blocks }: { autoStart?: LiftVariant; initial?: LiftVariant; blocks?: boolean }) {
  const data = useLiveQuery(async () => ({ snapshot: await loadLiftSnapshot(db), open: (await findOpenLiftSession(db)) ?? null }), []);
  const [picked, setPicked] = useState<LiftVariant | null>(initial ?? null);
  const [budget, setBudget] = useState<number>(DEFAULT_LIFT_BUDGET_MIN);
  const started = useRef(false);

  const [startError, setStartError] = useState(false);
  const snapshot = data?.snapshot;
  const readiness = snapshot && muscleReadiness(snapshot, LIFT_EXERCISES);
  const ready = (v: LiftVariant) => variantReadiness(variantMuscles(v), readiness!, snapshot!.now);
  const suggestion = snapshot && nextVariant(snapshot.history, (v) => ready(v).ready);
  const variant = picked ?? suggestion?.variant;
  const day = useLiveQuery(async () => {
    if (!blocks || !variant) return null;
    return { variant, budget, plan: await planTodayLift(db, variant, budget) };
  }, [blocks, variant, budget]);
  const dayPlan = day?.variant === variant && day?.budget === budget ? day?.plan : undefined;
  useEffect(() => {
    if (!autoStart || !snapshot || started.current) return;
    started.current = true;
    const plan = buildLiftPlan(snapshot, autoStart, DEFAULT_LIFT_BUDGET_MIN, true);
    startLiftSession(db, plan).then((id) => navigate('/lift/session/' + id));
  }, [autoStart, snapshot]);

  if (!data || !snapshot || !variant || !suggestion) return <main class="screen"><h1>Lift</h1></main>;

  const plan = blocks ? dayPlan : buildLiftPlan(snapshot, variant, budget);

  const start = async () => {
    if (started.current) return;
    started.current = true;
    setStartError(false);
    try {
      const id = blocks
        ? await startOrResumePlannedLift(db, variant, budget)
        : await db.transaction('rw', [db.sessions, db.sets, db.equipment, db.exerciseOverrides], async () =>
          (await findOpenLiftSession(db))?.id ?? startLiftSession(db, buildLiftPlan(snapshot, variant, budget)),
        );
      navigate('/lift/session/' + id);
    } catch {
      started.current = false;
      setStartError(true);
    }
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>Lift</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      {data.open && (
        <a class="resume" data-testid="resume" href={'#/lift/session/' + data.open.id}>
          <span>Resume {data.open.variant ? variantName(data.open.variant) : 'session'}</span>
          <span aria-hidden="true">→</span>
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
      {plan?.deload && <p class="badge">Deload week: fewer sets, no raises</p>}
      {plan?.rampIn && <p class="badge">Ramp-in: ~60% volume, easy effort</p>}
      {plan && (
        <>
          <ul class="plan">
            {plan.blocks.map((b) => {
              if (b.kind === 'circuit') return <li key={b.id}><strong>{b.label}</strong><span class="num">{b.durationSec / 60} min</span></li>;
              if (b.kind !== 'lift') return null;
              const p = 'prescriptions' in plan ? plan.prescriptions.get(b.id) : plan.main;
              const name = blocks && b.warmup && b.label ? b.label : exerciseById.get(b.exerciseId)?.name ?? b.exerciseId;
              return (
                <li key={b.id} data-testid={`preview-${b.exerciseId}`}>
                  <strong>{name}</strong>
                  {b.warmup ? !blocks && <span>Warm-up · 7 min</span> : <span class="num">{p?.mode === 'calibrate' ? 'calibrate' : `${p?.sets} × ${p?.reps} @ ${p?.weight} lb`}</span>}
                </li>
              );
            })}
          </ul>
          {plan.dropped.length > 0 && <p class="dim">Dropped to fit {budget} min: {plan.dropped.map(exerciseName).join(', ')}</p>}
          <p class="dim num">≈ {Math.round(plan.estMin)} min{'floor' in plan && ` · ${floorLabel(plan.floor)}`}</p>
        </>
      )}
      {startError && <p class="error" role="alert">Could not start the lift. Try again.</p>}
      <button type="button" class="primary" data-testid="start-lift" disabled={!plan} onClick={start}>Start</button>
      <MineRow types={['lift', 'custom']} />
      <nav class="linkbar" aria-label="Lift links">
        <a class="btn" href="#/lift/volume">Weekly volume</a>
        <a class="btn" href="#/lift/gym">My gym</a>
        <a class="btn" href="#/">Home</a>
      </nav>
    </main>
  );
}
