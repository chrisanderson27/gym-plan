import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { MixedInputError, mixedOptions, updateMixedSession } from '../../data/mixedSession';
import { saveSettings } from '../../data/settings';
import type { AcceptedStrength, CardioModality, EffectiveStation, MixedCursor, MixedDraft, MixedExecution, OrderedBlock, RunBlock, Session } from '../../data/types';
import { blockBeeps } from '../../engine/block/clock';
import { blockRemainingSec, coachedSchedule, nextStation, projectCoached, sameCoachedPhase, stationWorkSec } from '../../engine/block/coached';
import { elapsedClamped, remainingMs } from '../../engine/block/session';
import { runPhases, runSegmentAt } from '../../engine/run/segments';
import { beep, unlockAudio } from '../../platform/audio';
import { holdWakeLock } from '../../platform/wakelock';
import { StationCard, stationTargetLine } from '../blocks/StationCard';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, EditIcon, MutedIcon, PauseIcon, PlayIcon, SoundIcon } from '../icons';
import { exerciseName, mixedBlockName, modalityName, runKindName } from '../labels';
import { useDemoPlayback } from '../pose/playback';
import { MoreMenu } from '../MoreMenu';
import { navigate } from '../router';
import { Sheet } from '../Sheet';
import { RpeChips } from '../cardio/RpeChips';
import { runReviewActuals, startedClock } from './runReview';
import { runExerciseId } from '../../content/stationDemos';
import { PosePlaybackButton, PoseView } from '../slots/PoseView';
import { LIMITS, rangeError } from '../limits';
import './mixed.css';

type Action = Parameters<typeof updateMixedSession>[3];
type Submit = (action: Action, expected?: MixedCursor, closeEditor?: boolean) => Promise<boolean>;
type Retry = { action: Action; expected: MixedCursor; closeEditor?: boolean };

// Ticks and small scheduling delays may announce one edge. A foreground gap only updates the display.
const FRESH_CUE_MS = 1000;
const blockKind = (block: OrderedBlock) => block.kind === 'coached' ? 'Coached rotation'
  : block.kind === 'self-paced' ? 'Self-paced circuit' : block.kind === 'run' ? 'Running' : block.kind;
