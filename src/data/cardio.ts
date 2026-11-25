import { EXERCISES } from '../content/exercises';
import { classifyHard } from '../engine/hard';
import type { RunHistoryItem } from '../engine/run/generator';
import type { GymDb } from './db';
import { newId } from './ids';
import { poolOf } from './settings';
import type {
  CssTest, IntervalBlock, ISODateTime, RunBlock, RunSegment, Session, SessionType, Settings, SwimSetBlock,
} from './types';

const SNAPSHOT_DAYS = 60;
const CARDIO_TYPES: SessionType[] = ['burn', 'run', 'swim'];

export interface CardioSnapshot {
  runHistory: RunHistoryItem[];
  /** Latest session instant per `templateId` (burn/run/swim). */
  lastDone: Record<string, ISODateTime>;
  /** Latest session instant per type. */
  lastByType: Partial<Record<SessionType, ISODateTime>>;
  /** Last time each interval format was run, for round-robin. */
  lastIntervalFormat: Record<string, ISODateTime>;
  cssTests: CssTest[];
  excluded: Set<string>;
  settings: Settings | undefined;
}

/** One bounded read per store: sessions by date, then their run rows, tests, overrides and settings. */
export async function loadCardioSnapshot(db: GymDb, now = new Date()): Promise<CardioSnapshot> {
  const since = new Date(now.getTime() - SNAPSHOT_DAYS * 86_400_000).toISOString();
  const sessions = await db.sessions.where('date').aboveOrEqual(since).toArray();
  const cardio = sessions.filter((s) => CARDIO_TYPES.includes(s.type));
  const runIds = sessions.filter((s) => s.type === 'run' || s.type === 'hybrid' || (s.type === 'custom' && !!s.mixed)).map((s) => s.id);
  const [runRows, cssTests, overrides, settings] = await Promise.all([
    db.runs.where('sessionId').anyOf(runIds).toArray(),
    db.tests.where('kind').equals('css').toArray(),
    db.exerciseOverrides.toArray(),
    db.settings.get('settings'),
  ]);

  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const runHistory: RunHistoryItem[] = [];
  for (const r of runRows) {
    const date = dateOf.get(r.sessionId);
    if (!date) continue;
    runHistory.push({
      date, kind: r.kind, modality: r.modality ?? 'run', distanceMi: r.distanceMi, durationSec: r.durationSec,
      rpe: r.rpe, painFlag: r.painFlag, ...(r.runWalkRatio ? { runWalkRatio: r.runWalkRatio } : {}),
    });
  }

  const lastDone: Record<string, ISODateTime> = {};
  const lastByType: Partial<Record<SessionType, ISODateTime>> = {};
  const lastIntervalFormat: Record<string, ISODateTime> = {};
  const later = (a: string | undefined, b: string) => (a === undefined || b > a ? b : a);
  for (const s of cardio) {
    lastByType[s.type] = later(lastByType[s.type], s.date);
    if (s.templateId) lastDone[s.templateId] = later(lastDone[s.templateId], s.date);
    const block = s.blocks[0];
    if (s.type === 'run' && block?.kind === 'run' && block.runKind === 'intervals' && block.format) {
      lastIntervalFormat[block.format] = later(lastIntervalFormat[block.format], s.date);
    }
  }
  for (const s of sessions) {
    // A mixed workout's run block is not first, so read it by kind.
    const run = s.type === 'custom' && s.mixed ? s.blocks.find((b) => b.kind === 'run') : undefined;
    if (run?.kind === 'run' && run.runKind === 'intervals' && run.format) {
      lastIntervalFormat[run.format] = later(lastIntervalFormat[run.format], s.date);
    }
  }
  return {
    runHistory, lastDone, lastByType, lastIntervalFormat, cssTests,
    excluded: new Set(overrides.filter((o) => o.notAtMyGym).map((o) => o.exerciseId)),
    settings,
  };
}

/** Substitutes and display names for the engine, which cannot import content. */
export function burnInputs(): { substitutesOf: Record<string, string[]>; labelOf: Record<string, string> } {
  const substitutesOf: Record<string, string[]> = {};
  const labelOf: Record<string, string> = {};
  for (const e of EXERCISES) {
    substitutesOf[e.id] = e.substitutes;
    labelOf[e.id] = e.name;
  }
  return { substitutesOf, labelOf };
}

const minutesBetween = (startedAt: ISODateTime, now: Date) => Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 60_000));

