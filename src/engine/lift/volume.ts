import type { LocalDate, SetRow } from '../../data/types';
import {
  PRIMARY_SET_WEIGHT,
  SECONDARY_SET_WEIGHT,
  TRACKED_MUSCLES,
  VOLUME_CEILING,
  VOLUME_TARGETS,
} from '../config';
import { addDays, localDate } from '../dates';
import { weekIndex } from '../week';
import { isWorking, type HistorySession, type LiftExercise, type LiftSnapshot } from './types';

/** Working sets only: primary counts 1, secondary 0.5. Warm-up and calibration never count. */
export function fractionalSets(sets: SetRow[], exById: Map<string, LiftExercise>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sets) {
    if (!isWorking(s)) continue;
    const ex = exById.get(s.exerciseId);
    if (!ex) continue;
    for (const m of ex.primary) out.set(m, (out.get(m) ?? 0) + PRIMARY_SET_WEIGHT);
    for (const m of ex.secondary) out.set(m, (out.get(m) ?? 0) + SECONDARY_SET_WEIGHT);
  }
  return out;
}

export function weeklyTarget(weekIdx: number): { min: number; max: number; ceiling: number } {
  let row: (typeof VOLUME_TARGETS)[number] = VOLUME_TARGETS[0];
  for (const r of VOLUME_TARGETS) if (r.fromWeek <= weekIdx) row = r;
  return { min: row.min, max: row.max, ceiling: VOLUME_CEILING };
}

/** The program calendar week (not a rolling 7 days) that `today` falls in. */
export function programWeekRange(today: LocalDate, programStart: LocalDate): { from: LocalDate; to: LocalDate } {
  const from = addDays(programStart, (weekIndex(today, programStart) - 1) * 7);
  return { from, to: addDays(from, 6) };
}

export interface MuscleVolume {
  muscle: string;
  done: number;
  min: number;
  max: number;
  ceiling: number;
  status: 'under' | 'met' | 'over';
}

export function weekSets(snapshot: LiftSnapshot): SetRow[] {
  const today = localDate(new Date(snapshot.now));
  const { from, to } = programWeekRange(today, snapshot.programStart);
  return snapshot.history
    .filter((h) => {
      const d = localDate(new Date(h.session.date));
      return d >= from && d <= to;
    })
    .flatMap((h) => h.sets);
}

export function circuitSets(
  history: HistorySession[], from: LocalDate, to: LocalDate, exById: Map<string, LiftExercise>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const { session } of history) {
    const day = localDate(new Date(session.date));
    if (day < from || day > to) continue;
    for (const block of session.blocks) {
      if (block.kind !== 'circuit' || !block.log || block.log.completedRounds <= 0) continue;
      const { completedRounds, stations } = block.log;
      for (const station of stations) {
        const ex = exById.get(station.exerciseId);
        if (!ex || ex.group === 'conditioning' || ex.primary.includes('cardio')) continue;
        for (const m of ex.primary) out.set(m, (out.get(m) ?? 0) + completedRounds * PRIMARY_SET_WEIGHT);
        for (const m of ex.secondary) out.set(m, (out.get(m) ?? 0) + completedRounds * SECONDARY_SET_WEIGHT);
      }
    }
  }
  return out;
}

export function weekFractionalSets(snapshot: LiftSnapshot, exById: Map<string, LiftExercise>): Map<string, number> {
  const { from, to } = programWeekRange(localDate(new Date(snapshot.now)), snapshot.programStart);
  const done = fractionalSets(weekSets(snapshot), exById);
  for (const [muscle, count] of circuitSets(snapshot.history, from, to, exById)) {
    done.set(muscle, (done.get(muscle) ?? 0) + count);
  }
  return done;
}

export function weeklyVolume(snapshot: LiftSnapshot, exById: Map<string, LiftExercise>): MuscleVolume[] {
  const today = localDate(new Date(snapshot.now));
  const t = weeklyTarget(weekIndex(today, snapshot.programStart));
  const done = weekFractionalSets(snapshot, exById);
  return TRACKED_MUSCLES.map((muscle) => {
    const d = done.get(muscle) ?? 0;
    return { muscle, done: d, ...t, status: d > t.max ? 'over' : d >= t.min ? 'met' : 'under' };
  });
}
