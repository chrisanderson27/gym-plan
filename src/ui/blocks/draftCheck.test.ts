import { describe, expect, it } from 'vitest';
import { draftProblem, type DraftCheckInput } from './draftCheck';

const ok: DraftCheckInput = {
  name: 'A', kind: 'self-paced', minutes: '8', workSec: NaN, restSec: NaN, transitionSec: NaN,
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
