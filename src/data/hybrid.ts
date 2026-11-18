import { RUN_FORMATS } from '../content/run-formats';
import { HYBRID_CARDIO_MIN, HYBRID_LIFT_MIN, type HYBRID_LEG_MODALITIES } from '../engine/config';
import { localDate } from '../engine/dates';
import { classifyHard } from '../engine/hard';
import { hybridCardio } from '../engine/hybrid';
import type { LiftPlan } from '../engine/lift/generator';
import { summarizeLiftSession } from '../engine/lift/session';
import type { LiftSnapshot } from '../engine/lift/types';
import { generateRun } from '../engine/run/generator';
import type { CardioSnapshot } from './cardio';
import { runWalkRatioOf } from './cardio';
import type { GymDb } from './db';
import { newId } from './ids';
import { buildLiftPlan, writeLiftSession } from './lift';
import type { CardioModality, LiftBlock, LiftVariant, RunBlock } from './types';

export type HybridCardio = ReturnType<typeof hybridCardio>;
export interface HybridPlan { variant: LiftVariant; lift: LiftPlan; cardio: HybridCardio }

export function buildHybridPlan(
  liftSnap: LiftSnapshot,
  cardioSnap: CardioSnapshot,
  opts: { variant: LiftVariant; liftMin?: number; cardioMin?: number; cardioKind?: 'easy' | 'intervals'; modality?: (typeof HYBRID_LEG_MODALITIES)[number] },
): HybridPlan {
  const now = new Date(liftSnap.now);
  const lift = buildLiftPlan(liftSnap, opts.variant, opts.liftMin ?? HYBRID_LIFT_MIN);
  const run = generateRun({
    now: liftSnap.now, today: localDate(now), programStart: liftSnap.programStart, history: cardioSnap.runHistory,
    kind: opts.cardioKind ?? 'easy', durationMin: opts.cardioMin ?? HYBRID_CARDIO_MIN, formats: RUN_FORMATS,
    lastDoneByFormat: cardioSnap.lastIntervalFormat, makeId: newId,
  });
  return { variant: opts.variant, lift, cardio: hybridCardio({ variant: opts.variant, run, ...(opts.modality ? { modality: opts.modality } : {}) }) };
}

export function startHybridSession(db: GymDb, plan: HybridPlan, now = new Date()): Promise<string> {
  return writeLiftSession(db, {
    type: 'hybrid', blocks: [...plan.lift.blocks, plan.cardio.block], variant: plan.variant, templateId: 'hybrid-' + plan.variant,
    calibration: [...plan.lift.prescriptions.values()].some((p) => p.mode === 'calibrate'), deload: plan.lift.deload,
  }, now);
}

export interface HybridLogValues { distanceMi: number; durationSec: number; modality: CardioModality; rpe: number; painFlag: boolean }

/** One transaction: the cardio row, the fatigue flag and the hard flags (the session RPE is asked once, in the cardio log). */
export async function finishHybridSession(db: GymDb, sessionId: string, v: HybridLogValues, now = new Date()): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, db.runs, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error(`No such session: ${sessionId}`);
    const run = session.blocks.find((b): b is RunBlock => b.kind === 'run');
    if (!run) throw new Error('Hybrid session has no cardio block');
    const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
    const lifts = session.blocks.filter((b): b is LiftBlock => b.kind === 'lift');
    const { fatigue } = summarizeLiftSession(lifts, sets);
    const ratio = runWalkRatioOf(run);
    await db.runs.put({
      sessionId, kind: run.runKind, modality: v.modality, distanceMi: v.distanceMi, durationSec: v.durationSec, intervals: run.segments,
      ...(ratio ? { runWalkRatio: ratio } : {}), rpe: v.rpe, painFlag: v.painFlag,
    });
    const flags = { ...session.flags };
    if (fatigue) flags.fatigue = true;
    else delete flags.fatigue;
    await db.sessions.update(sessionId, {
      rpe: v.rpe, ...classifyHard({ type: 'hybrid', rpe: v.rpe, runKinds: [run.runKind] }), flags, endedAt: now.toISOString(),
      durationMin: Math.round((now.getTime() - new Date(session.date).getTime()) / 60_000),
      blocks: session.blocks.map((b) => (b.kind === 'run' ? { ...b, modality: v.modality } : b)),
    });
  });
}
