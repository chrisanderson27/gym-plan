import type { CardioModality, ISODateTime, LocalDate, RunBlock, RunKind, RunSegment } from '../../data/types';
import {
  RUN_COOLDOWN_SEC, RUN_CUTBACK_EVERY_WEEKS, RUN_CUTBACK_FACTOR, RUN_EASY_MIN, RUN_LONG_PROGRESS_MAX_RPE, RUN_LONG_START_MIN,
  RUN_LONG_STEP_MIN, RUN_MIN_MIN, RUN_SPIKE_CAP, RUN_SPRINT_CAP_WEEKS, RUN_SPRINT_RPE_EARLY, RUN_SPRINT_RPE_LATE, RUN_WALK_LADDER,
  RUN_WALK_PROGRESS_MAX_RPE, RUN_WALK_WEEKS, RUN_WARMUP_SEC,
} from '../config';
import { weekIndex } from '../week';
import { longest30, paceSecPerMi, runCapSec, runsOnly, weeklySoftCapSec, type RunHistoryItem } from './guardrails';

export type { RunHistoryItem } from './guardrails';

/** Structural copy of content's RunFormatDef: the engine cannot import content. */
export interface RunFormatShape {
  format: NonNullable<RunBlock['format']>;
  name: string;
  modality: 'run' | 'treadmill';
  minWeek: number;
  bands: { fromWeek: number; repeats: number; segments: RunSegment[] }[];
}

export interface RunInput {
  now: ISODateTime;
  today: LocalDate;
  programStart: LocalDate;
  history: RunHistoryItem[];
  kind: RunKind;
  format?: RunBlock['format'];
  formats: RunFormatShape[];
  /** Last time each interval format was done, for round-robin. */
  lastDoneByFormat?: Record<string, ISODateTime | undefined>;
  durationMin?: number;
  makeId: () => string;
}
export interface RunPlan {
  block: RunBlock;
  plannedSec: number;
  estMi?: number;
  warmupSec: number;
  cooldownSec: number;
  reasons: string[];
  warnings: string[];
}

const LADDER_TOP = RUN_WALK_LADDER.length;
const segSec = (segs: RunSegment[]) => segs.reduce((n, s) => n + (s.sec ?? 0), 0);
const minutes = (sec: number) => Math.round(sec / 60);

/** Current Galloway rung: LADDER_TOP means "continuous". */
function currentRung(history: RunHistoryItem[]): number {
  const last = runsOnly(history)
    .filter((r) => r.kind !== 'intervals')
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return 0;
  const run = last.runWalkRatio ? Number(last.runWalkRatio.split(':')[0]) : NaN;
  const idx = RUN_WALK_LADDER.findIndex(([r]) => r === run);
  const rung = last.runWalkRatio ? (idx === -1 ? 0 : idx) : LADDER_TOP;
  if (last.painFlag) return Math.max(0, Math.min(rung, LADDER_TOP - 1) - 1);
  if (last.rpe <= RUN_WALK_PROGRESS_MAX_RPE) return Math.min(LADDER_TOP, rung + 1);
  return rung;
}

/** Repeats that fit `capSec`, never below 1 and never below the 15 min floor unless the cap itself is lower. */
function fitRepeats(fixedSec: number, repSec: number, repeats: number, capSec: number): number {
  const maxRep = Math.floor((capSec - fixedSec) / repSec);
  const minRep = Math.ceil((Math.min(RUN_MIN_MIN * 60, capSec) - fixedSec) / repSec);
  let r = Math.min(repeats, maxRep);
  r = Math.max(r, Math.min(minRep, maxRep));
  return Math.max(1, r);
}

/** When even one repetition exceeds the cap, shrink its segments proportionally so the hard cap holds. */
function trimToCap(segments: RunSegment[], capSec: number): RunSegment[] {
  const total = segSec(segments);
  if (total <= capSec || total <= 0) return segments;
  const k = Math.max(0, capSec) / total;
  return segments.map((s) => (s.sec === undefined ? s : { ...s, sec: Math.floor(s.sec * k) }));
}

