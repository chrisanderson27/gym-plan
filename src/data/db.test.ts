import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED_EQUIPMENT } from '../content/equipment';
import { V1_STORES } from './db';
import { V2_STORES, V3_STORES } from './schema';
import { STORE_NAMES } from './stores';
import { openTestDb } from './test-utils';

const dbs: ReturnType<typeof openTestDb>[] = [];
const fresh = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

describe('GymDb v3', () => {
  it('adds exactly two sync stores to V2_STORES', () => {
    expect(V3_STORES).toEqual({ ...V2_STORES, syncOutbox: '++seq, &[store+key]', syncMeta: 'id' });
  });

  it('upgrades v2 while preserving every user store', async () => {
    const db = fresh();
    const old = new Dexie(db.name);
    old.version(2).stores(V2_STORES);
    const date = '2026-11-10';
    const ts = `${date}T10:00:00.000Z`;
    const rows = {
      exerciseOverrides: { exerciseId: 'leg-press', notAtMyGym: true, preferredEquipmentId: 'pin-stack' },
      equipment: SEED_EQUIPMENT[0],
      sessions: { id: 's1', date: ts, type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 45, notes: 'n' },
      sets: { id: 'x1', sessionId: 's1', exerciseId: 'leg-press', equipmentId: 'pin-stack', idx: 0, targetWeight: 100, targetReps: 8, weight: 100, reps: 8, painFlag: false },
      runs: { sessionId: 's2', kind: 'easy', modality: 'bike', distanceMi: 3, durationSec: 1200, intervals: [], rpe: 5, painFlag: false },
      swims: { sessionId: 's3', poolLength: 25, poolUnit: 'yd', distance: 1000, sets: [], rpe: 6, shoulderPainFlag: false },
      tests: { id: 't1', kind: 'css', date: ts, poolUnit: 'yd', t400: 480, t200: 220 },
      bodyLogs: { date, weightLb: 245, waistIn: 40, protein: true },
      templates: { id: 'tp1', name: 'Mine', type: 'lift', blocks: [], source: 'saved', createdAt: ts },
      feedback: { id: 'f1', v: 1, ts, kind: 'app', tags: ['other'], text: 'hi', context: {} },
      settings: { id: 'settings', daysPerWeek: 5, weightUnit: 'lb', distanceUnit: 'mi', programStart: date, onboardedAt: ts, backupAt: null, updatedAt: ts },
      libraryBlocks: { id: 'b1', name: 'Block A', kind: 'self-paced', durationSec: 480, stations: [], recommend: true, createdAt: ts, updatedAt: ts },
    };
    try {
      for (const store of STORE_NAMES) await old.table(store).add(rows[store]);
    } finally {
      old.close();
    }
    await db.open();
    for (const store of STORE_NAMES) expect(await db.table(store).toArray(), store).toEqual([rows[store]]);
    expect(db.verno).toBe(3);
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
    expect(await db.equipment.count()).toBe(1);
  });

  it('enforces a unique outbox entry per store and key', async () => {
    const db = fresh();
    const entry = { store: 'sessions', key: 's1', op: 'put', clientUpdatedAt: '2026-11-10T10:00:00.000Z' } as const;
    await db.syncOutbox.add(entry);
    await expect(db.syncOutbox.add({ ...entry, op: 'delete' })).rejects.toHaveProperty('name', 'ConstraintError');
  });
});

describe('GymDb v1', () => {
  it('matches the frozen V1_STORES literal', () => {
    // Changing this means add version(2) with an upgrade and a migrateExport step. Never edit v1.
    expect(V1_STORES).toEqual({
      exerciseOverrides: 'exerciseId',
      equipment: 'id, kind',
      sessions: 'id, date, type, templateId',
      sets: 'id, sessionId, exerciseId, equipmentId, [exerciseId+equipmentId]',
      runs: 'sessionId, kind',
      swims: 'sessionId',
      tests: 'id, kind, date',
      bodyLogs: 'date',
      templates: 'id, type, source',
      feedback: 'id, ts, kind',
      settings: 'id',
    });
  });
  it('seeds equipment on creation', async () => {
    const db = fresh();
    expect(await db.equipment.count()).toBe(SEED_EQUIPMENT.length);
  });
  it('queries the compound [exerciseId+equipmentId] index', async () => {
    const db = fresh();
    const base = { sessionId: 's', idx: 0, targetWeight: 0, targetReps: 8, weight: 0, reps: 8, painFlag: false };
    await db.sets.bulkPut([
      { ...base, id: 'a', exerciseId: 'leg-press', equipmentId: 'pin-stack' },
      { ...base, id: 'b', exerciseId: 'leg-press', equipmentId: 'plate-loaded' },
    ]);
    const rows = await db.sets.where('[exerciseId+equipmentId]').equals(['leg-press', 'pin-stack']).toArray();
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });
});
