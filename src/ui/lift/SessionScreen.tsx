import { useEffect, useState } from 'preact/hooks';
import { EXERCISES, LIFT_TEMPLATES, exerciseById } from '../../content';
import { blockedExerciseIds } from '../../content/equipment-prefs';
import { db } from '../../data/db';
import {
  LIFT_EXERCISES, changeBlockEquipment, loadLiftSnapshot, prescribeExercise,
  saveCircuitLog, setNotAtMyGym, setPainFlag, swapBlockExercise, undoLastSet,
} from '../../data/lift';
import { useLiveQuery } from '../../data/live';
import { getSettings } from '../../data/settings';
import type { CircuitBlock, CircuitLog, LiftBlock, RunBlock, SetRow } from '../../data/types';
import { estimateLiftDayMinutes } from '../../engine/block/generate';
import { REST_DEFAULT_SEC } from '../../engine/config';
import { localDate } from '../../engine/dates';
import { isLiftDayCooldown, resumeIndex, sessionSteps, stepDone, upNext, type Step } from '../../engine/lift/focus';
import { pickSubstitute } from '../../engine/lift/generator';
import { isWorking } from '../../engine/lift/types';
import { loggedBlockPR, setPRs, type PR } from '../../engine/pr';
import { isRampInWeek, weekIndex } from '../../engine/week';
import { MoreMenu } from '../MoreMenu';
import { fmtMSS } from '../cardio/format';
import { exerciseName, modalityName, podLabel, runKindName, stationEquipmentLabel } from '../labels';
import { navigate } from '../router';
import { BlockScreen } from '../session/BlockScreen';
import { DiscardSheet } from '../session/DiscardSheet';
import { FinishSheet } from '../session/FinishSheet';
import { PrBanner } from '../session/PrBanner';
import { RestTimer } from '../session/RestTimer';
import { blockChangeItems, exerciseChangeItems } from '../session/changeItems';
import { PoseView } from '../slots/PoseView';
import { useNow, useWakeLock } from '../session/hooks';
import { CalibrationCard } from './CalibrationCard';
import { EquipmentSheet } from './EquipmentSheet';
import { FocusLift } from './FocusLift';
import { SwapSheet } from './SwapSheet';

type ChangeSheet = { kind: 'swap' | 'equip'; block: LiftBlock } | null;
type Rest = { startedAtMs: number; restSec: number };

function cardioDescription(block: RunBlock) {
  const minutes = Math.round(block.repeats * block.segments.reduce((n, s) => n + (s.sec ?? 0), 0) / 60);
  return `${modalityName(block.modality)} · ${minutes} min (${runKindName(block.runKind)})`;
}

function stepDescription(step: Step) {
  switch (step.kind) {
    case 'note': return step.block.label ?? (step.role === 'warmup' ? 'Warm-up' : 'Cool-down');
    case 'lift': return step.blocks.map((b) => {
      const reps = b.repMin === b.repMax ? b.repMin : `${b.repMin}–${b.repMax}`;
      return `${exerciseName(b.exerciseId)} · ${b.sets} × ${reps}`;
    }).join(' / ');
    case 'circuit': return [step.block.label ?? 'Block', `${step.block.durationSec / 60} min`, podLabel(step.block.podId)].filter(Boolean).join(' · ');
    case 'cardio': return cardioDescription(step.block);
  }
}

export function SessionScreen({ sessionId }: { sessionId: string }) {
  return <SessionRunner key={sessionId} sessionId={sessionId} />;
}

