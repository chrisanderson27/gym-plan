import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { finishLiftSession } from '../../data/lift';
import { loadRingInput } from '../../data/plan';
import { FINISH_DWELL_MS, FINISH_RPE } from '../../engine/config';
import { weeklyGoal } from '../../engine/plan/ring';
import { Sheet } from '../Sheet';
import { Ring } from '../home/Ring';
import { Confetti } from './Confetti';
import './finish-ring.css';

const RATINGS = { easy: 'Easy', right: 'Right', hard: 'Hard' } as const;
type Rating = keyof typeof RATINGS;
type RingState = ReturnType<typeof weeklyGoal>;

function ringFor({ sessions, today, programStart, activities }: Awaited<ReturnType<typeof loadRingInput>>) {
  return weeklyGoal(sessions, today, programStart, activities);
}

export function FinishSheet({
  sessionId, onClose, onDone, finish = (rpe, now) => finishLiftSession(db, sessionId, rpe, now),
}: {
  sessionId: string;
  finish?: (rpe: number, now: Date) => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ before: RingState; after: RingState } | null>(null);
  const [error, setError] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => doneRef.current(), FINISH_DWELL_MS);
    return () => clearTimeout(id);
  }, [result]);

  const saveRating = async (rating: Rating) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    const now = new Date();
    try {
      const before = ringFor(await loadRingInput(db, now));
      await finish(FINISH_RPE[rating], now);
      const after = ringFor(await loadRingInput(db, now));
      setResult({ before, after });
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
          <Ring ring={result.after} previousRing={result.before} budget={[]} freezeAvailable={false} />
          {!result.before.closed && result.after.closed && <Confetti />}
        </div>
      ) : (
        <div class="session-actions">
          {(Object.keys(RATINGS) as Rating[]).map((rating) => (
            <button key={rating} type="button" class="btn" data-testid={`finish-${rating}`} disabled={busy} onClick={() => saveRating(rating)}>
              {RATINGS[rating]}
            </button>
          ))}
        </div>
      )}
      {error && <p class="error" role="alert">Could not save the workout. Try again.</p>}
    </Sheet>
  );
}
