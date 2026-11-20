import { LIFT_TEMPLATES } from '../content';
import { circuitWork } from '../engine/block/work';
import { CARDIO_MODALITY_LABELS, HISTORY_PAGE } from '../engine/config';
import { isWorking, type HistorySession } from '../engine/lift/types';
import { sessionPRs, type PR } from '../engine/pr';
import type { GymDb } from './db';
import type { RunRow, Session, SetRow, SwimRow } from './types';

export interface CardNumber { value: string; label: string }
export interface HistoryItem { session: Session; title: string; summary: string; numbers: CardNumber[]; prs: PR[] }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function cardTitle(s: Session, run: RunRow | undefined): string {
  if (s.variant) return `${s.type === 'hybrid' ? 'Hybrid · ' : ''}${LIFT_TEMPLATES[s.variant].name}`;
  if (s.type === 'run' && run) return `${cap(run.kind)} run`;
  return cap(s.type);
}

function summarize(s: Session, title: string, run: RunRow | undefined, swim: SwimRow | undefined): string {
  const bits = [!s.variant && s.type === 'swim' && swim ? `${title} ${swim.distance} ${swim.poolUnit}` : title];
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

function groupSets(rows: SetRow[]): Map<string, SetRow[]> {
  const groups = new Map<string, SetRow[]>();
  for (const set of rows) {
    const group = groups.get(set.sessionId);
    if (group) group.push(set);
    else groups.set(set.sessionId, [set]);
  }
  return groups;
}

function circuitExercises(session: Session): string[] {
  return session.blocks.flatMap((block) => {
    if (block.kind !== 'circuit' || !block.log || block.log.stations.some((station) => station.swappedFromExerciseId)) return [];
    return circuitWork(block)?.perStation.map(({ exerciseId }) => exerciseId) ?? [];
  });
}

async function priorPRs(db: GymDb, entries: HistorySession[], newestDate: string): Promise<PR[][]> {
  const entryIds = new Set(entries.map(({ session }) => session.id));
  const pairs = new Map<string, [string, string]>();
  const circuitIds = new Set<string>();
  for (const { session, sets } of entries) {
    for (const { exerciseId, equipmentId } of sets.filter(isWorking)) {
      const pair: [string, string] = [exerciseId, equipmentId];
      pairs.set(JSON.stringify(pair), pair);
    }
    for (const id of circuitExercises(session)) circuitIds.add(id);
  }

  const [sets, circuits] = await Promise.all([
    pairs.size ? db.sets.where('[exerciseId+equipmentId]').anyOf([...pairs.values()])
      .filter((set) => !entryIds.has(set.sessionId) && isWorking(set)).toArray() : [],
    // Circuits have no index of their own. Only scan when the page contains a comparable circuit.
    circuitIds.size ? db.sessions.where('date').below(newestDate)
      .filter((session) => !entryIds.has(session.id) && circuitExercises(session).some((id) => circuitIds.has(id)))
      .toArray() : [],
  ]);
  const setsBy = groupSets(sets);
  const circuitSessionIds = new Set(circuits.map(({ id }) => id));
  const setSessions = await db.sessions.bulkGet([...setsBy.keys()].filter((id) => !circuitSessionIds.has(id)));
  const prior = [...entries];
  for (const session of [...circuits, ...setSessions]) {
    if (session && session.date < newestDate) prior.push({ session, sets: setsBy.get(session.id) ?? [] });
  }
  return entries.map((entry) => sessionPRs(entry, prior.filter(({ session }) => session.date < entry.session.date)));
}

export async function listHistory(db: GymDb, page = 0, size = HISTORY_PAGE): Promise<HistoryItem[]> {
  const rows = await db.sessions.orderBy('date').reverse().offset(page * size).limit(size).toArray();
  const newest = rows[0];
  if (!newest) return [];
  const ids = rows.map((s) => s.id);
  const [runs, swims, sets] = await Promise.all([
    db.runs.where('sessionId').anyOf(ids).toArray(),
    db.swims.where('sessionId').anyOf(ids).toArray(),
    db.sets.where('sessionId').anyOf(ids).toArray(),
  ]);
  const setsBy = groupSets(sets);
  const entries = rows.map((session) => ({ session, sets: setsBy.get(session.id) ?? [] }));
  const prs = await priorPRs(db, entries, newest.date);
  const runBy = new Map(runs.map((r) => [r.sessionId, r]));
  const swimBy = new Map(swims.map((r) => [r.sessionId, r]));
  return entries.map(({ session, sets }, index) => {
    const run = runBy.get(session.id);
    const swim = swimBy.get(session.id);
    const title = cardTitle(session, run);
    return {
      session,
      title,
      summary: summarize(session, title, run, swim),
      numbers: cardNumbers(session, sets, run, swim),
      prs: prs[index]!,
    };
  });
}

export async function loadSessionPRs(db: GymDb, id: string): Promise<PR[]> {
  const session = await db.sessions.get(id);
  if (!session) return [];
  const sets = await db.sets.where('sessionId').equals(id).toArray();
  const [prs] = await priorPRs(db, [{ session, sets }], session.date);
  return prs!;
}

export async function loadSessionDetail(db: GymDb, id: string): Promise<{ session: Session; sets: SetRow[]; run?: RunRow; swim?: SwimRow } | null> {
  const session = await db.sessions.get(id);
  if (!session) return null;
  const [sets, run, swim] = await Promise.all([db.sets.where('sessionId').equals(id).toArray(), db.runs.get(id), db.swims.get(id)]);
  return { session, sets: sets.sort((a, b) => a.idx - b.idx), ...(run ? { run } : {}), ...(swim ? { swim } : {}) };
}