const stationIdentity = (s: EffectiveStation, poseId?: string) => `${s.slotId}:${s.exerciseId}:${s.equipmentId ?? ''}:${poseId ?? ''}`;

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
  const coached = block.kind === 'coached' && block.stations ? block : undefined;
  const circuit = block.kind === 'self-paced';
  const stations = circuit || coached ? mixed.stations[block.id] ?? [] : [];
  const draft = circuit || coached ? mixed.drafts[block.id] : undefined;
  const lineup = coached ? stations.filter((s) => !s.skipped) : [];
  const options = useLiveQuery(() => mixedOptions(db, block, mixed), [block, mixed]);
  const sound = useLiveQuery(() => db.settings.get('settings').then((s) => s?.soundCues !== false), []);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<Retry | null>(null);
  const [editing, setEditing] = useState(false);
  const [swap, setSwap] = useState<{ slotId: string } | 'strength' | null>(null);
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const elapsed = clock ? elapsedClamped(clock, now) : 0;
  const rotation = coached && clock?.coached && stage === 'active' && options?.ready
    ? projectCoached(coachedSchedule(coached, lineup), clock.coached, Math.min(elapsed, clock.durationMs - 1)) : undefined;
  const remaining = coached && clock?.startedAt != null && stage === 'active'
    ? blockRemainingSec(clock.startedAt, clock.pausedMs, clock.pausedAt, coached.durationSec, now)
    : clock ? Math.ceil(remainingMs(clock, now) / 1000) : block.kind === 'strength' ? 0 : block.durationSec;
  const previous = useRef<number | null>(null);
  const cue = useRef<{ now: number; rotation: NonNullable<typeof rotation>; remaining: number } | null>(null);
  const currentStation = rotation && lineup[rotation.at.station];
  const nextStationInLineup = rotation && lineup[nextStation(rotation.at, lineup.length).station];
  const stationEntry = rotation && `${rotation.at.rotations}:${currentStation?.slotId}`;
  const stationPose = (s: EffectiveStation) => options?.available?.has(s.slotId) ? s.poseId : undefined;
  const demoIds = stations.filter((s) => stationPose(s)).map((s) => stationIdentity(s, stationPose(s)));
  // Demo playback is UI state only. It never goes through updateMixedSession.
  const demo = useDemoPlayback(stationEntry ? `entry:${stationEntry}` : `block:${block.id}`, demoIds,
    currentStation && stationPose(currentStation) ? stationIdentity(currentStation, stationPose(currentStation)) : null);
  const acceptedRun = block.kind === 'run' ? session.blocks.find((row): row is RunBlock => row.kind === 'run' && row.id === block.id) : undefined;
  const phases = useMemo(() => acceptedRun ? runPhases(acceptedRun) : [], [acceptedRun]);
  const segment = acceptedRun && clock && stage === 'active' ? runSegmentAt(phases, elapsed) : undefined;
  const segmentCue = useRef<{ now: number; index: number } | null>(null);

  const submit: Submit = async (action, expected = mixed.cursor, closeEditor) => {
    const draftEdit = action.type === 'review';
    if (writing.current) return false;
    if (!draftEdit || closeEditor) {
      writing.current = true;
      setBusy(true);
    }
    setError('');
    setRetry(null);
    try {
      const row = await updateMixedSession(db, session.id, expected, action);
      const updated = row?.mixed?.timers[block.id];
      if (coached && sound !== false && document.visibilityState === 'visible') {
        if (action.type === 'start' && row?.mixed?.cursor.stage === 'active') beep('go');
        if (action.type === 'finish' && updated?.frozenElapsedMs !== undefined && updated.frozenElapsedMs < updated.durationMs) beep('complete');
      }
      if (row?.endedAt) navigate('/workout/summary/' + row.id);
      if (closeEditor) setEditing(false);
      if (action.type === 'swap-station' || action.type === 'swap-strength') {
        setSwap(null);
      }
      setNow(Date.now());
      return true;
    } catch (reason) {
      if (reason instanceof MixedInputError) setError(reason.message);
      else {
        setError('Could not save this change.');
        setRetry({ action, expected, closeEditor });
      }
      return false;
    } finally {
      if (!draftEdit || closeEditor) {
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
      cue.current = null;
      return;
    }
    const update = () => setNow(Date.now());
    const visible = () => {
      previous.current = null;
      cue.current = null;
      update();
    };
    update();
    const timer = window.setInterval(update, 200);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', visible);
    };
  }, [active]);
  useEffect(() => {
    if (!active || coached) return;
    if (previous.current !== null && document.visibilityState === 'visible') {
      for (const current of blockBeeps(previous.current, remaining)) beep(current);
    }
    previous.current = remaining;
  }, [active, coached, remaining]);
  useEffect(() => {
    if (!active || !rotation || document.visibilityState !== 'visible') return;
    const last = cue.current;
    cue.current = { now, rotation, remaining };
    if (!last || sound === false || now < last.now || now - last.now > FRESH_CUE_MS) return;
    if (remaining === 0) {
      if (last.remaining > 0) beep('complete');
      return;
    }
    const { at } = rotation;
    if (!sameCoachedPhase(at, last.rotation.at) && elapsed - at.phaseStartMs <= FRESH_CUE_MS
      && (at.phaseStartMs === last.rotation.endMs || (clock?.coached && sameCoachedPhase(at, clock.coached)))) {
      beep(at.phase === 'work' ? 'go' : 'tick');
    }
  });
  useEffect(() => {
    if (!active) return;
    if (remaining === 0 && !busy && retry?.action.type !== 'expire') void apply.current({ type: 'expire' });
  }, [active, remaining, busy, retry]);
  useLayoutEffect(() => {
    if (stage !== 'review') return;
    setSwap(null);
  }, [stage]);
  useEffect(() => {
    // Segment edges sound once, and only when fresh. A foreground gap or a missed edge never replays.
    if (!active || !segment || document.visibilityState !== 'visible') {
      segmentCue.current = null;
      return;
    }
    const last = segmentCue.current;
    segmentCue.current = { now, index: segment.index };
    if (!last || sound === false || now < last.now || now - last.now > FRESH_CUE_MS || last.index === segment.index || remaining === 0) return;
    if (elapsed - (segment.current?.startMs ?? 0) <= FRESH_CUE_MS) beep(segment.current?.role === 'work' ? 'go' : 'tick');
  });
  useLayoutEffect(() => {
    if (stage === 'review' && swap === null) reviewHeading.current?.focus();
  }, [stage, swap, editing]);

  if (block.kind === 'coached' && !coached) return <main class="screen"><h1>Coached block unavailable</h1><a class="btn" href="#/">Back</a></main>;
  const strength = block.kind === 'strength' ? mixed.strength[block.id] : undefined;
  const swapped = swap && swap !== 'strength' ? stations.find((s) => s.slotId === swap.slotId) : undefined;
  const title = strength ? exerciseName(strength.exerciseId) : mixedBlockName(block);
  const kind = blockKind(block);
  const back = session.templateId ? '#/mine/' + session.templateId : '#/';
  const ready = !!options?.ready;
  const paused = stage === 'active' && !!clock && clock.pausedAt !== null;
  const nextBlock = mixed.prescription.blocks[index + 1];
  const finish = !nextBlock;
  const selectSwap = async (exerciseId: string | null) => {
    const action = swapped
      ? { type: 'swap-station' as const, slotId: swapped.slotId, expectedExerciseId: swapped.exerciseId, exerciseId }
      : strength && exerciseId ? { type: 'swap-strength' as const, expectedExerciseId: strength.exerciseId, exerciseId } : undefined;
    if (action) await submit(action);
  };

  return (
    <main class={`screen mixed-live${coached ? ' mixed-coached' : ''}`} data-testid="mixed-runner">
      <header class="mixed-live-top">
        <a class="btn" href={back}>{coached ? <><ArrowLeftIcon /> Back</> : '← Back'}</a>
        <span>{mixed.prescription.name}</span>
        <button type="button" aria-label="Sound cues" aria-pressed={sound !== false} onClick={async () => {
          if (sound === false) unlockAudio(true);
          try { await saveSettings(db, { soundCues: sound === false }); }
          catch { setError('Could not save sound preference. Try again.'); }
        }}>{coached ? sound === false ? <MutedIcon /> : <SoundIcon /> : sound === false ? 'Muted' : 'Sound'}</button>
        <MoreMenu feedback={{ kind: 'workout', context: { sessionId: session.id, templateId: session.templateId } }} />
      </header>
      {(!coached || stage !== 'review') && <>
        <p class="mixed-eyebrow num">Block {index + 1} / {mixed.prescription.blocks.length}<span class="mixed-dot"> · </span>{kind}</p>
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
      </>}
      {(error || retry) && !swap && <SaveError error={error} retry={retry} submit={submit} busy={busy} />}
      {stage === 'review' && coached ? (
        <section class="mixed-coached-review" aria-labelledby="rotation-review-title">
          <span class="mixed-complete-mark" aria-hidden="true"><CheckIcon /></span>
          <p class="mixed-eyebrow num">Block {index + 1} / {mixed.prescription.blocks.length} {clock?.startedAt === null ? 'skipped' : 'complete'}</p>
          <h1 id="rotation-review-title" ref={reviewHeading} tabIndex={-1} aria-describedby={editing ? undefined : 'rotation-review-count'}>{editing ? 'Edit what I did' : title}</h1>
          {editing ? <ReviewForm draft={draft} stations={stations} finish={finish} busy={busy} submit={submit} edit /> : <>
            <p id="rotation-review-count" role="status">{clock?.startedAt === null ? 'Block skipped' : draft?.rounds == null ? 'Rotations unreported'
              : `${draft.rounds} full ${draft.rounds === 1 ? 'rotation' : 'rotations'} completed`}</p>
            {nextBlock && <div class="mixed-countdown mixed-coached-next">
              <p class="mixed-eyebrow num">Up next</p>
              <h2>{mixedBlockName(nextBlock)}</h2>
              <p>{nextBlock.kind === 'strength' ? `${nextBlock.sets} sets` : `${Math.floor(nextBlock.durationSec / 60)} min${nextBlock.durationSec % 60 ? ` ${nextBlock.durationSec % 60} sec` : ''}`} · {blockKind(nextBlock)}</p>
            </div>}
            <button type="button" class="primary" disabled={busy} onClick={() => submit({ type: 'continue' })}>
              {nextBlock ? <>Continue to {mixedBlockName(nextBlock)}<span class="visually-hidden"> →</span><ArrowRightIcon /></> : 'Finish workout'}
            </button>
            {clock?.startedAt !== null && <button type="button" class="mixed-coached-edit" disabled={busy} onClick={() => setEditing(true)}><EditIcon /> Edit what I did</button>}
          </>}
        </section>
      ) : stage === 'review' ? (
        <section class="mixed-review">
          <h2 ref={reviewHeading} tabIndex={-1}>Review block</h2>
          {clock && <p>{formatClock(Math.floor((clock.frozenElapsedMs ?? 0) / 1000))} elapsed</p>}
          {strength && <p>{setSlot ? `${setSlot} of ${strength.sets} sets logged` : 'Skipped'}</p>}
          {block.kind === 'run' && startedClock(clock)
            ? <RunReviewForm elapsedSec={Math.floor((clock?.frozenElapsedMs ?? 0) / 1000)} modality={acceptedRun?.modality ?? block.modality} finish={finish} busy={busy} submit={submit} />
            : <ReviewForm draft={clock?.startedAt === null ? undefined : draft} stations={stations} finish={finish} busy={busy} submit={submit} />}
        </section>
      ) : strength ? (
        <>
          <p>{ready ? `${strength.sets} sets · ${strength.repMin}–${strength.repMax} reps` : options ? 'Movement unavailable' : 'Checking equipment…'}</p>
          <MixedDemo key={`${strength.exerciseId}:${strength.equipmentId}:${options?.poseId}`} scope={block.id} exerciseId={strength.exerciseId} poseId={options?.poseId || undefined} />
          {ready && <StrengthSet key={`${strength.exerciseId}:${strength.equipmentId}:${setSlot}`} strength={strength} slot={setSlot} busy={busy} submit={submit} />}
          <div class="actions">
            {stage === 'entry' && <button type="button" disabled={busy || !options?.strength?.length} onClick={() => setSwap('strength')}>Swap exercise</button>}
            <button type="button" disabled={busy} onClick={() => submit({ type: stage === 'entry' ? 'skip' : 'finish' })}>{stage === 'entry' ? 'Skip block' : 'Finish block'}</button>
          </div>
        </>
      ) : (
        <>
          <div class={`mixed-countdown${rotation ? ' mixed-coached-clocks' : ''}`}>
            {rotation && <div><span class="mixed-eyebrow num">Current interval <span class="mixed-phase">{rotation.at.phase}</span></span>
              <strong class="num" role="timer" aria-label="Phase time left">{formatClock(remaining ? rotation.remainingSec : 0)}</strong></div>}
            <div class={rotation ? 'mixed-rounds' : undefined}><span class="mixed-eyebrow num">{paused ? 'Paused · time left' : 'Block time left'}</span>
              <strong class="num" role="timer" aria-label={coached ? 'Block time left' : undefined}>{formatClock(remaining)}</strong></div>
            {circuit && draft && <div class="mixed-rounds"><span class="mixed-eyebrow num">Rounds logged</span>
              <strong class="num" aria-label={draft.rounds === null ? 'Rounds unreported' : undefined}>{String(draft.rounds ?? 0).padStart(2, '0')}</strong></div>}
            <progress aria-label="Block time left" max={block.kind === 'strength' ? 1 : clock ? clock.durationMs / 1000 : block.durationSec} value={remaining} />
          </div>
          {circuit || coached ? (
            <>
              {rotation && currentStation && nextStationInLineup ? <>
                <div class="mixed-stations-head"><span><b>Up next:</b> {exerciseName(nextStationInLineup.exerciseId)}</span>
                  <span class="num">Round {rotation.at.rotations + 1}</span></div>
                <p class="mixed-coached-announcement" role="status">{exerciseName(currentStation.exerciseId)} · {rotation.at.phase} · Round {rotation.at.rotations + 1}</p>
              </> : <div class="mixed-stations-head"><span>{coached ? `Sound cues ${sound === false ? 'off' : 'on'}` : 'Go in order. Repeat at your pace.'}</span><span class="num">{stations.length} stations</span></div>}
              <div class="gym-grid">
                {stations.map((station, i) => (
                  <StationCard key={station.slotId} exerciseId={station.exerciseId} equipmentId={station.equipmentId}
                    poseId={options?.available?.has(station.slotId) ? station.poseId : undefined} index={i}
                    target={stationTargetLine(station.exerciseId, station.target.amount, station.target.unit, station.load)}
                    interval={coached && station.target.unit !== 'sec' ? stationWorkSec(station.target, coached.workSec) : undefined}
                    marker={station === currentStation ? 'Now' : station === nextStationInLineup ? 'Next' : undefined}
                    playing={demo.playingId === stationIdentity(station, stationPose(station))} onPlay={() => demo.toggle(stationIdentity(station, stationPose(station)))}
                    onSwap={coached && stage === 'active' && station.skipped ? undefined : () => setSwap({ slotId: station.slotId })} disabled={busy}
                    status={station.skipped ? 'Skipped' : options && !options.available?.has(station.slotId) ? 'Movement unavailable' : undefined} />
                ))}
              </div>
            </>
          ) : (block.kind === 'preparation' || block.kind === 'recovery') && <>
            <p>{block.instructions}</p>
            {block.exerciseId && <MixedDemo key={`${block.exerciseId}:${options?.equipmentId}:${options?.poseId}`} scope={block.id} exerciseId={block.exerciseId} poseId={options?.poseId || undefined} />}
            {options && !ready && <p>Movement unavailable</p>}
          </>}
          {block.kind === 'run' && <>
            <p>{runKindName(acceptedRun?.runKind ?? block.runKind)} · {modalityName(acceptedRun?.modality ?? block.modality)} · {Math.round((clock?.durationMs ?? phases.at(-1)?.endMs ?? block.durationSec * 1000) / 60_000)} min planned</p>
            {segment?.current && <div class="mixed-run-segment" role="status" data-testid="run-segment">
              <p class="mixed-eyebrow num">Now</p>
              <h2>{segment.current.label}</h2>
              <p class="num" role="timer" aria-label="Segment time left">{formatClock(Math.ceil(segment.remainingMs / 1000))}</p>
              {segment.next && <p><b>Next:</b> {segment.next.label}</p>}
            </div>}
            <MixedDemo key={`${block.id}:${(acceptedRun?.modality ?? block.modality)}:${options?.poseId}`} scope={block.id} exerciseId={runExerciseId(acceptedRun?.modality ?? block.modality)} poseId={options?.poseId || undefined} />
            {options && !ready && <p>Movement unavailable</p>}
          </>}
          <div class="mixed-live-actions actions">
            {stage === 'entry' ? <>
              <button type="button" class="primary" disabled={busy || !ready} onClick={() => { if (sound !== false) unlockAudio(); void submit({ type: 'start' }); }}>Start block</button>
              <button type="button" disabled={busy} onClick={() => submit({ type: 'skip' })}>Skip block</button>
            </> : <>
              <button type="button" disabled={busy || remaining === 0} onClick={() => { if (paused && sound !== false) unlockAudio(); void submit({ type: paused ? 'resume' : 'pause' }); }}>
                {coached && (paused ? <PlayIcon /> : <PauseIcon />)}{paused ? 'Resume' : 'Pause'}
              </button>
              {rotation && <button type="button" disabled={busy || paused || remaining === 0} onClick={() => submit({ type: 'next', observed: rotation.at })}><ArrowRightIcon /> Next</button>}
              {circuit && <button type="button" class="primary" disabled={busy || paused || !ready || remaining === 0}
                onClick={() => submit({ type: 'round', expectedTapped: draft?.tapped ?? 0, expectedStations: stations })}>+1 round</button>}
              <button type="button" disabled={busy || remaining === 0} onClick={() => submit({ type: 'finish' })}>Finish block</button>
            </>}
          </div>
        </>
      )}
      {swap && stage !== 'review' && (
        <Sheet label={swapped ? `Swap ${exerciseName(swapped.exerciseId)}` : 'Swap exercise'} onClose={() => setSwap(null)}>
          <h2>{swapped ? `Swap ${exerciseName(swapped.exerciseId)}` : 'Swap exercise'}</h2>
          <div class="mixed-fields">
            {(swapped ? options?.stations?.[swapped.slotId]?.map((s) => s.exerciseId) : options?.strength)?.filter((id) => !stations.some((s) => s.exerciseId === id)).map((id) => (
              <button type="button" key={id} disabled={busy} onClick={() => selectSwap(id)}>{exerciseName(id)}</button>
            ))}
            {swapped && !swapped.skipped && (!coached || stage === 'entry') && <button type="button" disabled={busy} onClick={() => selectSwap(null)}>Skip station</button>}
            <button type="button" onClick={() => setSwap(null)}>Close</button>
          </div>
          {error && <SaveError error={error} retry={retry} submit={submit} busy={busy} />}
        </Sheet>
      )}
    </main>
  );
}

