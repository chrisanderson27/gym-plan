import { LIFT_TEMPLATES } from '../content/lift-templates';
import { blockedExerciseIds } from '../content/equipment-prefs';
import { defaultEquipmentFor, exerciseById } from '../content';
import type { Exercise } from '../content';
import { HISTORY_WINDOW_DAYS, JOINT_FRIENDLY_WEEKS, RESUME_WINDOW_HOURS } from '../engine/config';
import { localDate } from '../engine/dates';
import { classifyHard } from '../engine/hard';
import { generateLift, type LiftPlan } from '../engine/lift/generator';
import { isLowerBarbell, prescribe } from '../engine/lift/progression';
import { summarizeLiftSession } from '../engine/lift/session';
import { isRampInWeek, weekIndex } from '../engine/week';
import { isWorking, isWorkingKind, type HistorySession, type LiftExercise, type LiftSnapshot, type Prescription } from '../engine/lift/types';
import type { GymDb } from './db';
import { newId } from './ids';
import type { Block, CircuitLog, Equipment, ExerciseOverride, LiftBlock, LiftVariant, Session, SessionType, SetRow } from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Content → engine shape (data may read content; the engine may not). */
export function toLiftExercise(e: Exercise): LiftExercise {
  const p = e.prescription;
  return {
    id: e.id,
    group: e.group,
    equipment: [...e.equipment],
    primary: [...e.primary],
    secondary: [...e.secondary],
    repClass: e.repClass,
    repMin: p.unit === 'reps' ? p.min : 0,
    repMax: p.unit === 'reps' ? p.max : 0,
    jointFriendly: e.jointFriendly,
    substitutes: [...e.substitutes],
  };
}

/** Every exercise a lift session can use: live, rep-based, not conditioning. */
export const LIFT_EXERCISES: Map<string, LiftExercise> = new Map(
  [...exerciseById.values()]
    .filter((e) => !e.retired && e.prescription.unit === 'reps' && e.group !== 'conditioning')
    .map((e) => [e.id, toLiftExercise(e)]),
);
// The warm-up machines are cardio (not rep-based) but the generator needs to see them.
for (const id of ['air-bike', 'rower', 'elliptical']) {
  const e = exerciseById.get(id);
  if (e) LIFT_EXERCISES.set(id, { ...toLiftExercise(e), repMin: 0, repMax: 0 });
}

export async function loadLiftSnapshot(db: GymDb, now = new Date()): Promise<LiftSnapshot> {
  const since = new Date(now.getTime() - HISTORY_WINDOW_DAYS * DAY).toISOString();
  const [sessions, overrides, equipment, settings] = await Promise.all([
    db.sessions.where('date').aboveOrEqual(since).toArray(),
    db.exerciseOverrides.toArray(),
    db.equipment.toArray(),
    db.settings.get('settings'),
  ]);
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const sets = sessions.length ? await db.sets.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray() : [];
  const bySession = new Map<string, SetRow[]>();
  for (const s of sets) bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s]);
  const history: HistorySession[] = sessions.map((session) => ({
    session,
    sets: (bySession.get(session.id) ?? []).sort((a, b) => a.idx - b.idx),
  }));
  return {
    now: now.toISOString(),
    programStart: settings?.programStart ?? localDate(now),
    history,
    overrides: new Map(overrides.map((o) => [o.exerciseId, o])),
    equipment: new Map(equipment.map((e) => [e.id, e])),
    checklistBlocked: blockedExerciseIds([...exerciseById.values()], settings?.unavailableEquipment ?? []),
  };
}

/** Preferred → equipment of the latest logged set → seed for the tag. Read-only. */
export function resolveEquipmentId(snapshot: LiftSnapshot, ex: Exercise, weekIdx: number, fallback?: string): string {
  const pref = snapshot.overrides.get(ex.id)?.preferredEquipmentId;
  if (pref && snapshot.equipment.has(pref)) return pref;
  let latest: SetRow | undefined;
  for (const h of snapshot.history) {
    for (const s of h.sets) {
      if (s.exerciseId !== ex.id || !snapshot.equipment.has(s.equipmentId)) continue;
      if (!latest || (s.ts ?? h.session.date) >= (latest.ts ?? '')) latest = s;
    }
  }
  if (latest) return latest.equipmentId;
  const tags = ex.equipment;
  const tag = (weekIdx <= JOINT_FRIENDLY_WEEKS ? tags.find((t) => t !== 'barbell') : undefined) ?? tags[0]!;
  return fallback ?? defaultEquipmentFor(tag);
}

