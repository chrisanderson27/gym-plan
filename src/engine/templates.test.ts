import { describe, expect, it } from 'vitest';
import type { Block, IntervalBlock, LiftBlock, OrderedBlock, StationTarget } from '../data/types';
import type { BlockExerciseShape } from './block/rules';
import { blockBalanceIssues, blockRoundSeconds, blockRounds, blockSecondsForRounds, isHardBlockIssue, type RoundBlock, FULL_WORKOUT_MIN_SEC, moveBlock, orderedBlockMinutes, orderedBlockSeconds, orderedDurationMin, orderedDurationSec, newLiftBlock, shortfallLabel, workoutShortfallSec, pairWithNext, removeBlock, templateDurationMin, toTemplateBlocks, unpair } from './templates';

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

describe('workoutShortfallSec', () => {
  const timed = (sec: number): OrderedBlock => ({ id: 't', kind: 'recovery', durationSec: sec, instructions: 'Easy.' });
  it('passes at exactly 45 minutes and fails by the missing second below it', () => {
    expect(workoutShortfallSec([timed(2700)])).toBe(0);
    expect(workoutShortfallSec([timed(2701)])).toBe(0);
    expect(workoutShortfallSec([timed(2699)])).toBe(1);
    expect(workoutShortfallSec([])).toBe(FULL_WORKOUT_MIN_SEC);
  });
  it('counts a run block by its prescribed seconds', () => {
    const run: OrderedBlock = { id: 'r', kind: 'run', name: 'Easy run', runKind: 'easy', modality: 'run', durationSec: 1200 };
    expect(orderedBlockSeconds(run)).toBe(1200);
    expect(workoutShortfallSec([timed(1500), run])).toBe(0);
  });
  it('leaves legacy template minutes unchanged', () => {
    expect(templateDurationMin([lift('a', { sets: 3 })])).toBe(Math.round(3 * 2));
  });
});

describe('shortfallLabel', () => {
  it('reads whole minutes rounded up, never undershooting', () => {
    expect(shortfallLabel(179.5)).toBe('3 min');
    expect(shortfallLabel(59.2)).toBe('1 min');
    expect(shortfallLabel(0.5)).toBe('1 min');
    expect(shortfallLabel(2700)).toBe('45 min');
    expect(shortfallLabel(2160)).toBe('36 min');
  });
});

describe('block rounds and balance', () => {
  const shape = (id: string, group: BlockExerciseShape['group']) => ({
    id, name: id, group, unit: 'reps', equipment: ['bodyweight'], primary: [], secondary: [], repMin: 8, repMax: 12,
  } as unknown as BlockExerciseShape);
  const catalog = new Map([
    shape('squat', 'squat'), shape('lunge', 'lunge'), shape('press', 'horizontal-push'), shape('row', 'horizontal-pull'),
    shape('plank', 'carry-core'), shape('bug', 'carry-core'), shape('carry', 'carry-core'), shape('bike', 'conditioning'), shape('erg', 'conditioning'),
  ].map((ex) => [ex.id, ex]));
  const of = (id: string) => catalog.get(id);
  const reps = (amount: number): StationTarget => ({ unit: 'reps', amount });
  const block = (ids: string[], durationSec: number): RoundBlock => ({
    kind: 'self-paced', durationSec, stations: ids.map((exerciseId) => ({ exerciseId, target: reps(8) })),
  });
  const kinds = (b: RoundBlock) => blockBalanceIssues(b, of).map((issue) => issue.kind);

  it('times a self-paced round from reps, seconds and carried metres, plus a transition per station', () => {
    const b: RoundBlock = { kind: 'self-paced', durationSec: 600, stations: [
      { exerciseId: 'squat', target: reps(10) }, { exerciseId: 'plank', target: { unit: 'sec', amount: 30 } },
      { exerciseId: 'carry', target: { unit: 'm', amount: 20 } }, { exerciseId: 'bike', target: { unit: 'm', amount: 200 } },
    ] };
    expect(blockRoundSeconds(b, of)).toBe((30 + 10) + (30 + 10) + (30 + 10) + (50 + 10));
  });

  it('times a coached round from the work window, a sec station\'s own length, rest and transition', () => {
    const b: RoundBlock = { kind: 'coached', durationSec: 600, workSec: 30, restSec: 5, transitionSec: 10, stations: [
      { exerciseId: 'row', target: reps(10) }, { exerciseId: 'bike', target: { unit: 'sec', amount: 45 } },
    ] };
    expect(blockRoundSeconds(b, of)).toBe(45 + 60);
    expect(blockRounds(b, of)).toBeCloseTo(600 / 105);
    expect(blockSecondsForRounds(b, of)).toBe(330);
    expect(blockRoundSeconds({ kind: 'coached', durationSec: 600 }, of)).toBeUndefined();
  });

  it('passes a balanced six-station block at three rounds', () => {
    expect(kinds(block(['squat', 'press', 'plank', 'lunge', 'row', 'bug'], 3 * 6 * 34))).toEqual([]);
  });

  it('flags two exercises stretched across 21 minutes', () => {
    const issues = blockBalanceIssues(block(['row', 'press'], 1260), of);
    expect(issues.map((issue) => issue.kind)).toEqual(['too-few-exercises', 'too-many-rounds']);
    expect(issues.find((issue) => issue.kind === 'too-many-rounds')).toMatchObject({ rounds: 1260 / 68 });
    expect(issues.some(isHardBlockIssue)).toBe(true);
  });

  it('flags too few rounds, too many exercises and a repeated exercise', () => {
    expect(kinds(block(['squat', 'press', 'row'], 120))).toEqual(['too-few-rounds']);
    const ten = ['squat', 'press', 'plank', 'lunge', 'row', 'bug', 'squat', 'press', 'row', 'bike'];
    expect(kinds(block(ten, 10 * 34 * 3))).toEqual(expect.arrayContaining(['duplicate', 'too-many-exercises']));
  });

  it('finds same-group neighbours across the last-to-first wrap', () => {
    const issues = blockBalanceIssues(block(['bike', 'row', 'squat', 'erg'], 4 * 34 * 3), of);
    expect(issues).toEqual([{ kind: 'adjacent-group', group: 'cardio', from: 3, length: 2 }]);
    expect(issues.some(isHardBlockIssue)).toBe(false);
  });

  it('flags the one-leg, two-ab circuit and an all-core block', () => {
    expect(kinds(block(['lunge', 'bug', 'plank'], 3 * 34 * 3))).toEqual(['adjacent-group', 'too-much-core', 'too-few-groups']);
    const allCore = blockBalanceIssues(block(['carry', 'plank', 'bug'], 3 * 34 * 3), of);
    expect(allCore[0]).toEqual({ kind: 'adjacent-group', group: 'core', from: 0, length: 3 });
    expect(allCore.some(isHardBlockIssue)).toBe(true);
  });

  it('allows two core stations in six but not three', () => {
    expect(kinds(block(['bug', 'squat', 'press', 'plank', 'lunge', 'row'], 6 * 34 * 3))).toEqual([]);
    expect(kinds(block(['bug', 'squat', 'plank', 'press', 'carry', 'row'], 6 * 34 * 3))).toEqual(['too-much-core']);
  });

  it('ignores exercises it cannot place in a group', () => {
    expect(kinds(block(['unknown', 'squat', 'press'], 3 * 34 * 3))).toEqual(['too-few-groups']);
  });
});
