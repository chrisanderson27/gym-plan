import { loadBodyLogs } from '../../data/body';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { weightTrend } from '../../engine/body';
import { TrendChart } from './TrendChart';

export function BodyCard() {
  const logs = useLiveQuery(() => loadBodyLogs(db), []);
  const points = weightTrend(logs ?? []);
  const latest = logs?.filter((row) => row.weightLb !== undefined).at(-1);

  return <section class="training-card" data-testid="progress-body">
    <h2>Bodyweight trend</h2>
    <p class="pref-support">Past weigh-ins are separate from training progress.</p>
    {latest ? <div class="training-trend">
      <strong class="num">{latest.weightLb} lb · latest</strong>
      <TrendChart compact points={points} />
    </div> : logs && <p class="dim">No weigh-ins yet.</p>}
  </section>;
}
