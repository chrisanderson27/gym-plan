import { describe, expect, it } from 'vitest';
import { BURN_TEMPLATES } from '../content/burn-templates';
import { generateBurn, nextBurnTemplate } from './burn';

let n = 0;
const base = {
  excluded: new Set<string>(),
  substitutesOf: { 'ski-erg': ['rower', 'air-bike'], rower: ['ski-erg', 'air-bike'] } as Record<string, string[]>,
  labelOf: { rower: 'Rower', 'air-bike': 'Air bike' } as Record<string, string>,
  makeId: () => `id${n++}`,
};
const tpl = (id: string) => BURN_TEMPLATES.find((t) => t.id === id)!.blocks;
const isFixed = (b: { phases: { role: string }[] }) => b.phases.every((p) => p.role === 'warmup' || p.role === 'cooldown');

describe('generateBurn', () => {
  it('default 55 lands in 50–60 for every template', () => {
    for (const t of BURN_TEMPLATES) {
      const r = generateBurn({ ...base, blocks: t.blocks, budgetMin: 55 });
      expect(r.totalMin, t.id).toBeGreaterThanOrEqual(50);
      expect(r.totalMin, t.id).toBeLessThanOrEqual(60);
    }
  });

  it('30 min budget shrinks to ≤ 32 and keeps every non-fixed block once', () => {
    for (const id of ['burn-tread-floor', 'burn-strength-hybrid']) {
      const src = tpl(id);
      const r = generateBurn({ ...base, blocks: src, budgetMin: 30 });
      expect(r.totalMin, id).toBeLessThanOrEqual(32);
      expect(r.blocks.filter((b) => !isFixed(b)).length).toBe(src.filter((b) => !isFixed(b)).length);
    }
    const circuit = generateBurn({ ...base, blocks: tpl('burn-station-circuit'), budgetMin: 30 });
    expect(circuit.totalMin).toBeLessThanOrEqual(32); // laps are shed
  });

  it('swaps excluded stations to the first available substitute', () => {
    const one = generateBurn({ ...base, excluded: new Set(['ski-erg']), blocks: tpl('burn-tread-floor'), budgetMin: 55 });
    const ski = one.blocks.find((b) => b.label === 'Ski')!;
    expect(ski.phases[0]?.exerciseId).toBe('rower');
    expect(ski.phases[0]?.label).toBe('Rower');
    const two = generateBurn({ ...base, excluded: new Set(['ski-erg', 'rower']), blocks: tpl('burn-tread-floor'), budgetMin: 55 });
    expect(two.blocks.find((b) => b.label === 'Ski')!.phases[0]?.exerciseId).toBe('air-bike');
  });

  it('with every substitute excluded the station becomes a bodyweight choice', () => {
    const r = generateBurn({ ...base, excluded: new Set(['ski-erg', 'rower', 'air-bike']), blocks: tpl('burn-tread-floor'), budgetMin: 55 });
    const p = r.blocks.find((b) => b.label === 'Ski')!.phases[0]!;
    expect(p.exerciseId).toBeUndefined();
    expect(p.label).toBe('Choice: bodyweight');
  });

  it('gives each block a fresh id', () => {
    const r = generateBurn({ ...base, blocks: tpl('burn-tread-floor'), budgetMin: 55 });
    expect(new Set(r.blocks.map((b) => b.id)).size).toBe(r.blocks.length);
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
