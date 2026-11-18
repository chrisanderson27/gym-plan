import type { ISODateTime, SetRow } from '../../data/types';
import { PAIN_FLAGS_FOR_SWAP, PAIN_WINDOW_DAYS } from '../config';
import type { HistorySession } from './types';

const DAY = 86_400_000;

/** Counts distinct pain-flagged sets (PRD §5: after two flags) on this exercise in the window, plus the current one. */
export function painSwapOffer(exId: string, history: HistorySession[], currentSessionSets: SetRow[], now: ISODateTime): boolean {
  const since = new Date(now).getTime() - PAIN_WINDOW_DAYS * DAY;
  const ids = new Set<string>();
  for (const h of history) {
    if (new Date(h.session.date).getTime() < since) continue;
    for (const s of h.sets) if (s.exerciseId === exId && s.painFlag) ids.add(s.id);
  }
  for (const s of currentSessionSets) if (s.exerciseId === exId && s.painFlag) ids.add(s.id);
  return ids.size >= PAIN_FLAGS_FOR_SWAP;
}
