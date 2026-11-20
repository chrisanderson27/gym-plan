import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GymDb } from './db';
import { cardNumbers, listHistory, loadSessionDetail, loadSessionPRs } from './history';
import { session, topSets } from './p4-test-utils';
import { openTestDb } from './test-utils';
import type { CircuitBlock, RunRow, SwimRow } from './types';

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
    expect(item!.title).toBe('Hybrid · Lower A');
    expect(item!.summary).toContain('Hybrid · Lower A');
    expect(item!.summary).toContain('Bike 20 min');
    const d = (await loadSessionDetail(db, 'h'))!;
    expect(d.sets).toHaveLength(3);
    expect(d.run?.modality).toBe('bike');
    expect(await loadSessionDetail(db, 'nope')).toBeNull();
  });
  it('pages with a custom size and includes sessions outside the page in PR comparisons', async () => {
    const db = open();
    await db.sessions.bulkPut([session('newest', 1), session('newer', 2), session('older', 6)]);
    await db.sets.bulkPut([
      ...topSets('older', 6).map((s) => ({ ...s, weight: 100, reps: 10 })),
      ...topSets('newer', 2).map((s) => ({ ...s, weight: 110, reps: 10 })),
      ...topSets('newest', 1).map((s) => ({ ...s, weight: 120, reps: 10 })),
    ]);
    const page = await listHistory(db, 1, 1);
    expect(page.map((row) => row.session.id)).toEqual(['newer']);
    expect(page[0]!.prs).toMatchObject([{ kind: 'weight-at-reps', weight: 110, prev: 100 }]);
    expect(await loadSessionPRs(db, 'newer')).toEqual(page[0]!.prs);
    expect((await listHistory(db, 2, 1))[0]!.prs).toEqual([]);
    expect(await loadSessionPRs(db, 'older')).toEqual([]);
    expect(await loadSessionPRs(db, 'missing')).toEqual([]);
    expect(await listHistory(db, 3, 1)).toEqual([]);
  });
  it('does not compare sets from the same session or timestamp', async () => {
    const db = open();
    await db.sessions.bulkPut([session('a', 3), session('b', 3)]);
    await db.sets.bulkPut([
      ...topSets('a', 3).map((s, i) => ({ ...s, weight: 100 + 10 * i, reps: 10 })),
      ...topSets('b', 3).map((s) => ({ ...s, weight: 90, reps: 10 })),
    ]);
    expect((await listHistory(db)).every(({ prs }) => prs.length === 0)).toBe(true);
    expect(await loadSessionPRs(db, 'a')).toEqual([]);
  });
  it('only reads sets and sessions relevant to the current page and its PRs', async () => {
    const db = open();
    const unrelated = Array.from({ length: 20 }, (_, i) => session(`other-${i}`, i + 4));
    await db.sessions.bulkPut([session('current', 1), session('prior', 2), ...unrelated]);
    await db.sets.bulkPut([
      ...topSets('current', 1).map((s) => ({ ...s, weight: 110 })),
      ...topSets('prior', 2),
      ...unrelated.flatMap((s, i) => topSets(s.id, i + 4).map((set) => ({ ...set, equipmentId: 'other' }))),
    ]);
    const readSession = vi.fn((row: { id: string }) => row);
    const readSet = vi.fn((row: { sessionId: string }) => row);
    db.sessions.hook('reading', readSession);
    db.sets.hook('reading', readSet);

    const [item] = await listHistory(db, 0, 1);

    expect(item!.prs).toMatchObject([{ kind: 'weight-at-reps', weight: 110, prev: 100 }]);
    expect(readSession.mock.calls.map(([row]) => row.id).sort()).toEqual(['current', 'prior']);
    expect(readSet.mock.calls.map(([row]) => row.sessionId).sort()).toEqual([
      'current', 'current', 'current', 'prior', 'prior', 'prior',
    ]);
  });
  it('finds prior matching circuits across session types without reading their sets', async () => {
    const db = open();
    const circuit = (completedRounds: number, exerciseId = 'rower'): CircuitBlock => ({
      id: 'circuit', kind: 'circuit', role: 'block', podId: 'turf', durationSec: 480, targetRounds: 5,
      stations: [{ exerciseId, target: { unit: 'cal', amount: 10 } }],
      log: { completedRounds, actualDurationSec: 480, stations: [{ exerciseId }] },
    });
    await db.sessions.bulkPut([
      session('current', 2, { blocks: [circuit(3)] }),
      session('prior', 3, { type: 'burn', blocks: [circuit(2)] }),
      session('future', 1, { blocks: [circuit(4)] }),
      session('other', 4, { blocks: [circuit(4, 'air-bike')] }),
    ]);
    await db.sets.bulkPut(topSets('prior', 3));
    const readSet = vi.fn((row: { sessionId: string }) => row);
    db.sets.hook('reading', readSet);

    const [item] = await listHistory(db, 1, 1);
    expect(item!.prs).toEqual([{ kind: 'block-work', blockId: 'circuit', total: 3, prev: 2 }]);
    expect(await loadSessionPRs(db, 'current')).toEqual(item!.prs);
    expect(readSet).not.toHaveBeenCalled();
  });
  it('shows minutes, working sets and circuit rounds before cardio distance', () => {
    const circuit: CircuitBlock = {
      id: 'circuit', kind: 'circuit', role: 'block', podId: 'turf', durationSec: 480, targetRounds: 5,
      stations: [{ exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 10 } }],
      log: { completedRounds: 3, actualDurationSec: 480, stations: [{ exerciseId: 'goblet-squat' }] },
    };
    const [working, warmup] = topSets('s', 3);
    const sets = [{ ...working!, setKind: 'working' as const }, { ...warmup!, setKind: 'warmup' as const }];
    const lift = session('s', 3, { durationMin: 30, blocks: [] });
    const run: RunRow = { sessionId: 's', kind: 'easy', distanceMi: 3, durationSec: 1800, intervals: [], rpe: 5, painFlag: false };
    expect(cardNumbers(lift, sets)).toEqual([{ value: '30', label: 'min' }, { value: '1', label: 'sets' }]);
    expect(cardNumbers({ ...lift, blocks: [circuit, { ...circuit, id: 'b2' }] }, sets, run)).toEqual([
      { value: '30', label: 'min' }, { value: '1', label: 'sets' }, { value: '6', label: 'rounds' },
    ]);
    expect(cardNumbers({ ...lift, type: 'run', durationMin: 0 }, [], run)).toEqual([
      { value: '30', label: 'min' }, { value: '3', label: 'mi' },
    ]);
  });
  it('shows swim distance in the logged pool unit', async () => {
    const db = open();
    const swim = session('s', 3, { type: 'swim', durationMin: 0 });
    const row: SwimRow = { sessionId: swim.id, distance: 600, poolUnit: 'm', poolLength: 25, sets: [], rpe: 5, shoulderPainFlag: false };
    expect(cardNumbers(swim, [], undefined, row)).toEqual([{ value: '600', label: 'm' }]);
    expect(cardNumbers(swim, [])).toEqual([]);
    await db.sessions.put(swim);
    await db.swims.put(row);
    const [item] = await listHistory(db);
    expect(item?.title).toBe('Swim');
    expect(item?.numbers).toEqual(cardNumbers(swim, [], undefined, row));
  });
});
