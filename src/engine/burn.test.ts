import { describe, expect, it } from 'vitest';
import { BURN_TEMPLATES } from '../content/burn-templates';
import { HOME_GYM } from '../content/gym/home-gym';
import { SEED_EQUIPMENT } from '../content';
import { burnInputFrom } from '../data/burn';
import { BLOCK_EXERCISES } from '../data/liftday';
import type { CircuitBlock } from '../data/types';
import { mulberry32 } from './block/rng';
import { countsAsCardio, groupOf, kitOf } from './block/rules';
import { blockContext, validateBlock } from './block/validate';
import { generateBurn, nextBurnTemplate, type BurnResult } from './burn';
import { BURN_BUDGETS_MIN } from './config';
import { defaultBurnPods } from './gym/availability';
import type { LiftSnapshot } from './lift/types';

const snapshot: LiftSnapshot = {
  now: '2026-11-19T12:00:00Z', programStart: '2026-10-22', history: [],
  overrides: new Map(), equipment: new Map(SEED_EQUIPMENT.map((eq) => [eq.id, eq])),
};
const tpl = BURN_TEMPLATES[0]!;
const ctx = blockContext(HOME_GYM, BLOCK_EXERCISES);
const circuits = (result: BurnResult) => result.blocks.filter((b): b is CircuitBlock => b.kind === 'circuit');
const itemIds = (pods: readonly string[]) => new Set(HOME_GYM.pods.filter((pod) => pods.includes(pod.id)).flatMap((pod) => pod.items));

