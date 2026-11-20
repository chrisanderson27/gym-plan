import { useEffect, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { listHistory, type HistoryItem } from '../../data/history';
import { HISTORY_PAGE } from '../../engine/config';
import { MoreMenu } from '../MoreMenu';
import { HistoryCard } from './HistoryCard';

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
        <a class="gear" href="#/progress">Progress</a>
        <MoreMenu feedback={{ kind: 'workout', context: {} }} />
      </header>
      {rows && rows.length === 0 && <p class="dim">No sessions yet.</p>}
      <ul class="history-cards">
        {(rows ?? []).map((item) => <li key={item.session.id}><HistoryCard item={item} /></li>)}
      </ul>
      {more && <button type="button" data-testid="history-more" onClick={() => setPage(page + 1)}>Load more</button>}
    </main>
  );
}