/** Sync plan builder used by the Lift screen preview and by session start. */
export function buildLiftPlan(snapshot: LiftSnapshot, variant: LiftVariant, budgetMin: number, forceCalibrate = false): LiftPlan {
  const weekIdx = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  return generateLift({
    variant,
    budgetMin,
    template: LIFT_TEMPLATES[variant],
    exercises: LIFT_EXERCISES,
    snapshot,
    resolveEquipmentId: (id) => resolveEquipmentId(snapshot, exerciseById.get(id)!, weekIdx),
    forceCalibrate,
  });
}

/** Prescription for one exercise × equipment pair (used after a swap or equipment change). */
export function prescribeExercise(
  snapshot: LiftSnapshot,
  exerciseId: string,
  equipmentId: string,
  flags: { deload: boolean; rampIn: boolean },
  range?: { repMin: number; repMax: number },
): Prescription | null {
  const base = LIFT_EXERCISES.get(exerciseId);
  const ex = base && range ? { ...base, repMin: range.repMin, repMax: range.repMax } : base;
  const eq = snapshot.equipment.get(equipmentId);
  if (!ex || !eq) return null;
  const pair = snapshot.history
    .filter((h) => !h.session.flags?.deload)
    .map((h) => ({ session: h.session, sets: h.sets.filter((s) => s.exerciseId === exerciseId && s.equipmentId === equipmentId) }))
    .filter((h) => h.sets.length > 0);
  return prescribe(ex, eq, pair, { ...flags, isLowerBarbell: isLowerBarbell(ex, eq) });
}

/** Block fields that depend on the exercise × equipment pair; a swap must not carry the previous pair's values. */
export function blockPrescriptionPatch(
  snapshot: LiftSnapshot,
  exerciseId: string,
  equipmentId: string,
  flags: { deload: boolean; rampIn: boolean },
  current?: LiftBlock,
  range?: { repMin: number; repMax: number },
): Partial<LiftBlock> {
  const presc = prescribeExercise(snapshot, exerciseId, equipmentId, flags, range);
  if (!presc) return { targetWeight: undefined, label: undefined };
  // Never raise the planned count: the generator may have trimmed it for the weekly ceiling.
  const sets = current ? Math.min(presc.sets, current.sets) : presc.sets;
  return { targetWeight: presc.weight, sets, rirTarget: presc.rirTarget, label: presc.mode === 'calibrate' ? 'Calibration' : undefined };
}

/** Per-machine instance, only for a seed machine/cable that has never been used for this exercise. */
export async function ensureEquipmentInstance(db: GymDb, ex: Exercise, seedId: string): Promise<string> {
  const seed = await db.equipment.get(seedId);
  if (!seed || !seed.builtin || (seed.kind !== 'machine' && seed.kind !== 'cable')) return seedId;
  if ((await db.sets.where('exerciseId').equals(ex.id).count()) > 0) return seedId;
  const inst: Equipment = { id: newId(), name: `${ex.name} — ${seed.name}`, kind: seed.kind, steps: [...seed.steps] };
  await db.equipment.put(inst);
  await setPreferredEquipment(db, ex.id, inst.id);
  return inst.id;
}

