import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { finishLiftSession } from '../../data/lift';
import { loadRingInput } from '../../data/plan';
import { FINISH_RPE } from '../../engine/config';
import { programWeekRange } from '../../engine/lift/volume';
import { weekRing } from '../../engine/plan/ring';
import { Sheet } from '../Sheet';
import { Ring } from '../home/Ring';
import { Confetti } from './Confetti';

const RATINGS = { easy: 'Easy', right: 'Right', hard: 'Hard' } as const;
type Rating = keyof typeof RATINGS;
type RingState = ReturnType<typeof weekRing>;

function ringFor({ sessions, today, programStart, activities }: Awaited<ReturnType<typeof loadRingInput>>) {
  return weekRing(sessions, programWeekRange(today, programStart), activities);
}

export function FinishSheet({ sessionId, onClose, onDone }: {
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ring: RingState; closed: boolean } | null>(null);
  const [error, setError] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!result) return;
    const duration = getComputedStyle(document.documentElement).getPropertyValue('--dur-base');
    const id = setTimeout(() => doneRef.current(), parseFloat(duration) || 0);
    return () => clearTimeout(id);
  }, [result]);

  const finish = async (rating: Rating) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    const now = new Date();
    try {
      const before = ringFor(await loadRingInput(db, now));
      await finishLiftSession(db, sessionId, FINISH_RPE[rating], now);
      const after = ringFor(await loadRingInput(db, now));
      setResult({ ring: after, closed: !before.closed && after.closed });
    } catch {
      setError(true);
      setBusy(false);
      saving.current = false;
    }
  };

  return (
    <Sheet label="How was it?" onClose={() => { if (!saving.current) onClose(); }}>
      <h2>{result ? 'Workout saved' : 'How was it?'}</h2>
      {result ? (
        <div class="finish-ring">
          <Ring ring={result.ring} budget={[]} freezeAvailable={false} />
          {result.closed && <Confetti />}
        </div>
      ) : (
        <div class="session-actions">
          {(Object.keys(RATINGS) as Rating[]).map((rating) => (
            <button key={rating} type="button" class="btn" data-testid={`finish-${rating}`} disabled={busy} onClick={() => finish(rating)}>
              {RATINGS[rating]}
            </button>
          ))}
        </div>
      )}
      {error && <p class="error" role="alert">Could not save the workout. Try again.</p>}
    </Sheet>
  );
}
