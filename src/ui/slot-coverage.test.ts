import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Screens that legitimately carry no feedback button; each needs a reason. */
const NO_FEEDBACK = [
  'CssTestScreen.tsx', // one-off test entry form, not a workout
  'BlocksScreen.tsx', // saved-block library, not a workout
  'ProgressScreen.tsx', // PRD 4 §7 pinned training log header omits More
];

describe('feedback slot coverage (PRD §5: screen-level feedback via More)', () => {
  it('every *Screen.tsx mounts MoreMenu or is allowlisted', () => {
    const files = (readdirSync(__dirname, { recursive: true }) as string[]).filter((f) => f.endsWith('Screen.tsx'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const name = basename(f);
      if (NO_FEEDBACK.includes(name)) continue;
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src.includes('MoreMenu'), `${name}: mount <MoreMenu> or add it to NO_FEEDBACK with a reason (PRD §5: screen-level feedback via More)`).toBe(true);
    }
  });
});
