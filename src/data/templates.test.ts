import { afterEach, describe, expect, it } from 'vitest';
import type { GymDb } from './db';
import { setNotAtMyGym } from './lift';
import { chestBlock, NOW, seedSettings, session, topSets } from './p4-test-utils';
import { listMine, loadRunnable, saveAsMine, saveBuilt, startFromBlocks } from './templates';
import { openTestDb } from './test-utils';
import type { LiftBlock } from './types';

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
});
