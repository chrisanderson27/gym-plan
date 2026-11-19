import { expect, it } from 'vitest';
import { HOME_GYM, SEED_EQUIPMENT } from '../content';
import { generateLiftDay, type LiftDayPlan } from '../engine/block/generate';
import { blockContext, validateBlock, validateLiftDay } from '../engine/block/validate';
import { availableOn } from '../engine/gym/availability';
import type { LiftSnapshot } from '../engine/lift/types';
import { BLOCK_EXERCISES, BODYWEIGHT_IDS, liftDayInputFrom, planLiftDay } from './liftday';
import { openTestDb } from './test-utils';
import type { CircuitBlock, LiftVariant, Session } from './types';
import { validateRows } from './validate';

const variants: LiftVariant[] = ['upper-a', 'upper-b', 'lower-a', 'lower-b'];
const budgets = [45, 60, 75];
const snapshot: LiftSnapshot = {
  now: '2026-11-19T12:00:00Z', programStart: '2026-10-22', history: [],
  overrides: new Map(), equipment: new Map(SEED_EQUIPMENT.map((eq) => [eq.id, eq])),
};
const sessionWith = (plan: LiftDayPlan): Session => ({
  id: 'planned', date: snapshot.now, type: 'lift', variant: plan.variant, blocks: plan.blocks,
  hard: false, hardCardio: false, rpe: null, durationMin: plan.estMin, notes: '',
});
const circuits = (plan: LiftDayPlan) => plan.blocks.filter((block): block is CircuitBlock => block.kind === 'circuit');

it('generates and validates 504 upstairs sessions on HOME_GYM across all four variants and budgets', () => {
  const ctx = blockContext(HOME_GYM, BLOCK_EXERCISES, 2);
  for (let seed = 0; seed < 504; seed++) {
    const variant = variants[seed % variants.length]!;
    const budget = budgets[Math.floor(seed / variants.length) % budgets.length]!;
    const plan = generateLiftDay(liftDayInputFrom(snapshot, variant, budget, seed));
    const blocks = circuits(plan);
    const details = `${variant} ${budget} min, seed ${seed}`;
    expect(plan.floor, details).toBe(2);
    expect(blocks.length, details).toBeGreaterThan(0);
    expect(plan.estMin, details).toBeLessThanOrEqual(budget);
    for (const block of blocks) expect(validateBlock(block, ctx, 'lift'), details).toEqual([]);
    expect(validateLiftDay(plan.blocks, ctx), details).toEqual([]);
  }
});

it('uses downstairs when all upstairs main candidates for the variant are marked unavailable', () => {
  const variant = 'lower-b';
  const input = liftDayInputFrom(snapshot, variant, 45, 42);
  const upstairs = new Set(availableOn(HOME_GYM, 2, { notAtMyGym: new Set(), bodyweightIds: [] })
    .filter((option) => option.anchorOk).map((option) => option.exerciseId));
  const overrides = new Map(input.mainCandidates.filter((id) => upstairs.has(id))
    .map((exerciseId) => [exerciseId, { exerciseId, notAtMyGym: true }]));
  expect(overrides.size).toBeGreaterThan(0);
  const plan = generateLiftDay(liftDayInputFrom({ ...snapshot, overrides }, variant, 45, 42));
  expect(plan.floor).toBe(1);
  expect(circuits(plan).length).toBeGreaterThan(0);
  expect(validateLiftDay(plan.blocks, blockContext(HOME_GYM, BLOCK_EXERCISES, 1))).toEqual([]);
});

it('only offers bodyweight movements requiring kit at their catalog items', () => {
  const upstairs = availableOn(HOME_GYM, 2, { notAtMyGym: new Set(), bodyweightIds: BODYWEIGHT_IDS });
  expect(upstairs.filter((option) => option.exerciseId === 'hanging-knee-raise')).toEqual([
    expect.objectContaining({ itemId: 'f2-mx-vkr-dip' }),
  ]);
  expect(upstairs.some((option) => option.exerciseId === 'ab-wheel')).toBe(false);
  expect(upstairs.some((option) => option.exerciseId === 'plank' && !option.itemId)).toBe(true);
});

it('prescribes upstairs Romanian deadlifts using the dumbbell steps even after the joint-friendly weeks', () => {
  const plan = generateLiftDay(liftDayInputFrom(snapshot, 'lower-b', 45, 42));
  expect(plan.floor).toBe(2);
  expect(plan.blocks.find((block) => block.label === 'Main lift'))
    .toMatchObject({ exerciseId: 'romanian-deadlift', equipmentId: 'dumbbells', targetWeight: 10 });
});

it('round-trips a generated plan through persisted session validation', () => {
  const session = sessionWith(generateLiftDay(liftDayInputFrom(snapshot, 'upper-a', 60, 123)));
  expect(() => validateRows('sessions', [JSON.parse(JSON.stringify(session))])).not.toThrow();
});

it('loads the snapshot and plans without writing a session', async () => {
  const db = openTestDb();
  try {
    const plan = await planLiftDay(db, 'upper-a', 45, 123, new Date(snapshot.now));
    expect(plan.floor).toBe(2);
    expect(circuits(plan).length).toBeGreaterThan(0);
    expect(await db.sessions.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
