import { useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { discardLiftSession } from '../../data/lift';
import type { Session } from '../../data/types';
import { navigate } from '../router';
import { Sheet } from '../Sheet';
import { clearBlockStates } from './blockState';

export function DiscardSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const discarding = useRef(false);
  const [error, setError] = useState(false);
  const close = () => { if (!discarding.current) onClose(); };
  const discard = async () => {
    if (discarding.current) return;
    discarding.current = true;
    try {
      await discardLiftSession(db, session.id);
      clearBlockStates(session);
      navigate('/');
    } catch {
      setError(true);
      discarding.current = false;
    }
  };

  return (
    <Sheet label="Discard this workout?" onClose={close}>
      <h2>Discard this workout?</h2>
      <div class="session-actions">
        <button type="button" class="btn" data-testid="discard-confirm" onClick={discard}>Discard</button>
        <button type="button" class="btn" onClick={close}>Keep</button>
      </div>
      {error && <p class="error" role="alert">Could not discard the workout. Try again.</p>}
    </Sheet>
  );
}
