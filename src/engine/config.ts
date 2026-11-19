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

// ---- P3 cardio ----
export const TIMER_TICK_MS = 250;
export const TIMER_BEEP_LEAD_SEC = 3; // 3-2-1 before each phase change
export const TIMER_MAX_BEEP_GAP_SEC = 2; // a longer jump (resume) is silent
export const BURN_BUDGETS_MIN = [30, 45, 55, 60] as const;
export const BURN_DEFAULT_MIN = 55;
export const RUN_SPIKE_CAP = 1.1; // §5: ≤ 1.10 × longest run in 30 d
export const RUN_LOOKBACK_DAYS = 30;
export const RUN_COLD_START_MAX_MIN = 25; // no run in 30 d → safe starter
export const RUN_WEEKLY_SOFT_CAP = 1.15; // +10–15 %
export const RUN_CUTBACK_EVERY_WEEKS = 4;
export const RUN_CUTBACK_FACTOR = 0.75; // 70–80 %
export const RUN_WALK_WEEKS = 3; // weeks 1–3 run-walk
export const RUN_WALK_LADDER = [[60, 90], [60, 60], [120, 60], [180, 60], [240, 60], [480, 60]] as const; // [runSec, walkSec]
export const RUN_WALK_PROGRESS_MAX_RPE = 5;
export const RUN_SPRINT_CAP_WEEKS = 6; // weeks 1–6 sprints at RPE 8–9
export const RUN_SPRINT_RPE_EARLY = 8;
export const RUN_SPRINT_RPE_LATE = 9;
export const RUN_WARMUP_SEC = 600;
export const RUN_COOLDOWN_SEC = 300;
export const RUN_MIN_MIN = 15; // the caps never shorten a run below this
export const RUN_EASY_MIN = [{ fromWeek: 1, min: 25 }, { fromWeek: 3, min: 30 }, { fromWeek: 6, min: 35 }] as const;
export const RUN_LONG_START_MIN = 30;
export const RUN_LONG_STEP_MIN = 5;
export const RUN_LONG_PROGRESS_MAX_RPE = 5;
export const SWIM_CSS_FALLBACK_ADD_SEC = 5; // 3×100 avg + 5 s (flagged estimate)
export const SWIM_YD_TO_M_PACE = 1.09;
export const SWIM_SENDOFF_ROUND_SEC = 5; // round UP to :05
export const SWIM_SENDOFF_OFFSET_SEC = { EZ: 30, MOD: 20, CSS: 15, FAST: 20 } as const; // per 100, added to CSS
export const SWIM_DRILL_OFFSET_SEC = 40;
export const SWIM_REST_SEC = { EZ: 15, MOD: 20, CSS: 20, FAST: 30, SPRINT: 45 } as const; // no-CSS fallback, and kick/sprint always
export const SWIM_PADDLES_FROM_WEEK = 3;
export const SWIM_CSS_SANITY_MIN_GAP_SEC = 100; // T400 − T200 well under this → warn

// ---- P4 plan & body ----
export const BUDGET = { hardCardioMax: 2, liftsMin: 2, liftsMax: 3, longRunMin: 1, longRunMax: 1, swimsMin: 1, swimsMax: 2, restMin: 1 } as const;
export const LOWER_MUSCLES = ['quads', 'glutes', 'hamstrings'] as const;
export const LOWER_SESSION_MIN_SETS = 3; // working sets on a lower primary that make a non-variant session "lower"
export const LOWER_AFTER_LOWER_H = 48;
export const HARD_RUN_AFTER_HEAVY_LEGS_H = 24;
export const LOWER_AFTER_HARD_RUN_H = 48;
export const HARD_SPACING_H = 48;
export const LONG_AFTER_HARD_RUN_H = 24;
export const PICK_WINDOW_DAYS = 14;
export const RING_FALLBACK_MIN_DAYS = 2;
export const BODY_MAINTAIN_BAND_LB = 2;
export const HYBRID_LIFT_MIN = 30;
export const HYBRID_CARDIO_MIN = 20;
export const HYBRID_LEG_MODALITIES = ['bike', 'row', 'ski'] as const;
export const HYBRID_LEG_DEFAULT = 'bike';
/** Display names for cardio modality ids (shared by history summaries and the UI label helpers). */
export const CARDIO_MODALITY_LABELS = {
  run: 'Run', treadmill: 'Treadmill', bike: 'Bike', row: 'Rower', ski: 'Ski erg', stair: 'Stair climber', elliptical: 'Elliptical',
} as const;
export const BODY_EMA_ALPHA = 0.1;
export const BODY_RATE_WINDOW_DAYS = 14;
export const BODY_RATE_MIN_SPAN_DAYS = 7;
export const BODY_RATE_BAND_LB = [1.25, 2.5] as const; // loss per week
export const WAIST_EVERY_DAYS = 7;
export const BODY_WEIGHT_RANGE_LB = [50, 700] as const;
export const BODY_WAIST_RANGE_IN = [15, 80] as const;
export const HISTORY_PAGE = 50;
