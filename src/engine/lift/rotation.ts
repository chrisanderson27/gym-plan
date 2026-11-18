import type { LiftVariant } from '../../data/types';
import type { HistorySession } from './types';

/**
 * Alternates upper/lower and flips A/B within each half. `isReady` (optional) lets the caller steer to the
 * other half when the chosen half's muscles are still recovering and the other's are not.
 */
/** The next A/B letter for one half, from the most recent session of that half. */
export function nextVariantFor(history: HistorySession[], half: 'upper' | 'lower'): LiftVariant {
  const prev = [...history.filter((h) => h.session.variant)].reverse().find((h) => h.session.variant!.startsWith(half))?.session.variant;
  return `${half}-${prev?.endsWith('-a') ? 'b' : 'a'}` as LiftVariant;
}

export function nextVariant(
  history: HistorySession[],
  isReady?: (v: LiftVariant) => boolean,
): { variant: LiftVariant; why: string } {
  const withVariant = history.filter((h) => h.session.variant);
  const last = withVariant.at(-1)?.session.variant;
  if (!last) return { variant: 'lower-a', why: 'First session: start with Lower A and calibrate' };

  const letterFor = (half: 'upper' | 'lower'): LiftVariant => nextVariantFor(withVariant, half);
  const lastHalf = last.startsWith('upper') ? 'upper' : 'lower';
  const half = lastHalf === 'upper' ? 'lower' : 'upper';
  const other = half === 'upper' ? 'lower' : 'upper';
  const pick = letterFor(half);
  if (isReady && !isReady(pick)) {
    const alt = letterFor(other);
    if (isReady(alt)) return { variant: alt, why: `${pick} muscles still recovering — ${alt} instead` };
  }
  return { variant: pick, why: `After ${last}: ${pick}` };
}
