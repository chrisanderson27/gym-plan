import { useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { loadSessionDetail, loadSessionPRs } from '../../data/history';
import { useLiveQuery } from '../../data/live';
import { rateMixedSession } from '../../data/mixedSession';
import { loadRingInput } from '../../data/plan';
import { FINISH_RPE } from '../../engine/config';
import { weeklyGoal } from '../../engine/plan/ring';
import { weekIndex } from '../../engine/week';
import { CalendarIcon, CheckIcon } from '../icons';
import { MoreMenu } from '../MoreMenu';
import { prLabel } from '../labels';
import { RING_ACTIVITY_LABELS } from '../home/Ring';
import './mixed.css';

const EFFORT = [['Easy', FINISH_RPE.easy], ['Right', FINISH_RPE.right], ['Hard', FINISH_RPE.hard]] as const;

function Trophy() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <path d="M7 3h10v8a5 5 0 0 1-10 0V3ZM7 5H3v4a4 4 0 0 0 4 4m10-8h4v4a4 4 0 0 1-4 4m-5 3v5m-5 0h10" />
  </svg>;
}

export function MixedSummaryScreen({ id }: { id: string }) {
  const detail = useLiveQuery(async () => {
    const row = await loadSessionDetail(db, id);
    if (!row?.session.mixed || !row.session.endedAt) return row ? { row } : null;
    const [prs, input] = await Promise.all([loadSessionPRs(db, id), loadRingInput(db, new Date(row.session.date))]);
    return { row, prs, input };
  }, [id]);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<number | null>(null);
  if (detail === undefined) return <main class="screen shell-screen" aria-busy="true"><h1>Workout summary</h1></main>;
  if (!detail?.input) return (
    <main class="screen shell-screen"><h1>Workout summary unavailable</h1>
      {detail?.row.session.mixed && !detail.row.session.endedAt && <a class="btn" href={`#/workout/session/${id}`}>Resume workout</a>}
      <a class="btn" href="#/progress/history">History</a>
    </main>
  );
  const { row: { session, sets }, prs, input: { sessions, today, programStart, activities } } = detail;
  const mixed = session.mixed!;
  const results = Object.values(mixed.results);
  const completed = results.filter((result) => result.status === 'completed').length;
  const skipped = results.length - completed;
  const goal = weeklyGoal(sessions, today, programStart, activities);
  const outstanding = goal.segments.filter((s) => s.done < s.min).map((s) => `${RING_ACTIVITY_LABELS[s.activity]} (${s.min - s.done})`);
  const rate = async (rpe: number) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setRetry(null);
    try { await rateMixedSession(db, id, rpe); }
    catch { setRetry(rpe); }
    finally { writing.current = false; setBusy(false); }
  };
  return (
    <main class="screen shell-screen mixed-summary" data-testid="mixed-summary">
      <header class="pref-top">
        <div class="pref-brand">
          <span class="pref-mark" aria-hidden="true"><svg viewBox="0 0 16 19"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
          <p class="wordmark">Gym Plan.</p>
        </div>
        <p class="week-chip"><CalendarIcon />Week {weekIndex(today, programStart)}</p>
      </header>
      <section class="mixed-completion">
        <div class="mixed-trophy"><Trophy /></div>
        <span class="mixed-complete-mark"><CheckIcon /></span>
        <p class="pref-eyebrow">Workout complete</p>
        <h1>Showed up.<br />Got stronger.</h1>
        <p>{mixed.prescription.name} · {completed} {completed === 1 ? 'block' : 'blocks'} finished · {sets.length} {sets.length === 1 ? 'set' : 'sets'} logged{skipped > 0 && ` · ${skipped} skipped`}</p>
      </section>
      <section class="mixed-summary-card" aria-label="Weekly goal">
        <p class="pref-eyebrow">Weekly goal</p>
        <h2 data-testid="mixed-weekly-goal">{goal.done} of {goal.target} sessions</h2>
        <p>{goal.closed ? 'Weekly goal reached.' : goal.target - goal.done === 1 ? 'One more session toward the week you planned.' : `Remaining · ${outstanding.join(' · ')}`}</p>
        <div class="mixed-goal-track" aria-hidden="true">
          {goal.segments.flatMap(({ activity, done, min }) => Array.from({ length: min }, (_, i) =>
            <span key={`${activity}-${i}`} data-done={i < done} />))}
        </div>
      </section>
      {!!prs?.length && <section class="mixed-summary-card" data-testid="mixed-pr">
        <Trophy /><h2>New personal best</h2>
        <ul>{prs.map((pr) => <li key={pr.kind === 'block-work' ? pr.blockId : `${pr.kind}-${pr.exerciseId}-${pr.equipmentId}`}>{prLabel(pr)}</li>)}</ul>
      </section>}
      <section class="mixed-summary-card">
        <h2>How did that feel?</h2>
        <p>A quick check-in, if you want it.</p>
        <div class="mixed-ratings">
          {EFFORT.map(([label, value]) => (
            <button type="button" key={value} disabled={busy} aria-pressed={session.rpe === value} onClick={() => rate(value)}>{label}</button>
          ))}
        </div>
        {retry !== null && <div><p role="alert">Could not save effort.</p><button type="button" disabled={busy} onClick={() => rate(retry)}>Retry</button></div>}
      </section>
      <nav class="mixed-summary-links" aria-label="Workout complete">
        <a class="btn primary" href="#/">Back to Today</a>
        <a class="btn" href="#/progress">View progress</a>
        <a class="btn" href={`#/history/${id}`}>View workout details</a>
      </nav>
      <MoreMenu feedback={{ kind: 'workout', context: { sessionId: id, templateId: session.templateId } }} />
    </main>
  );
}
