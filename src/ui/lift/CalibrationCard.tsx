import { useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { LIFT_EXERCISES, logSet, setPainFlag } from '../../data/lift';
import { CALIBRATION_JUMP_STEPS, CALIBRATION_REPS } from '../../engine/config';
import { pickSubstitute } from '../../engine/lift/generator';
import { painSwapOffer } from '../../engine/lift/pain';
import { calibrationLanding, calibrationStart } from '../../engine/lift/progression';
import { stepBy } from '../../engine/lift/steps';
import { FeedbackButton } from '../slots/FeedbackButton';
import { PoseView } from '../slots/PoseView';
import type { CardProps } from './ExerciseCard';

export function CalibrationCard(p: CardProps) {
  const { block, snapshot, session } = p;
  const ex = exerciseById.get(block.exerciseId);
  const eq = block.equipmentId ? snapshot.equipment.get(block.equipmentId) : undefined;
  const steps = eq?.steps ?? [];
  const cal = p.sets.filter((s) => s.setKind === 'calibration').sort((a, b) => a.idx - b.idx);
  const last = cal.at(-1);
  // Local only: after a reload an "4+" answer looks like a stop, and "Go heavier" restarts the ladder.
  const [heavier, setHeavier] = useState(false);
  const [reps, setReps] = useState(CALIBRATION_REPS);

  const startWeight = block.targetWeight ?? (eq ? calibrationStart(eq) : 0);
  const jump = eq ? CALIBRATION_JUMP_STEPS[eq.kind] : 1;
  const nextWeight = last ? stepBy(steps, last.weight, jump) : startWeight;
  const [weight, setWeight] = useState<number | null>(null);
  const w = weight ?? nextWeight;
  const sub = painSwapOffer(block.exerciseId, snapshot.history, p.sets, new Date().toISOString())
    ? pickSubstitute(block.exerciseId, LIFT_EXERCISES, snapshot.overrides, { jointFriendlyOnly: true })
    : null;
  const awaitingAnswer = !!last && last.rir === undefined;
  const stopped = !!last && last.rir !== undefined && !heavier;

  const log = async () => {
    await logSet(db, {
      id: newId(),
      sessionId: session.id,
      exerciseId: block.exerciseId,
      equipmentId: block.equipmentId ?? '',
      idx: cal.length,
      targetWeight: w,
      targetReps: CALIBRATION_REPS,
      weight: w,
      reps,
      painFlag: false,
      setKind: 'calibration',
      ts: new Date().toISOString(),
    });
    setHeavier(false);
    setWeight(null);
  };

  const answer = async (rir: 1 | 3, goHeavier: boolean) => {
    if (!last) return;
    await db.sets.update(last.id, { rir });
    setHeavier(goHeavier);
    setWeight(null);
  };

  return (
    <section class="card" data-testid={`exercise-${block.exerciseId}`}>
      <header>
        <h2>{ex?.name ?? block.exerciseId}</h2>
        <FeedbackButton kind="exercise" context={{ sessionId: session.id, exerciseId: block.exerciseId, equipmentId: block.equipmentId }} />
      </header>
      <PoseView exerciseId={block.exerciseId} poseId={ex?.poseId} />
      <button type="button" class="link" onClick={p.onEquipment}>{eq?.name ?? 'Choose equipment'} ▾</button>
      <p class="dim">Calibration: find a weight you could lift about 3 more times.</p>
      {cal.map((s) => (
        <div class="setrow done" key={s.id} data-testid={`cal-${block.exerciseId}-${s.idx}`}>
          <span class="idx">Set {s.idx + 1}</span>
          <span class="val">{s.weight}</span>
          <span>× {s.reps}</span>
          <button type="button" aria-label="pain" aria-pressed={s.painFlag} class={s.painFlag ? 'pain on' : 'pain'} onClick={() => setPainFlag(db, s.id, !s.painFlag)}>⚠</button>
          <FeedbackButton kind="set" context={{ sessionId: session.id, exerciseId: block.exerciseId, setId: s.id, equipmentId: s.equipmentId }} />
        </div>
      ))}
      {awaitingAnswer && (
        <div class="rir">
          <span>How many more could you have done?</span>
          <button type="button" class="chip" data-testid={`cal-le2-${block.exerciseId}`} onClick={() => answer(1, false)}>≤ 2</button>
          <button type="button" class="chip" data-testid={`cal-3-${block.exerciseId}`} onClick={() => answer(3, false)}>~3 — this is it</button>
          <button type="button" class="chip" data-testid={`cal-4-${block.exerciseId}`} onClick={() => answer(3, true)}>4+ — go heavier</button>
        </div>
      )}
      {stopped && (
        <p data-testid={`cal-result-${block.exerciseId}`}>
          Working weight: <strong>{calibrationLanding(steps, cal)}</strong>{' '}
          <button type="button" onClick={() => setHeavier(true)}>Go heavier</button>
        </p>
      )}
      {!awaitingAnswer && !stopped && (
        <div class="setrow">
          <span class="idx">Set {cal.length + 1}</span>
          <button type="button" aria-label="weight down" onClick={() => setWeight(stepBy(steps, w, -1))}>−</button>
          <span class="val" data-testid={`cal-weight-${block.exerciseId}`}>{w}</span>
          <button type="button" aria-label="weight up" onClick={() => setWeight(stepBy(steps, w, 1))}>+</button>
          <span>×</span>
          <button type="button" aria-label="reps down" onClick={() => setReps(Math.max(1, reps - 1))}>−</button>
          <span class="val">{reps}</span>
          <button type="button" aria-label="reps up" onClick={() => setReps(reps + 1)}>+</button>
          <button type="button" class="tick" data-testid={`cal-log-${block.exerciseId}`} onClick={log}>✓</button>
        </div>
      )}
      {sub && (
        <p class="warn" data-testid={`pain-offer-${block.exerciseId}`}>
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
