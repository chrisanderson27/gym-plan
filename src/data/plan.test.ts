import { afterEach, describe, expect, it } from 'vitest';
import type { GymDb } from './db';
import { localDate } from '../engine/dates';
import { loadPlanInput, loadRingInput } from './plan';
import { NOW, seedSettings, session, topSets } from './p4-test-utils';
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

describe('loadPlanInput', () => {
  it('maps a lower hybrid with a bike row to lower, not a hard run', async () => {
    const db = open();
    await seedSettings(db);
    await db.sessions.put(session('h1', 20, { type: 'hybrid', variant: 'lower-a', hard: true, hardCardio: true }));
    await db.runs.put({ sessionId: 'h1', kind: 'intervals', modality: 'bike', distanceMi: 0, durationSec: 1200, intervals: [], rpe: 8, painFlag: false });
    const input = await loadPlanInput(db, NOW);
    expect(input.sessions).toHaveLength(1);
    expect(input.sessions[0]).toMatchObject({ lower: true, hardRun: false, hardCardio: true, type: 'hybrid' });
  });
  it('excludes sessions older than the window and reports lift history', async () => {
    const db = open();
    await seedSettings(db);
    await db.sessions.put(session('old', 24 * 20, { variant: 'upper-a' }));
    await db.sessions.put(session('new', 24, { variant: 'upper-a' }));
    await db.sets.bulkPut(topSets('new', 24));
    const input = await loadPlanInput(db, NOW);
    expect(input.sessions.map((s) => s.id)).toEqual(['new']);
    expect(input.hasLiftHistory).toBe(true);
    expect(input.lift.upper.variant).toBe('upper-b');
    expect(input.lift.lower.variant).toBe('lower-a');
  });
});

it('loads program history beyond the pick window and reports only finished sessions for today', async () => {
  const db = open();
  const now = new Date(2026, 10, 12, 16);
  const today = localDate(now);
  await seedSettings(db, { activities: ['lift'] });
  const date = new Date(2026, 10, 12, 10).toISOString();
  const openToday = { ...session('active', 0), date };
  delete openToday.endedAt;
  await db.sessions.bulkPut([session('past', 24 * 20), openToday]);
  expect(await loadRingInput(db, now)).toMatchObject({
    programStart: '2026-10-12', today, activities: ['lift'], done: undefined,
    sessions: [{ id: 'past', finished: true }, { id: 'active', finished: false }],
  });
  await db.sessions.update('active', { endedAt: now.toISOString() });
  expect((await loadRingInput(db, now)).done).toMatchObject({ id: 'active', durationMin: 45 });
});
