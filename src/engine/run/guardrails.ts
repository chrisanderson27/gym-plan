import type { CardioModality, ISODateTime, LocalDate, RunKind } from '../../data/types';
import {
  RUN_COLD_START_MAX_MIN, RUN_CUTBACK_EVERY_WEEKS, RUN_CUTBACK_FACTOR, RUN_LOOKBACK_DAYS, RUN_MIN_MIN, RUN_SPIKE_CAP,
  RUN_WEEKLY_SOFT_CAP,
} from '../config';
import { localDate } from '../dates';
import { weekIndex } from '../week';

export interface RunHistoryItem {
  date: ISODateTime;
  kind: RunKind;
  modality: CardioModality;
  distanceMi: number;
  durationSec: number;
  rpe: number;
  painFlag: boolean;
  runWalkRatio?: string;
}

/** Only real running counts: a hybrid's bike/row/ski part never feeds the run guardrails. */
export const runsOnly = (h: RunHistoryItem[]): RunHistoryItem[] => h.filter((r) => r.modality === 'run' || r.modality === 'treadmill');

export function longest30(history: RunHistoryItem[], now: ISODateTime): { durationSec: number; distanceMi: number } {
  const since = new Date(now).getTime() - RUN_LOOKBACK_DAYS * 86_400_000;
  let durationSec = 0;
  let distanceMi = 0;
  for (const r of runsOnly(history)) {
    if (new Date(r.date).getTime() < since) continue;
    durationSec = Math.max(durationSec, r.durationSec);
    distanceMi = Math.max(distanceMi, r.distanceMi);
  }
  return { durationSec, distanceMi };
}

/** Total duration ÷ total distance over runs with a distance; null when nothing has one. */
export function paceSecPerMi(history: RunHistoryItem[]): number | null {
  let sec = 0;
  let mi = 0;
  for (const r of runsOnly(history)) {
    if (r.distanceMi > 0) { sec += r.durationSec; mi += r.distanceMi; }
  }
  return mi > 0 ? sec / mi : null;
}

/** The hard ceiling on one session: 1.10 × the 30-day longest (time and, with a pace, distance). */
export function runCapSec(longest: { durationSec: number; distanceMi: number }, pace: number | null): number {
  if (longest.durationSec <= 0) return RUN_COLD_START_MAX_MIN * 60;
  let cap = Math.floor(RUN_SPIKE_CAP * longest.durationSec);
  if (pace !== null && longest.distanceMi > 0) cap = Math.min(cap, Math.floor(RUN_SPIKE_CAP * longest.distanceMi * pace));
  return cap;
}

/** Cap a planned duration; the minimum-length floor never breaks the cap itself. */
export function capRunSec(plannedSec: number, longest: { durationSec: number; distanceMi: number }, pace: number | null): number {
  const cap = runCapSec(longest, pace);
  return Math.max(Math.min(plannedSec, cap), Math.min(RUN_MIN_MIN * 60, cap));
}

/**
 * Seconds still allowed this program week under the +10–15 % soft cap (×0.75 on a cutback week).
 * Null when last week had no running, because there is nothing to scale from.
 */
export function weeklySoftCapSec(history: RunHistoryItem[], weekIdx: number, programStart: LocalDate): number | null {
  let last = 0;
  let thisWeek = 0;
  for (const r of runsOnly(history)) {
    const w = weekIndex(localDate(new Date(r.date)), programStart);
    if (w === weekIdx - 1) last += r.durationSec;
    else if (w === weekIdx) thisWeek += r.durationSec;
  }
  if (last <= 0) return null;
  const factor = weekIdx % RUN_CUTBACK_EVERY_WEEKS === 0 ? RUN_CUTBACK_FACTOR : RUN_WEEKLY_SOFT_CAP;
  return Math.round(last * factor) - thisWeek;
}
