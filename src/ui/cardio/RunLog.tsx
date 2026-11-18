import { useState } from 'preact/hooks';
import type { CardioModality } from '../../data/types';
import { RpeChips } from './RpeChips';

export interface RunLogValues {
  distanceMi: number;
  durationSec: number;
  modality: CardioModality;
  rpe: number;
  painFlag: boolean;
}

const DEFAULT_MODALITIES: { id: CardioModality; label: string }[] = [{ id: 'run', label: 'Outdoors' }, { id: 'treadmill', label: 'Treadmill' }];

export function RunLog({ defaultMinutes, defaultModality, onSave, modalities = DEFAULT_MODALITIES }: {
  defaultMinutes: number; defaultModality: CardioModality; onSave: (v: RunLogValues) => Promise<void>;
  modalities?: { id: CardioModality; label: string }[];
}) {
  const [distance, setDistance] = useState('');
  const [minutes, setMinutes] = useState(String(defaultMinutes));
  const [modality, setModality] = useState<CardioModality>(defaultModality);
  const [rpe, setRpe] = useState<number | null>(null);
  const [pain, setPain] = useState(false);
  const [busy, setBusy] = useState(false);
  const mins = Number(minutes);
  const ok = rpe !== null && mins > 0;

  const save = async () => {
    if (rpe === null || !(mins > 0)) return;
    setBusy(true);
    try {
      // An unknown distance is 0: the guardrails ignore runs with no distance.
      await onSave({ distanceMi: Number(distance) > 0 ? Number(distance) : 0, durationSec: Math.round(mins * 60), modality, rpe, painFlag: pain });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <label>
        Distance (mi, optional)
        <input data-testid="run-distance" inputMode="decimal" value={distance} onInput={(e) => setDistance(e.currentTarget.value)} />
      </label>
      <label>
        Duration (min)
        <input data-testid="run-duration" inputMode="decimal" value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} />
      </label>
      <label>
        Where
        <select value={modality} onChange={(e) => setModality(e.currentTarget.value as CardioModality)}>
          {modalities.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <p>RPE</p>
      <RpeChips value={rpe} onChange={setRpe} />
      <button type="button" class={pain ? 'chip on pain' : 'chip'} aria-pressed={pain} data-testid="run-pain" onClick={() => setPain(!pain)}>Pain</button>
      <button type="button" class="primary" data-testid="run-save" disabled={!ok || busy} onClick={save}>Save</button>
    </section>
  );
}
