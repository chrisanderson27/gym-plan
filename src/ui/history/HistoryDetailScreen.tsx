import { useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { loadSessionDetail } from '../../data/history';
import { useLiveQuery } from '../../data/live';
import { saveAsMine } from '../../data/templates';
import { dayOf } from '../cardio/format';
import { FeedbackButton } from '../slots/FeedbackButton';

export function HistoryDetailScreen({ id }: { id: string }) {
  const d = useLiveQuery(() => loadSessionDetail(db, id), [id]);
  const [saved, setSaved] = useState(false);
  if (d === undefined) return <main class="screen"><h1>Session</h1></main>;
  if (d === null) {
    return (
      <main class="screen">
        <h1>Session not found</h1>
        <a href="#/history">History</a>
        <FeedbackButton kind="workout" context={{}} />
      </main>
    );
  }
  const { session, sets, run, swim } = d;
  const byEx = new Map<string, typeof sets>();
  for (const s of sets) byEx.set(s.exerciseId, [...(byEx.get(s.exerciseId) ?? []), s]);

  return (
    <main class="screen">
      <header class="bar">
        <h1>{session.type} · {dayOf(session.date)}</h1>
        <a class="gear" href="#/history">History</a>
      </header>
      <p class="dim">{session.durationMin} min{session.rpe !== null ? ` · RPE ${session.rpe}` : ''}{session.endedAt ? '' : ' · in progress'}</p>
      {[...byEx].map(([exId, rows]) => (
        <section key={exId} class="card">
          <h2>{exerciseById.get(exId)?.name ?? exId}</h2>
          <ul class="plan">
            {rows.map((s) => (
              <li key={s.id}>{s.weight} × {s.reps}{s.rir !== undefined ? ` · RIR ${s.rir}` : ''}{s.painFlag ? ' · pain' : ''}</li>
            ))}
          </ul>
        </section>
      ))}
      {run && <p>{run.modality ?? 'run'} · {run.kind} · {Math.round(run.durationSec / 60)} min{run.distanceMi ? ` · ${run.distanceMi} mi` : ''} · RPE {run.rpe}</p>}
      {swim && <p>Swim · {swim.distance} {swim.poolUnit} · RPE {swim.rpe}</p>}
      {session.blocks.some((b) => b.kind === 'interval') && <p class="dim">{session.blocks.length} timed blocks</p>}
      <div class="chips">
        <a class="chip" href={'#/again/' + id} data-testid="again">Do this again</a>
        <button type="button" data-testid="save-mine" onClick={async () => { await saveAsMine(db, id); setSaved(true); }}>Save as mine</button>
      </div>
      {saved && <p role="status">Saved to Mine</p>}
      <FeedbackButton kind="workout" context={{ sessionId: id }} />
    </main>
  );
}
