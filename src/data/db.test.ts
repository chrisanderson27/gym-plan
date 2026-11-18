import { afterEach, describe, expect, it } from 'vitest';
import { SEED_EQUIPMENT } from '../content/equipment';
import { V1_STORES } from './db';
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
