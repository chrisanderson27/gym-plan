import { useState } from 'preact/hooks';
import { LIFT_TEMPLATES, exerciseById } from '../../content';
import { loadCardioSnapshot } from '../../data/cardio';
import { db } from '../../data/db';
import { buildHybridPlan, startHybridSession } from '../../data/hybrid';
import { useLiveQuery } from '../../data/live';
import { LIFT_EXERCISES, findOpenLiftSession, loadLiftSnapshot, variantMuscles } from '../../data/lift';
import type { LiftVariant } from '../../data/types';
import { HYBRID_LEG_MODALITIES } from '../../engine/config';
import { isLowerVariant } from '../../engine/hybrid';
import { muscleReadiness, variantReadiness } from '../../engine/lift/readiness';
import { nextVariant } from '../../engine/lift/rotation';
import { humanize, modalityName, plural, runKindName } from '../labels';
import { MineRow } from '../mine/MineRow';
import { navigate } from '../router';
import { FeedbackButton } from '../slots/FeedbackButton';

const VARIANTS: LiftVariant[] = ['upper-a', 'upper-b', 'lower-a', 'lower-b'];

export function HybridScreen({ initial }: { initial?: LiftVariant }) {
  const data = useLiveQuery(async () => ({
    lift: await loadLiftSnapshot(db),
    cardio: await loadCardioSnapshot(db),
    open: (await findOpenLiftSession(db, new Date(), ['hybrid'])) ?? null,
  }), []);
  const [picked, setPicked] = useState<LiftVariant | null>(initial ?? null);
  const [kind, setKind] = useState<'easy' | 'intervals'>('easy');
  const [modality, setModality] = useState<(typeof HYBRID_LEG_MODALITIES)[number]>('bike');
  const [busy, setBusy] = useState(false);

  if (!data) return <main class="screen"><h1>Hybrid</h1></main>;
  const readiness = muscleReadiness(data.lift, LIFT_EXERCISES);
  const ready = (v: LiftVariant) => variantReadiness(variantMuscles(v), readiness, data.lift.now);
  const variant = picked ?? nextVariant(data.lift.history, (v) => ready(v).ready).variant;
  const plan = buildHybridPlan(data.lift, data.cardio, { variant, cardioKind: kind, modality });
  const lower = isLowerVariant(variant);
  const cardioMin = Math.round(plan.cardio.plannedSec / 60);

  const start = async () => {
    setBusy(true);
    const id = await startHybridSession(db, plan);
    navigate('/hybrid/session/' + id);
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>Hybrid</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      {data.open && <a class="resume" data-testid="hybrid-resume" href={'#/hybrid/session/' + data.open.id}>Resume hybrid →</a>}
      <div class="chips">
        {VARIANTS.map((v) => (
          <button key={v} type="button" class={v === variant ? 'chip on' : 'chip'} data-testid={`hybrid-variant-${v}`} onClick={() => setPicked(v)}>
            {LIFT_TEMPLATES[v].name}
          </button>
        ))}
      </div>
      <div class="chips">
        {(['easy', 'intervals'] as const).map((k) => (
          <button key={k} type="button" class={k === kind ? 'chip on' : 'chip'} data-testid={`hybrid-kind-${k}`} onClick={() => setKind(k)}>{runKindName(k)}</button>
        ))}
      </div>
      {lower && (
        <div class="chips">
          {HYBRID_LEG_MODALITIES.map((m) => (
            <button key={m} type="button" class={m === modality ? 'chip on' : 'chip'} data-testid={`hybrid-modality-${m}`} onClick={() => setModality(m)}>{modalityName(m)}</button>
          ))}
        </div>
      )}
      <ul class="plan">
        {plan.lift.blocks.filter((b) => !b.warmup).map((b) => (
          <li key={b.id}><strong>{exerciseById.get(b.exerciseId)?.name ?? b.exerciseId}</strong><span>{plural(b.sets, 'set')}</span></li>
        ))}
      </ul>
      <p data-testid="hybrid-cardio"><strong>Then {modalityName(plan.cardio.block.modality)} {cardioMin} min</strong> ({runKindName(plan.cardio.block.runKind)})</p>
      <ul class="plan">
        {plan.cardio.reasons.map((r) => <li key={r} class="dim">{humanize(r)}</li>)}
      </ul>
      <button type="button" class="primary" data-testid="hybrid-start" disabled={busy} onClick={start}>Start</button>
      <MineRow types={['hybrid']} />
      <FeedbackButton kind="workout" context={{}} />
    </main>
  );
}