function MixedDemo({ scope, exerciseId, poseId }: { scope: string; exerciseId: string; poseId?: string }) {
  const { playingId, toggle } = useDemoPlayback(scope, poseId ? [exerciseId] : []);
  const playing = playingId === exerciseId;
  return <div class="mixed-demo">
    <PoseView exerciseId={exerciseId} poseId={poseId} running={playing} />
    {poseId && <PosePlaybackButton name={exerciseName(exerciseId)} playing={playing} onPlay={() => toggle(exerciseId)} />}
  </div>;
}

const RUN_MODALITIES: CardioModality[] = ['run', 'treadmill', 'bike', 'row', 'ski', 'stair', 'elliptical'];

function RunReviewForm({ elapsedSec, modality, finish, busy, submit }: {
  elapsedSec: number; modality: CardioModality; finish: boolean; busy: boolean; submit: Submit;
}) {
  const [distance, setDistance] = useState('');
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(elapsedSec / 60))));
  const [mode, setMode] = useState<CardioModality>(modality);
  const [rpe, setRpe] = useState<number | null>(null);
  const [pain, setPain] = useState(false);
  const actuals = runReviewActuals({ distance, minutes, modality: mode, rpe, pain });
  return (
    <form class="mixed-fields" data-testid="run-review" onSubmit={(event) => {
      event.preventDefault();
      if (actuals) void submit({ type: 'continue', run: actuals });
    }}>
      <label>Distance (mi)<input type="number" inputMode="decimal" min="0" step="any" value={distance} onInput={(e) => setDistance(e.currentTarget.value)} /></label>
      <label>Duration (min)<input type="number" inputMode="decimal" min="0.5" step="any" required value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} /></label>
      <label>Modality<select value={mode} onChange={(e) => setMode(e.currentTarget.value as CardioModality)}>
        {RUN_MODALITIES.map((m) => <option key={m} value={m}>{modalityName(m)}</option>)}</select></label>
      <p>Effort (RPE 1–10)</p>
      <RpeChips value={rpe} onChange={setRpe} />
      <label class="check"><input type="checkbox" checked={pain} onChange={(e) => setPain(e.currentTarget.checked)} />Pain during this block</label>
      <button type="submit" class="primary" disabled={busy || !actuals}>{finish ? 'Finish workout' : 'Continue'}</button>
    </form>
  );
}

