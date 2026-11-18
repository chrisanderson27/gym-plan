/** First entry above `current` (and at least `minIncrement` above it); null at the top of the rack. */
export function nextStep(steps: number[], current: number, minIncrement = 0): number | null {
  for (const s of steps) if (s > current && s >= current + minIncrement) return s;
  return null;
}

/** Closest entry; ties go down (safer). */
export function nearestStep(steps: number[], w: number): number {
  let best: number | undefined;
  for (const s of steps) if (best === undefined || Math.abs(s - w) < Math.abs(best - w)) best = s;
  return best ?? w;
}

/** Move `n` entries from the nearest index, clamped to the list. */
export function stepBy(steps: number[], current: number, n: number): number {
  if (steps.length === 0) return current;
  const near = nearestStep(steps, current);
  const i = steps.indexOf(near);
  const j = Math.min(steps.length - 1, Math.max(0, i + n));
  return steps[j] ?? current;
}
