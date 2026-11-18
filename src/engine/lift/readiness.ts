import type { ISODateTime } from '../../data/types';
import { READY_HOURS, READY_HOURS_NEAR_FAILURE } from '../config';
import { isWorking, type LiftExercise, type LiftSnapshot } from './types';

const HOUR = 3_600_000;

export interface MuscleState {
  lastAt: ISODateTime | null;
  readyAt: ISODateTime | null;
  ready: boolean;
}

/** From `sets` only — cross-activity rules are P4. 72 h when that session hit RIR 0 on a primary. */
export function muscleReadiness(snapshot: LiftSnapshot, exById: Map<string, LiftExercise>): Map<string, MuscleState> {
  const now = new Date(snapshot.now).getTime();
  const readyMs = new Map<string, { last: number; ready: number }>();
  for (const h of snapshot.history) {
    const work = h.sets.filter(isWorking);
    for (const s of work) {
      const ex = exById.get(s.exerciseId);
      if (!ex) continue;
      const at = new Date(s.ts ?? h.session.date).getTime();
      for (const m of [...ex.primary, ...ex.secondary]) {
        const nearFailure = work.some((w) => {
          if (w.rir !== 0) return false;
          return exById.get(w.exerciseId)?.primary.includes(m) ?? false;
        });
        const ready = at + (nearFailure ? READY_HOURS_NEAR_FAILURE : READY_HOURS) * HOUR;
        const cur = readyMs.get(m);
        readyMs.set(m, { last: Math.max(cur?.last ?? 0, at), ready: Math.max(cur?.ready ?? 0, ready) });
      }
    }
  }
  const out = new Map<string, MuscleState>();
  for (const [m, v] of readyMs) {
    out.set(m, { lastAt: new Date(v.last).toISOString(), readyAt: new Date(v.ready).toISOString(), ready: v.ready <= now });
  }
  return out;
}

export function variantReadiness(
  templateMuscles: string[],
  readiness: Map<string, MuscleState>,
  now: ISODateTime,
): { ready: boolean; hoursLeft: number; blocking: string[] } {
  const t = new Date(now).getTime();
  const blocking: string[] = [];
  let left = 0;
  for (const m of templateMuscles) {
    const r = readiness.get(m);
    if (!r?.readyAt) continue;
    const ms = new Date(r.readyAt).getTime() - t;
    if (ms > 0) {
      blocking.push(m);
      left = Math.max(left, ms);
    }
  }
  return { ready: blocking.length === 0, hoursLeft: Math.ceil(left / HOUR), blocking };
}
