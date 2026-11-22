import Dexie, { RangeSet, type ObservabilitySet } from 'dexie';
import { LIFT_TEMPLATES } from '../content';
import { CARDIO_MODALITY_LABELS, HISTORY_PAGE } from '../engine/config';
import { isWorking, type HistorySession } from '../engine/lift/types';
import { comparableBlock, sessionPRs, type PR } from '../engine/pr';
import type { GymDb } from './db';
import type { RunRow, Session, SetRow, SwimRow } from './types';

export interface CardNumber { value: string; label: string }
export interface HistoryItem { session: Session; title: string; summary: string; numbers: CardNumber[]; prs: PR[] }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function cardTitle(s: Session, run: RunRow | undefined): string {
  if (s.mixed) return s.mixed.prescription.name;
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

function circuitKeys(session: Session): string[] {
  return session.blocks.map(comparableBlock).flatMap((block) => block ? [block.key] : []);
}

type CircuitCandidate = { session: Session; keys: string[] };
type CircuitIndex = { rows: Map<string, CircuitCandidate | null>; revision: number };
const circuitIndexes = new WeakMap<GymDb, CircuitIndex>();

function circuitIndex(db: GymDb): CircuitIndex {
  const existing = circuitIndexes.get(db);
  if (existing) return existing;
  const index: CircuitIndex = { rows: new Map(), revision: 0 };
  const invalidate = (parts: ObservabilitySet) => {
    const changes = parts[`idb://${db.name}/sessions/`];
    if (!changes?.d) return;
    index.revision++;
    for (const { from, to } of RangeSet(changes)) {
      if (typeof from === 'string' && from === to) index.rows.delete(from);
      else index.rows.clear();
    }
  };
  Dexie.on.storagemutated.subscribe(invalidate);
  const close = () => {
    Dexie.on.storagemutated.unsubscribe(invalidate);
    db.on.close.unsubscribe(close);
    circuitIndexes.delete(db);
  };
  db.on.close.subscribe(close);
  circuitIndexes.set(db, index);
  return index;
}

async function priorCircuitSessions(db: GymDb, ids: string[], keys: Set<string>, index?: CircuitIndex): Promise<Session[]> {
  // A primary-key count keeps live queries subscribed to circuit edits even on cache hits.
  const revision = index?.revision;
  const candidates = ids.map((id) => index?.rows.get(id));
  const missing = ids.filter((_, i) => candidates[i] === undefined);
  const [rows] = await Promise.all([db.sessions.bulkGet(missing), db.sessions.count()]);
  const loaded = rows.map((session) => {
    if (!session) return null;
    const keys = circuitKeys(session);
    return keys.length ? { session, keys } : null;
  });
  if (index && index.revision === revision) missing.forEach((id, i) => index.rows.set(id, loaded[i]!));
  return [...candidates, ...loaded].flatMap((row) => row?.keys.some((key) => keys.has(key)) ? [row.session] : []);
}

async function priorWorkingSets(db: GymDb, ids: string[], pairs: [string, string][]): Promise<SetRow[]> {
  // The set timestamp is optional and may differ from the owning session's date.
  // Intersect index keys before reading set rows so both constraints apply to every read.
  const [dated, matching] = await Promise.all([
    db.sets.where('sessionId').anyOf(ids).primaryKeys(),
    db.sets.where('[exerciseId+equipmentId]').anyOf(pairs).primaryKeys(),
  ]);
  const datedKeys = new Set(dated);
  return (await db.sets.bulkGet(matching.filter((id) => datedKeys.has(id))))
    .filter((set): set is SetRow => !!set && isWorking(set));
}

async function priorPRs(db: GymDb, entries: HistorySession[], newestDate: string): Promise<PR[][]> {
  const entryIds = new Set(entries.map(({ session }) => session.id));
  const pairs = new Map<string, [string, string]>();
  const keys = new Set<string>();
  for (const { session, sets } of entries) {
    for (const { exerciseId, equipmentId } of sets.filter(isWorking)) {
      const pair: [string, string] = [exerciseId, equipmentId];
      pairs.set(JSON.stringify(pair), pair);
    }
    for (const key of circuitKeys(session)) keys.add(key);
  }
  if (!pairs.size && !keys.size) return entries.map(() => []);

  // A caller's transaction can contain uncommitted edits. Keep those reads out of the shared index.
  const index = keys.size && !Dexie.currentTransaction ? circuitIndex(db) : undefined;
  const prior = await db.transaction('r', db.sessions, db.sets, async () => {
    const ids = (await db.sessions.where('date').below(newestDate).primaryKeys()).filter((id) => !entryIds.has(id));
    if (!ids.length) return entries;
    const [sets, circuits] = await Promise.all([
      pairs.size ? priorWorkingSets(db, ids, [...pairs.values()]) : [],
      keys.size ? priorCircuitSessions(db, ids, keys, index) : [],
    ]);
    const setsBy = groupSets(sets);
    const circuitSessionIds = new Set(circuits.map(({ id }) => id));
    const setSessions = await db.sessions.bulkGet([...setsBy.keys()].filter((id) => !circuitSessionIds.has(id)));
    return [...entries, ...[...circuits, ...setSessions].flatMap((session) =>
      session ? [{ session, sets: setsBy.get(session.id) ?? [] }] : [])];
  });
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
