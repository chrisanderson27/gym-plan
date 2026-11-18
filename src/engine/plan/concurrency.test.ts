import { describe, expect, it } from 'vitest';
import { weeklyBudget } from './budget';
import { concurrency, type CandidateFlags } from './concurrency';
import { burn, hardRun, input, lowerA, upperA } from './plan-test-utils';
import type { PlanSession } from './types';

const flags = (o: Partial<CandidateFlags>): CandidateFlags => ({ id: 'lift-lower', lower: false, hardRun: false, hard: false, hardCardio: false, longRun: false, ...o });
const run = (sessions: PlanSession[], c: Partial<CandidateFlags>) => {
  const i = input(sessions);
  return concurrency(flags(c), i, weeklyBudget(i));
};

describe('concurrency', () => {
  it('blocks lower within 48 h of lower, allows exactly 48 h', () => {
    expect(run([lowerA(47.9)], { lower: true })[0]).toMatchObject({ status: 'blocked' });
    expect(run([lowerA(47.9)], { lower: true })[0]!.reason).toContain('Lower A 48 h ago');
    expect(run([lowerA(48)], { lower: true })).toEqual([]);
  });
  it('blocks lower within 48 h of a hard run', () => {
    expect(run([hardRun(30)], { lower: true }).some((r) => r.status === 'blocked')).toBe(true);
    expect(run([hardRun(48)], { lower: true, hard: false })).toEqual([]);
  });
  it('blocks a hard run within 24 h of heavy legs', () => {
    expect(run([lowerA(23.9)], { hardRun: true }).some((r) => r.status === 'blocked')).toBe(true);
    expect(run([lowerA(24)], { hardRun: true })).toEqual([]);
  });
  it('blocks a hard candidate within 48 h of any hard session', () => {
    expect(run([burn(47.9)], { hard: true }).some((r) => r.status === 'blocked')).toBe(true);
    expect(run([burn(48)], { hard: true })).toEqual([]);
  });
  it('blocks a third hard-cardio session in the week', () => {
    const r = run([burn(60), burn(70)], { hardCardio: true });
    expect(r.some((x) => x.status === 'blocked' && x.reason.includes('2/2'))).toBe(true);
    expect(run([burn(60)], { hardCardio: true })).toEqual([]);
  });
  it('warns on Burn within 24 h of leg day', () => {
    expect(run([lowerA(10)], { id: 'burn' })[0]).toMatchObject({ status: 'warned' });
    expect(run([lowerA(30)], { id: 'burn' })).toEqual([]);
  });
  it('warns a long run within 24 h of a hard run', () => {
    expect(run([hardRun(10)], { longRun: true })[0]).toMatchObject({ status: 'warned' });
    expect(run([upperA(10)], { longRun: true })).toEqual([]);
  });
});
