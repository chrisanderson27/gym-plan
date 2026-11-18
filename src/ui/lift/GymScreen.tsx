import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { setNotAtMyGym } from '../../data/lift';

export function GymScreen() {
  const missing = useLiveQuery(() => db.exerciseOverrides.filter((o) => o.notAtMyGym).toArray(), []);
  return (
    <main class="screen">
      <header class="bar">
        <h1>My gym</h1>
        <a class="gear" href="#/lift">Lift</a>
      </header>
      {missing && missing.length === 0 && <p class="dim">Nothing marked "not at my gym".</p>}
      <ul class="plan">
        {missing?.map((o) => (
          <li key={o.exerciseId} data-testid={`gym-${o.exerciseId}`}>
            <strong>{exerciseById.get(o.exerciseId)?.name ?? o.exerciseId}</strong>
            <button type="button" onClick={() => setNotAtMyGym(db, o.exerciseId, false)}>I have this</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
