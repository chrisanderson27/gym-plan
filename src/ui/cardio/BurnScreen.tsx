import { useRef, useState } from 'preact/hooks';
import { BURN_TEMPLATES } from '../../content/burn-templates';
import { findStaleOpenBurns, planBurn, startOrResumeBurn } from '../../data/burn';
import { loadCardioSnapshot } from '../../data/cardio';
import { db } from '../../data/db';
import { findOpenLiftSession } from '../../data/lift';
import { useLiveQuery } from '../../data/live';
import { BURN_BUDGETS_MIN, BURN_DEFAULT_MIN } from '../../engine/config';
import { unlockAudio } from '../../platform/audio';
import { exerciseName } from '../labels';
import { MineRow } from '../mine/MineRow';
import { MoreMenu } from '../MoreMenu';
import { navigate } from '../router';
import { Sheet } from '../Sheet';
import { dayOf } from './format';

const staleDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** Budgets a Burn can start with. A fresh Repeat passes the 45-minute floor so it never offers a shorter one. */
export const burnBudgets = (minMin = 0) => BURN_BUDGETS_MIN.filter((m) => m >= minMin);

export function BurnScreen({ templateId, minBudgetMin }: { templateId?: string; minBudgetMin?: number }) {
  const [picked, setPicked] = useState<string>();
  const [budgetMin, setBudgetMin] = useState<number>(BURN_DEFAULT_MIN);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const starting = useRef(false);
  const data = useLiveQuery(async () => {
    const now = new Date();
    const [plan, open, stale, snap] = await Promise.all([
      planBurn(db, { templateId: picked ?? templateId, budgetMin }, now),
      findOpenLiftSession(db, now, ['burn']),
      findStaleOpenBurns(db, now),
      loadCardioSnapshot(db, now),
    ]);
    return { plan, open, stale: stale[0], last: snap.lastByType.burn };
  }, [picked, templateId, budgetMin]);

  if (!data) return <main class="screen"><h1>Burn</h1></main>;
  const { plan, open, stale, last } = data;
  const selected = picked ?? plan.template.id;
  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(false);
    unlockAudio();
    try {
      const id = open?.id ?? await startOrResumeBurn(db, { templateId: selected, budgetMin });
      navigate(`/burn/session/${id}`);
    } catch {
      setError(true);
      starting.current = false;
      setBusy(false);
    }
  };
  const swap = plan.swaps[0];

  return (
    <main class="screen">
      <header class="bar">
        <h1>Burn</h1>
        <a class="gear" href="#/">Home</a>
        <MoreMenu feedback={{ kind: 'workout', context: { templateId: plan.template.id } }} />
      </header>
      <section class="plan-card" data-activity="burn" data-testid="burn-plan">
        <h2>{plan.template.name}</h2>
        <p class="num" data-testid="burn-total">{plan.totalMin} min · turf</p>
        <ul class="plan">
          {plan.blocks.map((b) => (
            <li key={b.id}>{b.kind === 'circuit' ? `${b.label} · ${b.durationSec / 60} min · ${b.stations.length} stations` : b.label}</li>
          ))}
        </ul>
        {(swap || plan.dropped.length > 0) && (
          <p class="dim">{swap ? `Swapped ${exerciseName(swap.from)} → ${exerciseName(swap.to)}` : 'Some planned stations were unavailable.'}</p>
        )}
      </section>
      <button type="button" class="btn change-line" data-testid="burn-change" onClick={() => setChanging(true)}>
        {plan.template.name} · {plan.totalMin} min · Change
      </button>
      <button type="button" class="primary" data-testid="burn-start" disabled={busy} onClick={start}>{open ? 'Resume' : 'Start'}</button>
      {error && <p class="error" role="alert">Could not start Burn. Try again.</p>}
      {stale && <a class="btn" data-testid="burn-stale" href={`#/burn/session/${stale.id}`}>Unfinished Burn from {staleDate.format(new Date(stale.date))}</a>}
      <p class="dim">{last ? `Last Burn: ${dayOf(last)}` : 'No Burn yet'}</p>
      <MineRow types={['burn']} />
      {changing && (
        <Sheet label="Change Burn" onClose={() => setChanging(false)}>
          <h2>Change Burn</h2>
          <div class="chips">
            {BURN_TEMPLATES.map((t) => (
              <button key={t.id} type="button" class={t.id === selected ? 'chip on' : 'chip'} aria-pressed={t.id === selected}
                data-testid={`burn-template-${t.id}`} onClick={() => setPicked(t.id)}>{t.name}</button>
            ))}
          </div>
          <div class="chips">
            {burnBudgets(minBudgetMin).map((m) => (
              <button key={m} type="button" class={m === budgetMin ? 'chip on' : 'chip'} aria-pressed={m === budgetMin}
                data-testid={`burn-budget-${m}`} onClick={() => setBudgetMin(m)}>{m} min</button>
            ))}
          </div>
          <button type="button" class="btn sheet-cancel" onClick={() => setChanging(false)}>Done</button>
        </Sheet>
      )}
    </main>
  );
}
