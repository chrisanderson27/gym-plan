import { useEffect, useRef, useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { LIFT_EXERCISES, logWorkingSet, prescribeExercise, setLastSetRir } from '../../data/lift';
import type { LiftBlock, Session, SetRow } from '../../data/types';
import { pickSubstitute } from '../../engine/lift/generator';
import { painSwapOffer } from '../../engine/lift/pain';
import { stepBy } from '../../engine/lift/steps';
import { isWorking, type LiftSnapshot } from '../../engine/lift/types';
import { unlockAudio } from '../../platform/audio';
import { CheckIcon } from '../icons';
import { StepperSheet } from '../session/StepperSheet';

export interface CardProps {
  session: Session;
  block: LiftBlock;
  sets: SetRow[];
  snapshot: LiftSnapshot;
  flags: { deload: boolean; rampIn: boolean };
  onSwap: () => void;
  onEquipment: () => void;
  onNotAtMyGym: () => void;
  onSwapTo: (exerciseId: string) => void;
  blocked: Set<string>;
}

const RIRS = [{ v: 0, label: '0' }, { v: 1, label: '1–2' }, { v: 3, label: '3+' }] as const;

export function FocusLift({ block, sets, snapshot, session, flags, onSwapTo, onLogged, primary, blocked }: CardProps & {
  onLogged: (row: SetRow) => void;
  primary: boolean;
}) {
  const ex = exerciseById.get(block.exerciseId);
  const equipmentId = block.equipmentId ?? '';
  const eq = snapshot.equipment.get(equipmentId);
  const presc = eq ? prescribeExercise(snapshot, block.exerciseId, equipmentId, flags, block) : null;
  const baseWeight = block.targetWeight ?? presc?.weight ?? 0;
  const baseReps = presc?.reps ?? block.repMin;
  const working = sets.filter(isWorking);
  const marks = Array.from({ length: block.sets }, (_, id) => working.some((s) => s.idx === id));
  const idx = marks.indexOf(false);
  const lastLogged = working.reduce<SetRow | undefined>((last, row) => !last || row.idx > last.idx ? row : last, undefined);
  const previousSet = working.find((row) => row.idx === idx - 1);
  let lastTime: SetRow | undefined;
  let lastTimeAt = -Infinity;
  for (const prior of snapshot.history) {
    if (!prior.session.endedAt || prior.session.date > session.date) continue;
    for (const set of prior.sets) {
      const at = Date.parse(set.ts ?? prior.session.date);
      if (isWorking(set) && set.exerciseId === block.exerciseId && set.equipmentId === equipmentId
          && (at > lastTimeAt || (at === lastTimeAt && set.idx >= (lastTime?.idx ?? -1)))) {
        lastTime = set;
        lastTimeAt = at;
      }
    }
  }

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const [, rerender] = useState(0);
  const draft = useRef<Record<number, { weight: number; reps: number }>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<SetRow | null>(null);
  useEffect(() => {
    if (pending.current && working.some((s) => s.id === pending.current?.id)) {
      delete draft.current[pending.current.idx];
      pending.current = null;
      rerender((n) => n + 1);
    }
  }, [sets]);

  const view = () => draft.current[idx] ?? { weight: previousSet?.weight ?? baseWeight, reps: previousSet?.reps ?? baseReps };
  const change = (patch: Partial<ReturnType<typeof view>>) => {
    draft.current[idx] = { ...view(), ...patch };
    rerender((n) => n + 1);
  };

  const done = () => {
    if (idx < 0 || pending.current) return;
    unlockAudio();
    setError(false);
    const row: SetRow = {
      ...view(), id: newId(), sessionId: session.id, exerciseId: block.exerciseId, equipmentId, idx,
      targetWeight: baseWeight, targetReps: baseReps, painFlag: false, setKind: 'working',
      ...(block.supersetGroup ? { supersetGroup: block.supersetGroup } : {}),
      ts: new Date().toISOString(),
    };
    pending.current = row;
    rerender((n) => n + 1);
    queue.current = queue.current.then(async () => {
      if (await logWorkingSet(db, row) === 'logged') {
        onLogged(row);
      } else {
        pending.current = null;
        rerender((n) => n + 1);
      }
    }).catch(() => {
      pending.current = null;
      setError(true);
    });
  };

  const name = ex?.name ?? block.exerciseId;
  const { weight, reps } = view();
  const delta = lastTime && weight - lastTime.weight;
  const sub = painSwapOffer(block.exerciseId, snapshot.history, sets, new Date().toISOString())
    ? pickSubstitute(block.exerciseId, LIFT_EXERCISES, snapshot.overrides, { jointFriendlyOnly: true, exclude: blocked })
    : null;

  return (
    <section class="focus-lift" data-testid={`exercise-${block.exerciseId}`}>
      <h2>{name}</h2>
      <p class="dim num">{[eq?.name, lastTime && `Last time ${lastTime.weight} lb × ${lastTime.reps}`].filter(Boolean).join(' · ')}</p>
      {idx >= 0 && (
        <>
          <div class="focus-values num">
            <button type="button" aria-label={`Weight ${weight} lb`} data-testid={`set-weight-${block.exerciseId}-${idx}`} onClick={() => setEditing(true)}>{weight} <small>lb</small></button>
            <span aria-hidden="true">×</span>
            <button type="button" aria-label={`${reps} reps`} data-testid={`set-reps-${block.exerciseId}-${idx}`} onClick={() => setEditing(true)}>{reps} <small>reps</small></button>
          </div>
          {!!delta && <p class="num">{delta > 0 ? `↑ +${delta}` : `↓ −${Math.abs(delta)}`} lb from last time</p>}
        </>
      )}
      <div class="set-progress num">
        <span>{idx < 0 ? `${block.sets} of ${block.sets} sets done` : `Set ${idx + 1} of ${block.sets}`}</span>
        <span aria-hidden="true">{marks.map((marked, i) => <span key={i}>{marked ? '✓' : '○'}</span>)}</span>
      </div>
      {idx >= 0 && (
        <button type="button" class={primary ? 'primary' : 'btn'} data-testid="set-done" disabled={!!pending.current} onClick={done}><CheckIcon /> Done</button>
      )}
      {error && <p class="error" role="alert">Could not log the set. Try again.</p>}
      {idx < 0 && lastLogged && (
        <div class="rir">
          <span>Reps in reserve?</span>
          {RIRS.map(({ v, label }) => (
            <button key={v} type="button" class={lastLogged.rir === v ? 'chip on' : 'chip'} aria-pressed={lastLogged.rir === v}
              data-testid={`rir-${block.exerciseId}-${v}`} onClick={() => setLastSetRir(db, session.id, block.exerciseId, v, equipmentId)}>{label}</button>
          ))}
        </div>
      )}
      {sub && (
        <p class="warn">
          Pain flagged twice. Try {exerciseById.get(sub)?.name}{' '}
          <button type="button" onClick={() => onSwapTo(sub)}>Swap</button>
        </p>
      )}
      {editing && idx >= 0 && <StepperSheet label={`Edit set ${idx + 1}`} onClose={() => setEditing(false)} fields={[
        { label: 'Weight', value: weight, unit: 'lb',
          onDown: () => change({ weight: stepBy(eq?.steps ?? [], view().weight, -1) }),
          onUp: () => change({ weight: stepBy(eq?.steps ?? [], view().weight, 1) }) },
        { label: 'Reps', value: reps, unit: 'reps', onDown: () => change({ reps: Math.max(1, view().reps - 1) }),
          onUp: () => change({ reps: view().reps + 1 }) },
      ]} />}
    </section>
  );
}
