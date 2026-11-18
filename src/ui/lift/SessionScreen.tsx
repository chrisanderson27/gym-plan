import { useState } from 'preact/hooks';
import { LIFT_TEMPLATES, exerciseById } from '../../content';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import {
  LIFT_EXERCISES,
  blockPrescriptionPatch,
  ensureEquipmentInstance,
  finishLiftSession,
  loadLiftSnapshot,
  prescribeExercise,
  resolveEquipmentId,
  setNotAtMyGym,
  setPreferredEquipment,
  swapExerciseInSession,
} from '../../data/lift';
import type { LiftBlock } from '../../data/types';
import { localDate } from '../../engine/dates';
import { pickSubstitute } from '../../engine/lift/generator';
import { isRampInWeek, weekIndex } from '../../engine/week';
import { FeedbackButton } from '../slots/FeedbackButton';
import { navigate } from '../router';
import { CalibrationCard } from './CalibrationCard';
import { EquipmentSheet } from './EquipmentSheet';
import { ExerciseCard } from './ExerciseCard';
import { SwapSheet } from './SwapSheet';

type Sheet = { kind: 'swap' | 'equip'; block: LiftBlock } | null;

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
    const full = await loadLiftSnapshot(db);
    // Progression reads history only: the session being logged must not feed its own prescription.
    return { session, sets, snapshot: { ...full, history: full.history.filter((h) => h.session.id !== sessionId) } };
  }, [sessionId]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [rpePrompt, setRpePrompt] = useState(false);
  const [fatigue, setFatigue] = useState(false);

  if (!data) return <main class="screen"><h1>Session</h1></main>;
  const { session, sets, snapshot } = data;
  if (!session) {
    return (
      <main class="screen">
        <h1>Session not found</h1>
        <a href="#/lift">Back to Lift</a>
      </main>
    );
  }

  const weekIdx = weekIndex(localDate(new Date(session.date)), snapshot.programStart);
  const flags = { deload: !!session.flags?.deload, rampIn: isRampInWeek(weekIdx) };
  const lifts = session.blocks.filter((b): b is LiftBlock => b.kind === 'lift');
  const planned = new Set(lifts.map((b) => b.exerciseId));
  const name = session.variant ? `${LIFT_TEMPLATES[session.variant].name} · ${LIFT_TEMPLATES[session.variant].focus}` : 'Lift';
  const elapsed = Math.max(0, Math.round(((session.endedAt ? new Date(session.endedAt).getTime() : Date.now()) - new Date(session.date).getTime()) / 60_000));

  const rebuildPrescription = (exId: string, eqId: string) => blockPrescriptionPatch(snapshot, exId, eqId, flags);

  const swapTo = async (block: LiftBlock, newId: string) => {
    const ex = exerciseById.get(newId);
    if (!ex) return;
    const eqId = await ensureEquipmentInstance(db, ex, resolveEquipmentId(snapshot, ex, weekIdx));
    await swapExerciseInSession(db, sessionId, block.id, newId, eqId, rebuildPrescription(newId, eqId));
    setSheet(null);
  };
  const notAtMyGym = async (block: LiftBlock) => {
    await setNotAtMyGym(db, block.exerciseId, true);
    const overrides = new Map(snapshot.overrides).set(block.exerciseId, { exerciseId: block.exerciseId, notAtMyGym: true });
    const sub = pickSubstitute(block.exerciseId, LIFT_EXERCISES, overrides, { exclude: planned });
    if (sub) await swapTo(block, sub);
  };
  const chooseEquipment = async (block: LiftBlock, eqId: string) => {
    await setPreferredEquipment(db, block.exerciseId, eqId);
    await swapExerciseInSession(db, sessionId, block.id, block.exerciseId, eqId, rebuildPrescription(block.exerciseId, eqId));
    setSheet(null);
  };

  const finish = async (rpe: number | null) => {
    await finishLiftSession(db, sessionId, rpe);
    const done = await db.sessions.get(sessionId);
    if (done?.flags?.fatigue) {
      setRpePrompt(false);
      setFatigue(true);
    } else {
      navigate('/');
    }
  };

  const warm = lifts.find((b) => b.warmup);
  const cardFor = (block: LiftBlock) => {
    const mine = sets.filter((s) => s.exerciseId === block.exerciseId && s.equipmentId === (block.equipmentId ?? ''));
    const presc = block.equipmentId ? prescribeExercise(snapshot, block.exerciseId, block.equipmentId, flags) : null;
    const calibrating = mine.some((s) => s.setKind === 'calibration') || presc?.mode === 'calibrate';
    const props = {
      session,
      block,
      sets: mine,
      snapshot,
      flags,
      onSwap: () => setSheet({ kind: 'swap', block }),
      onEquipment: () => setSheet({ kind: 'equip', block }),
      onNotAtMyGym: () => notAtMyGym(block),
      onSwapTo: (id: string) => swapTo(block, id),
    };
    return calibrating ? <CalibrationCard key={`${block.id}|${block.equipmentId}`} {...props} /> : <ExerciseCard key={`${block.id}|${block.equipmentId}`} {...props} />;
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>{name}</h1>
        <FeedbackButton kind="workout" context={{ sessionId }} />
      </header>
      <p class="dim">{session.endedAt ? 'Finished' : 'In progress'} · {elapsed} min</p>

      {fatigue && (
        <p class="warn" data-testid="fatigue-banner">
          Several exercises fell short. Take it easy next time — a deload may be coming. <a href="#/">Home</a>
        </p>
      )}

      {warm && (
        <section class="card" data-testid="warmup">
          <h2>{warm.label}</h2>
          <p class="dim">{warm.notes}</p>
          <label class="check"><input type="checkbox" data-testid="warmup-done" /> Warm-up done</label>
        </section>
      )}

      {lifts.filter((b) => !b.warmup).map(cardFor)}

      {sheet?.kind === 'swap' && (
        <SwapSheet
          exerciseId={sheet.block.exerciseId}
          overrides={snapshot.overrides}
          exclude={planned}
          onPick={(id) => swapTo(sheet.block, id)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'equip' && (
        <EquipmentSheet
          exerciseId={sheet.block.exerciseId}
          currentId={sheet.block.equipmentId ?? ''}
          equipment={snapshot.equipment}
          onChoose={(id) => chooseEquipment(sheet.block, id)}
          onClose={() => setSheet(null)}
        />
      )}

      {!session.endedAt && !rpePrompt && (
        <button type="button" class="primary" data-testid="finish" onClick={() => setRpePrompt(true)}>Finish</button>
      )}
      {rpePrompt && (
        <div class="sheet" data-testid="rpe-prompt">
          <p>How hard was the session overall? (optional)</p>
          <div class="chips">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" class="chip" data-testid={`rpe-${n}`} onClick={() => finish(n)}>{n}</button>
            ))}
          </div>
          <button type="button" data-testid="rpe-skip" onClick={() => finish(null)}>Skip</button>
        </div>
      )}
    </main>
  );
}
