import { useState } from 'preact/hooks';
import { loadBodyLogs, saveBodyLog } from '../../data/body';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import type { Settings } from '../../data/types';
import { BODY_MAINTAIN_BAND_LB, BODY_RATE_BAND_LB, BODY_RATE_MIN_SPAN_DAYS } from '../../engine/config';
import { etaToGoal, rateBand, round1, waistDue, weeklyRate, weightTrend } from '../../engine/body';
import { localDate } from '../../engine/dates';
import { rateLabel } from '../labels';
import { MoreMenu } from '../MoreMenu';
import { TrendChart } from './TrendChart';

const BAND_TEXT = { gaining: 'gaining', below: 'below band', in: 'in band', above: 'above band' } as const;

export function BodyScreen({ settings }: { settings: Settings }) {
  const logs = useLiveQuery(() => loadBodyLogs(db), []);
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const today = localDate(new Date());

  if (!logs) return <main class="screen"><h1>Weigh-in</h1></main>;
  const points = weightTrend(logs);
  const last = points.at(-1);
  const rate = weeklyRate(points, today);
  const direction = settings.goalDirection ?? 'lose';
  const band = rateBand(rate);
  const noEta = { lose: 'not trending down', gain: 'not trending up', maintain: `outside ±${BODY_MAINTAIN_BAND_LB} lb` };
  const eta = last ? etaToGoal(last.trend, settings.goalWeightLb, rate, today, direction) : null;
  const todayRow = logs.find((l) => l.date === today);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
      // The field is already cleared by `fn`; the confirmation below reads the saved row, never the input.
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>Weigh-in</h1>
        <a class="gear" href="#/progress">Progress</a>
        <MoreMenu feedback={{ kind: 'workout', context: {} }} />
      </header>
      <label>
        Weight (lb)
        <input data-testid="body-weight" inputMode="decimal" value={weight} placeholder="" onInput={(e) => setWeight(e.currentTarget.value)} />
      </label>
      <button type="button" class="primary" data-testid="body-save" disabled={!weight}
        onClick={() => run(async () => { await saveBodyLog(db, today, { weightLb: Number(weight) }); setWeight(''); })}>Save</button>
      <label class="check">
        <input type="checkbox" data-testid="body-protein" checked={!!todayRow?.protein}
          onChange={() => run(() => saveBodyLog(db, today, { protein: !todayRow?.protein }))} />
        <span>Protein</span>
      </label>
      <label>
        Waist (in) {waistDue(logs, today) && <span class="badge" data-testid="body-waist-due">due</span>}
        <input data-testid="body-waist" inputMode="decimal" value={waist} onInput={(e) => setWaist(e.currentTarget.value)} />
      </label>
      <button type="button" data-testid="body-waist-save" disabled={!waist}
        onClick={() => run(async () => { await saveBodyLog(db, today, { waistIn: Number(waist) }); setWaist(''); })}>Save waist</button>
      {error && <p role="alert" class="warn">{error}</p>}
      {saved && todayRow && (
        <p role="status" class="ok" data-testid="body-saved">
          Saved for today: {todayRow.weightLb ? `${todayRow.weightLb} lb` : 'no weight'}{todayRow.waistIn ? ` · waist ${todayRow.waistIn} in` : ''}
        </p>
      )}

      {last && (
        <section class="card">
          <p class="num" data-testid="body-trend">Trend {round1(last.trend)} lb</p>
          <p class="num" data-testid="body-rate">
            {rate === null || band === null
              ? `not enough data (need ${BODY_RATE_MIN_SPAN_DAYS} days)`
              : `${rateLabel(rate)}${direction === 'lose' ? ` · ${BAND_TEXT[band]} (${BODY_RATE_BAND_LB[0]}–${BODY_RATE_BAND_LB[1]})` : ''}`}
          </p>
          <p class="num" data-testid="body-eta">
            {eta === 'reached' ? `Goal ${settings.goalWeightLb} reached` : eta === null ? noEta[direction] : `ETA ${settings.goalWeightLb} ≈ ${eta}`}
          </p>
        </section>
      )}
      <TrendChart points={points} goal={settings.goalWeightLb} />
      <details>
        <summary>Entries</summary>
        <ul class="plan num">
          {points.slice(-14).reverse().map((p) => (
            <li key={p.date}><span>{p.date}</span><span>{p.weight} lb · trend {round1(p.trend)} lb</span></li>
          ))}
        </ul>
      </details>
    </main>
  );
}
