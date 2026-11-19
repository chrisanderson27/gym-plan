import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildProfile } from '../../../scripts/gen-gym.mjs';
import { SEED_EQUIPMENT } from '../../content';
import { liftDayInputFrom } from '../../data/liftday';
import type { CircuitBlock, LiftBlock, LiftVariant, SetRow } from '../../data/types';
import type { LiftSnapshot } from '../lift/types';
import { generateLiftDay, type LiftDayPlan } from './generate';
import { blockContext, validateBlock, validateLiftDay } from './validate';

const fixture = buildProfile(parse(readFileSync(new URL('../../../scripts/fixtures/gym-fixture.yaml', import.meta.url), 'utf8'))).profile;
const variants: LiftVariant[] = ['upper-a', 'upper-b', 'lower-a', 'lower-b'];
const working: SetRow = {
  id: 'set', sessionId: 'baseline', exerciseId: 'db-bench', equipmentId: 'dumbbells',
  idx: 0, targetWeight: 45, targetReps: 8, weight: 45, reps: 8, painFlag: false,
};
const snapshot: LiftSnapshot = {
  now: '2026-02-01T12:00:00Z', programStart: '2026-01-01', overrides: new Map(),
  equipment: new Map(SEED_EQUIPMENT.map((eq) => [eq.id, eq])),
  history: [{
    session: {
      id: 'baseline', date: '2026-01-31T12:00:00Z', type: 'lift', variant: 'upper-a',
      blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 30, notes: '',
    },
    sets: [working],
  }],
};
const planFor = (seed: number, minutes = 60, variant: LiftVariant = 'upper-a', snap = snapshot, profile = fixture) =>
  generateLiftDay(liftDayInputFrom(snap, variant, minutes, seed, profile));
const circuits = (plan: LiftDayPlan) => plan.blocks.filter((block): block is CircuitBlock => block.kind === 'circuit');
const main = (plan: LiftDayPlan) => plan.blocks.find((block): block is LiftBlock => block.kind === 'lift' && !block.warmup);
const minutes = (plan: LiftDayPlan) => circuits(plan).map((block) => block.durationSec / 60);

it('is deterministic for the same seed and injected IDs', () => {
  expect(planFor(123)).toEqual(planFor(123));
  expect(planFor(123).blocks.map((block) => block.id)).toEqual(planFor(123).blocks.map((_, i) => `b${i}`));
});

it('uses the ladder at 30, 45, 60 and 75 minutes while keeping the main intact', () => {
  const budgets = [30, 45, 60, 75];
  const plans = budgets.map((budget) => planFor(6, budget));
  expect(plans.map((plan) => main(plan)?.sets)).toEqual([3, 3, 3, 3]);
  expect(plans.map((plan) => main(plan)?.restSec)).toEqual([150, 150, 150, 150]);
  expect(minutes(plans[0]!)).toEqual([8]);
  expect(minutes(plans[1]!)).toEqual([8, 8, 4]);
  expect(minutes(plans[2]!)).toEqual([12, 8, 8, 4]);
  expect(minutes(plans[3]!)).toEqual([12, 8, 8, 4]);
  for (const [i, plan] of plans.entries()) expect(plan.estMin).toBeLessThanOrEqual(budgets[i]!);
  expect(minutes(planFor(6, 10))).toEqual([8]);
});

it('uses a downstairs main when upstairs has no trustworthy candidate', () => {
  const profile = structuredClone(fixture);
  for (const item of profile.items) {
    if (item.floor === 2 && item.exercises.includes('db-bench')) item.confidence = 'G';
  }
  expect(planFor(123, 45, 'upper-a', snapshot, profile).floor).toBe(1);
});

it('drops a floor gracefully when every item is a guess and no main can be prescribed', () => {
  const profile = structuredClone(fixture);
  for (const item of profile.items) {
    item.confidence = 'G';
    item.verified = false;
  }
  const plan = planFor(123, 45, 'upper-a', snapshot, profile);
  expect(plan.floor).toBe(2);
  expect(plan.dropped).toContain('floor:2');
  expect(main(plan)).toBeUndefined();
  expect(circuits(plan)).toEqual([]);
});

it('rejects a single-count cardio station when its pod cannot offer another option', () => {
  const profile = structuredClone(fixture);
  const turf = profile.pods.find((pod) => pod.id === 'upper-turf-pod')!;
  turf.items = turf.items.filter((id) => !['upper-turf-row', 'upper-turf-ball'].includes(id));
  const snap = { ...snapshot, overrides: new Map([['burpee', { exerciseId: 'burpee', notAtMyGym: true }]]) };
  for (let seed = 0; seed < 20; seed++) {
    expect(circuits(planFor(seed, 60, 'upper-a', snap, profile)).flatMap((block) => block.stations)
      .some((station) => station.itemId === 'upper-turf-bike')).toBe(false);
  }
});

it('uses joint-friendly exercises through week 4 and follows main-lift deload and ramp-in', () => {
  const earlier = (now: string): LiftSnapshot => ({ ...snapshot, now, history: [{ ...snapshot.history[0]!, session: { ...snapshot.history[0]!.session, date: '2026-01-01T12:00:00Z' } }] });
  const ramp = planFor(1, 60, 'upper-a', earlier('2026-01-02T12:00:00Z'));
  expect(ramp.rampIn).toBe(true);
  expect(main(ramp)?.sets).toBe(2);
  const jf = liftDayInputFrom(earlier('2026-01-22T12:00:00Z'), 'upper-a', 60, 1, fixture);
  expect(circuits(generateLiftDay(jf)).flatMap((block) => block.stations)
    .every((station) => jf.exercises.get(station.exerciseId)?.jointFriendly)).toBe(true);
  const deload = planFor(1, 60, 'upper-a', earlier('2026-02-05T12:00:00Z'));
  expect(deload.deload).toBe(true);
  expect(deload.main.mode).toBe('deload');
  expect(main(deload)?.sets).toBe(2);
});

it('validates at least one circuit over 500 seeds for each of four variants', () => {
  let sawBike = false;
  const ctx = blockContext(fixture, liftDayInputFrom(snapshot, 'upper-a', 60, 0, fixture).exercises, 2);
  for (let seed = 0; seed < 500; seed++) {
    for (const variant of variants) {
      const plan = planFor(seed, [45, 60, 75][seed % 3], variant);
      const blocks = circuits(plan);
      if (!blocks.length || plan.floor !== 2) throw new Error(`No upstairs circuit at seed ${seed} for ${variant}`);
      for (const block of blocks) {
        expect(validateBlock(block, ctx, 'lift'), `${seed}: ${variant}`).toEqual([]);
        for (const station of block.stations) {
          expect(station.itemId).not.toBe('upper-turf-cable');
          if (station.itemId === 'upper-turf-bike') {
            expect(station.backup).toBeDefined();
            expect(station.backup?.itemId).not.toBe(station.itemId);
            if (station.backup?.itemId) expect(ctx.podsOfItem(station.backup.itemId)).toContain('upper-turf-pod');
            sawBike = true;
          }
        }
      }
      expect(validateLiftDay(plan.blocks, ctx), `${seed}: ${variant}`).toEqual([]);
    }
  }
  expect(sawBike).toBe(true);
});
