import { afterEach, describe, expect, it } from 'vitest';
import { exerciseById } from '../content';
import { buildExport, importExport } from './backup';
import type { GymDb } from './db';
import {
  blockPrescriptionPatch,
  changeBlockEquipment,
  swapBlockExercise,
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
import type { LiftBlock, SetRow } from './types';
import { painSwapOffer } from '../engine/lift/pain';
import { summarizeLiftSession } from '../engine/lift/session';

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

describe('blockPrescriptionPatch', () => {
  it('starts an uncalibrated pair at its calibration start, not the previous weight', async () => {
    const d = open();
    const snapshot = await loadLiftSnapshot(d);
    const db1 = [...snapshot.equipment.values()].find((e) => e.kind === 'db');
    if (!db1) return;
    const ex = [...exerciseById.values()].find((e) => e.equipment.includes('db'));
    if (!ex) return;
    const patch = blockPrescriptionPatch(snapshot, ex.id, db1.id, { deload: false, rampIn: false });
    expect(patch.label).toBe('Calibration');
    expect(patch.sets).toBe(1);
    expect(patch.targetWeight).not.toBe(100);
  });
});

describe('review fixes (cycle 2)', () => {
  const started = async () => {
    const db = open();
    await seedSettings(db);
    const plan = buildLiftPlan(await loadLiftSnapshot(db, NOW), 'upper-a', 60);
    const id = await startLiftSession(db, plan, NOW);
    const blocks = (await db.sessions.get(id))!.blocks.filter((b): b is LiftBlock => b.kind === 'lift' && !b.warmup);
    return { db, id, blocks };
  };

  it('R1: zero-rep working failures on three exercises trigger fatigue', () => {
    const blocks = ['a', 'b', 'c'].map((e) => ({ kind: 'lift', id: e, exerciseId: e, sets: 3, repMin: 8, repMax: 12 }) as unknown as LiftBlock);
    const sets = ['a', 'b', 'c'].map((e) => setRow('s', e, 'q', 0, { reps: 0, targetReps: 10 }));
    expect(summarizeLiftSession(blocks, sets)).toEqual({ missedExercises: ['a', 'b', 'c'], fatigue: true });
    const cal = sets.map((r) => ({ ...r, setKind: 'calibration' as const }));
    expect(summarizeLiftSession(blocks, cal).fatigue).toBe(false);
  });

  it('R2: swapping to a fresh machine exercise rebuilds sets/RIR for the new instance', async () => {
    const { db, id, blocks } = await started();
    const used = new Set(blocks.map((b) => b.exerciseId));
    const fresh = [...exerciseById.values()].find((e) => !e.retired && !used.has(e.id) && e.prescription.unit === 'reps' && e.group !== 'conditioning' && e.equipment[0] === 'machine')!;
    const target = blocks[0]!;
    await db.sessions.update(id, { blocks: (await db.sessions.get(id))!.blocks.map((b) => (b.kind === 'lift' && b.id === target.id ? { ...b, sets: 4, rirTarget: 3 } : b)) });
    const before = (await db.equipment.toArray()).length;
    await swapBlockExercise(db, id, target.id, fresh.id);
    const swapped = (await db.sessions.get(id))!.blocks.find((b): b is LiftBlock => b.kind === 'lift' && b.id === target.id)!;
    expect((await db.equipment.toArray()).length).toBe(before + 1);
    expect(swapped.exerciseId).toBe(fresh.id);
    expect(swapped.label).toBe('Calibration');
    expect(swapped.sets).toBe(1);
  });

  it('R5: re-selecting the current equipment keeps a ceiling-trimmed set count', async () => {
    const { db, id, blocks } = await started();
    const b = blocks.find((x) => x.equipmentId)!;
    await db.sessions.update(id, { blocks: (await db.sessions.get(id))!.blocks.map((x) => (x.kind === 'lift' && x.id === b.id ? { ...x, sets: 1 } : x)) });
    await changeBlockEquipment(db, id, b.id, b.equipmentId!);
    const after = (await db.sessions.get(id))!.blocks.find((x): x is LiftBlock => x.kind === 'lift' && x.id === b.id)!;
    expect(after.sets).toBe(1);
  });

  it('R1: an equipment-only change keeps the block custom rep range', async () => {
    const { db, id, blocks } = await started();
    const b = blocks.find((x) => x.equipmentId)!;
    await db.sessions.update(id, {
      blocks: (await db.sessions.get(id))!.blocks.map((x) => (x.kind === 'lift' && x.id === b.id ? { ...x, repMin: 8, repMax: 20 } : x)),
    });
    const other: import('./types').Equipment = { id: newId(), name: 'Other', kind: 'db', steps: [5] };
    await db.equipment.put(other);
    await changeBlockEquipment(db, id, b.id, other.id);
    const after = (await db.sessions.get(id))!.blocks.find((x): x is LiftBlock => x.kind === 'lift' && x.id === b.id)!;
    expect(after.equipmentId).toBe(other.id);
    expect([after.repMin, after.repMax]).toEqual([8, 20]);
  });

  it('R5: a changed pair never exceeds the planned (trimmed) set count', async () => {
    const d = open();
    const snapshot = await loadLiftSnapshot(d);
    const eq = [...snapshot.equipment.values()].find((e) => e.kind === 'db')!;
    const ex = [...exerciseById.values()].find((e) => e.equipment.includes('db'))!;
    const cur = { sets: 0 } as LiftBlock;
    expect(blockPrescriptionPatch(snapshot, ex.id, eq.id, { deload: false, rampIn: false }, cur).sets).toBe(0);
  });

  it('R3: RIR on equipment B leaves equipment A rows untouched', async () => {
    const d = open();
    const sid = newId();
    await logSet(d, setRow(sid, 'x', 'A', 0, { rir: 3 }));
    await logSet(d, setRow(sid, 'x', 'A', 1));
    await logSet(d, setRow(sid, 'x', 'B', 0));
    await setLastSetRir(d, sid, 'x', 1, 'B');
    const rows = await d.sets.where('sessionId').equals(sid).toArray();
    const rir = (eq: string, idx: number) => rows.find((r) => r.equipmentId === eq && r.idx === idx)?.rir;
    expect(rir('B', 0)).toBe(1);
    expect(rir('A', 0)).toBe(3);
    expect(rir('A', 1)).toBeUndefined();
  });

  it('R4: two flagged calibration sets raise the pain-swap offer', () => {
    const sets = [0, 1].map((i) => setRow('s', 'x', 'A', i, { setKind: 'calibration', painFlag: true }));
    expect(painSwapOffer('x', [], sets, NOW.toISOString())).toBe(true);
  });
});
