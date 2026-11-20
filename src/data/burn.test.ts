import { expect, it } from 'vitest';
import { BURN_TEMPLATES } from '../content/burn-templates';
import { toPlanSession } from '../engine/plan/classify';
import { findStaleOpenBurns, finishBurnSession, planBurn, startOrResumeBurn } from './burn';
import { saveBurn } from './cardio';
import { saveCircuitLog } from './lift';
import { openTestDb } from './test-utils';
import type { CircuitBlock } from './types';

const START = new Date('2026-11-19T12:00:00Z');
const END = new Date('2026-11-19T12:55:00Z');

it.each([5, 9, null])('classifies loaded circuit Burn and legacy interval Burn alike at RPE %s', async (rpe) => {
  const db = openTestDb();
  try {
    const id = await startOrResumeBurn(db, {}, START);
    const open = (await db.sessions.get(id))!;
    expect(open).toMatchObject({ type: 'burn', hard: true, hardCardio: true, rpe: null });
    expect(open.endedAt).toBeUndefined();
    const circuit = open.blocks.find((b): b is CircuitBlock => b.kind === 'circuit' && b.stations.some((s) => s.load !== undefined))!;
    await saveCircuitLog(db, id, circuit.id, {
      completedRounds: 3, actualDurationSec: 480,
      stations: circuit.stations.map((s) => ({ exerciseId: s.exerciseId, actualLoad: s.load })),
    });
    await finishBurnSession(db, id, rpe, END);
    const legacyId = await saveBurn(db, {
      rpe, templateId: open.templateId!, startedAt: START.toISOString(),
      blocks: [{ kind: 'interval', id: 'legacy', rounds: 1, phases: [{ role: 'work', label: 'Row', sec: 60 }] }],
    }, END);
    const generated = (await db.sessions.get(id))!;
    const legacy = (await db.sessions.get(legacyId))!;
    expect({ hard: generated.hard, hardCardio: generated.hardCardio })
      .toEqual({ hard: legacy.hard, hardCardio: legacy.hardCardio });
    for (const session of [generated, legacy]) {
      expect(session.rpe).toBe(rpe);
      expect(toPlanSession(session, [], undefined, new Map()))
        .toMatchObject({ type: 'burn', hardCardio: true, lifted: false, finished: true });
    }
  } finally {
    await db.delete();
  }
});

it('serializes starts and resumes a single open Burn within 12 hours', async () => {
  const db = openTestDb();
  try {
    const [id, second] = await Promise.all([startOrResumeBurn(db, {}, START), startOrResumeBurn(db, {}, START)]);
    expect(second).toBe(id);
    expect(await startOrResumeBurn(db, {}, END)).toBe(id);
    expect(await db.sessions.count()).toBe(1);
  } finally {
    await db.delete();
  }
});

it('stores the preview prescription for the same template, budget and time', async () => {
  const db = openTestDb();
  try {
    const options = { templateId: BURN_TEMPLATES[1]!.id, budgetMin: 30 };
    const preview = await planBurn(db, options, START);
    const id = await startOrResumeBurn(db, options, START);
    expect((await db.sessions.get(id))?.blocks).toEqual(preview.blocks);
  } finally {
    await db.delete();
  }
});

it('round-robins finished templates and starts the next Burn with fresh circuit logs', async () => {
  const db = openTestDb();
  try {
    const first = await startOrResumeBurn(db, {}, START);
    expect((await planBurn(db, {}, START)).template.id).toBe(BURN_TEMPLATES[0]!.id);
    await finishBurnSession(db, first, 5, END);
    const second = await startOrResumeBurn(db, {}, END);
    expect((await db.sessions.get(second))?.templateId).toBe(BURN_TEMPLATES[1]!.id);
    await finishBurnSession(db, second, 5, END);
    expect((await planBurn(db, {}, END)).template.id).toBe(BURN_TEMPLATES[2]!.id);
    const regenerated = await planBurn(db, { templateId: BURN_TEMPLATES[0]!.id }, END);
    expect(regenerated.blocks.some((b) => b.kind === 'circuit')).toBe(true);
    expect(regenerated.blocks.every((b) => b.kind !== 'circuit' || !b.log)).toBe(true);
  } finally {
    await db.delete();
  }
});

it('finishes a stale Burn at its planned duration and preserves the first finish', async () => {
  const db = openTestDb();
  try {
    const preview = await planBurn(db, {}, START);
    const id = await startOrResumeBurn(db, {}, START);
    const staleAt = new Date('2026-11-21T12:00:00Z');
    expect((await findStaleOpenBurns(db, staleAt)).map((s) => s.id)).toEqual([id]);
    await finishBurnSession(db, id, 7, staleAt);
    await finishBurnSession(db, id, 5, staleAt);
    expect(await db.sessions.get(id)).toMatchObject({
      rpe: 7, durationMin: preview.totalMin, endedAt: new Date(START.getTime() + preview.totalMin * 60_000).toISOString(),
    });
  } finally {
    await db.delete();
  }
});
