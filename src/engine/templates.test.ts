import { describe, expect, it } from 'vitest';
import type { Block, IntervalBlock, LiftBlock } from '../data/types';
import { moveBlock, newLiftBlock, pairWithNext, removeBlock, templateDurationMin, toTemplateBlocks, unpair } from './templates';

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
  it('builds a 3-set block and estimates duration', () => {
    const b = newLiftBlock({ id: 'x', repMin: 6, repMax: 10 }, mk);
    expect(b).toMatchObject({ sets: 3, repMin: 6, repMax: 10, restSec: 90 });
    const blocks: Block[] = [b, { id: 'i', kind: 'interval', rounds: 2, label: 'x', phases: [{ role: 'work', sec: 60, label: 'w' }] }];
    expect(templateDurationMin(blocks)).toBe(8);
  });
});
