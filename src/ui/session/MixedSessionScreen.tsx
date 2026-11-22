import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { MixedInputError, mixedOptions, updateMixedSession } from '../../data/mixedSession';
import { saveSettings } from '../../data/settings';
import type { AcceptedStrength, EffectiveStation, MixedCursor, MixedDraft, MixedExecution, OrderedBlock, Session } from '../../data/types';
import { blockBeeps } from '../../engine/block/clock';
import { remainingMs } from '../../engine/block/session';
import { beep, unlockAudio } from '../../platform/audio';
import { holdWakeLock } from '../../platform/wakelock';
import { StationCard, stationTargetLine } from '../blocks/StationCard';
import { exerciseName, mixedBlockName } from '../labels';
import { MoreMenu } from '../MoreMenu';
import { navigate } from '../router';
import { Sheet } from '../Sheet';
import { PoseView } from '../slots/PoseView';
import './mixed.css';

type Action = Parameters<typeof updateMixedSession>[3];
type Submit = (action: Action, expected?: MixedCursor) => Promise<boolean>;
type Retry = { action: Action; expected: MixedCursor };

export function MixedSessionScreen({ id }: { id: string }) {
  const session = useLiveQuery(() => db.sessions.get(id).then((row) => row ?? null), [id]);
  const complete = !!session?.mixed && !!session.endedAt;
  useEffect(() => { if (complete) navigate('/workout/summary/' + id); }, [complete, id]);
  if (session === undefined || complete) return <main class="screen" aria-busy="true"><h1>Workout</h1></main>;
  if (!session?.mixed) return <main class="screen"><h1>Workout unavailable</h1><a class="btn" href="#/progress/history">History</a></main>;
  const { mixed } = session;
  const index = mixed.prescription.blocks.findIndex((b) => b.id === mixed.cursor.blockId);
  const block = mixed.prescription.blocks[index];
  if (!block) return <main class="screen"><h1>Workout block unavailable</h1><a class="btn" href="#/progress/history">History</a></main>;
  return <MixedBlock key={block.id} session={session} mixed={mixed} block={block} index={index} />;
}

