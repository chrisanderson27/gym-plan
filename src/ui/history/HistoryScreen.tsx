import { useEffect, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { listHistory, type HistoryItem } from '../../data/history';
import { HISTORY_PAGE } from '../../engine/config';
import { dayOf } from '../cardio/format';
import { FeedbackButton } from '../slots/FeedbackButton';

export function HistoryScreen() {
  const [rows, setRows] = useState<HistoryItem[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let live = true;
    listHistory(db, page).then((r) => {
      if (!live) return;
      setRows((cur) => (page === 0 ? r : [...(cur ?? []), ...r]));
      setMore(r.length === HISTORY_PAGE);
    });
    return () => { live = false; };
  }, [page]);

  return (
    <main class="screen">
      <header class="bar">
        <h1>History</h1>
        <a class="gear" href="#/">Home</a>
      </header>
      {rows && rows.length === 0 && <p class="dim">No sessions yet.</p>}
      <ul class="rows">
        {(rows ?? []).map(({ session, summary }) => (
          <li key={session.id} class="row-item">
            <a class="row" href={'#/history/' + session.id} data-testid={`history-${session.id}`}>
              {dayOf(session.date)} · {summary}{session.endedAt ? '' : ' · in progress'}
            </a>
          </li>
        ))}
      </ul>
      {more && <button type="button" data-testid="history-more" onClick={() => setPage(page + 1)}>Load more</button>}
      <FeedbackButton kind="workout" context={{}} />
    </main>
  );
}
