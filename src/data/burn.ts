import { HOME_GYM, type GymProfile } from '../content';
import { BURN_TEMPLATES, type BurnTemplate } from '../content/burn-templates';
import { estimateBurnMinutes, generateBurn, nextBurnTemplate, type BurnInput } from '../engine/burn';
import { BURN_DEFAULT_MIN, RESUME_WINDOW_HOURS } from '../engine/config';
import { localDate } from '../engine/dates';
import { classifyHard } from '../engine/hard';
import type { LiftSnapshot } from '../engine/lift/types';
import { weekIndex } from '../engine/week';
import type { GymDb } from './db';
import { newId } from './ids';
import { findOpenLiftSession, findStaleOpenLifts, loadLiftSnapshot } from './lift';
import { BLOCK_EXERCISES, BODYWEIGHT_IDS, blockEquipmentResolver } from './liftday';

type BurnOptions = { templateId?: string; budgetMin?: number };

export function burnInputFrom(
  snapshot: LiftSnapshot, template: BurnTemplate, budgetMin: number, profile: GymProfile = HOME_GYM,
): BurnInput {
  let i = 0;
  return {
    template, budgetMin, profile, exercises: BLOCK_EXERCISES, bodyweightIds: BODYWEIGHT_IDS,
    notAtMyGym: new Set([...snapshot.overrides.values()].filter((o) => o.notAtMyGym).map((o) => o.exerciseId)),
    history: snapshot.history, equipment: snapshot.equipment, resolveEquipmentId: blockEquipmentResolver(snapshot),
    weekIdx: weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart),
    makeId: () => `b${i++}`,
  };
}

function lastBurnDone(snapshot: LiftSnapshot): Record<string, string> {
  const last: Record<string, string> = {};
  for (const { session } of snapshot.history) {
    if (session.type !== 'burn' || !session.endedAt || !session.templateId) continue;
    if (session.date > (last[session.templateId] ?? '')) last[session.templateId] = session.date;
  }
  return last;
}

export async function planBurn(db: GymDb, { templateId, budgetMin = BURN_DEFAULT_MIN }: BurnOptions = {}, now = new Date()) {
  const snapshot = await loadLiftSnapshot(db, now);
  const id = BURN_TEMPLATES.some((t) => t.id === templateId)
    ? templateId : nextBurnTemplate(BURN_TEMPLATES.map((t) => t.id), lastBurnDone(snapshot));
  const template = BURN_TEMPLATES.find((t) => t.id === id)!;
  return { template, ...generateBurn(burnInputFrom(snapshot, template, budgetMin)) };
}

export function startOrResumeBurn(db: GymDb, options: BurnOptions = {}, now = new Date()): Promise<string> {
  return db.transaction('rw', [db.sessions, db.settings, db.sets, db.equipment, db.exerciseOverrides], async () => {
    const open = await findOpenLiftSession(db, now, ['burn']);
    if (open) return open.id;
    const { template, blocks } = await planBurn(db, options, now);
    const id = newId();
    await db.sessions.add({
      id, date: now.toISOString(), type: 'burn', templateId: template.id, blocks,
      ...classifyHard({ type: 'burn', rpe: null, runKinds: [] }), rpe: null, durationMin: 0, notes: '',
    });
    return id;
  });
}

export async function finishBurnSession(db: GymDb, id: string, rpe: number | null, now = new Date()): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(id);
    if (session?.type !== 'burn') throw new Error(`No such Burn session: ${id}`);
    if (session.endedAt) return;
    const start = Date.parse(session.date);
    const end = now.getTime() - start > RESUME_WINDOW_HOURS * 3_600_000
      ? start + estimateBurnMinutes(session.blocks) * 60_000 : now.getTime();
    await db.sessions.update(id, {
      ...classifyHard({ type: 'burn', rpe, runKinds: [] }), rpe, endedAt: new Date(end).toISOString(),
      durationMin: Math.round((end - start) / 60_000),
    });
  });
}

export const findStaleOpenBurns = (db: GymDb, now = new Date()) => findStaleOpenLifts(db, now, ['burn']);
