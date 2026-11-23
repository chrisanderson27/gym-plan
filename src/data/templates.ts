import { BURN_TEMPLATES } from '../content/burn-templates';
import { RUN_FORMATS } from '../content/run-formats';
import { LIFT_TEMPLATES, exerciseById } from '../content';
import { localDate } from '../engine/dates';
import { hybridCardio } from '../engine/hybrid';
import { pickSubstitute } from '../engine/lift/generator';
import { deloadState } from '../engine/lift/deload';
import { summarizeLiftSession } from '../engine/lift/session';
import { generateRun } from '../engine/run/generator';
import { toTemplateBlocks } from '../engine/templates';
import { isRampInWeek, weekIndex } from '../engine/week';
import { loadCardioSnapshot } from './cardio';
import type { GymDb } from './db';
import { newId } from './ids';
import { LIFT_EXERCISES, blockPrescriptionPatch, loadLiftSnapshot, resolveEquipmentId, writeLiftSession } from './lift';
import type { Block, LiftBlock, LiftVariant, OrderedPrescription, RunBlock, SessionType, Template } from './types';
import { snapshotValue, validAuthoredWorkout } from './validate';

export interface Runnable {
  type: SessionType;
  blocks: Block[];
  templateId?: string;
  variant?: LiftVariant;
  name: string;
  ordered?: OrderedPrescription;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function defaultName(type: SessionType, variant: LiftVariant | undefined, templateId: string | undefined, date: string): string {
  if (variant) return `${type === 'hybrid' ? 'Hybrid ' : ''}${LIFT_TEMPLATES[variant].name}`;
  const burn = BURN_TEMPLATES.find((t) => t.id === templateId);
  if (burn) return burn.name;
  return `${cap(type)} ${date.slice(0, 10)}`;
}

export async function saveAsMine(db: GymDb, sessionId: string, name?: string, now = new Date()): Promise<string> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error(`No such session: ${sessionId}`);
  const id = newId();
  const ordered = session.mixed ? structuredClone(session.mixed.prescription) : undefined;
  if (ordered && name?.trim()) ordered.name = name.trim();
  await db.templates.add({
    id, name: ordered?.name ?? (name?.trim() || defaultName(session.type, session.variant, session.templateId, session.date)), type: session.type,
    ...(ordered ? { ordered } : {}),
    ...(session.variant ? { variant: session.variant } : {}), blocks: ordered ? orderedStrengthBlocks(ordered) : toTemplateBlocks(session.blocks, newId), source: 'saved', createdAt: now.toISOString(),
  });
  return id;
}

export async function saveBuilt(db: GymDb, input: { id?: string; name: string; blocks: LiftBlock[] }, now = new Date()): Promise<string> {
  const id = input.id ?? newId();
  await db.transaction('rw', db.templates, async () => {
    const row = input.id ? await db.templates.get(id) : undefined;
    if (input.id && !editableLiftTemplate(row)) throw new WorkoutSaveError('This workout cannot be edited in the lift builder.');
    await db.templates.put({ id, name: input.name.trim(), type: 'custom', blocks: input.blocks, source: 'built', createdAt: row?.createdAt ?? now.toISOString() });
  });
  return id;
}

export class WorkoutSaveError extends Error {}
export class StaleWorkoutSaveError extends WorkoutSaveError {}

export function editableLiftTemplate(row: Template | undefined): row is Template {
  return !!row && row.source === 'built' && row.type === 'custom' && !row.ordered && row.blocks.every((block) => block.kind === 'lift');
}

export async function saveOrderedWorkout(db: GymDb, draft: OrderedPrescription,
  edit?: { id: string; baseline: OrderedPrescription }, now = new Date()): Promise<string> {
  const ordered = structuredClone({ name: draft.name.trim(), blocks: draft.blocks });
  if (!validAuthoredWorkout(ordered)) throw new WorkoutSaveError('Enter a name and add 1–30 valid blocks. Replace or remove any coached block missing its schedule.');
  const id = edit?.id ?? newId();
  await db.transaction('rw', db.templates, async () => {
    const row = edit ? await db.templates.get(id) : undefined;
    if (edit && (!row?.ordered || row.type !== 'custom' || row.source !== 'saved' || snapshotValue(row.ordered) !== snapshotValue(edit.baseline))) {
      throw new StaleWorkoutSaveError('This workout changed or was removed. Reopen it to edit the latest version, or save this draft as a new workout.');
    }
    const saved: Template = {
      id, name: ordered.name, type: 'custom', source: 'saved',
      createdAt: row?.createdAt ?? now.toISOString(), ordered, blocks: orderedStrengthBlocks(ordered),
    };
    if (edit) await db.templates.put(saved);
    else await db.templates.add(saved);
  });
  return id;
}

