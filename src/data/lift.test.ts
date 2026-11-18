import { afterEach, describe, expect, it } from 'vitest';
import { exerciseById } from '../content';
import { buildExport, importExport } from './backup';
import type { GymDb } from './db';
import {
  buildLiftPlan,
  ensureEquipmentInstance,
  finishLiftSession,
  findOpenLiftSession,
  loadLiftSnapshot,
  logSet,
  resolveEquipmentId,
  setLastSetRir,
  setNotAtMyGym,
  startLiftSession,
  updateEquipmentSteps,
} from './lift';
import { newId } from './ids';
import { openTestDb } from './test-utils';
import type { SetRow } from './types';

const dbs: GymDb[] = [];
const open = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

const NOW = new Date('2026-03-10T12:00:00Z');
const seedSettings = (db: GymDb, programStart = '2026-01-01') =>
  db.settings.put({
    id: 'settings', goalWeightLb: 220, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
    programStart, onboardedAt: NOW.toISOString(), backupAt: null, updatedAt: NOW.toISOString(),
  });

const setRow = (sessionId: string, exerciseId: string, equipmentId: string, idx: number, o: Partial<SetRow> = {}): SetRow => ({
  id: newId(), sessionId, exerciseId, equipmentId, idx, targetWeight: 100, targetReps: 12, weight: 100, reps: 12, painFlag: false, ts: NOW.toISOString(), setKind: 'working', ...o,
});

describe('lift data layer', () => {
  it('start → log → rir → finish records flags, hard and endedAt', async () => {
    const db = open();
    await seedSettings(db);
    const plan = buildLiftPlan(await loadLiftSnapshot(db, NOW), 'upper-a', 60);
    const id = await startLiftSession(db, plan, NOW);
    const block = plan.blocks.find((b) => !b.warmup)!;
    for (let i = 0; i < 3; i++) await logSet(db, setRow(id, block.exerciseId, block.equipmentId!, i, { reps: 5, targetReps: 10 }));
    await setLastSetRir(db, id, block.exerciseId, 1);
    const rows = await db.sets.where('sessionId').equals(id).sortBy('idx');
    expect(rows.map((r) => r.rir)).toEqual([undefined, undefined, 1]);

    expect((await findOpenLiftSession(db, NOW))?.id).toBe(id);
    await finishLiftSession(db, id, null, new Date(NOW.getTime() + 45 * 60_000));
    const s = (await db.sessions.get(id))!;
    expect(s).toMatchObject({ hard: false, hardCardio: false, rpe: null, durationMin: 45, variant: 'upper-a' });
    expect(s.endedAt).toBeDefined();
    expect(await findOpenLiftSession(db, NOW)).toBeUndefined();
  });

  it('a hard RPE tap marks the session hard', async () => {
    const db = open();
    await seedSettings(db);
    const id = await startLiftSession(db, buildLiftPlan(await loadLiftSnapshot(db, NOW), 'lower-a', 60), NOW);
    await finishLiftSession(db, id, 9, NOW);
    expect((await db.sessions.get(id))?.hard).toBe(true);
  });

  it('resolves equipment from history before creating an instance', async () => {
    const db = open();
    await seedSettings(db);
    const sid = newId();
    await db.sessions.put({ id: sid, date: '2026-03-06T10:00:00.000Z', type: 'lift', variant: 'upper-a', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '', endedAt: '2026-03-06T11:00:00.000Z' });
    await db.sets.put(setRow(sid, 'chest-press-machine', 'pin-stack', 0));
    const snap = await loadLiftSnapshot(db, NOW);
    expect(resolveEquipmentId(snap, exerciseById.get('chest-press-machine')!, 8)).toBe('pin-stack');
    expect(await ensureEquipmentInstance(db, exerciseById.get('chest-press-machine')!, 'pin-stack')).toBe('pin-stack');
    expect((await db.equipment.toArray()).filter((e) => !e.builtin)).toHaveLength(0);
  });

  it('creates a per-machine instance once for a fresh machine exercise', async () => {
    const db = open();
    await seedSettings(db);
    const plan = buildLiftPlan(await loadLiftSnapshot(db, NOW), 'upper-a', 60);
    const id = await startLiftSession(db, plan, NOW);
    const s = (await db.sessions.get(id))!;
    const ids = s.blocks.filter((b) => b.kind === 'lift' && !b.warmup && b.exerciseId === 'chest-press-machine').map((b) => b.kind === 'lift' && b.equipmentId);
    const inst = (await db.equipment.toArray()).filter((e) => !e.builtin);
    expect(inst.length).toBeGreaterThan(0);
    expect(inst.find((e) => e.name === 'Chest press machine — Pin-stack machine')?.id).toBe(ids[0]);
    expect((await db.exerciseOverrides.get('chest-press-machine'))?.preferredEquipmentId).toBe(ids[0]);
  });

  it('only loads history inside the 120-day window', async () => {
    const db = open();
    await seedSettings(db);
    const old = newId();
    await db.sessions.put({ id: old, date: '2025-10-01T10:00:00.000Z', type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '' });
    expect((await loadLiftSnapshot(db, NOW)).history).toHaveLength(0);
  });

  it('notAtMyGym keeps the preferred equipment; steps are sorted and validated', async () => {
    const db = open();
    await db.exerciseOverrides.put({ exerciseId: 'leg-press', notAtMyGym: false, preferredEquipmentId: 'plate-loaded' });
    await setNotAtMyGym(db, 'leg-press', true);
    expect(await db.exerciseOverrides.get('leg-press')).toEqual({ exerciseId: 'leg-press', notAtMyGym: true, preferredEquipmentId: 'plate-loaded' });
    await updateEquipmentSteps(db, 'pin-stack', [30, 10, 20, 20]);
    expect((await db.equipment.get('pin-stack'))?.steps).toEqual([10, 20, 30]);
    await expect(updateEquipmentSteps(db, 'pin-stack', [])).rejects.toThrow();
  });

  it('a lift session round-trips through export/import', async () => {
    const db = open();
    await seedSettings(db);
    const id = await startLiftSession(db, buildLiftPlan(await loadLiftSnapshot(db, NOW), 'upper-a', 60), NOW);
    await logSet(db, setRow(id, 'chest-press-machine', 'pin-stack', 0));
    const file = await buildExport(db, NOW, 'test');
    const db2 = open();
    await importExport(db2, file);
    expect(await db2.sessions.get(id)).toEqual(await db.sessions.get(id));
    expect(await db2.sets.count()).toBe(1);
  });
});
