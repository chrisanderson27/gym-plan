import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotContext } from './FeedbackButton';

describe('feedback context snapshot (PRD §5)', () => {
  it('copies ids and screen so later prop changes cannot retarget the entry', () => {
    const live = { sessionId: 's1', exerciseId: 'a' };
    const snap = snapshotContext(live, '#/burn');
    live.exerciseId = 'b';
    expect(snap).toEqual({ sessionId: 's1', exerciseId: 'a', screen: '#/burn' });
  });

  it('FeedbackButton stores the snapshot on open, not live props, for the sheet', () => {
    const src = readFileSync(join(__dirname, 'FeedbackButton.tsx'), 'utf8');
    expect(src).toContain('setSnap(snapshotContext(context');
    expect(src).toContain('context={snap}');
  });

  it('calibration rows mount set-level feedback with the set id', () => {
    const src = readFileSync(join(__dirname, '../lift/CalibrationCard.tsx'), 'utf8');
    expect(src).toMatch(/<FeedbackButton kind="set"[^>]*setId: s\.id/);
  });
});
