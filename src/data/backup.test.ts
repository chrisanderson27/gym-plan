import { afterEach, describe, expect, it } from 'vitest';
import { GymDb } from './db';
import { ROUND_TRIP_EXCLUDE, buildExport, importExport, markBackedUp, parseExport, ImportError } from './backup';
import { newId } from './ids';
import { STORE_NAMES } from './stores';
import type { Block, Session, Settings } from './types';

const dbs: GymDb[] = [];
const open = (name = 't-' + newId()) => {
  const d = new GymDb(name);
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 'settings', goalWeightLb: 220, startWeightLb: 247, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25,
  weightUnit: 'lb', distanceUnit: 'mi', programStart: '2026-11-01', onboardedAt: '2026-11-01T08:00:00.000Z',
  backupAt: null, updatedAt: '2026-11-10T08:00:00.000Z', ...over,
});

const blocks: Block[] = [
  { id: 'b1', kind: 'interval', rounds: 2, phases: [{ role: 'work', sec: 30, label: 'Work' }] },
  { id: 'b2', kind: 'lift', exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 12, supersetGroup: 'g' },
  { id: 'b3', kind: 'swim', section: 'main', rounds: 1, items: [{ reps: 4, distance: 50, stroke: 'FR', swimKind: 'swim', equipment: [], mode: 'rest', intensity: 'EZ' }] },
  { id: 'b4', kind: 'run', runKind: 'easy', modality: 'run', repeats: 1, segments: [{ role: 'run', sec: 600 }] },
];
const session = (id: string, type: Session['type'] = 'lift'): Session => ({
  id, date: '2026-11-10T10:00:00.000Z', type, blocks, hard: false, hardCardio: false, rpe: null, durationMin: 45, notes: 'n',
});

async function seed(db: GymDb) {
  await db.exerciseOverrides.put({ exerciseId: 'leg-press', notAtMyGym: true, preferredEquipmentId: 'pin-stack' });
  await db.sessions.bulkPut([session('s1'), session('s2', 'hybrid')]);
  await db.sets.bulkPut([
    { id: 'x1', sessionId: 's1', exerciseId: 'leg-press', equipmentId: 'pin-stack', idx: 0, targetWeight: 100, targetReps: 8, weight: 100, reps: 8, painFlag: false, setKind: 'working' },
    { id: 'x2', sessionId: 's1', exerciseId: 'leg-press', equipmentId: 'pin-stack', idx: 1, targetWeight: 100, targetReps: 8, weight: 100, reps: 7, rir: 1, painFlag: true, supersetGroup: 'g' },
  ]);
  await db.runs.put({ sessionId: 's2', kind: 'easy', modality: 'bike', distanceMi: 3, durationSec: 1200, intervals: [{ role: 'run', sec: 60 }], rpe: 5, painFlag: false });
  await db.swims.put({ sessionId: 's3', poolLength: 25, poolUnit: 'yd', distance: 1000, sets: [blocks[2] as never], rpe: 6, shoulderPainFlag: false });
  await db.tests.put({ id: 't1', kind: 'css', date: '2026-11-05T10:00:00.000Z', poolUnit: 'yd', t400: 480, t200: 220 });
  await db.bodyLogs.put({ date: '2026-11-10', weightLb: 245, waistIn: 40, protein: true });
  await db.templates.put({ id: 'tp1', name: 'Mine', type: 'lift', blocks, source: 'saved', createdAt: '2026-11-02T10:00:00.000Z' });
  await db.feedback.put({ id: 'f1', v: 1, ts: '2026-11-10T11:00:00.000Z', kind: 'app', tags: ['other'], text: 'hi', context: {} });
  await db.settings.put(settings());
}

const dump = async (db: GymDb) => {
  const out: Record<string, unknown[]> = {};
  for (const n of STORE_NAMES) out[n] = await db.table(n).toArray();
  return out;
};