export async function listMine(db: GymDb, types: SessionType[]): Promise<Template[]> {
  const rows = await db.templates.where('type').anyOf(types).toArray();
  return rows.filter((t) => t.source !== 'generated').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const deleteTemplate = (db: GymDb, id: string): Promise<void> => db.templates.delete(id);

export async function loadRunnable(db: GymDb, src: { templateId: string } | { sessionId: string }): Promise<Runnable | null> {
  if ('templateId' in src) {
    const t = await db.templates.get(src.templateId);
    return t ? { type: t.type, blocks: t.blocks, templateId: t.id, name: t.name, ...(t.ordered ? { ordered: t.ordered } : {}), ...(t.variant ? { variant: t.variant } : {}) } : null;
  }
  const s = await db.sessions.get(src.sessionId);
  if (!s) return null;
  return {
    type: s.type, blocks: toTemplateBlocks(s.blocks, newId), ...(s.templateId ? { templateId: s.templateId } : {}),
    ...(s.variant ? { variant: s.variant } : {}), name: s.mixed?.prescription.name ?? defaultName(s.type, s.variant, s.templateId, s.date),
    ...(s.mixed ? { ordered: s.mixed.prescription } : {}),
  };
}

/** Re-prescribes every lift block from current history, keeps the source's set counts (except in a deload) and substitutes not-at-my-gym exercises. */
export async function startFromBlocks(db: GymDb, r: Runnable, now = new Date()): Promise<string> {
  if (r.type !== 'lift' && r.type !== 'custom' && r.type !== 'hybrid') throw new Error(`Cannot start a ${r.type} session from blocks`);
  const { blocks, calibration, deload } = await prepareLiftBlocks(db, r, now);
  return writeLiftSession(db, {
    type: r.type, blocks, calibration, deload,
    ...(r.variant ? { variant: r.variant } : {}), ...(r.templateId ? { templateId: r.templateId } : {}),
  }, now);
}

export function orderedStrengthBlocks(ordered: OrderedPrescription): LiftBlock[] {
  return ordered.blocks.flatMap((b) => b.kind === 'strength' ? [{ ...b, kind: 'lift' }] : []);
}

export function replayLiftFlags(snap: Awaited<ReturnType<typeof loadLiftSnapshot>>, now: Date) {
  const weekIdx = weekIndex(localDate(now), snap.programStart);
  const missed = new Map<string, number>();
  for (const h of snap.history) {
    const lifts = h.session.blocks.filter((b): b is LiftBlock => b.kind === 'lift');
    if (lifts.length) missed.set(h.session.id, summarizeLiftSession(lifts, h.sets).missedExercises.length);
  }
  return { deload: deloadState(snap, missed).deload, rampIn: isRampInWeek(weekIdx) };
}

async function prepareLiftBlocks(db: GymDb, r: Runnable, now: Date) {
  const snap = await loadLiftSnapshot(db, now);
  const weekIdx = weekIndex(localDate(now), snap.programStart);
  const flags = replayLiftFlags(snap, now);
  const used = new Set(r.blocks.filter((b): b is LiftBlock => b.kind === 'lift').map((b) => b.exerciseId));

  const blocks: Block[] = [];
  let calibration = false;
  for (const b of r.blocks) {
    if (b.kind === 'run') {
      blocks.push(await regenerateRun(db, b, r.variant, now));
      continue;
    }
    if (b.kind !== 'lift') continue;
    if (b.warmup) {
      blocks.push(b);
      continue;
    }
    const { result: _r, ...base } = b;
    void _r;
    let exerciseId = b.exerciseId;
    let equipmentId = b.equipmentId;
    if (snap.overrides.get(exerciseId)?.notAtMyGym) {
      const sub = pickSubstitute(exerciseId, LIFT_EXERCISES, snap.overrides, { exclude: used });
      if (sub) {
        used.add(sub);
        exerciseId = sub;
        equipmentId = undefined;
      }
    }
    const ex = exerciseById.get(exerciseId);
    if (!ex) continue;
    if (!equipmentId || !snap.equipment.has(equipmentId)) equipmentId = resolveEquipmentId(snap, ex, weekIdx);
    const patch = blockPrescriptionPatch(snap, exerciseId, equipmentId, flags, undefined, exerciseId === b.exerciseId ? b : undefined);
    const lx = LIFT_EXERCISES.get(exerciseId);
    const next: LiftBlock = {
      ...base, exerciseId, equipmentId, ...patch,
      sets: flags.deload ? patch.sets ?? b.sets : b.sets,
      ...(exerciseId !== b.exerciseId && lx ? { repMin: lx.repMin, repMax: lx.repMax } : {}),
    };
    if (next.label === 'Calibration') calibration = true;
    blocks.push(next);
  }
  return { blocks, calibration, deload: flags.deload };
}

/** A stored run block is never replayed verbatim: it goes back through the generator so the 1.10× cap holds. */
async function regenerateRun(db: GymDb, block: RunBlock, variant: LiftVariant | undefined, now: Date): Promise<RunBlock> {
  const [cardio, settings] = await Promise.all([loadCardioSnapshot(db, now), db.settings.get('settings')]);
  const plannedSec = block.repeats * block.segments.reduce((n, s) => n + (s.sec ?? 0), 0);
  const run = generateRun({
    now: now.toISOString(), today: localDate(now), programStart: settings?.programStart ?? localDate(now), history: cardio.runHistory,
    kind: block.runKind, ...(block.format ? { format: block.format } : {}), formats: RUN_FORMATS, lastDoneByFormat: cardio.lastIntervalFormat,
    ...(plannedSec > 0 ? { durationMin: Math.max(5, Math.round(plannedSec / 60)) } : {}), makeId: newId,
  });
  const machine = block.modality === 'bike' || block.modality === 'row' || block.modality === 'ski' ? block.modality : undefined;
  const out = hybridCardio({ variant: variant ?? 'upper-a', run, ...(machine ? { modality: machine } : {}) }).block;
  // Upper-day plans keep the generated modality; a machine choice from the source survives on any day.
  return machine ? { ...out, modality: machine } : out;
}
