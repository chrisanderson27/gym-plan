import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { MixedInputError, StaleWorkoutError, startMixedSession } from '../../data/mixedSession';
import type { OrderedPrescription } from '../../data/types';
import { unlockAudio } from '../../platform/audio';
import { navigate } from '../router';

export function OrderedStart({ source, ordered, children, onStale, disabled, testId }: {
  source: Parameters<typeof startMixedSession>[1]; ordered?: OrderedPrescription; children: ComponentChildren;
  onStale?: () => Promise<void>; disabled?: boolean; testId?: string;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    unlockAudio();
    try {
      navigate('/workout/session/' + await startMixedSession(db, source, undefined, ordered));
    } catch (reason) {
      if (reason instanceof StaleWorkoutError && onStale) {
        try {
          await onStale();
        } catch {
          setError('Could not refresh the workout. Reopen the preview and try again.');
          return;
        }
      }
      setError(reason instanceof MixedInputError ? reason.message : 'Could not start the workout. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return <>
    <button type="button" class="primary" data-testid={testId} disabled={disabled || busy} onClick={start}>{children}</button>
    {error && <p class="workout-error" role="alert">{error}</p>}
  </>;
}
