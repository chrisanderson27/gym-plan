import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { IntervalBlock } from '../../data/types';
import { TIMER_TICK_MS } from '../../engine/config';
import {
  beepsBetween, elapsedMs, flatten, initialTimer, summarize, timerReducer, timerView, type TimerAction, type TimerState,
} from '../../engine/timer';
import { beep, unlockAudio } from '../../platform/audio';
import { holdWakeLock } from '../../platform/wakelock';
import { FeedbackButton, type FeedbackContext } from '../slots/FeedbackButton';
import { fmtMSS } from './format';

interface Props {
  blocks: IntervalBlock[];
  /** Called once: on completion, or when the user ends early. */
  onFinish: (summarized: IntervalBlock[], startedAtIso: string, early: boolean) => void;
  onExit: () => void;
  feedbackContext: FeedbackContext;
}

export function TimerScreen({ blocks, onFinish, onExit, feedbackContext }: Props) {
  const steps = useMemo(() => flatten(blocks), [blocks]);
  const [state, setState] = useState<TimerState>(initialTimer());
  const [now, setNow] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const stateRef = useRef(state);
  const prevMs = useRef(0);
  const release = useRef<(() => void) | null>(null);
  const finished = useRef(false);

  const finish = (early: boolean) => {
    if (finished.current) return;
    const st = stateRef.current;
    if (st.startedAt === null) return;
    finished.current = true;
    release.current?.();
    release.current = null;
    onFinish(summarize(blocks, steps, st, Date.now()), new Date(st.startedAt).toISOString(), early);
  };

  // Everything derives from Date.now(): a backgrounded tab resumes at the right step.
  const tick = () => {
    const t = Date.now();
    setNow(t);
    const st = stateRef.current;
    const el = elapsedMs(st, t, steps);
    for (const b of beepsBetween(steps, prevMs.current, el)) beep(b);
    prevMs.current = el;
    if (st.startedAt !== null && timerView(blocks, steps, st, t).done) finish(false);
  };

  const dispatch = (action: TimerAction) => {
    const next = timerReducer(stateRef.current, action, Date.now(), steps);
    stateRef.current = next;
    setState(next);
    tick();
  };

  useEffect(() => {
    const id = setInterval(tick, TIMER_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      release.current?.();
    };
  }, []);

  const start = () => {
    unlockAudio(); // must happen inside this tap
    release.current = holdWakeLock();
    dispatch({ type: 'start' });
  };

  const v = timerView(blocks, steps, state, now);
  const role = v.started ? (v.step?.role ?? 'warmup') : 'warmup';

  return (
    <main class="timer" data-role={role} data-testid="timer">
      {!v.started ? (
        <>
          <h1>Ready</h1>
          <p>{fmtMSS(v.totalSec)} total · {steps[0]?.label}</p>
          <button type="button" class="primary" data-testid="timer-start" onClick={start}>Start</button>
          <button type="button" onClick={onExit}>Back</button>
        </>
      ) : (
        <>
          <div class="timer-phase" data-testid="timer-phase">{v.step?.label}</div>
          <div class="timer-remaining" data-testid="timer-remaining">{fmtMSS(v.remainingSec)}</div>
          <div class="timer-round" data-testid="timer-round">{v.roundLabel}</div>
          <div class="timer-next" data-testid="timer-next">{v.next ? `Next: ${v.next}` : 'Last one'}</div>
          <div class="timer-controls">
            <button type="button" data-testid="timer-pause" onClick={() => dispatch({ type: v.paused ? 'resume' : 'pause' })}>
              {v.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" data-testid="timer-skip" onClick={() => dispatch({ type: 'skip' })}>Skip</button>
            {confirmEnd ? (
              <>
                <button type="button" data-testid="timer-end-confirm" onClick={() => finish(true)}>End now</button>
                <button type="button" onClick={() => setConfirmEnd(false)}>Keep going</button>
              </>
            ) : (
              <button type="button" data-testid="timer-end" onClick={() => setConfirmEnd(true)}>End</button>
            )}
          </div>
        </>
      )}
      <FeedbackButton kind="workout" context={feedbackContext} />
    </main>
  );
}
