import { afterEach, describe, expect, it } from 'vitest';
import { runsOnly } from '../engine/run/guardrails';
import { loadCardioSnapshot } from './cardio';
import type { GymDb } from './db';
import { buildHybridPlan, finishHybridSession, startHybridSession } from './hybrid';
import { loadLiftSnapshot, prescribeExercise } from './lift';
import { NOW, seedSettings, topSets } from './p4-test-utils';
import { openTestDb } from './test-utils';

const dbs: GymDb[] = [];
const open = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

const start = async (db: GymDb, variant: 'upper-a' | 'lower-a', cardioKind: 'easy' | 'intervals' = 'easy') => {
  const plan = buildHybridPlan(await loadLiftSnapshot(db, NOW), await loadCardioSnapshot(db, NOW), { variant, cardioKind });
  return startHybridSession(db, plan, NOW);
};

describe('hybrid session', () => {
  it('writes one session with lift blocks, one run block and a variant', async () => {
    const db = open();
    await seedSettings(db);
    const id = await start(db, 'upper-a');
    const s = (await db.sessions.get(id))!;
    expect(s).toMatchObject({ type: 'hybrid', variant: 'upper-a', templateId: 'hybrid-upper-a' });
    expect(s.blocks.filter((b) => b.kind === 'run')).toHaveLength(1);
    expect(s.blocks.some((b) => b.kind === 'lift')).toBe(true);
  });

  it('finish writes the runs row; a bike row is excluded from run guardrails, a run row is not', async () => {
    const db = open();
    await seedSettings(db);
    const up = await start(db, 'upper-a');
    await finishHybridSession(db, up, { distanceMi: 1.5, durationSec: 1200, modality: 'run', rpe: 5, painFlag: false }, NOW);
    expect(runsOnly((await loadCardioSnapshot(db, NOW)).runHistory)).toHaveLength(1);

    const lo = await start(db, 'lower-a');
    await finishHybridSession(db, lo, { distanceMi: 0, durationSec: 1200, modality: 'bike', rpe: 5, painFlag: false }, NOW);
    const hist = (await loadCardioSnapshot(db, NOW)).runHistory;
    expect(hist).toHaveLength(2);
    expect(runsOnly(hist)).toHaveLength(1);
    expect((await db.sessions.get(lo))!.blocks.find((b) => b.kind === 'run')).toMatchObject({ modality: 'bike' });
  });

  it('intervals make the hybrid hardCardio', async () => {
    const db = open();
    await seedSettings(db);
    const id = await start(db, 'lower-a', 'intervals');
    await finishHybridSession(db, id, { distanceMi: 0, durationSec: 1200, modality: 'bike', rpe: 6, painFlag: false }, NOW);
    expect(await db.sessions.get(id)).toMatchObject({ hard: true, hardCardio: true, rpe: 6 });
  });

  it('hybrid sets feed progression for the next lift', async () => {
    const db = open();
    await seedSettings(db);
    const id = await start(db, 'upper-a');
    await db.sets.bulkPut(topSets(id, 1));
    await finishHybridSession(db, id, { distanceMi: 1, durationSec: 1200, modality: 'run', rpe: 4, painFlag: false }, NOW);
    const snap = await loadLiftSnapshot(db, NOW);
    expect(snap.history.find((h) => h.session.id === id)?.sets).toHaveLength(3);
    const p = prescribeExercise(snap, 'chest-press-machine', 'pin-stack', { deload: false, rampIn: false });
    expect(p?.mode).toBe('progress');
    expect(p!.weight).toBeGreaterThan(100);
  });
});
