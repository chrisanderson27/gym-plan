import { expect, it } from 'vitest';
import { runReviewActuals, startedClock } from './runReview';

const form = { distance: '', minutes: '20', modality: 'run' as const, rpe: 6, pain: false };

it('a block with no clock, or an unstarted one, is not a started run', () => {
  expect(startedClock(undefined)).toBe(false);
  expect(startedClock({ startedAt: null })).toBe(false);
  expect(startedClock({ startedAt: 1 })).toBe(true);
});

it('requires an effort and a positive duration, and treats a blank distance as unknown', () => {
  expect(runReviewActuals({ ...form, rpe: null })).toBeNull();
  expect(runReviewActuals({ ...form, minutes: '0' })).toBeNull();
  expect(runReviewActuals({ ...form, distance: '-1' })).toBeNull();
  expect(runReviewActuals(form)).toEqual({ distanceMi: 0, durationSec: 1200, modality: 'run', rpe: 6, painFlag: false });
});
