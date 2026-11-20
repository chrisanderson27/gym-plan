import { loadBodyLogs } from '../../data/body';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { round1, weeklyRate, weightTrend } from '../../engine/body';
import { localDate } from '../../engine/dates';
import { TrendChart } from './TrendChart';

export function BodyCard() {
  const logs = useLiveQuery(() => loadBodyLogs(db), []);
  const points = weightTrend(logs ?? []);
  const last = points.at(-1);
  const rate = weeklyRate(points, localDate(new Date()));
  return (
    <section class="card" data-testid="progress-body">
      <h2>Bodyweight</h2>
      {last ? (
        <>
          <TrendChart compact points={points} />
          <p class="num">Trend {round1(last.trend)} lb{rate !== null && ` · ${rate < 0 ? '−' : '+'}${round1(Math.abs(rate))} lb/wk`}</p>
        </>
      ) : logs && <p class="dim">No weigh-ins yet</p>}
      <a class="btn" href="#/progress/body" data-testid="progress-link-weigh-in">Log weigh-in</a>
    </section>
  );
}
