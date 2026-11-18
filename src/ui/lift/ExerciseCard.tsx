import { useRef, useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { LIFT_EXERCISES, prescribeExercise, setLastSetRir, setPainFlag, toggleWorkingSet, updateSetValues } from '../../data/lift';
import type { LiftBlock, Session, SetRow } from '../../data/types';
import { pickSubstitute } from '../../engine/lift/generator';
import { painSwapOffer } from '../../engine/lift/pain';
import { stepBy } from '../../engine/lift/steps';
import type { LiftSnapshot } from '../../engine/lift/types';
import { FeedbackButton } from '../slots/FeedbackButton';
import { PoseView } from '../slots/PoseView';
import { Stepper } from './Stepper';

export interface CardProps {
  session: Session;
  block: LiftBlock;
  /** Sets logged for this exercise in this session. */
  sets: SetRow[];
  /** Snapshot with the current session removed from history. */
  snapshot: LiftSnapshot;
  flags: { deload: boolean; rampIn: boolean };
  onSwap: () => void;
  onEquipment: () => void;
  onNotAtMyGym: () => void;
  onSwapTo: (exerciseId: string) => void;
}

const RIRS: { v: 0 | 1 | 3; label: string }[] = [
  { v: 0, label: '0' },
  { v: 1, label: '1–2' },
  { v: 3, label: '3+' },
];

export function ExerciseCard(p: CardProps) {
  const { block, sets, snapshot, session } = p;
  const ex = exerciseById.get(block.exerciseId);
  const eq = block.equipmentId ? snapshot.equipment.get(block.equipmentId) : undefined;
  const presc = block.equipmentId ? prescribeExercise(snapshot, block.exerciseId, block.equipmentId, p.flags, block) : null;
  const steps = eq?.steps ?? [];
  const baseWeight = presc?.weight ?? block.targetWeight ?? 0;
  const baseReps = presc?.reps ?? block.repMin;
  // Optimistic local values: the screen never waits for the live query to echo a +/− back, so a tap
  // straight after an adjust reads the value on screen, and rapid taps can't lose an increment.
  const [, rerender] = useState(0);
  const draftRef = useRef<Record<number, { weight: number; reps: number }>>({});
  // Every write for this card runs in tap order: an adjust and the ✓ that follows it cannot interleave.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (job: () => Promise<unknown>) => {
    queue.current = queue.current.then(job, job).catch((e) => console.error(e));
  };

  const working = sets.filter((s) => s.setKind === undefined || s.setKind === 'working');
  const rowFor = (idx: number) => working.find((s) => s.idx === idx);
  const view = (idx: number) => {
    const logged = rowFor(idx);
    return draftRef.current[idx] ?? (logged ? { weight: logged.weight, reps: logged.reps } : { weight: baseWeight, reps: baseReps });
  };

  const change = (idx: number, patch: Partial<{ weight: number; reps: number }>) => {
    draftRef.current = { ...draftRef.current, [idx]: { ...view(idx), ...patch } };
    rerender((n) => n + 1);
    // Looked up when the write runs, so it lands on the row even if the ✓ that created it is still queued.
    enqueue(async () => {
      const row = (await db.sets.where('sessionId').equals(session.id).toArray()).find(
        (s) => s.exerciseId === block.exerciseId && s.equipmentId === (block.equipmentId ?? '') && s.idx === idx && (s.setKind === undefined || s.setKind === 'working'),
      );
      if (row) await updateSetValues(db, row.id, patch);
    });
  };

  const toggle = (idx: number) => {
    const v = view(idx);
    enqueue(() => toggleWorkingSet(db, {
      id: newId(),
      sessionId: session.id,
      exerciseId: block.exerciseId,
      equipmentId: block.equipmentId ?? '',
      idx,
      targetWeight: baseWeight,
      targetReps: baseReps,
      weight: v.weight,
      reps: v.reps,
      painFlag: false,
      setKind: 'working',
      ...(block.supersetGroup ? { supersetGroup: block.supersetGroup } : {}),
      ts: new Date().toISOString(),
    }));
  };

  const lastIdx = block.sets - 1;
  const lastLogged = rowFor(lastIdx);
  const sub = painSwapOffer(block.exerciseId, snapshot.history, sets, new Date().toISOString())
    ? pickSubstitute(block.exerciseId, LIFT_EXERCISES, snapshot.overrides, { jointFriendlyOnly: true })
    : null;

  return (
    <section class="card" data-testid={`exercise-${block.exerciseId}`}>
      <header>
        <h2>{ex?.name ?? block.exerciseId}</h2>
        <FeedbackButton kind="exercise" context={{ sessionId: session.id, exerciseId: block.exerciseId, equipmentId: block.equipmentId }} />
      </header>
      <PoseView exerciseId={block.exerciseId} poseId={ex?.poseId} />
      <button type="button" class="link" onClick={p.onEquipment}>{eq?.name ?? 'Choose equipment'} ▾</button>
      {presc && <p class="dim">{presc.reason} · target RIR {presc.rirTarget}</p>}
      {Array.from({ length: block.sets }, (_, idx) => {
        const v = view(idx);
        const logged = rowFor(idx);
        const id = block.exerciseId;
        return (
          // Two deliberate lines: "Set N" + weight stepper, then reps stepper + ✓ (+ ⚠ / 💬 once logged).
          <div class={logged ? 'setrow done' : 'setrow'} key={idx} data-testid={`set-${id}-${idx}`}>
            <div class="setline">
              <span class="idx">Set {idx + 1}</span>
              <Stepper wide value={v.weight} unit="lb" valueTestId={`set-weight-${id}-${idx}`} downLabel="weight down" upLabel="weight up"
                onDown={() => change(idx, { weight: stepBy(steps, v.weight, -1) })} onUp={() => change(idx, { weight: stepBy(steps, v.weight, 1) })} />
            </div>
            <div class="setline">
              <Stepper value={v.reps} unit="reps" valueTestId={`set-reps-${id}-${idx}`} downLabel="reps down" upLabel="reps up"
                onDown={() => change(idx, { reps: Math.max(0, v.reps - 1) })} onUp={() => change(idx, { reps: v.reps + 1 })} />
              <button type="button" class="tick" aria-pressed={!!logged} data-testid={`set-done-${id}-${idx}`} onClick={() => toggle(idx)}>✓</button>
              {logged && (
                <button type="button" aria-label="pain" aria-pressed={logged.painFlag} class={logged.painFlag ? 'pain on' : 'pain'} onClick={() => setPainFlag(db, logged.id, !logged.painFlag)}>⚠</button>
              )}
              {logged && <FeedbackButton kind="set" context={{ sessionId: session.id, exerciseId: id, setId: logged.id, equipmentId: logged.equipmentId }} />}
            </div>
          </div>
        );
      })}
      {lastLogged && (
        <div class="rir">
          <span>Reps in reserve?</span>
          {RIRS.map((r) => (
            <button key={r.v} type="button" class={lastLogged.rir === r.v ? 'chip on' : 'chip'} data-testid={`rir-${block.exerciseId}-${r.v}`} onClick={() => setLastSetRir(db, session.id, block.exerciseId, r.v, block.equipmentId ?? '')}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {sub && (
        <p class="warn">
          Pain flagged twice — try {exerciseById.get(sub)?.name}{' '}
          <button type="button" onClick={() => p.onSwapTo(sub)}>Swap</button>
        </p>
      )}
      <div class="actions">
        <button type="button" onClick={p.onSwap}>Swap</button>
        <button type="button" onClick={p.onNotAtMyGym}>Not at my gym</button>
      </div>
    </section>
  );
}
