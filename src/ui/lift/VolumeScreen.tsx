import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { LIFT_EXERCISES, loadLiftSnapshot } from '../../data/lift';
import { localDate } from '../../engine/dates';
import { weeklyVolume } from '../../engine/lift/volume';
import { weekIndex } from '../../engine/week';

export function VolumeScreen() {
  const snapshot = useLiveQuery(() => loadLiftSnapshot(db), []);
  if (!snapshot) return <main class="screen"><h1>Weekly volume</h1></main>;
  const wk = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  const rows = weeklyVolume(snapshot, LIFT_EXERCISES);
  return (
    <main class="screen">
      <header class="bar">
        <h1>Week {wk} volume</h1>
        <a class="gear" href="#/lift">Lift</a>
      </header>
      <p class="dim">Fractional sets per muscle: primary 1, secondary ½.</p>
      <table class="vol">
        <thead>
          <tr><th>Muscle</th><th>Done</th><th>Target</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.muscle} data-testid={`volume-${r.muscle}`} class={`vol-${r.status}`}>
              <td>{r.muscle}</td>
              <td>{r.done.toFixed(1)}</td>
              <td>{r.min}–{r.max} (cap {r.ceiling})</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
