import { afterEach, describe, expect, it } from 'vitest';
import { GymDb } from './db';
import { ROUND_TRIP_EXCLUDE, buildExport, importExport, markBackedUp, parseExport, ImportError } from './backup';
import { newId } from './ids';
import { ensureDefaultSettings } from './settings';
import { saveOrderedWorkout } from './templates';
import { floored } from './test-utils';
import { startMixedSession, updateMixedSession } from './mixedSession';
import { libraryWorkoutBlock, copyWorkoutBlock, starterWorkoutBlocks } from './workoutChoices';
import { STORE_NAMES } from './stores';
import type { Block, LibraryBlock, Session, Settings } from './types';

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
  backupAt: null, updatedAt: '2026-11-10T08:00:00.000Z', appearance: 'dark', ...over,
});

const blocks: Block[] = [
  { id: 'b1', kind: 'interval', rounds: 2, phases: [{ role: 'work', sec: 30, label: 'Work' }] },
  { id: 'b2', kind: 'lift', exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 12, supersetGroup: 'g' },
  { id: 'b3', kind: 'swim', section: 'main', rounds: 1, items: [{ reps: 4, distance: 50, stroke: 'FR', swimKind: 'swim', equipment: [], mode: 'rest', intensity: 'EZ' }] },
  { id: 'b4', kind: 'run', runKind: 'easy', modality: 'run', repeats: 1, segments: [{ role: 'run', sec: 600 }] },
  {
    id: 'b5', kind: 'circuit', role: 'block', label: 'Block A', durationSec: 480, targetRounds: 5, podId: 'turf',
    stations: [
      { exerciseId: 'kb-swing', equipmentId: 'kettlebells', itemId: 'turf-bells', load: 25, target: { unit: 'reps', amount: 15 },
        backup: { exerciseId: 'goblet-squat', equipmentId: 'dumbbells', itemId: 'turf-dumbbells', load: 20, target: { unit: 'reps', amount: 10 } } },
      { exerciseId: 'rower', itemId: 'turf-rower', target: { unit: 'cal', amount: 15 } },
    ],
    log: {
      completedRounds: 4, partialReps: { stationIndex: 1, count: 6 }, lastRoundRir: 2, actualDurationSec: 468,
      stations: [{ exerciseId: 'goblet-squat', actualLoad: 20, swappedFromExerciseId: 'kb-swing' }, { exerciseId: 'rower' }],
    },
  },
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

  it('imports an older backup with no circuit blocks unchanged', async () => {
    const db = open();
    const old = { ...session('old'), blocks: blocks.filter((block) => block.kind !== 'circuit') };
    const backup = await buildExport(db, new Date(), 'test');
    backup.stores.sessions = [old];
    const { file } = parseExport(JSON.stringify(backup));
    await importExport(db, file);
    expect(await db.sessions.get(old.id)).toEqual(old);
  });

  it('excludes sync bookkeeping from export and preserves it on import', async () => {
    const db = open();
    const clientUpdatedAt = '2026-11-10T10:00:00.000Z';
    await db.syncOutbox.add({ store: 'sessions', key: 's1', op: 'put', clientUpdatedAt });
    await db.syncMeta.put({ id: 'sessions', cursor: { updatedAt: clientUpdatedAt, id: 's1' } });
    const backup = await buildExport(db, new Date(), 'test');
    expect(Object.keys(backup.stores)).toEqual(STORE_NAMES);
    await importExport(db, parseExport(JSON.stringify(backup)).file);
    expect(await db.syncOutbox.count()).toBe(1);
    expect(await db.syncMeta.count()).toBe(1);
  });

  it('rejects a circuit with an invalid station target unit', async () => {
    const db = open();
    const backup = await buildExport(db, new Date(), 'test');
    const invalid = blocks.map((block) => block.kind === 'circuit'
      ? { ...block, stations: [{ ...block.stations[0]!, target: { unit: 'mile', amount: 1 } }] }
      : block);
    backup.stores.sessions = [{ ...session('bad'), blocks: invalid }];
    expect(() => parseExport(JSON.stringify(backup))).toThrow('Row 1 in "sessions" is malformed.');
  });

  it('round-trips activity and goal settings with no pool and rejects an empty activity list', async () => {
    const src = open();
    const { poolUnit: _unit, poolLength: _length, ...noPool } = settings({ activities: ['run'], goalDirection: 'gain' });
    void _unit;
    void _length;
    await src.settings.put(noPool);
    const backup = await buildExport(src, new Date(), 'test');
    const dst = open();
    await importExport(dst, parseExport(JSON.stringify(backup)).file);
    const row = await dst.settings.get('settings');
    expect(row).toMatchObject({ activities: ['run'], goalDirection: 'gain' });
    expect(row).not.toHaveProperty('poolUnit');
    expect(row).not.toHaveProperty('poolLength');
    expect(() => parseExport(JSON.stringify({ ...backup, stores: { settings: [{ ...noPool, activities: [] }] } }))).toThrow(ImportError);
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

  it('a default-seeded local row loses to any imported settings row', async () => {
    const db = open();
    await ensureDefaultSettings(db, new Date(2026, 10, 1));
    await importExport(db, { schemaVersion: 1, exportedAt: '2026-11-12T00:00:00.000Z', appVersion: 't', stores: { settings: [settings({ soundCues: false })] } });
    const row = await db.settings.get('settings');
    expect(row?.soundCues).toBe(false);
    expect(row?.programStart).toBe('2026-11-01');
  });

  it('a settings row without goalWeightLb exports, validates and re-imports', async () => {
    const src = open();
    await ensureDefaultSettings(src, new Date(2026, 10, 1));
    const text = JSON.stringify(await buildExport(src, new Date('2026-11-12T00:00:00.000Z'), 't'));
    const dst = open();
    await importExport(dst, parseExport(text).file);
    expect(await dst.settings.get('settings')).not.toHaveProperty('goalWeightLb');
  });

  it('a v1 file with weights, templates and legacy sessions imports onto a default-seeded db intact', async () => {
    const src = open();
    await seed(src);
    const file = await buildExport(src, new Date('2026-11-12T00:00:00.000Z'), 't');
    const dst = open();
    await ensureDefaultSettings(dst, new Date(2026, 10, 1));
    await importExport(dst, parseExport(JSON.stringify(file)).file);
    const [a, b] = [await dump(src), await dump(dst)];
    for (const name of ['sessions', 'sets', 'bodyLogs', 'templates', 'runs', 'swims']) expect(b[name]).toEqual(a[name]);
    expect((await dst.settings.get('settings'))?.goalWeightLb).toBe(220);
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
    expect(() => parseExport(JSON.stringify({ schemaVersion: 3, exportedAt: 'x', appVersion: 'x', stores: {} }))).toThrow(/newer app/);
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
    expect(r.file.stores).toEqual({ libraryBlocks: [] });
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
      { settings: [settings({ appearance: 'neon' as never })] },
      { sessions: [{ ...session('s1'), flags: 'broken' }] },
      { sessions: [{ ...session('s1'), variant: 'nope' }] },
      { sessions: [{ ...session('s1'), blocks: [{ ...blocks[0], result: { actualSec: 'broken' } }] }] },
      { sessions: [{ ...session('s1'), date: '123' }] },
      { bodyLogs: [{ date: '2026-02-30', protein: true }] },
      { sets: [{ id: 'x', sessionId: 's', exerciseId: 'e', equipmentId: 'q', idx: 0, targetWeight: 1, targetReps: 1, weight: 1, reps: 1, painFlag: false, setKind: 'bogus' }] },
      { feedback: [{ id: 'f', v: 1, ts: '2026-11-10T11:00:00.000Z', kind: 'app', tags: [], text: '', context: { sessionId: 5 } }] },
    ];
    for (const stores of bad) expect(() => parseExport(mk(stores))).toThrow(ImportError);
    expect((await db.sessions.get('s1'))?.blocks).toEqual(blocks);
  });

  it('accepts valid optional fields and unknown extension fields', () => {
    const ok = {
      ...session('s1'), variant: 'upper-a', flags: { deload: true }, extra: 1,
      blocks: [{ ...blocks[0], result: { completed: true, actualSec: 30 } }],
    };
    const raw = JSON.stringify({ schemaVersion: 1, exportedAt: '2026-11-12T00:00:00.000Z', appVersion: 't', stores: { sessions: [ok], bodyLogs: [{ date: '2024-02-29', protein: true }] } });
    expect(() => parseExport(raw)).not.toThrow();
  });

  it('round-trips sound cues, equipment, goal, appearance and activities', async () => {
    const src = open();
    await src.settings.put(settings({
      soundCues: false, unavailableEquipment: ['dumbbells', 'lap-pool'], goalWeightLb: 210, appearance: 'dark', activities: ['lift', 'run'],
    }));
    const backup = await buildExport(src, new Date('2026-11-20T00:00:00.000Z'), 'test');
    const dst = open();
    await importExport(dst, parseExport(JSON.stringify(backup)).file);
    expect(await dst.settings.get('settings')).toMatchObject({
      soundCues: false, unavailableEquipment: ['dumbbells', 'lap-pool'], goalWeightLb: 210, appearance: 'dark', activities: ['lift', 'run'],
    });
  });

  it('a backup missing the new fields leaves cues on and the checklist empty', async () => {
    const src = open();
    await src.settings.put(settings());
    const backup = await buildExport(src, new Date(), 'test');
    const dst = open();
    await importExport(dst, parseExport(JSON.stringify(backup)).file);
    const saved = await dst.settings.get('settings');
    expect(saved?.soundCues).toBeUndefined();
    expect(saved?.soundCues !== false).toBe(true);
    expect(saved?.unavailableEquipment ?? []).toEqual([]);
  });

  it('rejects an unknown equipment id', async () => {
    const src = open();
    await src.settings.put(settings());
    const backup = await buildExport(src, new Date(), 'test');
    const bad = { ...backup, stores: { ...backup.stores, settings: [{ ...settings(), unavailableEquipment: ['not-a-row'] }] } };
    expect(() => parseExport(JSON.stringify(bad))).toThrow(ImportError);
  });

  it('an older file does not clobber a newer local checklist', async () => {
    const db = open();
    await db.settings.put(settings({ unavailableEquipment: ['dumbbells'], soundCues: true, updatedAt: '2026-11-11T00:00:00.000Z' }));
    const file = {
      schemaVersion: 1, exportedAt: '2026-11-12T00:00:00.000Z', appVersion: 't',
      stores: { settings: [settings({ unavailableEquipment: ['rower'], soundCues: false, updatedAt: '2026-11-01T00:00:00.000Z' })] },
    };
    await importExport(db, parseExport(JSON.stringify(file)).file);
    const row = await db.settings.get('settings');
    expect(row?.unavailableEquipment).toEqual(['dumbbells']);
    expect(row?.soundCues).toBe(true);
  });
});

