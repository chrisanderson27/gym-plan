import type { CssTest, PoolUnit } from '../../data/types';
import { SWIM_CSS_FALLBACK_ADD_SEC, SWIM_CSS_SANITY_MIN_GAP_SEC, SWIM_YD_TO_M_PACE } from '../config';

export interface Css {
  /** Seconds per 100 in the unit it was tested in (or converted to, when `approx`). */
  per100: number;
  /** From a 3×100 average rather than a 400/200 pair. */
  estimate: boolean;
  /** Converted between yards and metres. */
  approx?: boolean;
  warn?: string;
}

export function cssFromTest(t: Pick<CssTest, 't400' | 't200' | 't3x100'>): Css | null {
  if (t.t400 !== undefined && t.t200 !== undefined) {
    const gap = t.t400 - t.t200;
    return {
      per100: gap / 2,
      estimate: false,
      ...(gap < SWIM_CSS_SANITY_MIN_GAP_SEC ? { warn: 'The 400 and 200 times are very close: re-check them.' } : {}),
    };
  }
  if (t.t3x100 !== undefined) return { per100: t.t3x100 + SWIM_CSS_FALLBACK_ADD_SEC, estimate: true };
  return null;
}

/** Newest usable CSS test, converted to the current pool unit when it was taken in the other. */
export function latestCss(tests: CssTest[], poolUnit: PoolUnit): Css | null {
  const sorted = tests.filter((t) => t.kind === 'css').sort((a, b) => b.date.localeCompare(a.date));
  for (const t of sorted) {
    const css = cssFromTest(t);
    if (!css) continue;
    if (t.poolUnit === poolUnit) return css;
    // A yard pace is faster per 100 than a metre pace.
    const per100 = t.poolUnit === 'yd' ? css.per100 * SWIM_YD_TO_M_PACE : css.per100 / SWIM_YD_TO_M_PACE;
    return { ...css, per100, approx: true };
  }
  return null;
}
