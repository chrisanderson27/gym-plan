import { useRef, useState } from 'preact/hooks';
import type { CircuitLog, StationTarget } from '../../data/types';
import { Sheet } from '../Sheet';
import { Stepper } from '../lift/Stepper';

const RIRS = [{ value: 0, label: '0' }, { value: 1, label: '1–2' }, { value: 3, label: '3+' }] as const;

export function BlockEndSheet({ rounds, stations, onClose, onSave }: {
  rounds: number;
  stations: { name: string; target: StationTarget }[];
  onClose: () => void;
  onSave: (result: Pick<CircuitLog, 'completedRounds' | 'partialReps' | 'lastRoundRir'>) => Promise<void>;
}) {
  const [completedRounds, setRounds] = useState(rounds);
  const [stationIndex, setStation] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [rir, setRir] = useState<CircuitLog['lastRoundRir']>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState(false);
  const select = (i: number | null) => {
    setStation(i);
    setCount(0);
  };

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    try {
      await onSave({
        completedRounds,
        ...(stationIndex === null ? {} : { partialReps: { stationIndex, count } }),
        ...(rir === undefined ? {} : { lastRoundRir: rir }),
      });
    } catch {
      saving.current = false;
      setBusy(false);
      setError(true);
    }
  };

  return (
    <Sheet label="End block" onClose={() => { if (!saving.current) onClose(); }}>
      <h2>End block</h2>
      <div class="session-stepper">
        <span>Completed rounds</span>
        <Stepper value={completedRounds} unit="rounds" downLabel="Rounds down" upLabel="Rounds up"
          onDown={() => setRounds((n) => Math.max(0, n - 1))} onUp={() => setRounds((n) => n + 1)} />
      </div>
      <p>Stopped at</p>
      <div class="chips">
        <button type="button" class={stationIndex === null ? 'chip on' : 'chip'} aria-pressed={stationIndex === null} onClick={() => select(null)}>None</button>
        {stations.map(({ name }, i) => (
          <button key={i} type="button" class={i === stationIndex ? 'chip on' : 'chip'} aria-pressed={i === stationIndex}
            data-testid={`partial-${i}`} onClick={() => select(i)}>{name}</button>
        ))}
      </div>
      {stationIndex !== null && stations[stationIndex] && (
        <div class="session-stepper">
          <span>Partial count ({stations[stationIndex].target.unit})</span>
          <Stepper value={count} unit={stations[stationIndex].target.unit} valueTestId="partial-count"
            downLabel="Partial count down" upLabel="Partial count up"
            onDown={() => setCount((n) => Math.max(0, n - 1))} onUp={() => setCount((n) => n + 1)} />
        </div>
      )}
      <p>Left in the last round</p>
      <div class="chips">
        {RIRS.map(({ value, label }) => (
          <button key={value} type="button" class={value === rir ? 'chip on' : 'chip'} aria-pressed={value === rir} onClick={() => setRir(value)}>{label}</button>
        ))}
      </div>
      {error && <p class="error" role="alert">Could not save the block. Try again.</p>}
      <button type="button" class="primary" data-testid="block-save" disabled={busy} onClick={save}>Save</button>
    </Sheet>
  );
}
