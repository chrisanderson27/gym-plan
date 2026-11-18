import { afterEach, describe, expect, it } from 'vitest';
import type { GymDb } from './db';
import { listHistory, loadSessionDetail } from './history';
import { session, topSets } from './p4-test-utils';
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

describe('history', () => {
  it('pages 120 sessions as 50/50/20, newest first', async () => {
    const db = open();
    await db.sessions.bulkPut(Array.from({ length: 120 }, (_, i) => session('s' + String(i).padStart(3, '0'), i + 1)));
    const [a, b, c] = [await listHistory(db, 0), await listHistory(db, 1), await listHistory(db, 2)];
    expect([a.length, b.length, c.length]).toEqual([50, 50, 20]);
    expect(a[0]!.session.id).toBe('s000');
    expect(a[0]!.session.date > a[1]!.session.date).toBe(true);
  });
  it('summarises and joins sets, run and swim rows', async () => {
    const db = open();
    await db.sessions.put(session('h', 5, { type: 'hybrid', variant: 'lower-a', rpe: 6 }));
    await db.runs.put({ sessionId: 'h', kind: 'easy', modality: 'bike', distanceMi: 0, durationSec: 1200, intervals: [], rpe: 6, painFlag: false });
    await db.sets.bulkPut(topSets('h', 5));
    const [item] = await listHistory(db);
    expect(item!.summary).toContain('Hybrid · Lower A');
    expect(item!.summary).toContain('bike 20 min');
    const d = (await loadSessionDetail(db, 'h'))!;
    expect(d.sets).toHaveLength(3);
    expect(d.run?.modality).toBe('bike');
    expect(await loadSessionDetail(db, 'nope')).toBeNull();
  });
});
