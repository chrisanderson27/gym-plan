import { useMemo, useState } from 'preact/hooks';
import { BURN_TEMPLATES } from '../../content/burn-templates';
import { burnInputs, loadCardioSnapshot, saveBurn } from '../../data/cardio';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { useLiveQuery } from '../../data/live';
import type { IntervalBlock } from '../../data/types';
import { generateBurn, nextBurnTemplate } from '../../engine/burn';
import { BURN_BUDGETS_MIN, BURN_DEFAULT_MIN } from '../../engine/config';
import { navigate } from '../router';
import { FeedbackButton } from '../slots/FeedbackButton';
import { dayOf } from './format';
import { RpeChips } from './RpeChips';
import { TimerScreen } from './TimerScreen';

type Stage = 'preview' | 'timer' | 'log';
const { substitutesOf, labelOf } = burnInputs();
const blockMin = (b: IntervalBlock) => Math.round((b.rounds * b.phases.reduce((n, p) => n + p.sec, 0)) / 60);

export function BurnScreen() {
  const snap = useLiveQuery(() => loadCardioSnapshot(db), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [budget, setBudget] = useState<number>(BURN_DEFAULT_MIN);
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<Stage>('preview');
  const [frozen, setFrozen] = useState<IntervalBlock[]>([]);
  const [result, setResult] = useState<{ blocks: IntervalBlock[]; startedAt: string; early: boolean } | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Cardio holds no session row until Save, so the id is pre-allocated for feedback to link to it.
  const [sessionId] = useState(newId);

  const templateId = picked ?? nextBurnTemplate(BURN_TEMPLATES.map((t) => t.id), snap?.lastDone ?? {});
  const template = BURN_TEMPLATES.find((t) => t.id === templateId) ?? BURN_TEMPLATES[0]!;
  const excluded = snap?.excluded;

  const plan = useMemo(() => {
    const gen = generateBurn({ blocks: template.blocks, budgetMin: budget, excluded: excluded ?? new Set(), substitutesOf, labelOf, makeId: newId });
    // Per-session swaps sit on top of the persistent "not at my gym" exclusions.
    const blocks = gen.blocks.map((b) => ({
      ...b,
      phases: b.phases.map((p) => {
        const to = p.exerciseId ? swaps[p.exerciseId] : undefined;
        return to ? { ...p, exerciseId: to, label: labelOf[to] ?? to } : p;
      }),
    }));
    return { ...gen, blocks };
  }, [template, budget, excluded, swaps]);

  if (!snap) return <main class="screen"><h1>Burn class</h1></main>;

  if (stage === 'timer') {
    return (
      <TimerScreen
        blocks={frozen}
        feedbackContext={{ sessionId, templateId: template.id }}
        onExit={() => setStage('preview')}
        onFinish={(blocks, startedAt, early) => { setResult({ blocks, startedAt, early }); setStage('log'); }}
      />
    );
  }

  if (stage === 'log' && result) {
    const save = async () => {
      setSaving(true);
      try {
        await saveBurn(db, { templateId: template.id, blocks: result.blocks, rpe, startedAt: result.startedAt, id: sessionId });
        navigate('/');
      } finally {
        setSaving(false);
      }
    };
    return (
      <main class="screen">
        <h1>{result.early ? 'Session ended early' : 'Session complete'}</h1>
        <p>How hard was it? (optional)</p>
        <RpeChips value={rpe} onChange={setRpe} allowSkip />
        <button type="button" class="primary" data-testid="burn-save" disabled={saving} onClick={save}>Save</button>
        <FeedbackButton kind="workout" context={{ sessionId, templateId: template.id }} />
      </main>
    );
  }

  // Cycle through the stations a swap can use; the current one is first so "no swap" is a stop.
  const swapFor = (id: string) => {
    const options = [id, ...(substitutesOf[id] ?? []).filter((s) => !excluded?.has(s))];
    const next = options[(options.indexOf(swaps[id] ?? id) + 1) % options.length]!;
    setSwaps({ ...swaps, [id]: next });
  };
  const last = snap.lastByType.burn;

  return (
    <main class="screen">
      <header class="bar">
        <h1>Burn class</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      <div class="chips">
        {BURN_TEMPLATES.map((t) => (
          <button key={t.id} type="button" class={t.id === template.id ? 'chip on' : 'chip'} data-testid={`burn-template-${t.id}`} onClick={() => { setPicked(t.id); setSwaps({}); }}>
            {t.name}
          </button>
        ))}
      </div>
      <p class="dim">{template.summary}</p>
      <div class="chips">
        {BURN_BUDGETS_MIN.map((m) => (
          <button key={m} type="button" class={m === budget ? 'chip on' : 'chip'} data-testid={`burn-budget-${m}`} onClick={() => setBudget(m)}>{m}</button>
        ))}
      </div>
      <p data-testid="burn-total"><strong>{plan.totalMin} min</strong>{plan.swaps.length > 0 && ` · swapped ${plan.swaps.map((s) => `${labelOf[s.from] ?? s.from} → ${labelOf[s.to] ?? s.to}`).join(', ')}`}</p>
      <ul class="plan">
        {plan.blocks.map((b) => {
          const stations = [...new Set(b.phases.filter((p) => p.exerciseId).map((p) => p.exerciseId!))];
          return (
            <li key={b.id}>
              <span>{b.label ?? 'Block'} · {b.rounds}×</span>
              <span>{blockMin(b)} min</span>
              {stations.length > 0 && stations.length <= 4 && (
                <span class="stations">
                  {stations.map((id) => (
                    <button key={id} type="button" class="link" onClick={() => swapFor(id)}>{labelOf[id] ?? id} ⇄</button>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" class="primary" data-testid="burn-start" onClick={() => { setFrozen(plan.blocks); setStage('timer'); }}>Start</button>
      <p class="dim">{last ? `Last Burn: ${dayOf(last)}` : 'No Burn yet'}</p>
      <FeedbackButton kind="workout" context={{ templateId: template.id }} />
    </main>
  );
}
