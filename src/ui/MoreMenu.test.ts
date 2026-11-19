import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotContext } from './MoreMenu';

describe('feedback context snapshot (PRD §5)', () => {
  it('copies ids and screen so later prop changes cannot retarget the entry', () => {
    const live = { sessionId: 's1', exerciseId: 'a' };
    const snap = snapshotContext(live, '#/burn');
    live.exerciseId = 'b';
    expect(snap).toEqual({ sessionId: 's1', exerciseId: 'a', screen: '#/burn' });
  });

  it('MoreMenu stores the snapshot on open, not live props, for the sheet', () => {
    const src = readFileSync(join(__dirname, 'MoreMenu.tsx'), 'utf8');
    expect(src).toContain('setSnap(snapshotContext(context');
    expect(src).toContain('context={snap}');
  });

  it('keeps calibration feedback in the session header', () => {
    const card = readFileSync(join(__dirname, 'lift/CalibrationCard.tsx'), 'utf8');
    const session = readFileSync(join(__dirname, 'lift/SessionScreen.tsx'), 'utf8');
    expect(card).not.toContain('<MoreMenu');
    expect(session).toMatch(/<MoreMenu feedback=\{\{ kind: 'workout', context: \{ sessionId \}/);
  });
});
