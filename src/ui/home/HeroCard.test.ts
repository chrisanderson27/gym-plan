import { describe, expect, it } from 'vitest';
import type { CardioSnapshot } from '../../data/cardio';
import type { Candidate } from '../../engine/plan/types';
import { heroFor } from './HeroCard';

const now = new Date(2026, 10, 19, 12);
const snapshot: CardioSnapshot = {
  runHistory: [], cssTests: [], lastDone: {}, lastByType: {}, lastIntervalFormat: {}, excluded: new Set(),
  settings: undefined,
};
const pick = (id: Candidate['id'], tile: Candidate['tile']): Candidate => ({
  id, tile, title: tile, route: `#/${tile}`, status: 'eligible', reasons: [],
  score: { unmet: 0, daysSince: 0, readyHoursLeft: 0 },
});

describe('Today hero duration', () => {
  it('shows the rounded lift-day estimate and floor', () => {
    expect(heroFor(pick('lift-upper', 'lift'), null, now, { estMin: 51.5, floor: 2 }))
      .toMatchObject({ duration: 52, place: 'upstairs' });
  });

  it('uses the capped run plan for the ranked Run kind', () => {
    const cardio: CardioSnapshot = {
      ...snapshot,
      runHistory: [{ date: '2026-11-18T15:00:00Z', kind: 'easy', modality: 'run', distanceMi: 1, durationSec: 600, rpe: 5, painFlag: false }],
    };
    expect(heroFor(pick('run-long', 'run'), cardio, now).duration).toBe(9);
  });

  it('estimates the first swim before the pool or CSS is set', () => {
    expect(heroFor(pick('swim', 'swim'), snapshot, now).duration).toBe(42);
  });

  it('uses the next swim workout and CSS send-offs when available', () => {
    const cardio: CardioSnapshot = {
      ...snapshot,
      lastDone: { 'swim-easy-technique': '2026-11-18T15:00:00Z' },
      cssTests: [{ id: 'css', kind: 'css', date: '2026-11-18T15:00:00Z', poolUnit: 'yd', t200: 200, t400: 400 }],
    };
    expect(heroFor(pick('swim', 'swim'), cardio, now).duration).toBe(38);
  });
});
