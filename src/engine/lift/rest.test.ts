import { describe, expect, it } from 'vitest';
import type { LiftBlock, Session, SetRow } from '../../data/types';
import { deloadState } from './deload';
import { painSwapOffer } from './pain';
import { nextVariant } from './rotation';
import { summarizeLiftSession } from './session';
import type { HistorySession, LiftSnapshot } from './types';

const mk = (id: string, date: string, extra: Partial<Session> = {}): HistorySession => ({
  session: { id, date, type: 'lift', blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '', ...extra },
  sets: [],
});
const snap = (now: string, history: HistorySession[]): LiftSnapshot => ({ now, programStart: '2026-01-01', history, overrides: new Map(), equipment: new Map() });

describe('rotation', () => {
  it('cycles L-A → U-A → L-B → U-B → L-A', () => {
    const hist: HistorySession[] = [];
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) {
      const v = nextVariant(hist).variant;
      seq.push(v);
      hist.push(mk('s' + i, `2026-02-0${i + 1}T10:00:00Z`, { variant: v }));
    }
    expect(seq).toEqual(['lower-a', 'upper-a', 'lower-b', 'upper-b', 'lower-a']);
  });
  it('steers to the other half when the chosen one is not ready', () => {
    const hist = [mk('a', '2026-02-01T10:00:00Z', { variant: 'lower-a' })];
    expect(nextVariant(hist, (v) => v !== 'upper-a').variant).toBe('lower-b');
  });
});

describe('deload', () => {
  it('week 6 is scheduled, week 2 never', () => {
    expect(deloadState(snap('2026-02-08T12:00:00', []), new Map())).toEqual({ deload: true, reason: 'scheduled' });
    expect(deloadState(snap('2026-01-10T12:00:00', []), new Map())).toEqual({ deload: false, reason: null });
  });
  it('triggers after two bad sessions and lasts 7 days from the first deload session', () => {
    const h = [mk('a', '2026-02-10T10:00:00Z'), mk('b', '2026-02-12T10:00:00Z')];
    const missed = new Map([['a', 2], ['b', 3]]);
    expect(deloadState(snap('2026-02-14T12:00:00', h), missed).reason).toBe('triggered');
    const withDeload = [...h, mk('c', '2026-02-14T10:00:00Z', { flags: { deload: true } })];
    expect(deloadState(snap('2026-02-18T12:00:00', withDeload), missed).deload).toBe(true);
    expect(deloadState(snap('2026-02-22T12:00:00', withDeload), missed).deload).toBe(false);
  });
});

describe('pain', () => {
  const pain = (sessionId: string): SetRow => ({ id: sessionId, sessionId, exerciseId: 'x', equipmentId: 'e', idx: 0, targetWeight: 1, targetReps: 1, weight: 1, reps: 1, painFlag: true });
  it('offers a swap on the second flagged session', () => {
    const past = { ...mk('p', '2026-02-10T10:00:00Z'), sets: [pain('p')] };
    expect(painSwapOffer('x', [past], [], '2026-02-20T00:00:00Z')).toBe(false);
    expect(painSwapOffer('x', [past], [pain('cur')], '2026-02-20T00:00:00Z')).toBe(true);
    expect(painSwapOffer('x', [past], [pain('cur')], '2026-04-20T00:00:00Z')).toBe(false);
  });
});

describe('summarizeLiftSession', () => {
  const block = (id: string): LiftBlock => ({ id: 'b' + id, kind: 'lift', exerciseId: id, sets: 3, repMin: 8, repMax: 12 });
  const set = (exerciseId: string, reps: number, targetReps = 10): SetRow => ({ id: Math.random().toString(), sessionId: 's', exerciseId, equipmentId: 'e', idx: 0, targetWeight: 1, targetReps, weight: 1, reps, painFlag: false });
  it('flags missed exercises and fatigue at three; unlogged is not missed', () => {
    const blocks = ['a', 'b', 'c', 'd'].map(block);
    const r = summarizeLiftSession(blocks, [set('a', 5), set('b', 6), set('c', 7), set('d', 9)]);
    expect(r.missedExercises).toEqual(['a', 'b', 'c']);
    expect(r.fatigue).toBe(true);
    expect(summarizeLiftSession(blocks, []).missedExercises).toEqual([]);
  });
});