export function generateRun(input: RunInput): RunPlan {
  const { history, kind, programStart, today, now } = input;
  const weekIdx = weekIndex(today, programStart);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const longest = longest30(history, now);
  const pace = paceSecPerMi(history);

  // One cap for the whole session: the 1.10× spike cap, tightened by the weekly soft cap.
  let capSec = runCapSec(longest, pace);
  const spikeCap = capSec;
  const weekly = weeklySoftCapSec(history, weekIdx, programStart);
  if (weekly !== null && weekly < capSec) capSec = Math.max(weekly, Math.min(RUN_MIN_MIN * 60, capSec));

  const capReason = () =>
    longest.durationSec <= 0
      ? 'no run in the last 30 days: capped at a 25 min starter'
      : `capped at ${RUN_SPIKE_CAP.toFixed(2)} × your ${minutes(longest.durationSec)} min longest run`;
  const noteCaps = (plannedSec: number, finalSec: number) => {
    if (finalSec >= plannedSec) return;
    if (capSec < spikeCap) warnings.push('weekly soft cap: this week already has a lot of running');
    else reasons.push(capReason());
  };

  let segments: RunSegment[];
  let repeats: number;
  let format: RunBlock['format'];
  let modality: CardioModality = 'run';
  let warmupSec = 0;
  let cooldownSec = 0;
  let plannedSec: number;

  if (kind === 'intervals') {
    const eligible = input.formats.filter((f) => f.minWeek <= weekIdx);
    let def = input.format ? input.formats.find((f) => f.format === input.format) : undefined;
    if (def && def.minWeek > weekIdx) {
      reasons.push(`${def.name} unlocks in week ${def.minWeek}`);
      def = undefined;
    }
    if (!def) {
      const last = input.lastDoneByFormat ?? {};
      def = eligible.reduce<RunFormatShape | undefined>(
        (best, f) => (!best || (last[f.format] ?? '') < (last[best.format] ?? '') ? f : best),
        undefined,
      );
    }
    if (!def) throw new Error('No interval format is available');
    const band = [...def.bands].reverse().find((b) => b.fromWeek <= weekIdx) ?? def.bands[0];
    if (!band) throw new Error(`Run format ${def.format} has no bands`);
    const rpe = weekIdx <= RUN_SPRINT_CAP_WEEKS ? RUN_SPRINT_RPE_EARLY : RUN_SPRINT_RPE_LATE;
    segments = band.segments.map((s) => (s.role === 'sprint' || s.role === 'run' ? { ...s, rpeTarget: rpe } : { ...s }));
    format = def.format;
    modality = def.modality;
    if (segSec(segments) > capSec) segments = trimToCap(segments, capSec);
    const repSec = segSec(segments);
    warmupSec = RUN_WARMUP_SEC;
    cooldownSec = RUN_COOLDOWN_SEC;
    // A tiny cap shrinks the warm-up/cool-down before it would force the work past the cap.
    if (capSec - warmupSec - cooldownSec < repSec) {
      const room = Math.max(0, capSec - repSec);
      warmupSec = Math.min(RUN_WARMUP_SEC, Math.floor((room * 2) / 3));
      cooldownSec = Math.min(RUN_COOLDOWN_SEC, room - warmupSec);
    }
    let wanted = band.repeats;
    if (input.durationMin) wanted = Math.max(1, Math.round((input.durationMin * 60 - warmupSec - cooldownSec) / repSec));
    repeats = fitRepeats(warmupSec + cooldownSec, repSec, wanted, capSec);
    plannedSec = warmupSec + cooldownSec + repeats * repSec;
    noteCaps(warmupSec + cooldownSec + wanted * repSec, plannedSec);
    reasons.push(`${def.name}: sprints at RPE ${rpe} (weeks 1–${RUN_SPRINT_CAP_WEEKS} cap at ${RUN_SPRINT_RPE_EARLY})`);
  } else {
    // easy / long
    let workMin: number;
    if (kind === 'easy') {
      workMin = [...RUN_EASY_MIN].reverse().find((e) => e.fromWeek <= weekIdx)?.min ?? RUN_EASY_MIN[0].min;
    } else {
      const lastLong = runsOnly(history).filter((r) => r.kind === 'long').sort((a, b) => b.date.localeCompare(a.date))[0];
      workMin = lastLong
        ? lastLong.durationSec / 60 + (!lastLong.painFlag && lastLong.rpe <= RUN_LONG_PROGRESS_MAX_RPE ? RUN_LONG_STEP_MIN : 0)
        : RUN_LONG_START_MIN;
      if (weekIdx % RUN_CUTBACK_EVERY_WEEKS === 0) {
        workMin *= RUN_CUTBACK_FACTOR;
        reasons.push(`cutback week: ×${RUN_CUTBACK_FACTOR}`);
      }
      workMin = Math.round(workMin);
    }
    if (input.durationMin) workMin = input.durationMin;
    const wantedSec = workMin * 60;
    let rung = currentRung(history);
    if (weekIdx <= RUN_WALK_WEEKS) rung = Math.min(rung, LADDER_TOP - 1);
    if (rung >= LADDER_TOP) {
      format = undefined;
      const sec = Math.max(Math.min(wantedSec, capSec), Math.min(RUN_MIN_MIN * 60, capSec));
      segments = [{ role: 'run', sec }];
      repeats = 1;
      plannedSec = sec;
    } else {
      const [r0, w0] = RUN_WALK_LADDER[rung] as readonly [number, number];
      segments = trimToCap([{ role: 'run', sec: r0 }, { role: 'walk', sec: w0 }], capSec);
      const [r, w] = [segments[0]?.sec ?? r0, segments[1]?.sec ?? w0];
      repeats = fitRepeats(0, Math.max(1, r + w), Math.max(1, Math.floor(wantedSec / Math.max(1, r + w))), capSec);
      plannedSec = repeats * (r + w);
      format = 'run-walk';
      reasons.push(`run-walk ${r}:${w} s${weekIdx <= RUN_WALK_WEEKS ? ` (weeks 1–${RUN_WALK_WEEKS})` : ''}`);
    }
    noteCaps(wantedSec, plannedSec);
  }

  const block: RunBlock = {
    id: input.makeId(), kind: 'run', runKind: kind, modality, repeats, segments,
    ...(format ? { format } : {}),
  };
  const mi = pace !== null && pace > 0 ? Math.floor((plannedSec / pace) * 10) / 10 : undefined;
  return { block, plannedSec, ...(mi !== undefined ? { estMi: mi } : {}), warmupSec, cooldownSec, reasons, warnings };
}
