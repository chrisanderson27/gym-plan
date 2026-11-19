import { describe, expect, it } from 'vitest';
import type { Session } from '../../data/types';
import { toPlanSession } from './classify';
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
  it('counts logged loaded lift circuits toward lifts and Burn circuits toward hard cardio', () => {
    const start = session(24);
    const lift: Session = {
      id: 'circuit-lift', date: start.start, endedAt: start.end, type: 'lift', hard: false, hardCardio: false,
      notes: '', rpe: null, durationMin: 30, blocks: [{
        id: 'c', kind: 'circuit', role: 'block', podId: 'turf', targetRounds: 4, durationSec: 480,
        stations: [{ exerciseId: 'goblet-squat', load: 15, target: { unit: 'reps', amount: 10 } }],
        log: { completedRounds: 3, actualDurationSec: 480, stations: [{ exerciseId: 'goblet-squat' }] },
      }],
    };
    const liftPlan = toPlanSession(lift, [], undefined, new Map());
    const burnPlan = toPlanSession({ ...lift, id: 'circuit-burn', type: 'burn', hard: true, hardCardio: true }, [], undefined, new Map());
    const w = weeklyBudget(input([liftPlan, burnPlan]));
    expect(line(w, 'lifts').done).toBe(1);
    expect(line(w, 'hard').done).toBe(1);
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