it('round-trips an edited ordered workout with extra strength fields and valid legacy lifts', async () => {
  const src = open();
  const now = new Date('2026-11-22T12:00:00.000Z');
  const strength = starterWorkoutBlocks.find((block) => block.kind === 'strength')!;
  const baseline = { name: 'Restored strength', blocks: floored([{ ...strength, notes: 12, warmup: 'easy' }]) };
  const template = { id: 'portable', name: baseline.name, ordered: baseline, blocks: [],
    type: 'custom', source: 'saved', createdAt: now.toISOString() };
  await importExport(src, parseExport(JSON.stringify({ schemaVersion: 2, stores: { templates: [template] } })).file);
  const sessionId = await startMixedSession(src, { templateId: template.id }, now);
  const ordered = { ...baseline, name: 'Renamed strength' };
  await saveOrderedWorkout(src, ordered, { id: template.id, baseline }, now);
  const saved = (await src.templates.get(template.id))!;
  const session = (await src.sessions.get(sessionId))!;
  for (const block of [saved.blocks[0], session.blocks[0]]) {
    expect.soft(block).toMatchObject({ kind: 'lift', sets: strength.sets, restSec: strength.restSec });
    expect.soft(block).not.toHaveProperty('notes');
    expect.soft(block).not.toHaveProperty('warmup');
  }
  const restored = open();
  await importExport(restored, parseExport(JSON.stringify(await buildExport(src, now, 'test'))).file);
  expect(await restored.templates.get(template.id)).toMatchObject({ ...template, name: ordered.name, ordered, blocks: saved.blocks });
  expect((await restored.sessions.get(sessionId))?.mixed?.prescription).toEqual(baseline);
});

