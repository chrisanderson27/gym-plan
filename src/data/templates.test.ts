import { afterEach, describe, expect, it } from 'vitest';
import { moveBlock } from '../engine/templates';
import type { GymDb } from './db';
import { loadLiftSnapshot, prescribeExercise, setNotAtMyGym } from './lift';
import { chestBlock, NOW, seedSettings, session, topSets } from './p4-test-utils';
import { listMine, loadRunnable, saveAsMine, saveBuilt, saveOrderedWorkout, startFromBlocks } from './templates';
import { openTestDb } from './test-utils';
import { copyWorkoutBlock, starterWorkoutBlocks } from './workoutChoices';
import type { LiftBlock, OrderedPrescription } from './types';

const dbs: GymDb[] = [];
const open = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

describe('templates', () => {
  it('save-as-mine of a burn strips results', async () => {
    const db = open();
    await db.sessions.put(session('b1', 5, {
      type: 'burn', templateId: 'burn-tread-floor', hard: true, hardCardio: true,
      blocks: [{ id: 'x', kind: 'interval', rounds: 2, phases: [{ role: 'work', sec: 30, label: 'w' }], result: { completed: true, actualSec: 60 } }],
    }));
    const id = await saveAsMine(db, 'b1');
    const t = (await db.templates.get(id))!;
    expect(t).toMatchObject({ type: 'burn', source: 'saved' });
    expect(t.blocks[0]).not.toHaveProperty('result');
    expect(t.blocks[0]!.id).not.toBe('x');
    expect((await listMine(db, ['burn'])).map((x) => x.id)).toEqual([id]);
    expect(await listMine(db, ['swim'])).toEqual([]);
  });

  it('startFromBlocks re-prescribes from history instead of copying the old weight', async () => {
    const db = open();
    await seedSettings(db);
    await db.sessions.put(session('l1', 30, { variant: 'upper-a', blocks: [chestBlock()] }));
    await db.sets.bulkPut(topSets('l1', 30));
    const r = (await loadRunnable(db, { sessionId: 'l1' }))!;
    const id = await startFromBlocks(db, r, NOW);
    const s = (await db.sessions.get(id))!;
    const b = s.blocks[0] as LiftBlock;
    expect(s.variant).toBe('upper-a');
    expect(b.sets).toBe(3);
    expect(b.targetWeight).toBeGreaterThan(100);
  });

  it('substitutes an exercise that is not at my gym', async () => {
    const db = open();
    await seedSettings(db);
    await setNotAtMyGym(db, 'chest-press-machine', true);
    const id = await startFromBlocks(db, { type: 'custom', name: 'x', blocks: [chestBlock()] }, NOW);
    const b = (await db.sessions.get(id))!.blocks[0] as LiftBlock;
    expect(b.exerciseId).not.toBe('chest-press-machine');
  });

  it('a built superset pair keeps its shared group on the new session', async () => {
    const db = open();
    await seedSettings(db);
    const tid = await saveBuilt(db, {
      name: 'Arms', blocks: [chestBlock({ id: 'a', supersetGroup: 'g1' }), chestBlock({ id: 'b', exerciseId: 'lat-pulldown', equipmentId: 'pin-stack', supersetGroup: 'g1' })],
    }, NOW);
    const r = (await loadRunnable(db, { templateId: tid }))!;
    const id = await startFromBlocks(db, r, NOW);
    const s = (await db.sessions.get(id))!;
    expect(s).toMatchObject({ type: 'custom', templateId: tid });
    const groups = (s.blocks as LiftBlock[]).map((b) => b.supersetGroup);
    expect(groups[0]).toBeDefined();
    expect(groups[0]).toBe(groups[1]);
    expect((await db.templates.get(tid))!.source).toBe('built');
  });

  it('save-as-mine keeps the variant and loading a Mine template restores it', async () => {
    const db = open();
    await db.sessions.put(session('h1', 5, { type: 'hybrid', variant: 'lower-a', blocks: [chestBlock()] }));
    const id = await saveAsMine(db, 'h1');
    expect((await db.templates.get(id))!.variant).toBe('lower-a');
    expect((await loadRunnable(db, { templateId: id }))!.variant).toBe('lower-a');
  });

  it('a builder rep ceiling controls the prescription', async () => {
    const db = open();
    await seedSettings(db);
    await db.sessions.put(session('l1', 30, { variant: 'upper-a', blocks: [chestBlock()] }));
    await db.sets.bulkPut(topSets('l1', 30));
    const snap = await loadLiftSnapshot(db, NOW);
    const flags = { deload: false, rampIn: false };
    const base = prescribeExercise(snap, 'chest-press-machine', 'pin-stack', flags)!;
    const custom = prescribeExercise(snap, 'chest-press-machine', 'pin-stack', flags, { repMin: 8, repMax: 20 })!;
    expect(base.mode).toBe('progress');
    expect(custom.mode).not.toBe('progress');
    expect(custom.weight).toBe(100);
  });
});

