import { db } from '../data/db';
import { listHistory } from '../data/history';
import { useLiveQuery } from '../data/live';
import { BodyCard } from './body/BodyCard';
import { HistoryCard } from './history/HistoryCard';
import { ALL_TEMPLATE_TYPES, MineRow } from './mine/MineRow';
import { MoreMenu } from './MoreMenu';
import { RingHistory } from './progress/RingHistory';

export function ProgressScreen() {
  const recent = useLiveQuery(() => listHistory(db, 0, 5), []);
  return (
    <main class="screen progress-screen">
      <header class="bar">
        <h1>Progress</h1>
        <MoreMenu feedback={{ kind: 'workout', context: {} }} />
      </header>
      <RingHistory />
      <BodyCard />
      <section>
        <h2>Recent</h2>
        {recent && (recent.length > 0 ? (
          <ul class="history-cards">
            {recent.map((item) => <li key={item.session.id}><HistoryCard item={item} /></li>)}
          </ul>
        ) : <p class="dim">No sessions yet.</p>)}
        <a class="btn" href="#/progress/history" data-testid="progress-link-history">All history</a>
      </section>
      <section class="progress-workouts" data-testid="my-workouts">
        <h2>My workouts</h2>
        <a class="btn" href="#/builder" data-testid="progress-link-builder">Build a workout</a>
        <MineRow types={ALL_TEMPLATE_TYPES} title="Saved" />
        <a class="btn" href="#/hybrid" data-testid="progress-link-hybrid">Hybrid · lift then cardio</a>
        <a class="btn" href="#/progress/volume" data-testid="progress-link-volume">Weekly volume</a>
      </section>
    </main>
  );
}
