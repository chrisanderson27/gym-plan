import { afterEach, describe, expect, it } from 'vitest';
import { SWIM_WORKOUTS } from '../content/swim-workouts';
import type { RunBlock } from './types';
import { buildExport, importExport, parseExport } from './backup';
import { burnInputs, loadCardioSnapshot, saveBurn, saveCssTest, saveRun, saveSwim } from './cardio';
import type { GymDb } from './db';
import { STORE_NAMES } from './stores';
import { openTestDb } from './test-utils';
import type { Settings } from './types';

const dbs: GymDb[] = [];
const open = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

const NOW = new Date('2026-11-12T12:00:00.000Z');
const START = '2026-11-12T11:00:00.000Z';
const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 'settings', goalWeightLb: 220, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
  programStart: '2026-11-01', onboardedAt: '2026-11-01T08:00:00.000Z', backupAt: null, updatedAt: '2026-11-10T08:00:00.000Z', ...over,
});
const runBlock = (runKind: RunBlock['runKind'], extra: Partial<RunBlock> = {}): RunBlock => ({
  id: 'rb', kind: 'run', runKind, modality: 'run', repeats: 6, segments: [{ role: 'run', sec: 60 }, { role: 'walk', sec: 90 }], format: 'run-walk', ...extra,
});

describe('cardio writers', () => {
  it('saveBurn is hard + hardCardio, with or without an RPE', async () => {
    const db = open();
    const id = await saveBurn(db, { templateId: 'burn-tread-floor', blocks: [], rpe: null, startedAt: START }, NOW);
    const s = await db.sessions.get(id);
    expect(s).toMatchObject({ type: 'burn', hard: true, hardCardio: true, rpe: null, durationMin: 60, templateId: 'burn-tread-floor' });
  });

  it('saveBurn uses a pre-allocated id when given', async () => {
    const db = open();
    const id = await saveBurn(db, { templateId: 'burn-tread-floor', blocks: [], rpe: null, startedAt: START, id: 'PRE' }, NOW);
    expect(id).toBe('PRE');
    expect(await db.sessions.get('PRE')).toBeTruthy();
  });

  it('saveRun: intervals are hardCardio; easy RPE 5 is not hard; the run row mirrors the session', async () => {
    const db = open();
    const hard = await saveRun(db, { block: runBlock('intervals', { format: 'hill' }), distanceMi: 0, durationSec: 1500, rpe: 7, painFlag: false, startedAt: START }, NOW);
    expect(await db.sessions.get(hard)).toMatchObject({ hard: true, hardCardio: true, templateId: 'run-hill', rpe: 7 });
    const easy = await saveRun(db, { block: runBlock('easy'), distanceMi: 1.5, durationSec: 1500, rpe: 5, painFlag: false, startedAt: START }, NOW);
    expect(await db.sessions.get(easy)).toMatchObject({ hard: false, hardCardio: false, templateId: 'run-run-walk' });
    expect(await db.runs.get(easy)).toMatchObject({ kind: 'easy', modality: 'run', distanceMi: 1.5, rpe: 5, runWalkRatio: '60:90' });
  });

  it('saveSwim copies the pool from settings at save time, and writes a css test on request', async () => {
    const db = open();
    await db.settings.put(settings());
    const blocks = SWIM_WORKOUTS[0]!.blocks;
    const id = await saveSwim(db, { workoutId: 'swim-easy-technique', blocks, distance: 1500, rpe: 8, shoulderPainFlag: false, durationMin: 40, startedAt: START, css: { t400: 420, t200: 200 } }, NOW);
    await db.settings.update('settings', { poolUnit: 'm', poolLength: 50 });
    expect(await db.swims.get(id)).toMatchObject({ poolUnit: 'yd', poolLength: 25, distance: 1500, rpe: 8 });
    expect(await db.sessions.get(id)).toMatchObject({ type: 'swim', hard: true, hardCardio: false });
    const tests = await db.tests.toArray();
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({ t400: 420, t200: 200, poolUnit: 'yd' });
  });

  it('saveSwim writes nothing when the css input is invalid', async () => {
    const db = open();
    await db.settings.put(settings());
    await expect(saveSwim(db, { workoutId: 'w', blocks: [], distance: 0, rpe: 5, shoulderPainFlag: false, durationMin: 1, startedAt: START, css: { t400: 100, t200: 200 } }, NOW)).rejects.toThrow();
    expect(await db.sessions.count()).toBe(0);
  });

  it('saveCssTest accepts a pair or a 3×100 and rejects bad input', async () => {
    const db = open();
    await db.settings.put(settings({ poolUnit: 'm' }));
    await saveCssTest(db, { t400: 420, t200: 200 }, NOW);
    await saveCssTest(db, { t3x100: 115 }, NOW);
    expect((await db.tests.toArray()).map((t) => t.poolUnit)).toEqual(['m', 'm']);
    await expect(saveCssTest(db, { t400: 200, t200: 200 }, NOW)).rejects.toThrow();
    await expect(saveCssTest(db, { t400: 400 }, NOW)).rejects.toThrow();
    await expect(saveCssTest(db, {}, NOW)).rejects.toThrow();
  });
});

