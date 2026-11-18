/** Single home of tunable thresholds (PRD §17). Later phases add to it. */
export const REP_RANGES = {
  compound: [6, 10],
  machine: [8, 12],
  isolation: [12, 15],
} as const;

export const HARD_RPE = 8;
export const BACKUP_STALE_DAYS = 7;
export const RAMP_IN_WEEKS = 2;
export const DELOAD_EVERY_WEEKS = 6;
export const MISSED_REP_DELOAD_PCT = 0.075;
