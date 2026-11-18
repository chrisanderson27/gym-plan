import { PICK_WINDOW_DAYS } from '../engine/config';
import { localDate } from '../engine/dates';
import { toPlanSession } from '../engine/plan/classify';
import type { PlanInput } from '../engine/plan/types';
import { muscleReadiness, variantReadiness } from '../engine/lift/readiness';
import { nextVariantFor } from '../engine/lift/rotation';
import type { GymDb } from './db';
import { LIFT_EXERCISES, loadLiftSnapshot, variantMuscles } from './lift';
import type { RunRow } from './types';

/** One bounded read: sessions by date, then their sets and run rows. */
export async function loadPlanInput(db: GymDb, now = new Date()): Promise<PlanInput> {
  const since = new Date(now.getTime() - PICK_WINDOW_DAYS * 86_400_000).toISOString();
  const [settings, sessions, snapshot] = await Promise.all([
    db.settings.get('settings'),
    db.sessions.where('date').aboveOrEqual(since).toArray(),
    loadLiftSnapshot(db, now),
  ]);
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const ids = sessions.map((s) => s.id);
  const runIds = sessions.filter((s) => s.type === 'run' || s.type === 'hybrid').map((s) => s.id);
  const [sets, runs] = await Promise.all([
    ids.length ? db.sets.where('sessionId').anyOf(ids).toArray() : [],
    runIds.length ? db.runs.where('sessionId').anyOf(runIds).toArray() : [],
  ]);
  const runBy = new Map<string, RunRow>(runs.map((r) => [r.sessionId, r]));
  const planSessions = sessions.map((s) => toPlanSession(s, sets.filter((x) => x.sessionId === s.id), runBy.get(s.id), LIFT_EXERCISES));

  const readiness = muscleReadiness(snapshot, LIFT_EXERCISES);
  const half = (h: 'upper' | 'lower') => {
    const variant = nextVariantFor(snapshot.history, h);
    return { variant, ...variantReadiness(variantMuscles(variant), readiness, snapshot.now) };
  };
  return {
    now: now.toISOString(),
    today: localDate(now),
    programStart: settings?.programStart ?? localDate(now),
    daysPerWeek: settings?.daysPerWeek ?? 5,
    sessions: planSessions,
    lift: { upper: half('upper'), lower: half('lower') },
    hasLiftHistory: snapshot.history.some((h) => h.sets.length > 0),
  };
}