it('ordered saves keep the exact prescription, stable edit identity and legacy lift-only projection', async () => {
  const db = open();
  const initial = { name: '  Mixed plan  ', blocks: starterWorkoutBlocks.map((block) => copyWorkoutBlock(block)) };
  const id = await saveOrderedWorkout(db, initial, undefined, NOW);
  const baseline = (await loadRunnable(db, { templateId: id }))!.ordered!;
  expect(baseline).toEqual({ ...initial, name: 'Mixed plan' });
  const blocks = moveBlock(baseline.blocks, baseline.blocks[2]!.id, -1);
  const edited = { name: 'Mixed plan edited', blocks };
  expect(await saveOrderedWorkout(db, edited, { id, baseline }, new Date())).toBe(id);
  const saved = (await db.templates.get(id))!;
  expect(saved).toEqual({
    id, name: edited.name, type: 'custom', source: 'saved', createdAt: NOW.toISOString(), ordered: edited,
    blocks: [{ ...edited.blocks[2], kind: 'lift' }],
  });
  expect(await db.templates.count()).toBe(1);
  await expect(saveBuilt(db, { id, name: 'Wrong editor', blocks: [chestBlock()] })).rejects.toThrow('cannot be edited');
  expect(await db.templates.get(id)).toEqual(saved);
});

it('rejects stale concurrent, malformed and missing-row edits without writing over valid data', async () => {
  const db = open();
  const baseline = { name: 'Base', blocks: [starterWorkoutBlocks[0]!] };
  const id = await saveOrderedWorkout(db, baseline);
  const results = await Promise.allSettled(['First', 'Second'].map((name) =>
    saveOrderedWorkout(db, { ...baseline, name }, { id, baseline })));
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const winner = (await db.templates.get(id))!;
  const invalid: OrderedPrescription[] = [
    { ...baseline, name: ' ' }, { ...baseline, blocks: [] },
    { ...baseline, blocks: Array.from({ length: 31 }, (_, i) => ({ ...baseline.blocks[0]!, id: String(i) })) },
    { ...baseline, blocks: [baseline.blocks[0]!, baseline.blocks[0]!] },
    { ...baseline, blocks: [{ id: 'bad', kind: 'coached', name: 'Old rotation', durationSec: 120 }] },
    { ...baseline, blocks: [{ id: 'bad', kind: 'strength', exerciseId: 'leg-press', sets: 31, repMin: 12, repMax: 8 }] },
  ];
  for (const draft of invalid) {
    await expect(saveOrderedWorkout(db, draft, { id, baseline: winner.ordered! })).rejects.toThrow('valid blocks');
    expect(await db.templates.get(id)).toEqual(winner);
  }
  await db.templates.delete(id);
  await expect(saveOrderedWorkout(db, baseline, { id, baseline: winner.ordered! })).rejects.toThrow('changed or was removed');
  expect(await db.templates.count()).toBe(0);
});