describe('loadCardioSnapshot', () => {
  it('joins run dates, tracks lastDone and last interval format, and reads overrides', async () => {
    const db = open();
    await db.settings.put(settings());
    await db.exerciseOverrides.put({ exerciseId: 'ski-erg', notAtMyGym: true });
    await db.exerciseOverrides.put({ exerciseId: 'rower', notAtMyGym: false });
    await saveBurn(db, { templateId: 'burn-tread-floor', blocks: [], rpe: 8, startedAt: '2026-11-05T10:00:00.000Z' }, NOW);
    await saveBurn(db, { templateId: 'burn-tread-floor', blocks: [], rpe: 8, startedAt: '2026-11-09T10:00:00.000Z' }, NOW);
    await saveRun(db, { block: runBlock('intervals', { format: 'hill' }), distanceMi: 1, durationSec: 1200, rpe: 7, painFlag: false, startedAt: '2026-11-07T10:00:00.000Z' }, NOW);
    await saveCssTest(db, { t3x100: 120 }, NOW);
    const snap = await loadCardioSnapshot(db, NOW);
    expect(snap.lastDone['burn-tread-floor']).toBe('2026-11-09T10:00:00.000Z');
    expect(snap.lastByType.burn).toBe('2026-11-09T10:00:00.000Z');
    expect(snap.lastIntervalFormat['hill']).toBe('2026-11-07T10:00:00.000Z');
    expect(snap.runHistory).toHaveLength(1);
    expect(snap.runHistory[0]).toMatchObject({ date: '2026-11-07T10:00:00.000Z', kind: 'intervals', durationSec: 1200 });
    expect([...snap.excluded]).toEqual(['ski-erg']);
    expect(snap.cssTests).toHaveLength(1);
    expect(snap.settings?.poolLength).toBe(25);
  });

  it('ignores sessions older than 60 days', async () => {
    const db = open();
    await saveBurn(db, { templateId: 'burn-old', blocks: [], rpe: 8, startedAt: '2026-08-01T10:00:00.000Z' }, NOW);
    expect((await loadCardioSnapshot(db, NOW)).lastDone['burn-old']).toBeUndefined();
  });
});

describe('burnInputs', () => {
  it('exposes substitutes and names from the library', () => {
    const { substitutesOf, labelOf } = burnInputs();
    expect(substitutesOf['ski-erg']?.length).toBeGreaterThan(0);
    expect(labelOf['rower']).toBeTruthy();
  });
});

describe('export/import round-trip', () => {
  it('reproduces burn, run, swim and test rows exactly, so they pass import validation', async () => {
    const a = open();
    await a.settings.put(settings());
    await saveBurn(a, { templateId: 'burn-tread-floor', blocks: [{ id: 'b', kind: 'interval', rounds: 1, phases: [{ role: 'work', sec: 30, label: 'x', exerciseId: 'rower' }], result: { completed: true, actualSec: 30, completedRounds: 1, skipped: false } }], rpe: null, startedAt: START }, NOW);
    await saveRun(a, { block: runBlock('easy'), distanceMi: 0, durationSec: 1500, rpe: 4, painFlag: true, startedAt: START }, NOW);
    await saveSwim(a, { workoutId: 'swim-css-intro', blocks: SWIM_WORKOUTS[2]!.blocks, distance: 2000, rpe: 6, shoulderPainFlag: true, durationMin: 50, startedAt: START, css: { t3x100: 118 } }, NOW);
    const dump = async (db: GymDb) => {
      const out: Record<string, unknown[]> = {};
      for (const n of ['sessions', 'runs', 'swims', 'tests'] as const) out[n] = await db.table(n).toArray();
      return out;
    };
    expect(STORE_NAMES).toContain('runs');
    const before = await dump(a);
    const text = JSON.stringify(await buildExport(a, NOW, 'test'));
    const b = open();
    await importExport(b, parseExport(text).file);
    expect(await dump(b)).toEqual(before);
  });
});