function MixedBlock({ session, mixed, block, index }: { session: Session; mixed: MixedExecution; block: OrderedBlock; index: number }) {
  const { stage, setSlot } = mixed.cursor;
  const clock = Object.hasOwn(mixed.timers, block.id) ? mixed.timers[block.id] : undefined;
  const active = stage === 'active' && !!clock && clock.pausedAt === null;
  const options = useLiveQuery(() => mixedOptions(db, block, mixed), [block, mixed]);
  const sound = useLiveQuery(() => db.settings.get('settings').then((s) => s?.soundCues !== false), []);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<Retry | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [swap, setSwap] = useState<{ slotId: string } | 'strength' | null>(null);
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const remaining = clock ? Math.ceil(remainingMs(clock, now) / 1000) : block.kind === 'strength' ? 0 : block.durationSec;
  const previous = useRef<number | null>(null);

  const submit: Submit = async (action, expected = mixed.cursor) => {
    const draftEdit = action.type === 'review';
    if (writing.current) return false;
    if (!draftEdit) {
      writing.current = true;
      setBusy(true);
    }
    setError('');
    setRetry(null);
    try {
      const row = await updateMixedSession(db, session.id, expected, action);
      if (row?.endedAt) navigate('/workout/summary/' + row.id);
      if (action.type === 'swap-station' || action.type === 'swap-strength') {
        setSwap(null);
        setPlaying(null);
      }
      setNow(Date.now());
      return true;
    } catch (reason) {
      if (reason instanceof MixedInputError) setError(reason.message);
      else {
        setError('Could not save this change.');
        setRetry({ action, expected });
      }
      return false;
    } finally {
      if (!draftEdit) {
        writing.current = false;
        setBusy(false);
      }
    }
  };
  const apply = useRef(submit);
  apply.current = submit;

  useEffect(() => {
    if (!active || remaining === 0) return;
    return holdWakeLock();
  }, [active, remaining === 0]);
  useEffect(() => {
    if (!active) {
      previous.current = null;
      return;
    }
    const update = () => setNow(Date.now());
    const visible = () => {
      previous.current = null;
      update();
    };
    update();
    const timer = window.setInterval(update, 200);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    if (previous.current !== null && document.visibilityState === 'visible') {
      for (const cue of blockBeeps(previous.current, remaining)) beep(cue);
    }
    previous.current = remaining;
    if (remaining === 0 && !busy && retry?.action.type !== 'expire') void apply.current({ type: 'expire' });
  }, [active, remaining, busy, retry]);
  useLayoutEffect(() => {
    if (stage !== 'review') return;
    setPlaying(null);
    setSwap(null);
  }, [stage]);
  useLayoutEffect(() => {
    if (stage === 'review' && swap === null) reviewHeading.current?.focus();
  }, [stage, swap]);

  if (block.kind === 'coached') return <main class="screen"><h1>Coached block unavailable</h1><a class="btn" href="#/">Back</a></main>;
  const circuit = block.kind === 'self-paced';
  const strength = block.kind === 'strength' ? mixed.strength[block.id] : undefined;
  const stations = circuit ? mixed.stations[block.id] ?? [] : [];
  const draft = circuit ? mixed.drafts[block.id] : undefined;
  const swapped = swap && swap !== 'strength' ? stations.find((s) => s.slotId === swap.slotId) : undefined;
  const title = strength ? exerciseName(strength.exerciseId) : mixedBlockName(block);
  const kind = circuit ? 'Self-paced circuit' : block.kind;
  const back = session.templateId ? '#/mine/' + session.templateId : '#/';
  const ready = !!options?.ready;
  const paused = stage === 'active' && !!clock && clock.pausedAt !== null;
  const finish = index === mixed.prescription.blocks.length - 1;
  const selectSwap = async (exerciseId: string | null) => {
    const action = swapped
      ? { type: 'swap-station' as const, slotId: swapped.slotId, expectedExerciseId: swapped.exerciseId, exerciseId }
      : strength && exerciseId ? { type: 'swap-strength' as const, expectedExerciseId: strength.exerciseId, exerciseId } : undefined;
    if (action) await submit(action);
  };

  return (
    <main class="screen mixed-live" data-testid="mixed-runner">
      <header class="mixed-live-top">
        <a class="btn" href={back}>← Back</a>
        <span>{mixed.prescription.name}</span>
        <button type="button" aria-label="Sound cues" aria-pressed={sound !== false} onClick={async () => {
          unlockAudio();
          try { await saveSettings(db, { soundCues: sound === false }); }
          catch { setError('Could not save sound preference. Try again.'); }
        }}>{sound === false ? 'Muted' : 'Sound'}</button>
        <MoreMenu feedback={{ kind: 'workout', context: { sessionId: session.id, templateId: session.templateId } }} />
      </header>
      <p class="mixed-eyebrow num">Block {index + 1} / {mixed.prescription.blocks.length}<span class="mixed-dot"> · </span>{kind}</p>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      {(error || retry) && !swap && <SaveError error={error} retry={retry} submit={submit} busy={busy} />}
      {stage === 'review' ? (
        <section class="mixed-review">
          <h2 ref={reviewHeading} tabIndex={-1}>Review block</h2>
          {clock && <p>{formatClock(Math.floor((clock.frozenElapsedMs ?? 0) / 1000))} elapsed</p>}
          {strength && <p>{setSlot ? `${setSlot} of ${strength.sets} sets logged` : 'Skipped'}</p>}
          <ReviewForm draft={clock?.startedAt === null ? undefined : draft} stations={stations} finish={finish} busy={busy} submit={submit} />
        </section>
      ) : strength ? (
        <>
          <p>{ready ? `${strength.sets} sets · ${strength.repMin}–${strength.repMax} reps` : options ? 'Movement unavailable' : 'Checking equipment…'}</p>
          <PoseView exerciseId={strength.exerciseId} poseId={options?.poseId || undefined} />
          {ready && <StrengthSet key={`${strength.exerciseId}:${strength.equipmentId}:${setSlot}`} strength={strength} slot={setSlot} busy={busy} submit={submit} />}
          <div class="actions">
            {stage === 'entry' && <button type="button" disabled={busy || !options?.strength?.length} onClick={() => setSwap('strength')}>Swap exercise</button>}
            <button type="button" disabled={busy} onClick={() => submit({ type: stage === 'entry' ? 'skip' : 'finish' })}>{stage === 'entry' ? 'Skip block' : 'Finish block'}</button>
          </div>
        </>
      ) : (
        <>
          <div class="mixed-countdown">
            <div><span class="mixed-eyebrow num">{paused ? 'Paused · time left' : 'Block time left'}</span>
              <strong class="num" role="timer">{formatClock(remaining)}</strong></div>
            {draft && <div class="mixed-rounds"><span class="mixed-eyebrow num">Rounds logged</span>
              <strong class="num" aria-label={draft.rounds === null ? 'Rounds unreported' : undefined}>{String(draft.rounds ?? 0).padStart(2, '0')}</strong></div>}
            <progress aria-label="Block time left" max={block.kind === 'strength' ? 1 : block.durationSec} value={remaining} />
          </div>
          {circuit ? (
            <>
              <div class="mixed-stations-head"><span>Go in order. Repeat at your pace.</span><span class="num">{stations.length} stations</span></div>
              <div class="gym-grid">
                {stations.map((station, i) => (
                  <StationCard key={station.slotId} exerciseId={station.exerciseId} equipmentId={station.equipmentId}
                    poseId={options?.available?.has(station.slotId) ? station.poseId : undefined} index={i}
                    target={stationTargetLine(station.exerciseId, station.target.amount, station.target.unit, station.load)}
                    playing={playing === station.slotId} onPlay={() => setPlaying(playing === station.slotId ? null : station.slotId)}
                    onSwap={() => setSwap({ slotId: station.slotId })} disabled={busy || !!draft?.tapped}
                    status={station.skipped ? 'Skipped' : options && !options.available?.has(station.slotId) ? 'Movement unavailable' : undefined} />
                ))}
              </div>
            </>
          ) : block.kind !== 'strength' && <>
            <p>{block.instructions}</p>
            {block.exerciseId && <PoseView exerciseId={block.exerciseId} poseId={options?.poseId || undefined} />}
            {options && !ready && <p>Movement unavailable</p>}
          </>}
          <div class="mixed-live-actions actions">
            {stage === 'entry' ? <>
              <button type="button" class="primary" disabled={busy || !ready} onClick={() => { unlockAudio(); void submit({ type: 'start' }); }}>Start block</button>
              <button type="button" disabled={busy} onClick={() => submit({ type: 'skip' })}>Skip block</button>
            </> : <>
              <button type="button" disabled={busy || remaining === 0} onClick={() => { if (paused) unlockAudio(); void submit({ type: paused ? 'resume' : 'pause' }); }}>{paused ? 'Resume' : 'Pause'}</button>
              {circuit && <button type="button" class="primary" disabled={busy || paused || !ready || remaining === 0} onClick={() => submit({ type: 'round', expectedTapped: draft?.tapped ?? 0 })}>+1 round</button>}
              <button type="button" disabled={busy || remaining === 0} onClick={() => submit({ type: 'finish' })}>Finish block</button>
            </>}
          </div>
        </>
      )}
      {swap && stage !== 'review' && (
        <Sheet label={swapped ? `Swap ${exerciseName(swapped.exerciseId)}` : 'Swap exercise'} onClose={() => setSwap(null)}>
          <h2>{swapped ? `Swap ${exerciseName(swapped.exerciseId)}` : 'Swap exercise'}</h2>
          <div class="mixed-fields">
            {(swapped ? options?.stations?.[swapped.slotId]?.map((s) => s.exerciseId) : options?.strength)?.map((id) => (
              <button type="button" key={id} disabled={busy} onClick={() => selectSwap(id)}>{exerciseName(id)}</button>
            ))}
            {swapped && !swapped.skipped && <button type="button" disabled={busy} onClick={() => selectSwap(null)}>Skip station</button>}
            <button type="button" onClick={() => setSwap(null)}>Close</button>
          </div>
          {error && <SaveError error={error} retry={retry} submit={submit} busy={busy} />}
        </Sheet>
      )}
    </main>
  );
}

