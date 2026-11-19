import { afterEach, describe, expect, it } from 'vitest';
import { openTestDb } from './test-utils';
import type { Block, Session, SetRow, Template } from './types';

const blocks: Block[] = [
  { id: 'b1', kind: 'interval', rounds: 3, phases: [{ role: 'work', sec: 40, label: 'Squat jumps' }, { role: 'rest', sec: 20, label: 'Rest' }], result: { completed: true, completedRounds: 3 } },
  { id: 'b2', kind: 'lift', exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 12, supersetGroup: 'ss1' },
  { id: 'b3', kind: 'swim', section: 'main', rounds: 2, items: [{ reps: 4, distance: 50, stroke: 'FR', swimKind: 'swim', equipment: [], mode: 'rest', seconds: 15, intensity: 'MOD' }] },
  { id: 'b4', kind: 'run', runKind: 'intervals', modality: 'treadmill', repeats: 4, segments: [{ role: 'sprint', sec: 30 }, { role: 'walk', sec: 90 }], format: 'sprint-walk' },
  { id: 'b5', kind: 'circuit', role: 'finisher', durationSec: 240, targetRounds: 3, podId: 'turf',
    stations: [{ exerciseId: 'sled-push', itemId: 'fixture-sled', target: { unit: 'm', amount: 20 } }] },
];

// Compile-time exhaustiveness: adding a Block variant without handling it here fails typecheck.
function describeBlock(b: Block): string {
  switch (b.kind) {
    case 'interval':
    case 'lift':
    case 'swim':
    case 'run':
    case 'circuit':
      return b.kind;
    default: {
      const never: never = b;
      return never;
    }
  }
}

const dbs: ReturnType<typeof openTestDb>[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

describe('Block union', () => {
  it('covers every kind exhaustively', () => {
    expect(blocks.map(describeBlock)).toEqual(['interval', 'lift', 'swim', 'run', 'circuit']);
  });
  it('round-trips through Dexie and JSON', async () => {
    const db = openTestDb();
    dbs.push(db);
    const template: Template = { id: 't1', name: 'Mixed', type: 'custom', blocks, source: 'built', createdAt: '2026-11-17T10:00:00.000Z' };
    const session: Session = { id: 's1', date: '2026-11-17T10:00:00.000Z', type: 'hybrid', blocks, hard: true, hardCardio: true, rpe: null, durationMin: 50, notes: '', variant: 'lower-a', flags: { calibration: true } };
    const set: SetRow = { id: 'x1', sessionId: 's1', exerciseId: 'leg-press', equipmentId: 'pin-stack', idx: 0, targetWeight: 100, targetReps: 8, weight: 100, reps: 8, painFlag: false, supersetGroup: 'ss1', setKind: 'calibration' };
    await db.templates.put(template);
    await db.sessions.put(session);
    await db.sets.put(set);

    expect(await db.templates.get('t1')).toEqual(template);
    expect(await db.sessions.get('s1')).toEqual(session);
    expect(await db.sets.get('x1')).toEqual(set);
    expect(JSON.parse(JSON.stringify(await db.sessions.get('s1')))).toEqual(session);
  });
});