/** Every lift start goes through here: lift, custom (builder) and hybrid sessions. Non-lift blocks pass through untouched. */
export async function writeLiftSession(
  db: GymDb,
  input: { type: 'lift' | 'custom' | 'hybrid'; blocks: Block[]; variant?: LiftVariant; templateId?: string; calibration: boolean; deload: boolean },
  now = new Date(),
): Promise<string> {
  return db.transaction('rw', [db.sessions, db.sets, db.equipment, db.exerciseOverrides], async () => {
    const blocks: Block[] = [];
    for (const b of input.blocks) {
      const ex = b.kind === 'lift' ? exerciseById.get(b.exerciseId) : undefined;
      if (b.kind !== 'lift' || b.warmup || !ex || !b.equipmentId) {
        blocks.push(b);
        continue;
      }
      blocks.push({ ...b, equipmentId: await ensureEquipmentInstance(db, ex, b.equipmentId) });
    }
    const flags: NonNullable<Session['flags']> = {};
    if (input.calibration) flags.calibration = true;
    if (input.deload) flags.deload = true;
    const id = newId();
    await db.sessions.put({
      id,
      date: now.toISOString(),
      type: input.type,
      ...(input.variant ? { variant: input.variant } : {}),
      ...(input.templateId ? { templateId: input.templateId } : {}),
      blocks,
      hard: false,
      hardCardio: false,
      rpe: null,
      durationMin: 0,
      notes: '',
      flags,
    });
    return id;
  });
}

export function startLiftSession(db: GymDb, plan: LiftPlan, now = new Date()): Promise<string> {
  return writeLiftSession(
    db,
    { type: 'lift', blocks: plan.blocks, variant: plan.variant, calibration: [...plan.prescriptions.values()].some((p) => p.mode === 'calibrate'), deload: plan.deload },
    now,
  );
}

/** Primary muscles of a variant's lead exercises, used for readiness. */
export function variantMuscles(v: LiftVariant): string[] {
  const muscles = LIFT_TEMPLATES[v].slots.flatMap((s) => LIFT_EXERCISES.get(s.candidates[0]!)?.primary ?? []);
  return [...new Set(muscles)];
}

export async function logSet(db: GymDb, row: SetRow): Promise<void> {
  await db.sets.put(row);
}
export async function unlogSet(db: GymDb, id: string): Promise<void> {
  await db.sets.delete(id);
}

function workingRowsForSlot(db: GymDb, row: SetRow): Promise<SetRow[]> {
  return db.sets.where('sessionId').equals(row.sessionId).filter(
    (s) => s.exerciseId === row.exerciseId && s.equipmentId === row.equipmentId && s.idx === row.idx && isWorkingKind(s),
  ).toArray();
}

/**
 * Tick / untick one working set. Decides from the database inside one transaction, not from the rendered
 * (possibly stale) live-query snapshot, so a tap before the snapshot refreshes cannot write a duplicate row
 * for the same idx or untick a set that is not there.
 */
export async function toggleWorkingSet(db: GymDb, row: SetRow): Promise<'logged' | 'unlogged'> {
  return db.transaction('rw', db.sets, async () => {
    const existing = await workingRowsForSlot(db, row);
    if (existing.length > 0) {
      await db.sets.bulkDelete(existing.map((s) => s.id));
      return 'unlogged';
    }
    await db.sets.put(row);
    return 'logged';
  });
}

/** Log once while the session is open, replacing any zero-rep placeholder at this slot. */
export async function logWorkingSet(db: GymDb, row: SetRow): Promise<'logged' | 'unchanged'> {
  if (!isWorking(row)) return 'unchanged';
  return db.transaction('rw', [db.sessions, db.sets], async () => {
    const session = await db.sessions.get(row.sessionId);
    if (!session || session.endedAt) return 'unchanged';
    const existing = await workingRowsForSlot(db, row);
    if (existing.some(isWorking)) return 'unchanged';
    if (existing.length) await db.sets.bulkDelete(existing.map((s) => s.id));
    await db.sets.put(row);
    return 'logged';
  });
}

/** Edit a logged set's weight/reps. Update-only: a set unticked in the meantime is never resurrected. */
export async function updateSetValues(db: GymDb, id: string, patch: { weight?: number; reps?: number }): Promise<void> {
  await db.sets.update(id, patch);
}

