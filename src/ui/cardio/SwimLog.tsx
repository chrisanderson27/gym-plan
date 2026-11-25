import { useState } from 'preact/hooks';
import type { CssInput } from '../../data/cardio';
import { LIMITS, rangeError } from '../limits';
import { parseMSS } from './format';
import { RpeChips } from './RpeChips';

export interface SwimLogValues {
  distance: number;
  durationMin: number;
  rpe: number;
  shoulderPainFlag: boolean;
  css?: CssInput;
}

export function SwimLog({ defaultDistance, defaultMinutes = 45, onSave }: {
  defaultDistance: number;
  defaultMinutes?: number;
  onSave: (v: SwimLogValues) => Promise<void>;
}) {
  const [distance, setDistance] = useState(String(defaultDistance));
  const [minutes, setMinutes] = useState(String(defaultMinutes));
  const [rpe, setRpe] = useState<number | null>(null);
  const [pain, setPain] = useState(false);
  const [didTest, setDidTest] = useState(false);
  const [t400, setT400] = useState('');
  const [t200, setT200] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const distanceError = rangeError(distance, 'Distance', LIMITS.swimMeters, { min: 1 });
  const minutesError = rangeError(minutes, 'Duration', LIMITS.swimMinutes, { min: 1 });
  const ok = rpe !== null && Number(distance) > 0 && Number(minutes) > 0 && !distanceError && !minutesError;

  const save = async () => {
    if (rpe === null || !ok) return;
    const a = parseMSS(t400);
    const b = parseMSS(t200);
    if (didTest && (a === undefined || b === undefined)) {
      setError('Enter both CSS test times as m:ss, or untick the CSS test.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({
        distance: Number(distance), durationMin: Math.round(Number(minutes)), rpe, shoulderPainFlag: pain,
        ...(didTest && a !== undefined && b !== undefined ? { css: { t400: a, t200: b } } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <label>
        Distance
        <input data-testid="swim-distance" inputMode="decimal" value={distance} onInput={(e) => setDistance(e.currentTarget.value)} />
      </label>
      {distanceError && <p class="field-error" role="alert">{distanceError}</p>}
      <label>
        Duration (min)
        <input inputMode="decimal" value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} />
      </label>
      {minutesError && <p class="field-error" role="alert">{minutesError}</p>}
      <p>RPE</p>
      <RpeChips value={rpe} onChange={setRpe} />
      <button type="button" class={pain ? 'chip on pain' : 'chip'} aria-pressed={pain} data-testid="swim-shoulder-pain" onClick={() => setPain(!pain)}>Shoulder pain</button>
      <label class="check">
        <input type="checkbox" checked={didTest} onChange={(e) => setDidTest(e.currentTarget.checked)} />
        <span>I did a CSS test today</span>
      </label>
      {didTest && (
        <>
          <label>
            Test 400 (m:ss)
            <input value={t400} onInput={(e) => setT400(e.currentTarget.value)} />
          </label>
          <label>
            Test 200 (m:ss)
            <input value={t200} onInput={(e) => setT200(e.currentTarget.value)} />
          </label>
        </>
      )}
      {error && <p role="alert" class="warn">{error}</p>}
      <button type="button" class="primary" data-testid="swim-save" disabled={!ok || busy} onClick={save}>Save</button>
    </section>
  );
}
