import { describe, expect, it } from 'vitest';
import type { Block, IntervalBlock, LiftBlock, OrderedBlock } from '../data/types';
import { FULL_WORKOUT_MIN_SEC, moveBlock, orderedBlockMinutes, orderedBlockSeconds, orderedDurationMin, orderedDurationSec, newLiftBlock, pairWithNext, removeBlock, templateDurationMin, toTemplateBlocks, unpair } from './templates';

let n = 0;
const mk = () => 'id' + n++;
const lift = (id: string, o: Partial<LiftBlock> = {}): LiftBlock => ({ id, kind: 'lift', exerciseId: id, sets: 3, repMin: 8, repMax: 12, ...o });

describe('template blocks', () => {
  it('strips result, target weight and the calibration label, with fresh ids', () => {
    const interval: IntervalBlock = { id: 'i', kind: 'interval', rounds: 2, phases: [{ role: 'work', sec: 30, label: 'x' }], result: { completed: true } };
    const out = toTemplateBlocks([interval, lift('a', { targetWeight: 100, label: 'Calibration' })], mk);
    expect(out[0]).not.toHaveProperty('result');
    expect(out[0]!.id).not.toBe('i');
    const l = out[1] as LiftBlock;
    expect(l.targetWeight).toBeUndefined();
    expect(l.label).toBeUndefined();
  });
  it('remaps superset groups consistently', () => {
    const out = toTemplateBlocks([lift('a', { supersetGroup: 'g' }), lift('b', { supersetGroup: 'g' }), lift('c')], mk) as LiftBlock[];
    expect(out[0]!.supersetGroup).toBe(out[1]!.supersetGroup);
    expect(out[0]!.supersetGroup).not.toBe('g');
    expect(out[2]!.supersetGroup).toBeUndefined();
  });
  it('moves, with edge no-ops', () => {
    const bs = [lift('a'), lift('b')];
    expect(moveBlock(bs, 'a', -1)).toBe(bs);
    expect(moveBlock(bs, 'b', 1)).toBe(bs);
    expect(moveBlock(bs, 'a', 1).map((b) => b.id)).toEqual(['b', 'a']);
  });
  it('pairs with the next block, refuses a paired block, unpairs both', () => {
    const bs = [lift('a'), lift('b'), lift('c')];
    const p = pairWithNext(bs, 'a', mk);
    expect(p[0]!.supersetGroup).toBeDefined();
    expect(p[0]!.supersetGroup).toBe(p[1]!.supersetGroup);
    expect(pairWithNext(p, 'b', mk)).toBe(p);
    expect(pairWithNext(p, 'a', mk)).toBe(p);
    expect(pairWithNext(bs, 'c', mk)).toBe(bs);
    const u = unpair(p, 'b');
    expect(u.every((b) => b.supersetGroup === undefined)).toBe(true);
  });
  it('removing one of a pair unpairs the other', () => {
    const p = pairWithNext([lift('a'), lift('b')], 'a', mk);
    const out = removeBlock(p, 'a');
    expect(out).toHaveLength(1);
    expect(out[0]!.supersetGroup).toBeUndefined();
  });
  it('includes each circuit duration in the template estimate', () => {
    const circuit: Block = { id: 'c', kind: 'circuit', role: 'block', durationSec: 480, targetRounds: 4, stations: [], podId: 'turf' };
    expect(templateDurationMin([lift('a'), circuit])).toBe(14);
  });
  it('builds a 3-set block and estimates duration', () => {
    const b = newLiftBlock({ id: 'x', repMin: 6, repMax: 10 }, mk);
    expect(b).toMatchObject({ sets: 3, repMin: 6, repMax: 10, restSec: 90 });
    const blocks: Block[] = [b, { id: 'i', kind: 'interval', rounds: 2, label: 'x', phases: [{ role: 'work', sec: 60, label: 'w' }] }];
    expect(templateDurationMin(blocks)).toBe(8);
  });
});


describe('ordered scheduled duration', () => {
  const strength: OrderedBlock = { id: 'strength', kind: 'strength', exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 12 };
  it('counts upper-target reps and only between-set rests', () => {
    expect(orderedBlockSeconds({ ...strength, sets: 1 })).toBe(36);
    expect(orderedBlockSeconds({ ...strength, restSec: 0 })).toBe(108);
    expect(orderedBlockSeconds(strength)).toBe(288);
    expect(orderedBlockMinutes(strength)).toBe(4.8);
  });
  it('counts each timed block once and compares the minimum in exact seconds', () => {
    const blocks: OrderedBlock[] = [
      strength,
      { id: 'prep', kind: 'preparation', durationSec: 420, instructions: 'Warm up' },
      { id: 'rotation', kind: 'coached', name: 'Rotation', durationSec: 720, workSec: 30, restSec: 15, transitionSec: 10, stations: [] },
      { id: 'circuit', kind: 'self-paced', name: 'Circuit', durationSec: 600, stations: [] },
    ];
    const totals = [671, 672, 673].map((durationSec) =>
      orderedDurationSec([...blocks, { id: 'recovery', kind: 'recovery', durationSec, instructions: 'Cool down' }]));
    expect(totals).toEqual([2699, 2700, 2701]);
    expect(totals.map((seconds) => seconds >= FULL_WORKOUT_MIN_SEC)).toEqual([false, true, true]);
    expect(orderedDurationMin(blocks)).toBe(34);
  });
});
