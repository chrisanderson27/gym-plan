import { useEffect, useRef } from 'preact/hooks';
import { restRemaining } from '../../engine/block/clock';
import { REST_STEP_SEC, TIMER_TICK_MS } from '../../engine/config';
import { beep } from '../../platform/audio';
import { fmtMSS } from '../cardio/format';
import { useNow } from './hooks';

export function RestTimer({ startedAtMs, restSec, onAdjust, onSkip, onEnd }: {
  startedAtMs: number;
  restSec: number;
  onAdjust: (delta: number) => void;
  onSkip: () => void;
  onEnd: () => void;
}) {
  const remaining = restRemaining(startedAtMs, restSec, useNow(TIMER_TICK_MS));
  const ended = useRef(false);
  useEffect(() => {
    if (remaining > 0 || ended.current) return;
    ended.current = true;
    beep('go');
    onEnd();
  }, [remaining, onEnd]);

  return (
    <section class="rest-clock" data-testid="rest-timer" aria-label="Rest timer">
      <p>Rest <strong class="num" data-testid="rest-remaining">{fmtMSS(remaining)}</strong></p>
      <div class="session-actions">
        <button type="button" class="btn" onClick={() => onAdjust(-REST_STEP_SEC)}>−{REST_STEP_SEC} s</button>
        <button type="button" class="btn" onClick={() => onAdjust(REST_STEP_SEC)}>+{REST_STEP_SEC} s</button>
        <button type="button" class="btn" onClick={onSkip}>Skip</button>
      </div>
    </section>
  );
}
