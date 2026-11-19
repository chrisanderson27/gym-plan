import type { LiftBlock } from '../../data/types';
import { DELOAD_EVERY_WEEKS, DELOAD_LENGTH_DAYS, DELOAD_TRIGGER_MISSED, DELOAD_TRIGGER_SESSIONS } from '../config';
import { localDate } from '../dates';
import { isRampInWeek, weekIndex } from '../week';
import { summarizeLiftSession } from './session';
import type { LiftSnapshot } from './types';

const DAY = 86_400_000;

export function deloadState(
  snapshot: LiftSnapshot,
  missedBySession?: ReadonlyMap<string, number>,
): { deload: boolean; reason: 'scheduled' | 'triggered' | null } {
  const wk = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  if (isRampInWeek(wk)) return { deload: false, reason: null };
  if (wk % DELOAD_EVERY_WEEKS === 0) return { deload: true, reason: 'scheduled' };

  const lifts = snapshot.history.filter(({ session }) => session.type === 'lift');
  const normal = lifts.filter(({ session }) => !session.flags?.deload);
  const lastN = normal.slice(-DELOAD_TRIGGER_SESSIONS);
  const bad = lastN.length === DELOAD_TRIGGER_SESSIONS && lastN.every(({ session, sets }) => {
    if (missedBySession) return (missedBySession.get(session.id) ?? 0) >= DELOAD_TRIGGER_MISSED;
    const blocks = session.blocks.filter((block): block is LiftBlock => block.kind === 'lift');
    return summarizeLiftSession(blocks, sets).missedExercises.length >= DELOAD_TRIGGER_MISSED;
  });
  if (!bad) return { deload: false, reason: null };

  const since = lastN.at(-1)!.session.date;
  const firstDeload = lifts.find(({ session }) => session.flags?.deload && session.date > since)?.session;
  if (!firstDeload) return { deload: true, reason: 'triggered' };
  const on = new Date(snapshot.now).getTime() < new Date(firstDeload.date).getTime() + DELOAD_LENGTH_DAYS * DAY;
  return on ? { deload: true, reason: 'triggered' } : { deload: false, reason: null };
}
