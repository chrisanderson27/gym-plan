import { DELOAD_EVERY_WEEKS, DELOAD_LENGTH_DAYS, DELOAD_TRIGGER_MISSED, DELOAD_TRIGGER_SESSIONS } from '../config';
import { localDate } from '../dates';
import { isRampInWeek, weekIndex } from '../week';
import type { LiftSnapshot } from './types';

const DAY = 86_400_000;

/** `missedBySession`: sessionId → count of missed exercises (from `summarizeLiftSession`). */
export function deloadState(
  snapshot: LiftSnapshot,
  missedBySession: Map<string, number>,
): { deload: boolean; reason: 'scheduled' | 'triggered' | null } {
  const wk = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  if (isRampInWeek(wk)) return { deload: false, reason: null };
  if (wk % DELOAD_EVERY_WEEKS === 0) return { deload: true, reason: 'scheduled' };

  const lifts = snapshot.history.filter((h) => h.session.type === 'lift').map((h) => h.session);
  const normal = lifts.filter((s) => !s.flags?.deload);
  const lastN = normal.slice(-DELOAD_TRIGGER_SESSIONS);
  const bad = lastN.length === DELOAD_TRIGGER_SESSIONS && lastN.every((s) => (missedBySession.get(s.id) ?? 0) >= DELOAD_TRIGGER_MISSED);
  if (!bad) return { deload: false, reason: null };

  const since = lastN.at(-1)!.date;
  const firstDeload = lifts.find((s) => s.flags?.deload && s.date > since);
  if (!firstDeload) return { deload: true, reason: 'triggered' };
  const on = new Date(snapshot.now).getTime() < new Date(firstDeload.date).getTime() + DELOAD_LENGTH_DAYS * DAY;
  return on ? { deload: true, reason: 'triggered' } : { deload: false, reason: null };
}