describe('generateBurn', () => {
  it('default 55 lands in 50–60 for every template', () => {
    for (const template of BURN_TEMPLATES) {
      const result = generateBurn(burnInputFrom(snapshot, template, 55));
      expect(result.totalMin, template.id).toBeGreaterThanOrEqual(50);
      expect(result.totalMin, template.id).toBeLessThanOrEqual(60);
      expect(circuits(result).map((b) => b.durationSec / 60)).toEqual(template.blocks.map((b) => b.minutes));
    }
  });

  it('30 min budget gives ≤32 and keeps the finisher plus at least one other block', () => {
    for (const template of BURN_TEMPLATES) {
      const result = generateBurn(burnInputFrom(snapshot, template, 30));
      expect(result.totalMin, template.id).toBeLessThanOrEqual(32);
      expect(circuits(result)).toHaveLength(2);
      expect(circuits(result).at(-1)?.role).toBe('finisher');
    }
  });

  it('swaps an excluded SkiErg to its first available substitute', () => {
    const result = generateBurn({ ...burnInputFrom(snapshot, tpl, 55), notAtMyGym: new Set(['ski-erg']) });
    const ski = circuits(result).find((b) => b.label === 'Block D');
    expect(ski?.stations[0]?.exerciseId).toBe('rower');
    expect(result.swaps).toContainEqual({ from: 'ski-erg', to: 'rower' });
  });

  it('reports dropped work when every exercise in a station group is excluded', () => {
    const group = groupOf(BLOCK_EXERCISES.get('ski-erg')!);
    const excluded = [...BLOCK_EXERCISES.values()].filter((ex) => groupOf(ex) === group).map((ex) => ex.id);
    const result = generateBurn({ ...burnInputFrom(snapshot, tpl, 55), notAtMyGym: new Set(excluded) });
    expect(result.dropped).toContain('block:Block D');
    expect(result.blocks[0]?.kind === 'lift' && result.blocks[0].notes).toContain('Easy walking in place');
    for (const block of circuits(result)) expect(validateBlock(block, ctx, 'burn')).toEqual([]);
  });

  it('gives each block a fresh id', () => {
    const input = burnInputFrom(snapshot, tpl, 55);
    const ids = [...generateBurn(input).blocks, ...generateBurn(input).blocks].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('generates valid turf circuits with at most two cardio stations across 2,400 exclusion sets', () => {
    const turf = defaultBurnPods(HOME_GYM);
    const allowed = itemIds(turf);
    const ids = [...BLOCK_EXERCISES.keys()];
    const random = mulberry32(42);
    for (const template of BURN_TEMPLATES) for (const budget of BURN_BUDGETS_MIN) {
      const input = burnInputFrom(snapshot, template, budget);
      for (let seed = 0; seed < 200; seed++) {
        const excluded = ids.filter(() => random() < 0.2);
        const result = generateBurn({ ...input, notAtMyGym: new Set(excluded) });
        for (const block of circuits(result)) {
          expect(validateBlock(block, ctx, 'burn')).toEqual([]);
          expect(turf).toContain(block.podId);
          expect(block.stations.filter(({ exerciseId }) => {
            const ex = BLOCK_EXERCISES.get(exerciseId)!;
            return countsAsCardio(groupOf(ex), kitOf(ex));
          }).length).toBeLessThanOrEqual(2);
          for (const station of block.stations) for (const id of [station.itemId, station.backup?.itemId]) {
            if (id !== undefined) expect(allowed.has(id)).toBe(true);
          }
        }
      }
    }
  });

  it('draws equipment from the specified non-turf pods', () => {
    const turf = defaultBurnPods(HOME_GYM);
    const bells = HOME_GYM.items.filter((item) => item.floor === 2 && item.type.startsWith('dumbbell')).map((item) => item.id);
    const pods = HOME_GYM.pods.filter((pod) => !turf.includes(pod.id) && pod.items.some((id) => bells.includes(id))).map((pod) => pod.id);
    const input = burnInputFrom(snapshot, tpl, 55);
    const result = generateBurn({
      ...input, pods,
      template: { id: tpl.id, blocks: [{ label: 'Block A', role: 'block', minutes: 8, stations: [
        { exerciseId: 'goblet-squat' }, { exerciseId: 'one-arm-db-row' }, { exerciseId: 'db-bench' },
      ] }] },
    });
    expect(circuits(result)).toHaveLength(1);
    const block = circuits(result)[0]!;
    expect(pods).toContain(block.podId);
    const used = block.stations.flatMap((s) => [s.itemId, s.backup?.itemId]).filter((id) => id !== undefined);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(itemIds(pods).has(id)).toBe(true);
  });

  it.each([false, true])('keeps a fallback Burn on one floor (upstairs can serve it: %s)', (upstairsHasRow) => {
    const zones = [2, 1].map((floor) => ({ id: `zone-${floor}`, floor, neighbours: [] }));
    const items = zones.flatMap(({ id: zone, floor }) => {
      const place = { floor, zone, count: 2, confidence: 'C' as const, verified: true };
      return [
        { ...place, id: `bells-${floor}`, type: 'dumbbell', exercises: ['goblet-squat', ...(floor === 1 || upstairsHasRow ? ['one-arm-db-row'] : [])] },
        { ...place, id: `erg-${floor}`, type: 'rower', exercises: ['rower'] },
      ];
    });
    const profile = {
      id: 'home-gym' as const, zones, items,
      pods: zones.map(({ id: zone, floor }) => ({ id: `pod-${floor}`, zone, items: [`bells-${floor}`, `erg-${floor}`] })),
    };
    const input = burnInputFrom(snapshot, tpl, 55, profile);
    const result = generateBurn({
      ...input, bodyweightIds: ['push-up'],
      template: { id: tpl.id, blocks: ['rower', 'one-arm-db-row'].map((exerciseId, i) => ({
        label: `Block ${i + 1}`, role: 'block', minutes: 8,
        stations: [{ exerciseId: 'goblet-squat' }, { exerciseId }, { exerciseId: 'push-up' }],
      })) },
    });
    const floor = upstairsHasRow ? 2 : 1;
    expect(circuits(result)).toMatchObject([`erg-${floor}`, `bells-${floor}`].map((itemId) => ({
      podId: `pod-${floor}`, stations: [{ itemId: `bells-${floor}` }, { itemId }, { exerciseId: 'push-up' }],
    })));
    expect(result.dropped).toEqual([]);
  });

  it('produces warm-up, circuit and cool-down blocks with no intervals', () => {
    const { blocks } = generateBurn(burnInputFrom(snapshot, tpl, 55));
    expect(blocks[0]).toMatchObject({ kind: 'lift', warmup: true, role: 'warmup' });
    expect(blocks.at(-1)).toMatchObject({ kind: 'lift', warmup: true, role: 'cooldown' });
    expect(blocks.slice(1, -1).every((b) => b.kind === 'circuit')).toBe(true);
  });
});

describe('nextBurnTemplate', () => {
  it('picks the least recent; never-done first; ties by list order', () => {
    const ids = ['a', 'b', 'c'];
    expect(nextBurnTemplate(ids, {})).toBe('a');
    expect(nextBurnTemplate(ids, { a: '2026-11-03', b: '2026-11-01' })).toBe('c');
    expect(nextBurnTemplate(ids, { a: '2026-11-03', b: '2026-11-01', c: '2026-11-02' })).toBe('b');
  });
});
