import { useState } from 'preact/hooks';
import { db } from '../../data/db';
import { actualDurationSec, cardTitle, loadSessionDetail, loadSessionPRs } from '../../data/history';
import { useLiveQuery } from '../../data/live';
import { saveAsMine } from '../../data/templates';
import { dayOf } from '../cardio/format';
import { durationLabel, prLabel } from '../labels';
import { MoreMenu } from '../MoreMenu';
import { loggedLineup } from './MixedLoggedLineup';

export function HistoryDetailScreen({ id }: { id: string }) {
  const d = useLiveQuery(async () => {
    const detail = await loadSessionDetail(db, id);
    const equipment = new Map((await db.equipment.toArray()).map((item) => [item.id, item]));
    return detail ? { ...detail, lineup: loggedLineup(detail, equipment) } : null;
  }, [id]);
  const prs = useLiveQuery(() => loadSessionPRs(db, id), [id]);
  const [saved, setSaved] = useState(false);
  if (d === undefined) return <main class="screen"><h1>Session</h1></main>;
  if (d === null) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Session not found</h1>
          <a class="gear" href="#/progress/history">History</a>
          <MoreMenu feedback={{ kind: 'workout', context: {} }} />
        </header>
      </main>
    );
  }
  const { session, run, lineup } = d;

  return (
    <main class="screen">
      <header class="bar">
        <h1>{cardTitle(session, run)} · {dayOf(session.date)}</h1>
        <a class="gear" href="#/progress/history">History</a>
        <MoreMenu feedback={{ kind: 'workout', context: { sessionId: id } }} />
      </header>
      <p class="dim">{[
        session.endedAt ? durationLabel(actualDurationSec(session, run)) : null,
        session.rpe !== null ? `RPE ${session.rpe}` : null,
        session.endedAt ? null : 'in progress',
      ].filter(Boolean).join(' · ')}</p>
      {!!prs?.length && (
        <ul class="plan" data-testid="detail-prs" aria-label="Personal records">
          {prs.map((pr) => (
            <li key={pr.kind === 'block-work' ? pr.blockId : `${pr.kind}-${pr.exerciseId}-${pr.equipmentId}`}>
              <span class="num">PR · {prLabel(pr)}</span>
            </li>
          ))}
        </ul>
      )}
      {lineup.blocks.map(({ id: blockId, title, content }) => (
        <section class="card" key={blockId} data-testid={session.mixed ? `mixed-result-${blockId}` : undefined}>
          <h2 data-testid={session.blocks.some((block) => block.kind === 'circuit' && block.id === blockId) ? 'circuit-summary' : undefined}>{title}</h2>
          {content}
        </section>
      ))}
      {session.mixed && (
        <a class="btn" href={session.endedAt ? `#/workout/summary/${id}` : `#/workout/session/${id}`}>
          {session.endedAt ? 'View workout summary' : 'Resume workout'}
        </a>
      )}
      {(!session.mixed || session.endedAt) && <div class="actions">
        <a class="btn" href={'#/again/' + id} data-testid="again">Do this again</a>
        <button type="button" data-testid="save-mine" onClick={async () => { await saveAsMine(db, id); setSaved(true); }}>Save as mine</button>
      </div>}
      {saved && <p role="status">Saved to Mine</p>}
    </main>
  );
}
