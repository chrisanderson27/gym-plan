import { describe, expect, it } from 'vitest';
import type { CircuitBlock, RunRow, Session, SetRow } from '../../data/types';
import { weeklyBudget } from './budget';
import { concurrency } from './concurrency';
import { input, session } from './plan-test-utils';
import { weekRing } from './ring';
import { toPlanSession } from './classify';

const ex = new Map([
  ['leg-press', { primary: ['quads', 'glutes'] }],
  ['chest-press', { primary: ['chest'] }],
]);
const base: Session = { id: 's', date: '2026-03-10T10:00:00.000Z', type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 40, notes: '', endedAt: '2026-03-10T11:00:00.000Z' };
const set = (exerciseId: string, idx: number): SetRow => ({ id: `${exerciseId}${idx}`, sessionId: 's', exerciseId, equipmentId: 'e', idx, targetWeight: 1, targetReps: 8, weight: 1, reps: 8, painFlag: false });
const run = (o: Partial<RunRow>): RunRow => ({ sessionId: 's', kind: 'easy', distanceMi: 2, durationSec: 1200, intervals: [], rpe: 5, painFlag: false, ...o });

describe('toPlanSession', () => {
  it('treats a lower variant as lower with heavy legs', () => {
    const p = toPlanSession({ ...base, variant: 'lower-a' }, [], undefined, ex);
    expect(p.lower).toBe(true);
    expect(p.heavyLegs).toBe(true);
  });
  it('treats a custom session with 3 quad sets as lower', () => {
    const p = toPlanSession({ ...base, type: 'custom' }, [set('leg-press', 0), set('leg-press', 1), set('leg-press', 2)], undefined, ex);
    expect(p.lower).toBe(true);
    expect(p.lifted).toBe(true);
    expect(toPlanSession({ ...base, type: 'custom' }, [set('leg-press', 0), set('chest-press', 1)], undefined, ex).lower).toBe(false);
  });
  it('a deload lower is not heavy legs', () => {
    const p = toPlanSession({ ...base, variant: 'lower-a', flags: { deload: true } }, [], undefined, ex);
    expect(p.lower).toBe(true);
    expect(p.heavyLegs).toBe(false);
  });
  it('a hybrid with bike intervals is not a hard run but keeps hardCardio', () => {
    const p = toPlanSession({ ...base, type: 'hybrid', variant: 'lower-a', hard: true, hardCardio: true }, [], run({ kind: 'intervals', modality: 'bike' }), ex);
    expect(p.hardRun).toBe(false);
    expect(p.hardCardio).toBe(true);
  });
  it('an easy run at RPE 8 is a hard run', () => {
    expect(toPlanSession({ ...base, type: 'run' }, [], run({ rpe: 8 }), ex).hardRun).toBe(true);
    expect(toPlanSession({ ...base, type: 'run' }, [], run({ rpe: 5 }), ex).hardRun).toBe(false);
  });
  it('counts a completed calibration set towards both lift goals', () => {
    const calibration = { ...set('leg-press', 0), setKind: 'calibration' as const };
    const p = toPlanSession(base, [calibration], undefined, ex);
    expect(p.lifted).toBe(true);
    expect(toPlanSession(base, [{ ...calibration, reps: 0 }], undefined, ex).lifted).toBe(false);
    expect(weeklyBudget(input([p])).lines.find((line) => line.id === 'lifts')?.done).toBe(1);
    expect(weekRing([p], { from: '2026-03-09', to: '2026-03-15' }, ['lift']).done).toBe(1);
  });
  it('counts logged loaded circuits as lift work and excludes Burn and unlogged circuits', () => {
    const circuit: CircuitBlock = {
      id: 'c', kind: 'circuit', role: 'block', durationSec: 480, targetRounds: 4, podId: 'turf',
      stations: [{ exerciseId: 'leg-press', load: 20, target: { unit: 'reps', amount: 10 } }],
      log: { completedRounds: 2, actualDurationSec: 480, stations: [{ exerciseId: 'leg-press', actualLoad: 20 }] },
    };
    expect(toPlanSession({ ...base, blocks: [circuit] }, [], undefined, ex).lifted).toBe(true);
    expect(toPlanSession({ ...base, type: 'burn', hardCardio: true, blocks: [circuit] }, [], undefined, ex))
      .toMatchObject({ lifted: false, hardCardio: true });
    expect(toPlanSession({ ...base, blocks: [{ ...circuit, log: undefined }] }, [], undefined, ex).lifted).toBe(false);
  });
  it('an open session ends at its start and is unfinished', () => {
    const { endedAt: _e, ...open } = base;
    void _e;
    const p = toPlanSession(open, [], undefined, ex);
    expect(p.finished).toBe(false);
    expect(p.end).toBe(open.date);
  });
  it('only a finished Burn uses a hard slot and triggers hard spacing', () => {
    const recent = session(2);
    const burn: Session = { ...base, type: 'burn', date: recent.start, hard: true, hardCardio: true };
    const candidate = { id: 'burn', hard: true, hardCardio: true, hardRun: false, lower: false, longRun: false } as const;
    const open = input([toPlanSession({ ...burn, endedAt: undefined }, [], undefined, ex)]);
    const done = input([toPlanSession({ ...burn, endedAt: recent.end }, [], undefined, ex)]);

    expect(weeklyBudget(open).lines.find((line) => line.id === 'hard')?.done).toBe(0);
    expect(concurrency(candidate, open, weeklyBudget(open))).toEqual([]);
    expect(weeklyBudget(done).lines.find((line) => line.id === 'hard')?.done).toBe(1);
    expect(concurrency(candidate, done, weeklyBudget(done))).toMatchObject([{ status: 'blocked' }]);
  });
});