/** RIR lives only on the exercise's last set (PRD §9); clear it elsewhere. */
export async function setLastSetRir(db: GymDb, sessionId: string, exerciseId: string, rir: 0 | 1 | 3, equipmentId?: string): Promise<void> {
  const rows = (await db.sets.where('sessionId').equals(sessionId).toArray())
    .filter((s) => s.exerciseId === exerciseId && s.setKind !== 'warmup' && (equipmentId === undefined || s.equipmentId === equipmentId))
    .sort((a, b) => a.idx - b.idx);
  const last = rows.at(-1);
  if (!last) return;
  await db.transaction('rw', db.sets, async () => {
    for (const r of rows) {
      if (r.id === last.id) await db.sets.update(r.id, { rir });
      else if (r.rir !== undefined) await db.sets.update(r.id, { rir: undefined });
    }
  });
}

export async function setPainFlag(db: GymDb, setId: string, flag: boolean): Promise<void> {
  await db.sets.update(setId, { painFlag: flag });
}

async function lastActivityAt(db: GymDb, session: Session): Promise<string> {
  const sets = await db.sets.where('sessionId').equals(session.id).toArray();
  return sets.reduce((latest, row) => row.ts && Date.parse(row.ts) > Date.parse(latest) ? row.ts : latest, session.date);
}

export async function finishLiftSession(db: GymDb, sessionId: string, rpe: number | null, now = new Date()): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error(`No such session: ${sessionId}`);
    if (session.endedAt) return;
    const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
    const blocks = session.blocks.filter((b): b is LiftBlock => b.kind === 'lift');
    const { fatigue } = summarizeLiftSession(blocks, sets);
    const { hard, hardCardio } = classifyHard({ type: 'lift', rpe, runKinds: [] });
    const flags = { ...session.flags };
    if (fatigue) flags.fatigue = true;
    else delete flags.fatigue;
    const start = Date.parse(session.date);
    const endedAt = now.getTime() - start > RESUME_WINDOW_HOURS * HOUR
      ? await lastActivityAt(db, session)
      : now.toISOString();
    await db.sessions.update(sessionId, {
      rpe, hard, hardCardio, flags, endedAt,
      durationMin: Math.round((Date.parse(endedAt) - start) / 60_000),
    });
  });
}

const resumeSince = (now: Date) => new Date(now.getTime() - RESUME_WINDOW_HOURS * HOUR).toISOString();

export async function findOpenLiftSession(db: GymDb, now = new Date(), types: SessionType[] = ['lift', 'custom']): Promise<Session | undefined> {
  return db.sessions.where('date').between(resumeSince(now), now.toISOString(), true, true).reverse()
    .filter((s) => types.includes(s.type) && !s.endedAt && !s.mixed).first();
}

export async function findStaleOpenLifts(db: GymDb, now = new Date(), types: SessionType[] = ['lift', 'custom', 'hybrid']): Promise<Session[]> {
  return db.sessions.where('date').below(resumeSince(now)).reverse()
    .filter((s) => types.includes(s.type) && !s.endedAt && !s.mixed).toArray();
}

export async function discardLiftSession(db: GymDb, sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(sessionId);
    if (session?.endedAt) throw new Error('Cannot discard a finished workout');
    await db.sets.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function saveCircuitLog(db: GymDb, sessionId: string, blockId: string, log: CircuitLog): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.endedAt || !session.blocks.some((b) => b.id === blockId && b.kind === 'circuit')) return;
    const blocks = session.blocks.map((b) => b.id === blockId && b.kind === 'circuit' ? { ...b, log } : b);
    await db.sessions.update(sessionId, { blocks });
  });
}

export async function undoLastSet(db: GymDb, sessionId: string, exerciseId: string, equipmentId: string): Promise<void> {
  await db.transaction('rw', db.sets, async () => {
    const rows = await db.sets.where('sessionId').equals(sessionId).filter((s) => (
      s.exerciseId === exerciseId && s.equipmentId === equipmentId && isWorking(s)
    )).sortBy('idx');
    const last = rows.at(-1);
    if (last) await db.sets.delete(last.id);
  });
}

async function upsertOverride(db: GymDb, exerciseId: string, patch: Partial<ExerciseOverride>): Promise<void> {
  const cur = await db.exerciseOverrides.get(exerciseId);
  await db.exerciseOverrides.put({ exerciseId, notAtMyGym: false, ...cur, ...patch });
}
export const setNotAtMyGym = (db: GymDb, exerciseId: string, flag: boolean): Promise<void> =>
  upsertOverride(db, exerciseId, { notAtMyGym: flag });