export async function saveBurn(
  db: GymDb,
  input: { templateId: string; blocks: IntervalBlock[]; rpe: number | null; startedAt: ISODateTime; id?: string },
  now = new Date(),
): Promise<string> {
  const id = input.id ?? newId();
  const session: Session = {
    id, date: input.startedAt, type: 'burn', templateId: input.templateId, blocks: input.blocks,
    ...classifyHard({ type: 'burn', rpe: input.rpe, runKinds: [] }),
    rpe: input.rpe, durationMin: minutesBetween(input.startedAt, now), notes: '', endedAt: now.toISOString(),
  };
  await db.sessions.add(session);
  return id;
}

export const runWalkRatioOf = (block: RunBlock): string | undefined => {
  const [run, walk] = block.segments;
  return block.format === 'run-walk' && run?.sec && walk?.sec ? `${run.sec}:${walk.sec}` : undefined;
};

export async function saveRun(
  db: GymDb,
  input: {
    block: RunBlock; distanceMi: number; durationSec: number; rpe: number; painFlag: boolean; startedAt: ISODateTime;
    modality?: RunBlock['modality']; id?: string;
  },
  now = new Date(),
): Promise<string> {
  const id = input.id ?? newId();
  const { block } = input;
  const modality = input.modality ?? block.modality;
  const ratio = runWalkRatioOf(block);
  const intervals: RunSegment[] = block.segments;
  await db.transaction('rw', db.sessions, db.runs, async () => {
    await db.sessions.add({
      id, date: input.startedAt, type: 'run', templateId: `run-${block.format ?? block.runKind}`, blocks: [{ ...block, modality }],
      ...classifyHard({ type: 'run', rpe: input.rpe, runKinds: [block.runKind] }),
      rpe: input.rpe, durationMin: Math.max(1, Math.round(input.durationSec / 60)), notes: '', endedAt: now.toISOString(),
    });
    await db.runs.add({
      sessionId: id, kind: block.runKind, modality, distanceMi: input.distanceMi, durationSec: input.durationSec, intervals,
      ...(ratio ? { runWalkRatio: ratio } : {}), rpe: input.rpe, painFlag: input.painFlag,
    });
  });
  return id;
}

export interface CssInput {
  t400?: number;
  t200?: number;
  t3x100?: number;
}

/** A complete 400/200 pair (400 slower) wins; otherwise a 3×100 average. Anything else is rejected. */
export function validateCss(i: CssInput): Pick<CssTest, 't400' | 't200' | 't3x100'> {
  const pair = i.t400 !== undefined && i.t200 !== undefined;
  if (pair) {
    if (!(i.t400! > i.t200! && i.t200! > 0)) throw new Error('The 400 time must be slower than the 200 time');
    return { t400: i.t400!, t200: i.t200! };
  }
  if (i.t3x100 !== undefined && i.t3x100 > 0) return { t3x100: i.t3x100 };
  throw new Error('Enter both the 400 and 200 times, or a 3×100 average');
}

export async function saveCssTest(db: GymDb, input: CssInput, now = new Date()): Promise<string> {
  const times = validateCss(input);
  const settings = await db.settings.get('settings');
  const id = newId();
  await db.tests.add({ id, kind: 'css', date: now.toISOString(), poolUnit: settings?.poolUnit ?? 'yd', ...times });
  return id;
}

export async function saveSwim(
  db: GymDb,
  input: {
    workoutId: string; blocks: SwimSetBlock[]; distance: number; rpe: number; shoulderPainFlag: boolean; durationMin: number;
    startedAt: ISODateTime; css?: CssInput; id?: string;
  },
  now = new Date(),
): Promise<string> {
  const id = input.id ?? newId();
  const times = input.css ? validateCss(input.css) : null; // fail before writing anything
  await db.transaction('rw', db.settings, db.sessions, db.swims, db.tests, async () => {
    // Read inside the transaction so the row records the pool this swim really used.
    const pool = poolOf(await db.settings.get('settings'));
    if (!pool) throw new Error('Set your pool before logging a swim');
    await db.sessions.add({
      id, date: input.startedAt, type: 'swim', templateId: input.workoutId, blocks: input.blocks,
      ...classifyHard({ type: 'swim', rpe: input.rpe, runKinds: [] }),
      rpe: input.rpe, durationMin: input.durationMin, notes: '', endedAt: now.toISOString(),
    });
    await db.swims.add({
      sessionId: id, ...pool, distance: input.distance, sets: input.blocks,
      rpe: input.rpe, shoulderPainFlag: input.shoulderPainFlag,
    });
    if (times) await db.tests.add({ id: newId(), kind: 'css', date: now.toISOString(), poolUnit: pool.poolUnit, ...times });
  });
  return id;
}
