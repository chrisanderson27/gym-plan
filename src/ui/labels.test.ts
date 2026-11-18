import { describe, expect, it } from 'vitest';
import { humanize, plural, tagLabel, sessionTypeLabel, exerciseName } from './labels';

describe('display labels', () => {
  it('maps variant ids inside free text and leaves the rest alone', () => {
    expect(humanize('After lower-a: upper-b')).toBe('After Lower A: Upper B');
    expect(humanize('upper-a muscles still recovering — lower-b instead')).toBe('Upper A muscles still recovering — Lower B instead');
    expect(humanize('No history yet — calibrate first')).toBe('No history yet — calibrate first');
  });
  it('title-cases feedback tags and session types', () => {
    expect(tagLabel('too-easy')).toBe('Too easy');
    expect(tagLabel('adjacent-machines')).toBe('Adjacent machines');
    expect(sessionTypeLabel('hybrid')).toBe('Hybrid');
  });
  it('pluralises', () => {
    expect(plural(1, 'set')).toBe('1 set');
    expect(plural(3, 'set')).toBe('3 sets');
  });
  it('falls back to the id for an unknown exercise', () => {
    expect(exerciseName('no-such-exercise')).toBe('no-such-exercise');
  });
});