it('restores authored workouts and history after the source changes, keeping local v1 user rows', async () => {
  const src = open();
  await src.settings.put(settings({ programStart: '2026-07-01' }));
  const now = new Date('2026-11-22T12:00:00.000Z');
  const stamp = now.toISOString();
  const source: LibraryBlock = {
    id: 'source', name: 'My mixed circuit', kind: 'self-paced', recommend: false, durationSec: 480,
    createdAt: stamp, updatedAt: stamp, stations: [
      { exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 8 }, load: 15 },
      { exerciseId: 'rower', target: { unit: 'cal', amount: 11 } },
    ],
  };
  await src.libraryBlocks.add(source);
  const ordered = { name: 'Synthetic circuit day', blocks: floored([
    ...starterWorkoutBlocks.slice(0, 3), libraryWorkoutBlock(source), starterWorkoutBlocks[4]!,
  ].map((block) => copyWorkoutBlock(block))) };
  const id = await saveOrderedWorkout(src, ordered, undefined, now);
  await src.libraryBlocks.update(source.id, { recommend: true, durationSec: 600, stations: [...source.stations].reverse() });
  const sid = await startMixedSession(src, { templateId: id }, now);
  const write = async (action: Parameters<typeof updateMixedSession>[3], ms: number) => {
    const current = (await src.sessions.get(sid))!.mixed!;
    return updateMixedSession(src, sid, current.cursor, action, new Date(now.getTime() + ms));
  };
  for (const block of ordered.blocks) {
    if (block.kind === 'strength') {
      const accepted = (await src.sessions.get(sid))!.mixed!.strength[block.id]!;
      for (let slot = 0; slot < accepted.sets; slot++) {
        await write({ type: 'set', expectedExerciseId: accepted.exerciseId, expectedEquipmentId: accepted.equipmentId, weight: 95, reps: 9 }, slot * 1000);
      }
    } else {
      await write({ type: 'start' }, 10_000);
      if (block.kind === 'self-paced') {
        await write({ type: 'swap-station', slotId: block.stations[0]!.slotId, exerciseId: 'step-up', expectedExerciseId: 'reverse-lunge' }, 12_000);
      }
      await write({ type: 'finish' }, 15_000);
    }
    await write({ type: 'continue' }, 20_000);
  }
  await src.libraryBlocks.delete(source.id);
  const backup = parseExport(JSON.stringify(await buildExport(src, undefined, 'v2'))).file;
  expect(backup.schemaVersion).toBe(2);
  const dst = open();
  await importExport(dst, parseExport(JSON.stringify({
    schemaVersion: 1, exportedAt: stamp, stores: {
      bodyLogs: [{ date: '2026-10-01', weightLb: 240, protein: false }],
      settings: [settings({ updatedAt: '2026-12-23T12:00:00.000Z' })],
      sessions: [session('local')],
      exerciseOverrides: [{ exerciseId: 'lat-pulldown', notAtMyGym: true }],
      templates: [{ id: 'legacy', name: 'Legacy', type: 'lift', source: 'saved', createdAt: stamp, blocks: [blocks[1]] }],
    },
  })).file);
  await importExport(dst, backup);
  expect(await dst.templates.get(id)).toEqual(await src.templates.get(id));
  expect((await dst.templates.get(id))?.ordered).toEqual(ordered);
  const restored = (await dst.sessions.get(sid))!;
  expect(JSON.parse(JSON.stringify(await src.sessions.get(sid)))).toEqual(restored);
  expect(restored.endedAt).toBeTruthy();
  expect(restored.mixed!.prescription).toEqual(ordered);
  expect(Object.keys(restored.mixed!.results)).toEqual(ordered.blocks.map((b) => b.id));
  const circuitId = ordered.blocks[3]!.id;
  expect(restored.mixed!.results[circuitId]).toMatchObject({
    // A guided circuit counts its own rounds: finished 5 s in, none were complete.
    rounds: 0, stations: [{ exerciseId: 'step-up', swappedFromExerciseId: 'reverse-lunge' }, { exerciseId: 'rower' }],
  });
  expect(await dst.sets.toArray()).toEqual(await src.sets.toArray());
  expect(await dst.libraryBlocks.count()).toBe(0);
  expect(await dst.templates.get('legacy')).toBeDefined();
  expect(await dst.sessions.get('local')).toBeDefined();
  expect(await dst.bodyLogs.get('2026-10-01')).toMatchObject({ weightLb: 240 });
  expect(await dst.exerciseOverrides.get('lat-pulldown')).toMatchObject({ notAtMyGym: true });
  expect(await dst.settings.get('settings')).toMatchObject({ updatedAt: '2026-12-23T12:00:00.000Z' });
  await dst.templates.delete(id);
  const later = new Date(now.getTime() + 60_000);
  const repeat = { sessionId: sid };
  const [attempt, retried] = await Promise.all([startMixedSession(dst, repeat, later), startMixedSession(dst, repeat, later)]);
  expect(attempt).toBe(retried);
  expect(attempt).not.toBe(sid);
  expect(await dst.sessions.get(attempt)).toMatchObject({ rpe: null, mixed: {
    prescription: ordered, cursor: { stage: 'entry', setSlot: 0, blockId: ordered.blocks[0]!.id }, timers: {}, results: {},
    drafts: { [circuitId]: { tapped: 0, rounds: null } },
    stations: { [circuitId]: [{ exerciseId: 'reverse-lunge' }, { exerciseId: 'rower' }] },
  } });
  expect(await dst.sets.where('sessionId').equals(attempt).count()).toBe(0);
});
