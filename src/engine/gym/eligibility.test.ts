import { describe, expect, it } from 'vitest';
import { exerciseAllowed } from './eligibility';

describe('exerciseAllowed', () => {
  const goblet = { id: 'goblet-squat', tags: ['db', 'kb'] };

  it('keeps an exercise when one of its tags is still available', () => {
    expect(exerciseAllowed(goblet, new Set(), new Set(), new Set(['db']))).toBe(true);
  });

  it('blocks an exercise only when every tag is unavailable', () => {
    expect(exerciseAllowed(goblet, new Set(), new Set(), new Set(['db', 'kb']))).toBe(false);
  });

  it('blocks an excluded id and a blocked id', () => {
    expect(exerciseAllowed({ id: 'swim', tags: ['pool'] }, new Set(['swim']), new Set(), new Set())).toBe(false);
    expect(exerciseAllowed({ id: 'leg-press', tags: ['machine'] }, new Set(), new Set(['leg-press']), new Set())).toBe(false);
  });

  it('does not apply the tag rule when the exercise declares no tags', () => {
    expect(exerciseAllowed({ id: 'x', tags: [] }, new Set(), new Set(), new Set(['db']))).toBe(true);
  });
});
