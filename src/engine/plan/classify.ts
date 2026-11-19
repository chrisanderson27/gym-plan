import type { RunRow, Session, SetRow } from '../../data/types';
import { isLoadedCircuit } from '../block/work';
import { HARD_RPE, LOWER_MUSCLES, LOWER_SESSION_MIN_SETS } from '../config';
import { localDate } from '../dates';
import { isWorking } from '../lift/types';
import type { PlanSession } from './types';

export function toPlanSession(
  session: Session,
  sets: SetRow[],
  run: RunRow | undefined,
  exById: Map<string, { primary: string[] }>,
): PlanSession {
  const working = sets.filter(isWorking);
  const lowerSets = working.filter((s) => exById.get(s.exerciseId)?.primary.some((m) => (LOWER_MUSCLES as readonly string[]).includes(m))).length;
  const lower = !!session.variant?.startsWith('lower') || lowerSets >= LOWER_SESSION_MIN_SETS;
  const modality = run?.modality ?? 'run';
  // Burn is hard but not a hard *run*; the 48 h spacing rule catches it.
  const hardRun = !!run && (modality === 'run' || modality === 'treadmill') && (run.kind === 'intervals' || (run.rpe ?? 0) >= HARD_RPE);
  return {
    id: session.id,
    start: session.date,
    end: session.endedAt ?? session.date,
    day: localDate(new Date(session.date)),
    type: session.type,
    hard: session.hard,
    hardCardio: session.hardCardio,
    ...(session.variant ? { variant: session.variant } : {}),
    lower,
    heavyLegs: lower && !session.flags?.deload,
    lifted: working.length > 0 || sets.some((s) => s.setKind === 'calibration' && s.reps > 0)
      || (session.type !== 'burn' && session.blocks.some((b) => b.kind === 'circuit' && isLoadedCircuit(b))),
    ...(run ? { runKind: run.kind } : {}),
    hardRun,
    finished: !!session.endedAt,
  };
}