describe('export/import', () => {
  it('round-trips every user store, excluding only settings.backupAt', async () => {
    expect(ROUND_TRIP_EXCLUDE).toEqual([['settings', 'backupAt']]);
    const name = 't-' + newId();
    const a = open(name);
    await seed(a);
    const before = await dump(a);
    const text = JSON.stringify(await buildExport(a, new Date('2026-11-12T00:00:00.000Z'), 'test'));
    await a.delete();
    const b = open(name);
    const { file } = parseExport(text);
    await importExport(b, file);
    const after = await dump(b);
    for (const [store, field] of ROUND_TRIP_EXCLUDE) {
      for (const row of [...(before[store] ?? []), ...(after[store] ?? [])]) delete (row as Record<string, unknown>)[field];
    }
    for (const n of STORE_NAMES) {
      // A fresh DB is pre-seeded with equipment, so compare the seeded ids the export carried.
      expect(after[n], n).toEqual(before[n]);
    }
  });

  it('never deletes local rows absent from the file', async () => {
    const src = open();
    await src.sessions.put(session('from-file'));
    const text = JSON.stringify(await buildExport(src, new Date(), 'test'));
    const dst = open();
    await dst.sessions.put(session('local-only'));
    await importExport(dst, parseExport(text).file);
    expect((await dst.sessions.toArray()).map((s) => s.id).sort()).toEqual(['from-file', 'local-only']);
  });

  it('merges settings by updatedAt and sets backupAt to the max', async () => {
    const exportedAt = '2026-11-12T00:00:00.000Z';
    const fileWith = (s: Settings) => ({ schemaVersion: 1, exportedAt, appVersion: 't', stores: { settings: [s] } });

    const newer = open();
    await newer.settings.put(settings({ goalWeightLb: 200, updatedAt: '2026-11-11T00:00:00.000Z', backupAt: '2026-11-11T12:00:00.000Z' }));
    await importExport(newer, fileWith(settings({ goalWeightLb: 230 })));
    const kept = await newer.settings.get('settings');
    expect(kept?.goalWeightLb).toBe(200);
    expect(kept?.backupAt).toBe(exportedAt);

    const older = open();
    await older.settings.put(settings({ goalWeightLb: 200, updatedAt: '2026-11-01T00:00:00.000Z' }));
    await importExport(older, fileWith(settings({ goalWeightLb: 230 })));
    expect((await older.settings.get('settings'))?.goalWeightLb).toBe(230);

    const fresh = open();
    await importExport(fresh, fileWith(settings({ goalWeightLb: 230 })));
    expect((await fresh.settings.get('settings'))?.backupAt).toBe(exportedAt);
  });

  it('buildExport does not write; markBackedUp does', async () => {
    const db = open();
    await db.settings.put(settings());
    await buildExport(db, new Date(), 'test');
    expect((await db.settings.get('settings'))?.backupAt).toBeNull();
    await markBackedUp(db, '2026-11-12T00:00:00.000Z');
    expect((await db.settings.get('settings'))?.backupAt).toBe('2026-11-12T00:00:00.000Z');
  });

  it('rejects bad files and leaves the DB unchanged', async () => {
    const db = open();
    await seed(db);
    const before = await dump(db);
    expect(() => parseExport('not json')).toThrow(ImportError);
    expect(() => parseExport(JSON.stringify({ schemaVersion: 2, exportedAt: 'x', appVersion: 'x', stores: {} }))).toThrow(/newer app/);
    expect(() => parseExport(JSON.stringify({ schemaVersion: 1, exportedAt: 'x', appVersion: 'x', stores: { sessions: [{ date: 'x' }] } }))).toThrow(/missing its "id"/);
    // Atomic: a failure mid-import writes nothing.
    const bad = { schemaVersion: 1, exportedAt: 'x', appVersion: 'x', stores: { sessions: [session('new')], sets: [{ id: 'x1', bad: true }], settings: [{ id: 'settings', updatedAt: 'zzz' }] } };
    const poisoned = { ...bad, stores: { ...bad.stores, tests: [{ id: 'q' }] } };
    await db.table('tests').hook('creating', () => { throw new Error('boom'); });
    await expect(importExport(db, poisoned)).rejects.toThrow();
    expect(await dump(db)).toEqual(before);
  });

  it('ignores unknown stores with a warning and accepts an empty stores object', () => {
    const r = parseExport(JSON.stringify({ schemaVersion: 1, exportedAt: 'x', appVersion: 'x', stores: { mystery: [{ id: 'a' }] } }));
    expect(r.warnings.join(' ')).toMatch(/mystery/);
    expect(r.file.stores).toEqual({});
    expect(parseExport(JSON.stringify({ schemaVersion: 1, exportedAt: 'x', appVersion: 'x', stores: {} })).warnings).toEqual([]);
  });

  it('rejects rows with missing or mistyped fields, leaving local data untouched', async () => {
    const db = open();
    await db.sessions.put(session('s1'));
    const mk = (stores: Record<string, unknown[]>) =>
      JSON.stringify({ schemaVersion: 1, exportedAt: '2026-11-12T00:00:00.000Z', appVersion: 't', stores });
    const bad: Record<string, unknown[]>[] = [
      { sessions: [{ id: 's1' }] },
      { sessions: [{ ...session('s1'), blocks: [{ id: 'b', kind: 'lift' }] }] },
      { sessions: [{ ...session('s1'), date: 'not-a-date' }] },
      { bodyLogs: [{ date: '2026-11-10', protein: 'yes' }] },
      { settings: [{ id: 'settings' }] },
      { sessions: [{ ...session('s1'), flags: 'broken' }] },
      { sessions: [{ ...session('s1'), variant: 'nope' }] },
      { sessions: [{ ...session('s1'), blocks: [{ ...blocks[0], result: { actualSec: 'broken' } }] }] },
      { sessions: [{ ...session('s1'), date: '123' }] },
      { bodyLogs: [{ date: '2026-02-30', protein: true }] },
      { sets: [{ id: 'x', sessionId: 's', exerciseId: 'e', equipmentId: 'q', idx: 0, targetWeight: 1, targetReps: 1, weight: 1, reps: 1, painFlag: false, setKind: 'bogus' }] },
      { feedback: [{ id: 'f', v: 1, ts: '2026-11-10T11:00:00.000Z', kind: 'app', tags: [], text: '', context: { sessionId: 5 } }] },
    ];
    for (const stores of bad) expect(() => parseExport(mk(stores))).toThrow(ImportError);
    expect((await db.sessions.get('s1'))?.blocks).toHaveLength(4);
  });

  it('accepts valid optional fields and unknown extension fields', () => {
    const ok = {
      ...session('s1'), variant: 'upper-a', flags: { deload: true }, extra: 1,
      blocks: [{ ...blocks[0], result: { completed: true, actualSec: 30 } }],
    };
    const raw = JSON.stringify({ schemaVersion: 1, exportedAt: '2026-11-12T00:00:00.000Z', appVersion: 't', stores: { sessions: [ok], bodyLogs: [{ date: '2024-02-29', protein: true }] } });
    expect(() => parseExport(raw)).not.toThrow();
  });
});
