import { useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { loadSessionDetail, loadSessionPRs } from '../../data/history';
import { useLiveQuery } from '../../data/live';
import { saveAsMine } from '../../data/templates';
import { circuitWork } from '../../engine/block/work';
import { dayOf } from '../cardio/format';
import { exerciseName, modalityName, prLabel, runKindName, sessionTypeLabel } from '../labels';
import { MoreMenu } from '../MoreMenu';
import { circuitSummary } from './circuit-summary';

export function HistoryDetailScreen({ id }: { id: string }) {
  const d = useLiveQuery(() => loadSessionDetail(db, id), [id]);
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
  const { session, sets, run, swim } = d;
  const byEx = new Map<string, typeof sets>();
  for (const s of sets) byEx.set(s.exerciseId, [...(byEx.get(s.exerciseId) ?? []), s]);
  // Hybrid sessions can finish with a wall-clock duration of 0; fall back to the logged cardio time.
  const minutes = session.durationMin > 0 ? session.durationMin : run ? Math.round(run.durationSec / 60) : 0;

  return (
    <main class="screen">
      <header class="bar">
        <h1>{sessionTypeLabel(session.type)} · {dayOf(session.date)}</h1>
        <a class="gear" href="#/progress/history">History</a>
        <MoreMenu feedback={{ kind: 'workout', context: { sessionId: id } }} />
      </header>
      <p class="dim">{[
        minutes > 0 ? `${minutes} min` : null,
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
      {run && <p>{modalityName(run.modality ?? 'run')} · {runKindName(run.kind)} ·{Math.round(run.durationSec / 60)} min{run.distanceMi ? ` · ${run.distanceMi} mi` : ''} · RPE {run.rpe}</p>}
      {swim && <p>Swim · {swim.distance} {swim.poolUnit} · RPE {swim.rpe}</p>}
      {session.blocks.some((b) => b.kind === 'interval') && <p class="dim">{session.blocks.length} timed blocks</p>}
      {session.blocks.map((block) => {
        if (block.kind !== 'circuit') return null;
        const { log } = block;
        const work = circuitWork(block);
        return (
          <section key={block.id} class="card">
            <h2 class="num" data-testid="circuit-summary">
              {block.label ?? 'Block'} · {circuitSummary(block)}
            </h2>
            {work && <ul class="plan">
              {work.perStation.map(({ exerciseId, unit, amount }, i) => (
                <li key={i}>
                  <span>{exerciseName(exerciseId)}{log?.stations[i]?.swappedFromExerciseId && ' · swapped'}</span>
                  <span class="num">{amount} {unit}</span>
                </li>
              ))}
            </ul>}
          </section>
        );
      })}
      <div class="actions">
        <a class="btn" href={'#/again/' + id} data-testid="again">Do this again</a>
        <button type="button" data-testid="save-mine" onClick={async () => { await saveAsMine(db, id); setSaved(true); }}>Save as mine</button>
      </div>
      {saved && <p role="status">Saved to Mine</p>}
    </main>
  );
}
