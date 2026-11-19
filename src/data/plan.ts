import { PICK_WINDOW_DAYS } from '../engine/config';
import { localDate } from '../engine/dates';
import { toPlanSession } from '../engine/plan/classify';
import type { PlanInput } from '../engine/plan/types';
import { muscleReadiness, variantReadiness } from '../engine/lift/readiness';
import { nextVariantFor } from '../engine/lift/rotation';
import type { GymDb } from './db';
import { LIFT_EXERCISES, loadLiftSnapshot, variantMuscles } from './lift';
import { enabledActivities } from './settings';
import type { Session, SetRow } from './types';

/** One bounded read: sessions by date, then their sets and run rows. */
export async function loadPlanInput(db: GymDb, now = new Date()): Promise<PlanInput> {
  const since = new Date(now.getTime() - PICK_WINDOW_DAYS * 86_400_000).toISOString();
  const [settings, sessions, snapshot] = await Promise.all([
    db.settings.get('settings'),
    db.sessions.where('date').aboveOrEqual(since).toArray(),
    loadLiftSnapshot(db, now),
  ]);
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const planSessions = await classifySessions(db, sessions);

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
    activities: enabledActivities(settings),
    lift: { upper: half('upper'), lower: half('lower') },
    hasLiftHistory: snapshot.history.some((h) => h.sets.length > 0),
  };
}

async function classifySessions(db: GymDb, sessions: Session[]) {
  const ids = sessions.map((s) => s.id);
  const runIds = sessions.filter((s) => s.type === 'run' || s.type === 'hybrid').map((s) => s.id);
  const [sets, runs] = await Promise.all([
    ids.length ? db.sets.where('sessionId').anyOf(ids).toArray() : [],
    runIds.length ? db.runs.where('sessionId').anyOf(runIds).toArray() : [],
  ]);
  const runBy = new Map(runs.map((r) => [r.sessionId, r]));
  const setsBy = new Map<string, SetRow[]>();
  for (const set of sets) {
    const group = setsBy.get(set.sessionId);
    if (group) group.push(set);
    else setsBy.set(set.sessionId, [set]);
  }
  return sessions.map((s) => toPlanSession(s, setsBy.get(s.id) ?? [], runBy.get(s.id), LIFT_EXERCISES));
}

export async function loadRingInput(db: GymDb, now = new Date()) {
  const settings = await db.settings.get('settings');
  const today = localDate(now);
  const programStart = settings?.programStart ?? today;
  const since = (programStart < today ? programStart : today) + 'T00:00:00';
  const rows = await db.sessions.where('date').aboveOrEqual(new Date(since).toISOString()).toArray();
  return {
    sessions: await classifySessions(db, rows),
    programStart,
    today,
    activities: enabledActivities(settings),
    done: todayDone(rows, today),
  };
}

export function todayDone(sessions: readonly Session[], today: PlanInput['today']) {
  return [...sessions].reverse().find((s) => s.endedAt && localDate(new Date(s.date)) === today);
}
