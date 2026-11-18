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

// ---- P2 lifting ----
export const BASE_WORKING_SETS = 3;
export const RAMP_IN_VOLUME = 0.6; // weeks 1–2 at ~60% (§5 safety)
export const DELOAD_SET_FACTOR = 0.5; // ~half the sets
export const DELOAD_RIR = 3;
export const DEFAULT_RIR_TARGET = 2;
export const RAMP_IN_RIR = 3;
export const READY_HOURS = 48;
export const READY_HOURS_NEAR_FAILURE = 72;
export const VOLUME_TARGETS = [
  // fractional sets / muscle / program week
  { fromWeek: 1, min: 5, max: 6 }, // ramp-in: 60% of 8–10
  { fromWeek: 3, min: 8, max: 10 },
  { fromWeek: 9, min: 12, max: 16 },
] as const;
export const VOLUME_CEILING = 20;
export const PRIMARY_SET_WEIGHT = 1;
export const SECONDARY_SET_WEIGHT = 0.5;
export const TRACKED_MUSCLES = ['quads', 'glutes', 'hamstrings', 'calves', 'chest', 'side-delts', 'rear-delts', 'lats', 'mid-back', 'biceps', 'triceps', 'abs'] as const;
export const BARBELL_LOWER_MIN_INCREMENT_LB = 10; // §5 "+10 lb barbell lower"
export const MISSES_BEFORE_REDUCE = 2;
export const FATIGUE_MISSED_EXERCISES = 3;
export const DELOAD_TRIGGER_SESSIONS = 2; // consecutive lift sessions…
export const DELOAD_TRIGGER_MISSED = 2; // …each with ≥ this many missed exercises
export const DELOAD_LENGTH_DAYS = 7;
export const CALIBRATION_REPS = 10;
export const CALIBRATION_JUMP_STEPS = { db: 2, kb: 1, barbell: 4, machine: 2, cable: 2, cardio: 0, bodyweight: 0 } as const;
export const PAIN_FLAGS_FOR_SWAP = 2;
export const PAIN_WINDOW_DAYS = 28;
export const JOINT_FRIENDLY_WEEKS = 4;
export const WARMUP_MIN = 7; // 6–8 min block
export const MIN_PER_SET = { compound: 3, machine: 2.5, isolation: 2, other: 2 } as const;
export const DEFAULT_LIFT_BUDGET_MIN = 60;
export const LIFT_BUDGETS_MIN = [30, 45, 60, 75] as const;
export const MIN_EXERCISES = 2;
export const HISTORY_WINDOW_DAYS = 120; // older history → recalibrate
export const RESUME_WINDOW_HOURS = 12;