function formatClock(seconds: number) {
  return [Math.floor(seconds / 60), seconds % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function SaveError({ error, retry, submit, busy }: { error: string; retry: Retry | null; submit: Submit; busy: boolean }) {
  return <div class="mixed-save-error"><p role="alert">{error}</p>
    {retry && <button type="button" disabled={busy} onClick={() => submit(retry.action, retry.expected, retry.closeEditor)}>Retry</button>}</div>;
}

function StrengthSet({ strength, slot, busy, submit }: { strength: AcceptedStrength; slot: number; busy: boolean; submit: Submit }) {
  const [weight, setWeight] = useState(String(strength.targetWeight ?? ''));
  const [reps, setReps] = useState(String(strength.repMin));
  const repsError = rangeError(reps, 'Reps', LIMITS.strengthReps, { min: 1, integer: true });
  return (
    <form class="mixed-fields" onSubmit={(event) => {
      event.preventDefault();
      if (repsError) return;
      void submit({ type: 'set', weight: Number(weight), reps: Number(reps),
        expectedExerciseId: strength.exerciseId, expectedEquipmentId: strength.equipmentId });
    }}>
      <h2>Set {slot + 1} of {strength.sets}</h2>
      <label>Weight (lb)<input type="number" inputMode="decimal" min="0" step="any" required value={weight} onInput={(e) => setWeight(e.currentTarget.value)} /></label>
      <label>Reps<input type="number" inputMode="numeric" min="1" step="1" required value={reps} onInput={(e) => setReps(e.currentTarget.value)} /></label>
      {repsError && <p class="field-error" role="alert">{repsError}</p>}
      <button class="primary" type="submit" disabled={busy}>Log set</button>
    </form>
  );
}

function ReviewForm({ draft, stations, finish, busy, submit, edit }: {
  draft?: MixedDraft;
  stations: EffectiveStation[];
  finish: boolean;
  busy: boolean;
  submit: Submit;
  edit?: boolean;
}) {
  const [rounds, setRounds] = useState(draft?.rounds == null ? '' : String(draft.rounds));
  const [slot, setSlot] = useState(draft?.partial?.slotId ?? '');
  const [count, setCount] = useState(draft?.partial ? String(draft.partial.count) : '');
  const current = stations.find((s) => !s.skipped && s.slotId === slot);
  const actual = (r: string, s: EffectiveStation | undefined, c: string) => ({
    rounds: r === '' ? null : Number(r),
    partial: s && c !== '' ? { slotId: s.slotId, unit: s.target.unit, count: Number(c) } : null,
  });
  const roundsError = rangeError(rounds, 'Completed rounds', LIMITS.rounds, { integer: true });
  const partialError = rangeError(count, 'Partial work', LIMITS.targetReps);
  const save = (r: string, s: EffectiveStation | undefined, c: string) => {
    if (rangeError(r, 'Completed rounds', LIMITS.rounds, { integer: true }) || rangeError(c, 'Partial work', LIMITS.targetReps)) return;
    void submit({ type: 'review', ...actual(r, s, c) });
  };
  return (
    <form class="mixed-fields" onSubmit={(event) => {
      event.preventDefault();
      if (roundsError || partialError) return;
      void submit({ type: edit ? 'review' : 'continue', ...(draft ? actual(rounds, current, count) : {}) }, undefined, edit);
    }}>
      {draft && <>
        <label>Completed rounds<input type="number" inputMode="numeric" min="0" step="1" value={rounds}
          onInput={(e) => {
            const { value, validity } = e.currentTarget;
            setRounds(value);
            if (!validity.badInput) save(value, current, count);
          }} /></label>
        {roundsError && <p class="field-error" role="alert">{roundsError}</p>}
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
        {partialError && <p class="field-error" role="alert">{partialError}</p>}
      </>}
      <button type="submit" class="primary" disabled={busy}>{edit ? 'Save edits' : finish ? 'Finish workout' : 'Continue'}</button>
    </form>
  );
}
