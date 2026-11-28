import { describe, expect, it } from 'vitest';
import { draftFitMinutes, draftProblem, draftWarnings, roundsLine, type DraftCheckInput } from './draftCheck';

// Two minutes keeps one leg press inside the round limit.
const ok: DraftCheckInput = {
  name: 'A', kind: 'self-paced', minutes: '2', workSec: NaN, restSec: NaN, transitionSec: NaN,
  stations: [{ exerciseId: 'leg-press', unit: 'reps', amount: '10', load: '' }],
};
const withStation = (patch: Partial<DraftCheckInput['stations'][number]>): DraftCheckInput => ({ ...ok, stations: [{ ...ok.stations[0]!, ...patch }] });

describe('draftProblem', () => {
  it('accepts a valid draft', () => expect(draftProblem(ok)).toBeUndefined());
  it('says why Save is blocked', () => {
    expect(draftProblem({ ...ok, name: '  ' })).toMatch(/name/);
    expect(draftProblem({ ...ok, minutes: '61' })).toBe('Enter minutes from 1 to 60.');
    expect(draftProblem(withStation({ amount: '0' }))).toMatch(/greater than 0 and at most 999/);
    expect(draftProblem(withStation({ amount: '99999' }))).toMatch(/at most 999/);
    expect(draftProblem(withStation({ unit: 'sec', amount: '3601' }))).toMatch(/at most 3600/);
    expect(draftProblem({ ...ok, stations: [] })).toMatch(/at least one/);
  });
  it('caps coached work seconds', () => {
    const coached = { ...ok, kind: 'coached' as const, workSec: 0, restSec: 15, transitionSec: 5 };
    expect(draftProblem(coached)).toMatch(/Work time/);
    expect(draftProblem({ ...coached, workSec: 9999 })).toMatch(/Work time/);
    expect(draftProblem({ ...coached, workSec: 40 })).toBeUndefined();
  });
});

describe('balance and length', () => {
  const station = (exerciseId: string, unit = 'reps', amount = '8') => ({ exerciseId, unit, amount, load: '' });
  const coached = (minutes: string, ids: string[]): DraftCheckInput => ({
    ...ok, kind: 'coached', minutes, workSec: 30, restSec: 0, transitionSec: 10, stations: ids.map((id) => station(id)),
  });

  it('refuses two exercises across 21 minutes and offers the three-round length', () => {
    const d = coached('21', ['seated-cable-row', 'push-up']);
    expect(draftProblem(d)).toBe('2 exercises for 21 minutes repeats about 16 times. Use 4 min or add exercises.');
    expect(draftWarnings(d)).toEqual([]);
    expect(draftFitMinutes(d)).toBe(4);
    expect(draftFitMinutes({ ...d, minutes: '4' })).toBeUndefined();
    expect(draftProblem({ ...d, minutes: '4' })).toBeUndefined();
  });

  it('warns, but still saves, five or six rounds', () => {
    const d = coached('8', ['seated-cable-row', 'push-up']);
    expect(draftProblem(d)).toBeUndefined();
    expect(draftWarnings(d)).toEqual(['2 exercises for 8 minutes repeats about 6 times. Use 4 min or add exercises.']);
  });

  it('blocks more than six rounds and three of one group in a row', () => {
    expect(draftProblem({ ...ok, minutes: '8' })).toBe('1 exercise for 8 minutes repeats about 12 times. Use 2 min or add exercises.');
    expect(draftFitMinutes({ ...ok, minutes: '8' })).toBe(2);
    expect(draftProblem(coached('6', ['dead-bug', 'plank', 'farmer-carry'])))
      .toBe('Dead bug, plank and farmer carry are 3 core moves in a row. Put a different move between them.');
  });

  it('warns about back-to-back core, including across the loop, and too much core', () => {
    const d = coached('6', ['reverse-lunge', 'dead-bug', 'plank']);
    expect(draftProblem(d)).toBeUndefined();
    expect(draftWarnings(d)).toEqual([
      'Dead bug and plank are back to back. Put a different move between them.',
      '2 of 3 exercises are core moves. Keep it to 1.',
      'These exercises cover 2 movement groups. Mix in at least 3 of legs, push, pull, core and cardio.',
    ]);
    expect(draftWarnings(coached('6', ['plank', 'reverse-lunge', 'push-up', 'dead-bug'])))
      .toEqual(['Dead bug and plank are back to back when the block loops. Put a different move between them.', '2 of 4 exercises are core moves. Keep it to 1.']);
  });

  it('counts a refused block up, keeps proper names and never offers the length already set', () => {
    const selfPaced = (minutes: string, stations: DraftCheckInput['stations']): DraftCheckInput => ({ ...ok, minutes, stations });
    expect(draftProblem(selfPaced('7', [station('push-up'), station('seated-db-press')])))
      .toBe('2 exercises for 7 minutes repeats about 7 times. Use 4 min or add exercises.');
    expect(draftWarnings(coached('6', ['goblet-squat', 'romanian-deadlift', 'push-up'])))
      .toContain('Goblet squat and Romanian deadlift are back to back. Put a different move between them.');
    expect(draftWarnings(selfPaced('60', [station('farmer-carry', 'm', '2000')])))
      .toContain('1 exercise for 60 minutes fits less than 2 rounds. Remove exercises.');
  });

  it('saves nine balanced exercises and refuses a tenth', () => {
    const nine = ['goblet-squat', 'seated-cable-row', 'push-up', 'plank', 'reverse-lunge', 'one-arm-db-row', 'seated-db-press', 'dead-bug', 'rower'];
    const d = coached('18', nine);
    expect(draftProblem(d)).toBeUndefined();
    expect(draftWarnings(d)).toEqual([]);
    expect(draftProblem(coached('18', [...nine, 'step-up']))).toBe('A block holds at most 9 exercises.');
  });

  it('describes the rounds a saved block holds', () => {
    expect(roundsLine({ kind: 'coached', durationSec: 720, workSec: 30, restSec: 0, transitionSec: 10,
      stations: Array.from({ length: 6 }, (_, i) => ({ exerciseId: String(i), target: { unit: 'reps' as const, amount: 8 } })) }))
      .toBe('6 exercises × about 3 rounds');
    expect(roundsLine({ kind: 'self-paced', durationSec: 60, stations: [{ exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } }] }))
      .toBe('1 exercise × about 2 rounds');
    expect(roundsLine({ kind: 'coached', durationSec: 600 })).toBeUndefined();
  });
});
