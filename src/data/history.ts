import { LIFT_TEMPLATES } from '../content';
import { CARDIO_MODALITY_LABELS, HISTORY_PAGE } from '../engine/config';
import { isWorking, type HistorySession } from '../engine/lift/types';
import { sessionPRs, type PR } from '../engine/pr';
import type { GymDb } from './db';
import type { RunRow, Session, SetRow, SwimRow } from './types';

export interface CardNumber { value: string; label: string }
export interface HistoryItem { session: Session; summary: string; numbers: CardNumber[]; prs: PR[] }

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

export function cardNumbers(s: Session, sets: SetRow[], run?: RunRow, swim?: SwimRow): CardNumber[] {
  const minutes = s.durationMin > 0 ? s.durationMin : run ? Math.round(run.durationSec / 60) : 0;
  const rounds = s.blocks.reduce((total, block) =>
    total + (block.kind === 'circuit' ? block.log?.completedRounds ?? 0 : 0), 0);
  const values = [
    { value: minutes, label: 'min' },
    { value: sets.filter(isWorking).length, label: 'sets' },
    { value: rounds, label: 'rounds' },
    { value: run?.distanceMi ?? 0, label: 'mi' },
    { value: swim?.distance ?? 0, label: swim?.poolUnit ?? 'yd' },
  ];
  return values.filter(({ value }) => value > 0).slice(0, 3).map(({ value, label }) => ({ value: String(value), label }));
}

async function setsBySession(db: GymDb, sessions: Session[]): Promise<Map<string, SetRow[]>> {
  const groups = new Map<string, SetRow[]>();
  if (sessions.length === 0) return groups;
  const rows = await db.sets.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray();
  for (const set of rows) {
    const group = groups.get(set.sessionId);
    if (group) group.push(set);
    else groups.set(set.sessionId, [set]);
  }
  return groups;
}

export async function listHistory(db: GymDb, page = 0, size = HISTORY_PAGE): Promise<HistoryItem[]> {
  const rows = await db.sessions.orderBy('date').reverse().offset(page * size).limit(size).toArray();
  const newest = rows[0];
  if (!newest) return [];
  const ids = rows.map((s) => s.id);
  const [runs, swims, sessions] = await Promise.all([
    db.runs.where('sessionId').anyOf(ids).toArray(),
    db.swims.where('sessionId').anyOf(ids).toArray(),
    db.sessions.where('date').belowOrEqual(newest.date).toArray(),
  ]);
  const setsBy = await setsBySession(db, sessions);
  const history: HistorySession[] = sessions.map((session) => ({ session, sets: setsBy.get(session.id) ?? [] }));
  const runBy = new Map(runs.map((r) => [r.sessionId, r]));
  const swimBy = new Map(swims.map((r) => [r.sessionId, r]));
  return rows.map((session) => {
    const sets = setsBy.get(session.id) ?? [];
    const run = runBy.get(session.id);
    const swim = swimBy.get(session.id);
    return {
      session,
      summary: summarize(session, run, swim),
      numbers: cardNumbers(session, sets, run, swim),
      prs: sessionPRs({ session, sets }, history.filter((h) => h.session.date < session.date)),
    };
  });
}

export async function loadSessionPRs(db: GymDb, id: string): Promise<PR[]> {
  const session = await db.sessions.get(id);
  if (!session) return [];
  const prior = await db.sessions.where('date').below(session.date).toArray();
  const setsBy = await setsBySession(db, [session, ...prior]);
  return sessionPRs(
    { session, sets: setsBy.get(id) ?? [] },
    prior.map((session) => ({ session, sets: setsBy.get(session.id) ?? [] })),
  );
}

export async function loadSessionDetail(db: GymDb, id: string): Promise<{ session: Session; sets: SetRow[]; run?: RunRow; swim?: SwimRow } | null> {
  const session = await db.sessions.get(id);
  if (!session) return null;
  const [sets, run, swim] = await Promise.all([db.sets.where('sessionId').equals(id).toArray(), db.runs.get(id), db.swims.get(id)]);
  return { session, sets: sets.sort((a, b) => a.idx - b.idx), ...(run ? { run } : {}), ...(swim ? { swim } : {}) };
}