export const setPreferredEquipment = (db: GymDb, exerciseId: string, equipmentId: string): Promise<void> =>
  upsertOverride(db, exerciseId, { preferredEquipmentId: equipmentId });

export async function updateEquipmentSteps(db: GymDb, equipmentId: string, steps: number[]): Promise<void> {
  const clean = [...new Set(steps)].sort((a, b) => a - b);
  if (clean.length === 0 || clean.some((s) => !Number.isFinite(s) || s < 0)) throw new Error('Steps must be non-empty, non-negative numbers');
  await db.equipment.update(equipmentId, { steps: clean });
}

/** Rewrites one planned block; sets already logged for the old exercise stay. */
export async function swapExerciseInSession(
  db: GymDb,
  sessionId: string,
  blockId: string,
  newExerciseId: string,
  equipmentId: string,
  patch: Partial<LiftBlock> = {},
): Promise<void> {
  const ex = LIFT_EXERCISES.get(newExerciseId);
  if (!ex) throw new Error(`Unknown lift exercise: ${newExerciseId}`);
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) throw new Error(`No such session: ${sessionId}`);
    const blocks = s.blocks.map((b) =>
      b.id === blockId && b.kind === 'lift'
        ? { ...b, exerciseId: newExerciseId, equipmentId, repMin: ex.repMin, repMax: ex.repMax, ...patch }
        : b,
    );
    await db.sessions.update(sessionId, { blocks });
  });
}

/** Progression reads history only: the session being logged must not feed its own prescription. */
const historySnapshot = async (db: GymDb, sessionId: string): Promise<LiftSnapshot> => {
  const full = await loadLiftSnapshot(db, new Date());
  return { ...full, history: full.history.filter((h) => h.session.id !== sessionId) };
};

const flagsFor = (session: Session, snapshot: LiftSnapshot) => ({
  deload: !!session.flags?.deload,
  rampIn: isRampInWeek(weekIndex(localDate(new Date(session.date)), snapshot.programStart)),
});

/** Swap a block to another exercise. Equipment is created first and the prescription rebuilt from a fresh snapshot that includes it. */
export async function swapBlockExercise(db: GymDb, sessionId: string, blockId: string, newExerciseId: string): Promise<void> {
  const ex = exerciseById.get(newExerciseId);
  const session = await db.sessions.get(sessionId);
  const block = session?.blocks.find((b): b is LiftBlock => b.kind === 'lift' && b.id === blockId);
  if (!ex || !session || !block) return;
  const before = await historySnapshot(db, sessionId);
  const weekIdx = weekIndex(localDate(new Date(session.date)), before.programStart);
  const eqId = await ensureEquipmentInstance(db, ex, resolveEquipmentId(before, ex, weekIdx));
  const fresh = await historySnapshot(db, sessionId);
  await swapExerciseInSession(db, sessionId, blockId, newExerciseId, eqId, blockPrescriptionPatch(fresh, newExerciseId, eqId, flagsFor(session, fresh), block));
}

/** Pick equipment for a block. Re-selecting the current instance changes nothing, so a ceiling-trimmed count survives. */
export async function changeBlockEquipment(db: GymDb, sessionId: string, blockId: string, equipmentId: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  const block = session?.blocks.find((b): b is LiftBlock => b.kind === 'lift' && b.id === blockId);
  if (!session || !block) return;
  await setPreferredEquipment(db, block.exerciseId, equipmentId);
  if (block.equipmentId === equipmentId) return;
  const snap = await historySnapshot(db, sessionId);
  // Same exercise: keep the block's own (possibly custom) rep range instead of resetting to library defaults.
  const range = { repMin: block.repMin, repMax: block.repMax };
  await swapExerciseInSession(db, sessionId, blockId, block.exerciseId, equipmentId, {
    ...blockPrescriptionPatch(snap, block.exerciseId, equipmentId, flagsFor(session, snap), block, range),
    ...range,
  });
}
