import { LIFT_TEMPLATES } from '../content';
import { CARDIO_MODALITY_LABELS, HISTORY_PAGE } from '../engine/config';
import type { GymDb } from './db';
import type { RunRow, Session, SetRow, SwimRow } from './types';

export interface HistoryItem { session: Session; summary: string }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function summarize(s: Session, run: RunRow | undefined, swim: SwimRow | undefined): string {
  const bits: string[] = [];
  if (s.variant) bits.push(`${s.type === 'hybrid' ? 'Hybrid · ' : ''}${LIFT_TEMPLATES[s.variant].name}`);
  else if (s.type === 'run' && run) bits.push(`${cap(run.kind)} run`);
  else if (s.type === 'swim' && swim) bits.push(`Swim ${swim.distance} ${swim.poolUnit}`);
  else bits.push(cap(s.type));
  if (s.type === 'hybrid' && run) bits.push(`${CARDIO_MODALITY_LABELS[run.modality ?? 'run']} ${Math.round(run.durationSec / 60)} min`);
  if (s.durationMin) bits.push(`${s.durationMin} min`);
  if (s.rpe !== null) bits.push(`RPE ${s.rpe}`);
  return bits.join(' · ');
}

export async function listHistory(db: GymDb, page = 0): Promise<HistoryItem[]> {
  const rows = await db.sessions.orderBy('date').reverse().offset(page * HISTORY_PAGE).limit(HISTORY_PAGE).toArray();
  const ids = rows.map((s) => s.id);
  const [runs, swims] = await Promise.all([
    ids.length ? db.runs.where('sessionId').anyOf(ids).toArray() : [],
    ids.length ? db.swims.where('sessionId').anyOf(ids).toArray() : [],
  ]);
  const runBy = new Map(runs.map((r) => [r.sessionId, r]));
  const swimBy = new Map(swims.map((r) => [r.sessionId, r]));
  return rows.map((session) => ({ session, summary: summarize(session, runBy.get(session.id), swimBy.get(session.id)) }));
}

export async function loadSessionDetail(db: GymDb, id: string): Promise<{ session: Session; sets: SetRow[]; run?: RunRow; swim?: SwimRow } | null> {
  const session = await db.sessions.get(id);
  if (!session) return null;
  const [sets, run, swim] = await Promise.all([db.sets.where('sessionId').equals(id).toArray(), db.runs.get(id), db.swims.get(id)]);
  return { session, sets: sets.sort((a, b) => a.idx - b.idx), ...(run ? { run } : {}), ...(swim ? { swim } : {}) };
}
