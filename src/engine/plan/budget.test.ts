import { describe, expect, it } from 'vitest';
import { weeklyBudget } from './budget';
import { burn, input, lowerA, session, upperA } from './plan-test-utils';

const line = (w: ReturnType<typeof weeklyBudget>, id: string) => w.lines.find((l) => l.id === id)!;

describe('weeklyBudget', () => {
  it('empty week: everything under except hard', () => {
    const w = weeklyBudget(input([]));
    expect(line(w, 'lifts').status).toBe('under');
    expect(line(w, 'long').status).toBe('under');
    expect(line(w, 'hard').done).toBe(0);
    expect(w.trainingDays).toBe(0);
  });
  it('two burns meet the hard cap at 2/2', () => {
    const w = weeklyBudget(input([burn(24), burn(72)]));
    expect(line(w, 'hard')).toMatchObject({ done: 2, max: 2 });
  });
  it('counts 3 lifts, and a hybrid counts as a lift', () => {
    const hybrid = session(30, { type: 'hybrid', variant: 'upper-b', lifted: true });
    const w = weeklyBudget(input([lowerA(24), upperA(48), hybrid]));
    expect(line(w, 'lifts')).toMatchObject({ done: 3, status: 'met' });
  });
  it('excludes a session from last program week', () => {
    const w = weeklyBudget(input([upperA(24 * 6)]));
    expect(line(w, 'lifts').done).toBe(0);
  });
  it('counts rest days before today with no session', () => {
    const w = weeklyBudget(input([upperA(24)]));
    // week is Mon 9th..Sun 15th, today Thu 12th, trained Wed 11th: Mon and Tue are rest.
    expect(w.restDays).toBe(2);
    expect(w.daysLeft).toBe(4);
    expect(w.trainingDays).toBe(1);
  });
});
