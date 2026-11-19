import { describe, expect, it } from 'vitest';
import { rankToday } from './pick';
import { burn, hardRun, input, lowerA, session, upperA } from './plan-test-utils';
import type { PlanSession } from './types';

const byId = (r: ReturnType<typeof rankToday>, id: string) => r.candidates.find((c) => c.id === id)!;

describe('rankToday', () => {
  it('blocks lower and hybrid-lower within 48 h of a lower session', () => {
    const r = rankToday(input([lowerA(20)]));
    expect(byId(r, 'lift-lower').status).toBe('blocked');
    expect(byId(r, 'hybrid-lower').status).toBe('blocked');
    expect(r.pick.id).not.toBe('lift-lower');
    expect(r.pick.id).not.toBe('hybrid-lower');
  });
  it('never picks a third hard cardio session', () => {
    const r = rankToday(input([burn(60), burn(70)]));
    expect(byId(r, 'burn').status).toBe('blocked');
    expect(byId(r, 'run-intervals').status).toBe('blocked');
    expect(['burn', 'run-intervals']).not.toContain(r.pick.id);
  });
  it('a hard run 30 h ago blocks lower but not upper', () => {
    const r = rankToday(input([hardRun(30)]));
    expect(byId(r, 'lift-lower').status).toBe('blocked');
    expect(byId(r, 'lift-upper').status).not.toBe('blocked');
  });
  it('heavy legs 10 h ago block intervals', () => {
    const r = rankToday(input([lowerA(10)]));
    expect(byId(r, 'run-intervals').status).toBe('blocked');
  });
  it('cold start calibrates Lower A', () => {
    const r = rankToday(input([], { hasLiftHistory: false }));
    expect(r.pick).toMatchObject({ title: 'Lower A (calibration)', route: '#/lift/calibrate/lower-a' });
    expect(r.why).toBe('No history yet — calibrate first');
  });
  it('excludes disabled swim and separates the reason from the hard count', () => {
    const ranked = rankToday(input([], { activities: ['lift', 'run'] }));
    expect(ranked.candidates.map((candidate) => candidate.id)).not.toContain('swim');
    expect(ranked.reason).not.toContain('hard used');
    expect(ranked.why).toContain('hard used');
  });
  it('skips the first-lift calibration for a Burn-only user', () => {
    const ranked = rankToday(input([], { activities: ['burn'], hasLiftHistory: false }));
    expect(ranked.pick.id).toBe('burn');
    expect(ranked.candidates.map((candidate) => candidate.id)).toEqual(['burn', 'rest']);
    expect(rankToday(input([], { activities: [] })).pick.id).toBe('rest');
  });
  it('rest is the pick once the training days are used', () => {
    // Mon, Tue and Wed trained with a 3-day plan: 3/3 used.
    const r = rankToday(input([upperA(24), session(48, { type: 'swim' }), burn(72)], { daysPerWeek: 3 }));
    expect(r.pick.id).toBe('rest');
  });
  it('a never-done activity outranks a recent one at equal unmet', () => {
    const r = rankToday(input([upperA(100), lowerA(100)]));
    expect(r.pick.status).not.toBe('blocked');
    expect(r.pick.score.unmet).toBeGreaterThanOrEqual(1);
  });
  it('routes lifts to the preselect route', () => {
    const r = rankToday(input([lowerA(100)]));
    expect(byId(r, 'lift-upper').route).toBe('#/lift/start/upper-a');
    expect(byId(r, 'hybrid-lower').route).toBe('#/hybrid/lower-a');
  });

  it('property: 200 seeded weeks never pick a lower within 48 h of a lower, nor a third hard-cardio', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let t = 0; t < 200; t++) {
      const sessions: PlanSession[] = [];
      const count = Math.floor(rnd() * 8);
      for (let k = 0; k < count; k++) {
        const h = Math.floor(rnd() * 120);
        const r = rnd();
        sessions.push(r < 0.25 ? lowerA(h) : r < 0.45 ? upperA(h) : r < 0.65 ? burn(h) : r < 0.8 ? hardRun(h) : session(h, { type: 'swim' }));
      }
      const res = rankToday(input(sessions));
      const within48 = sessions.some((s) => s.lower && (Date.parse(input([]).now) - Date.parse(s.end)) / 3_600_000 < 48);
      if (within48) expect(['lift-lower', 'hybrid-lower']).not.toContain(res.pick.id);
      const hardDone = res.budget.find((l) => l.id === 'hard')!.done;
      if (hardDone >= 2) expect(['burn', 'run-intervals']).not.toContain(res.pick.id);
    }
  });
});