function SessionRunner({ sessionId }: { sessionId: string }) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
    const full = await loadLiftSnapshot(db);
    const settings = await getSettings(db);
    const template = session?.type === 'custom' && session.templateId ? await db.templates.get(session.templateId) : undefined;
    // Progression reads history only: the session being logged must not feed its own prescription.
    return {
      session, sets, templateName: template?.name,
      snapshot: { ...full, history: full.history.filter((h) => h.session.id !== sessionId) },
      blocked: blockedExerciseIds(EXERCISES, settings?.unavailableEquipment ?? []),
    };
  }, [sessionId]);
  const [sheet, setSheet] = useState<ChangeSheet>(null);
  const [prompt, setPrompt] = useState<'finish' | 'discard' | null>(null);
  const [i, setI] = useState<number | null>(null);
  const [rest, setRest] = useState<Rest | null>(null);
  const [record, setRecord] = useState<{ pr: PR; name: string; key: string } | null>(null);
  const [error, setError] = useState('');
  const now = useNow(1000);
  useWakeLock(!!data?.session && !data.session.endedAt && !data.session.mixed);
  const steps = sessionSteps(data?.session?.blocks ?? []);
  const index = i ?? resumeIndex(steps, data?.sets ?? []);

  // Freeze the initial resume position before local writes can change how far the saved workout appears.
  useEffect(() => {
    if (data?.session && i === null) setI(index);
  }, [data, i, index]);

  if (!data) return <main class="screen"><h1>Session</h1></main>;
  const { session, sets, snapshot, templateName, blocked } = data;
  if (!session) {
    return <main class="screen"><h1>Session not found</h1><a class="btn" href="#/lift">Back to Lift</a></main>;
  }

  if (session.mixed) {
    return <main class="screen"><h1>{session.mixed.prescription.name}</h1><a class="btn"
      href={`#/workout/${session.endedAt ? 'summary' : 'session'}/${session.id}`}>{session.endedAt ? 'View workout summary' : 'Resume workout'}</a></main>;
  }

  const step = steps[index];
  const finished = !!session.endedAt;
  const isHybrid = session.type === 'hybrid';
  const liftName = session.variant ? LIFT_TEMPLATES[session.variant].name : (templateName ?? 'Lift');
  const name = isHybrid ? `Hybrid · ${liftName}` : liftName;
  const started = Date.parse(session.date);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const weekIdx = weekIndex(localDate(new Date(session.date)), snapshot.programStart);
  const flags = { deload: !!session.flags?.deload, rampIn: isRampInWeek(weekIdx) };
  const planned = new Set(session.blocks.flatMap((b) => b.kind === 'lift' && !b.warmup ? [b.exerciseId] : []));
  const exclude = new Set<string>([...planned, ...blocked]);
  const history = snapshot.history.filter((h) => h.session.endedAt && h.session.date <= session.date);
  const rowsFor = (block: LiftBlock) => sets.filter((row) => row.exerciseId === block.exerciseId && row.equipmentId === (block.equipmentId ?? ''));
  const done = (block: LiftBlock) => stepDone({ kind: 'lift', blocks: [block] }, sets);
  const activeBlock = step?.kind === 'lift' ? step.blocks.find((b) => !done(b)) ?? step.blocks.at(-1) : undefined;
  const last = activeBlock && rowsFor(activeBlock)
    .filter(isWorking).sort((a, b) => a.idx - b.idx).at(-1);

  const advance = () => {
    setRest(null);
    setI(index + 1);
  };
  const cardio = () => navigate('/hybrid/cardio/' + sessionId);
  const finish = () => { setError(''); setPrompt('finish'); };
  const onAdvance = index >= steps.length - 1 ? (isHybrid ? cardio : finish) : advance;
  const advanceLabel = index >= steps.length - 1 ? (isHybrid ? 'Start cardio' : 'Finish') : 'Next';
  const workoutActions = {
    onFinish: finish,
    onDiscard: () => { setError(''); setPrompt('discard'); },
  };
  const act = async (write: () => Promise<void>) => {
    setError('');
    try {
      await write();
    } catch {
      setError('Could not update the workout. Try again.');
    }
  };
  const swapTo = (block: LiftBlock, id: string) => act(async () => {
    await swapBlockExercise(db, sessionId, block.id, id);
    setSheet(null);
  });
  const notAtMyGym = (block: LiftBlock) => act(async () => {
    await setNotAtMyGym(db, block.exerciseId, true);
    const overrides = new Map(snapshot.overrides).set(block.exerciseId, { exerciseId: block.exerciseId, notAtMyGym: true });
    const substitute = pickSubstitute(block.exerciseId, LIFT_EXERCISES, overrides, { exclude });
    if (substitute) await swapTo(block, substitute);
  });
  const logged = (block: LiftBlock, row: SetRow) => {
    setI(index);
    setRest({ startedAtMs: Date.parse(row.ts!), restSec: block.restSec ?? REST_DEFAULT_SEC });
    const [pr] = setPRs(row, history, sessionId);
    if (pr) setRecord({ pr, name: exerciseName(row.exerciseId), key: row.id });
  };
  const saveBlock = async (block: CircuitBlock, log: CircuitLog) => {
    await saveCircuitLog(db, sessionId, block.id, log);
    const pr = loggedBlockPR(session, { ...block, log }, snapshot.history);
    if (pr) setRecord({ pr, name: block.label ?? 'Block', key: block.id });
    advance();
  };

  const cards = step?.kind === 'lift' ? step.blocks.map((block) => {
    const mine = rowsFor(block);
    const presc = block.equipmentId ? prescribeExercise(snapshot, block.exerciseId, block.equipmentId, flags, block) : null;
    return {
      block, mine, calibrating: mine.some((row) => row.setKind === 'calibration') || presc?.mode === 'calibrate',
    };
  }) : [];
  const candidate = cards.find(({ block, calibrating }) => !calibrating && !done(block));
  const calibrationAdvance = cards.filter(({ calibrating }) => calibrating).at(-1);
  const cardFor = ({ block, mine, calibrating }: (typeof cards)[number]) => {
    const props = {
      session, block, sets: mine, snapshot, flags, blocked,
      onSwap: () => setSheet({ kind: 'swap', block }),
      onEquipment: () => setSheet({ kind: 'equip', block }),
      onNotAtMyGym: () => notAtMyGym(block),
      onSwapTo: (id: string) => swapTo(block, id),
    };
    const key = `${block.id}|${block.exerciseId}|${block.equipmentId}`;
    return calibrating
      ? <CalibrationCard key={key} {...props} advance={!candidate && calibrationAdvance?.block === block ? { label: advanceLabel, onClick: onAdvance } : undefined} />
      : <FocusLift key={key} {...props} primary={candidate?.block === block} onLogged={(row) => logged(block, row)} />;
  };

  const count = Math.min(index + 1, steps.length);
  const next = upNext(steps, index);
  const blockStep = !finished && step?.kind === 'circuit' ? step.block : null;
  const leave = <a class="btn session-leave" href="#/" aria-label="Leave session">✕</a>;
  const progress = !finished && steps.length > 0 && (
    <p class="session-progress num">
      <span>Step {count} of {steps.length}</span>
      <span class="step-dots" aria-hidden="true">{steps.map((_, j) => <i key={j} class={j < count ? 'current' : ''} />)}</span>
    </p>
  );
  const estimate = session.blocks.some(isLiftDayCooldown)
    ? Math.round(estimateLiftDayMinutes(session.blocks, LIFT_EXERCISES))
    : null;

  return (
    <main class="screen lift-session">
      {!blockStep && (
        <header class="session-bar">
          {leave}
          <div class="session-heading"><h1>{name}</h1>{progress}</div>
          {!finished && <span class="session-elapsed num" aria-label="Elapsed time">{fmtMSS(elapsed)}</span>}
          <MoreMenu feedback={{ kind: 'workout', context: { sessionId } }} items={finished ? [] : exerciseChangeItems({
            ...workoutActions,
            onSwap: activeBlock && (() => setSheet({ kind: 'swap', block: activeBlock })),
            onEquipment: activeBlock && (() => setSheet({ kind: 'equip', block: activeBlock })),
            onNotAtMyGym: activeBlock && (() => notAtMyGym(activeBlock)),
            onUndo: activeBlock && last && (() => act(async () => {
              await undoLastSet(db, sessionId, activeBlock.exerciseId, activeBlock.equipmentId ?? '');
              setRest(null);
            })),
            onPain: last && (() => act(() => setPainFlag(db, last.id, !last.painFlag))),
          })} />
        </header>
      )}
      {finished ? (
        <section>
          <h2>Finished</h2>
          <ul class="plan">
            {steps.map((s, j) => (
              <li key={j} class="session-summary-step">
                <span>{stepDescription(s)}</span>
                {s.kind === 'circuit' && s.block.log && <span class="num">{s.block.log.completedRounds} rounds</span>}
                {s.kind === 'lift' && s.blocks.map((block) => {
                  const loggedSets = rowsFor(block).filter((row) => row.setKind !== 'warmup').sort((a, b) => a.idx - b.idx);
                  return loggedSets.length > 0 && (
                    <small key={block.id} class="num dim">
                      {s.blocks.length > 1 && `${exerciseName(block.exerciseId)}: `}
                      {loggedSets.map(({ weight, reps }) => `${weight} lb × ${reps}`).join(' · ')}
                    </small>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {record && <PrBanner key={record.key} pr={record.pr} name={record.name} />}
          {step?.kind === 'note' && (
            <section class="session-note" data-testid={step.role}>
              <h2>{stepDescription(step)}</h2>
              {step.role === 'warmup' && estimate !== null && <p class="num dim" data-testid="plan-min">{estimate} min total</p>}
              <p>{step.block.notes}</p>
              <button type="button" class="primary" data-testid={step.role === 'warmup' ? 'warmup-done' : 'step-next'}
                onClick={step.role === 'warmup' ? advance : onAdvance}>{step.role === 'warmup' ? 'Start' : advanceLabel}</button>
            </section>
          )}
          {step?.kind === 'lift' && (
            <section class={cards.length > 1 ? 'superset session-superset' : undefined}
              data-testid={cards.length > 1 ? `superset-${cards[0]!.block.supersetGroup}` : undefined}>
              {cards.length > 1 && <h2>Superset · alternate sets</h2>}
              {cards.map(cardFor)}
              {!candidate && !calibrationAdvance && <button type="button" class="primary" data-testid="step-next" onClick={onAdvance}>{advanceLabel}</button>}
            </section>
          )}
          {blockStep && (
            <BlockScreen key={blockStep.id} sessionId={sessionId} block={blockStep} names={exerciseName}
              equipmentName={(station) => stationEquipmentLabel(station, snapshot.equipment)}
              steps={(id) => (id ? snapshot.equipment.get(id)?.steps : undefined) ?? []}
              place={podLabel(blockStep.podId)} headerLeft={leave}
              changeItems={blockChangeItems(workoutActions)} feedback={{ kind: 'workout', context: { sessionId } }}
              onNotAtMyGym={(exerciseId) => setNotAtMyGym(db, exerciseId, true)}
              onSkip={advance} onSave={(log) => saveBlock(blockStep, log)} />
          )}
          {step?.kind === 'cardio' && (
            <section>
              <h2>Cardio</h2>
              <p data-testid="hybrid-next">{cardioDescription(step.block)}</p>
              <button type="button" class="primary" data-testid="finish" onClick={cardio}>Start cardio</button>
            </section>
          )}
          {!step && <button type="button" class="primary" data-testid="step-next" onClick={onAdvance}>{advanceLabel}</button>}
          {rest && <RestTimer key={rest.startedAtMs} {...rest} onAdjust={(delta) => {
            setRest((cur) => cur && { ...cur, restSec: Math.max(0, cur.restSec + delta) });
          }} onSkip={() => setRest(null)} onEnd={() => setRest(null)} />}
          {next.length > 0 && (
            <section class="session-next" data-testid="up-next">
              <h2>Up next</h2>
              <ul>{next.map((s, j) => <li key={j} class="num">{stepDescription(s)}</li>)}</ul>
            </section>
          )}
          {cards.length === 1 && candidate && (
            <PoseView exerciseId={candidate.block.exerciseId} poseId={exerciseById.get(candidate.block.exerciseId)?.poseId} />
          )}
          {error && !prompt && <p class="error" role="alert">{error}</p>}
        </>
      )}

      {sheet?.kind === 'swap' && (
        <SwapSheet exerciseId={sheet.block.exerciseId} overrides={snapshot.overrides} exclude={exclude}
          onPick={(id) => swapTo(sheet.block, id)} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'equip' && (
        <EquipmentSheet exerciseId={sheet.block.exerciseId} currentId={sheet.block.equipmentId ?? ''} equipment={snapshot.equipment}
          onChoose={(id) => act(async () => {
            await changeBlockEquipment(db, sessionId, sheet.block.id, id);
            setSheet(null);
          })} onClose={() => setSheet(null)} />
      )}
      {prompt === 'finish' && <FinishSheet sessionId={sessionId} onClose={() => setPrompt(null)} onDone={() => navigate('/')} />}
      {prompt === 'discard' && <DiscardSheet session={session} onClose={() => setPrompt(null)} />}
    </main>
  );
}
