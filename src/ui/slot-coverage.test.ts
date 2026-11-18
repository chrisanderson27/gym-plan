import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Screens that legitimately carry no feedback button; each needs a reason. */
const NO_FEEDBACK = [
  'GymScreen.tsx', // equipment/gym settings editor, not a workout
  'VolumeScreen.tsx', // read-only weekly volume table
  'CssTestScreen.tsx', // one-off test entry form, not a workout
];

describe('feedback slot coverage (PRD §5: feedback from any workout, exercise or set)', () => {
  it('every *Screen.tsx mounts FeedbackButton or is allowlisted', () => {
    const files = (readdirSync(__dirname, { recursive: true }) as string[]).filter((f) => f.endsWith('Screen.tsx'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const name = basename(f);
      if (NO_FEEDBACK.includes(name)) continue;
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src.includes('FeedbackButton'), `${name}: mount <FeedbackButton> or add it to NO_FEEDBACK with a reason (PRD §5: feedback from any workout, exercise or set)`).toBe(true);
    }
  });
});
