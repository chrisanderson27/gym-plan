import type { Equipment, SetRow } from '../../data/types';
import {
  BARBELL_LOWER_MIN_INCREMENT_LB,
  BASE_WORKING_SETS,
  CALIBRATION_REPS,
  DEFAULT_RIR_TARGET,
  DELOAD_RIR,
  DELOAD_SET_FACTOR,
  MISSED_REP_DELOAD_PCT,
  MISSES_BEFORE_REDUCE,
  RAMP_IN_RIR,
  RAMP_IN_VOLUME,
} from '../config';
import { nearestStep, nextStep, stepBy } from './steps';
import type { HistorySession, LiftExercise, Prescription } from './types';

export interface PrescribeCtx {
  deload: boolean;
  rampIn: boolean;
  isLowerBarbell: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const byIdx = (a: SetRow, b: SetRow) => a.idx - b.idx;
const isCalib = (s: SetRow) => s.setKind === 'calibration';
// Logged failed sets (0 reps) still count: they are misses, not absent rows.
const isWork = (s: SetRow) => s.setKind === undefined || s.setKind === 'working';

export const isLowerBarbell = (ex: LiftExercise, eq: Equipment): boolean =>
  eq.kind === 'barbell' && ['squat', 'hinge', 'lunge'].includes(ex.group);

/** Where a calibration starts for each equipment kind. */
export function calibrationStart(eq: Equipment): number {
  if (eq.kind === 'db') return nearestStep(eq.steps, 10);
  if (eq.kind === 'kb') return nearestStep(eq.steps, 18);
  return eq.steps[0] ?? 0;
}

/** Working weight after a calibration: last calibration set, one step down if it was hard (RIR 0–1). */
export function calibrationLanding(steps: number[], sets: SetRow[]): number {
  const last = [...sets].filter(isCalib).sort(byIdx).at(-1);
  if (!last) return steps[0] ?? 0;
  return last.rir === 0 || last.rir === 1 ? stepBy(steps, last.weight, -1) : last.weight;
}

/**
 * `pairHistory` is the sessions holding sets for this exercise × equipment, ascending, deload sessions
 * excluded. Raises only when every set hit the top of the range at last-set RIR ≤ 2 (§13).
 */
export function prescribe(ex: LiftExercise, eq: Equipment, pairHistory: HistorySession[], ctx: PrescribeCtx): Prescription {
  const bodyweight = eq.kind === 'bodyweight';
  const steps = bodyweight ? [0] : eq.steps;
  const { repMin, repMax } = ex;

  const sessions = pairHistory
    .map((h) => {
      const mine = h.sets.filter((s) => s.exerciseId === ex.id && s.equipmentId === eq.id);
      const block = h.session.blocks.find((b) => b.kind === 'lift' && b.exerciseId === ex.id && b.equipmentId === eq.id);
      const planned = block && block.kind === 'lift' ? block.sets : 0;
      return { work: mine.filter(isWork).sort(byIdx), calib: mine.filter(isCalib).sort(byIdx), planned };
    })
    .filter((s) => s.work.length + s.calib.length > 0);

  const finish = (p: Omit<Prescription, 'sets' | 'rirTarget'>, lastWorkWeight?: number): Prescription => {
    let sets = BASE_WORKING_SETS;
    let rirTarget = DEFAULT_RIR_TARGET;
    let { mode, weight, reason } = p;
    if (ctx.rampIn) {
      sets = Math.max(2, Math.round(sets * RAMP_IN_VOLUME));
      rirTarget = RAMP_IN_RIR;
    }
    if (ctx.deload) {
      sets = Math.max(1, Math.ceil(BASE_WORKING_SETS * DELOAD_SET_FACTOR));
      rirTarget = DELOAD_RIR;
      mode = 'deload';
      weight = lastWorkWeight ?? weight;
      reason = `deload: ${sets} sets @ RIR ${DELOAD_RIR}, no raise`;
    }
    return { mode, weight, reps: p.reps, sets, rirTarget, reason };
  };

  const last = sessions.at(-1);
  if (!last) {
    // Bodyweight never calibrates.
    if (bodyweight) return finish({ mode: 'repeat', weight: 0, reps: repMin, reason: 'bodyweight: start at the bottom of the range' });
    return {
      mode: 'calibrate',
      weight: calibrationStart(eq),
      reps: CALIBRATION_REPS,
      sets: 1,
      rirTarget: DEFAULT_RIR_TARGET,
      reason: 'calibrate: find a weight you could lift ~3 more times',
    };
  }

  if (last.work.length === 0) {
    const weight = calibrationLanding(steps, last.calib);
    return finish({ mode: 'repeat', weight, reps: clamp(CALIBRATION_REPS, repMin, repMax), reason: `from calibration: ${weight}` }, weight);
  }

  const w = last.work.at(-1)!.weight;
  const lastRir = last.work.at(-1)!.rir;
  const topped = new Set(last.work.map((s) => s.idx)).size >= last.planned && last.work.every((s) => s.reps >= repMax && s.weight >= s.targetWeight);
  if (topped && (lastRir === 0 || lastRir === 1)) {
    const nxt = nextStep(steps, w, ctx.isLowerBarbell ? BARBELL_LOWER_MIN_INCREMENT_LB : 0);
    if (nxt === null) return finish({ mode: 'hold', weight: w, reps: repMax, reason: 'hold: top of the rack' }, w);
    return finish({ mode: 'progress', weight: nxt, reps: repMin, reason: `+1 step: ${last.work.length}×${repMax} @ RIR 1–2` }, w);
  }

  if (last.work.some((s) => s.reps < repMin)) {
    let m = 0;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const sess = sessions[i]!;
      if (!sess.work.some((s) => s.reps < repMin)) break;
      m++;
      const prev = sessions[i - 1];
      // A drop in weight means a reduce happened in between: the streak restarts there.
      if (prev?.work.length && prev.work.at(-1)!.weight > sess.work.at(-1)!.weight) break;
    }
    if (m >= MISSES_BEFORE_REDUCE) {
      const weight = nearestStep(steps, w * (1 - MISSED_REP_DELOAD_PCT));
      return finish({ mode: 'reduce', weight, reps: repMin, reason: `reduce: missed ${m} sessions in a row` }, w);
    }
    return finish({ mode: 'hold', weight: w, reps: repMin, reason: 'hold: missed once' }, w);
  }

  const reps = Math.min(repMax, Math.min(...last.work.map((s) => s.reps)) + 1);
  return finish({ mode: 'repeat', weight: w, reps, reason: `repeat: aim for ${reps} reps` }, w);
}
