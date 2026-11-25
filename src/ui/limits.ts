/** Shared input bounds and one validator, so every numeric field refuses and explains the same way. */
export const LIMITS = {
  rounds: 99,
  strengthReps: 999,
  targetReps: 999,
  workSec: 3600,
  swimMeters: 20000,
  swimMinutes: 600,
  poolLength: 200,
} as const;

/** Returns a user-facing message when `raw` is not a whole/decimal number within [min, max]; undefined when fine or blank. */
export function rangeError(raw: string, label: string, max: number, opts: { min?: number; integer?: boolean } = {}): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const n = Number(text);
  const min = opts.min ?? 0;
  if (!Number.isFinite(n) || (opts.integer && !Number.isInteger(n))) return `${label} must be a ${opts.integer ? 'whole ' : ''}number.`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return undefined;
}