function formatClock(seconds: number) {
  return [Math.floor(seconds / 60), seconds % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function SaveError({ error, retry, submit, busy }: { error: string; retry: Retry | null; submit: Submit; busy: boolean }) {
  return <div class="mixed-save-error"><p role="alert">{error}</p>
    {retry && <button type="button" disabled={busy} onClick={() => submit(retry.action, retry.expected)}>Retry</button>}</div>;
}

function StrengthSet({ strength, slot, busy, submit }: { strength: AcceptedStrength; slot: number; busy: boolean; submit: Submit }) {
  const [weight, setWeight] = useState(String(strength.targetWeight ?? ''));
  const [reps, setReps] = useState(String(strength.repMin));
  return (
    <form class="mixed-fields" onSubmit={(event) => { event.preventDefault(); void submit({ type: 'set', weight: Number(weight), reps: Number(reps) }); }}>
      <h2>Set {slot + 1} of {strength.sets}</h2>
      <label>Weight (lb)<input type="number" inputMode="decimal" min="0" step="any" required value={weight} onInput={(e) => setWeight(e.currentTarget.value)} /></label>
      <label>Reps<input type="number" inputMode="numeric" min="1" step="1" required value={reps} onInput={(e) => setReps(e.currentTarget.value)} /></label>
      <button class="primary" type="submit" disabled={busy}>Log set</button>
    </form>
  );
}

function ReviewForm({ draft, stations, finish, busy, submit }: {
  draft?: MixedDraft;
  stations: EffectiveStation[];
  finish: boolean;
  busy: boolean;
  submit: Submit;
}) {
  const [rounds, setRounds] = useState(draft?.rounds == null ? '' : String(draft.rounds));
  const [slot, setSlot] = useState(draft?.partial?.slotId ?? '');
  const [count, setCount] = useState(draft?.partial ? String(draft.partial.count) : '');
  const current = stations.find((s) => !s.skipped && s.slotId === slot);
  const actual = (r: string, s: EffectiveStation | undefined, c: string) => ({
    rounds: r === '' ? null : Number(r),
    partial: s && c !== '' ? { slotId: s.slotId, unit: s.target.unit, count: Number(c) } : null,
  });
  const save = (r: string, s: EffectiveStation | undefined, c: string) => {
    if ((r && (!Number.isSafeInteger(Number(r)) || Number(r) < 0)) || (c && (!Number.isFinite(Number(c)) || Number(c) < 0))) return;
    void submit({ type: 'review', ...actual(r, s, c) });
  };
  return (
    <form class="mixed-fields" onSubmit={(event) => {
      event.preventDefault();
      void submit({ type: 'continue', ...(draft ? actual(rounds, current, count) : {}) });
    }}>
      {draft && <>
        <label>Completed rounds<input type="number" inputMode="numeric" min="0" step="1" value={rounds}
          onInput={(e) => {
            const { value, validity } = e.currentTarget;
            setRounds(value);
            if (!validity.badInput) save(value, current, count);
          }} /></label>
        <label>Partial station<select value={slot} onChange={(e) => {
          const next = e.currentTarget.value;
          setSlot(next);
          setCount('');
          save(rounds, undefined, '');
        }}><option value="">None</option>{stations.filter((s) => !s.skipped).map((s, i) =>
          <option key={s.slotId} value={s.slotId}>{i + 1}. {exerciseName(s.exerciseId)}</option>)}</select></label>
        {current && <label>Partial work ({current.target.unit})<input type="number" inputMode="decimal" min="0" step="any" value={count}
          onInput={(e) => {
            const { value, validity } = e.currentTarget;
            setCount(value);
            if (!validity.badInput) save(rounds, current, value);
          }} /></label>}
      </>}
      <button type="submit" class="primary" disabled={busy}>{finish ? 'Finish workout' : 'Continue'}</button>
    </form>
  );
}
