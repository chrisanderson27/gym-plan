import { db } from '../data/db';
import { listHistory, type HistoryItem } from '../data/history';
import { useLiveQuery } from '../data/live';
import { round1 } from '../engine/body';
import { HISTORY_PAGE } from '../engine/config';
import { comparableBlock, type PR } from '../engine/pr';
import { weekIndex } from '../engine/week';
import { BodyCard } from './body/BodyCard';
import { HistoryCard } from './history/HistoryCard';
import { TrainingHeader } from './home/HeroCard';
import { SwapIcon, TrophyIcon } from './icons';
import { exerciseName } from './labels';
import { RingHistory } from './progress/RingHistory';
import { useRingInput, WeekCard } from './progress/WeekCard';

function recentRecords(history: HistoryItem[]) {
  const records = new Map<string, PR>();
  for (const { prs, session } of history) {
    for (const record of prs) {
      const block = record.kind === 'block-work' ? session.blocks.find((b) => b.id === record.blockId) : undefined;
      const key = record.kind === 'block-work' ? (block && comparableBlock(block)?.key) || record.blockId
        : JSON.stringify([record.kind, record.exerciseId, record.equipmentId]);
      if (!records.has(key)) records.set(key, record);
    }
  }
  return [...records.entries()].slice(0, 5);
}

export function ProgressScreen() {
  const input = useRingInput();
  const history = useLiveQuery(() => listHistory(db, 0, HISTORY_PAGE, true), []);
  const records = history ? recentRecords(history) : undefined;
  return <main class="screen shell-screen progress-screen training-screen">
    <TrainingHeader week={input ? weekIndex(input.today, input.programStart) : 1} />
    <p class="pref-eyebrow"><span class="workout-dot" />Training log</p>
    <h1>Progress</h1>
    <p class="pref-lead">Small sessions add up. Here’s what you’ve been building.</p>
    <div class="today-content">
      {input && <WeekCard input={input} browse />}
      <section class="training-card training-records">
        <TrophyIcon /><h2>Personal records</h2>
        {records && (records.length ? <ul class="training-record-list" aria-label="Recent personal records">
          {records.map(([key, record]) => <li key={key}>
            <strong>{record.kind === 'block-work' ? 'Block' : record.exerciseId === 'leg-press' ? 'Leg Press' : exerciseName(record.exerciseId)}</strong>
            <span class="num">{record.kind === 'block-work' ? `${round1(record.total)} rounds` : `${record.weight} lb × ${record.reps}`}</span>
          </li>)}
        </ul> : <p class="dim">No personal records yet.</p>)}
      </section>
      <section class="training-card">
        <h2>Workout history</h2>
        <p class="pref-support">Repeat a class from your training log.</p>
        {history && (history.length ? <ul class="history-cards progress-history-list">
          {history.slice(0, 5).map((item) => <li key={item.session.id}>
            <HistoryCard compact item={item} />
            <a class="btn" href={`#/again/${item.session.id}`} aria-label={`Repeat ${item.title}`}><SwapIcon />Repeat</a>
          </li>)}
        </ul> : <p class="dim">No sessions yet.</p>)}
        <a class="training-link" href="#/progress/history" data-testid="progress-link-history">All history</a>
      </section>
      <BodyCard />
      {input && <RingHistory input={input} />}
      <section class="card progress-workouts" data-testid="my-workouts">
        <h2>My workouts</h2>
        <a class="btn" href="#/workouts">Workouts</a>
        <a class="btn" href="#/blocks">Blocks</a>
      </section>
    </div>
  </main>;
}
