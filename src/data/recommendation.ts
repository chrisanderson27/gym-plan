import { exerciseById, LIFT_TEMPLATES } from '../content';
import { coachedSchedule, COACHED_TRANSITION_SEC, COACHED_WORK_SEC } from '../engine/block/coached';
import { generateLiftDay } from '../engine/block/generate';
import { DEFAULT_LIFT_BUDGET_MIN, JOINT_FRIENDLY_WEEKS, LIFT_DAY_SHAPES, SEC_PER_UNIT } from '../engine/config';
import { enabled } from '../engine/plan/activities';
import { rankToday } from '../engine/plan/pick';
import type { BudgetLine, Candidate, PlanInput } from '../engine/plan/types';
import { FULL_WORKOUT_MIN_SEC, orderedDurationSec } from '../engine/templates';
import type { GymDb } from './db';
import { findOpenLiftSession } from './lift';
import { liftDayInputFrom, liftDaySeed } from './liftday';
import { availableDemo, findOpenMixedSession, loadMixedGym, prepareOrderedStart, resolveStation, workoutPreview, writePreparedOrdered } from './mixedSession';
import { loadPlanInput } from './plan';
import type { LibraryBlock, LiftVariant, OrderedBlock, OrderedStation, Session } from './types';
import { snapshotValue, validAuthoredWorkout } from './validate';
import { copyWorkoutBlock, libraryWorkoutBlock, todayAccessorySlots, todayPreparation, todayRecovery } from './workoutChoices';

type Gym = Awaited<ReturnType<typeof loadMixedGym>>;
type Prescription = {
  prepared: NonNullable<ReturnType<typeof prepareOrderedStart>>;
  variant: LiftVariant;
  libraryId?: string;
  lineup: Awaited<ReturnType<typeof workoutPreview>>;
};

type TodayState = { budget: BudgetLine[] };
export type TodayRecommendation = TodayState & {
  kind: 'workout'; title: string; reason: string; durationSec: number; revision: string; sourceId: string; workout: Prescription;
};
export type TodayDecision = TodayRecommendation | (TodayState & { kind: 'rest' | 'unavailable'; reason: string });

const stores = (db: GymDb) => [db.sessions, db.sets, db.settings, db.equipment, db.exerciseOverrides, db.libraryBlocks, db.runs];
const maxLiftSec = DEFAULT_LIFT_BUDGET_MIN * 60;
const perSide = new Set(['reverse-lunge', 'step-up', 'bulgarian-split-squat', 'dead-bug']);
const accessoryWorkSec = ({ exerciseId, target }: Pick<OrderedStation, 'exerciseId' | 'target'>) =>
  target.amount * SEC_PER_UNIT[target.unit] * (target.unit === 'reps' && perSide.has(exerciseId) ? 2 : 1);

export function todaySessionRoute(s: Session) {
  return s.mixed ? `/workout/session/${s.id}` : `/${s.type === 'custom' ? 'lift' : s.type}/session/${s.id}`;
}

export async function findTodayOpen(db: GymDb, now: Date) {
  return (await findOpenMixedSession(db)) ?? await findOpenLiftSession(db, now, ['lift', 'custom', 'burn', 'hybrid']);
}

function safeAccessory(g: Gym, exerciseId: string, reduced: boolean) {
  const exercise = exerciseById.get(exerciseId);
  return !!exercise && (g.week > JOINT_FRIENDLY_WEEKS || exercise.jointFriendly)
    && exercise.impact !== 'high' && exercise.impact !== 'med'
    && (!reduced || exerciseId !== 'goblet-squat');
}

function generatedAccessory(g: Gym, variant: LiftVariant, main: string, id: string, minutes: number, slot: number, reduced: boolean): OrderedBlock | null {
  const upper = variant.startsWith('upper');
  const lanes = todayAccessorySlots[upper ? 'upper' : 'lower'];
  const coached = slot === 0;
  const order = slot === 0 ? [0, 1, 2, 3] : slot === 1 ? [0, 2, 1] : slot === 2 ? [1, 2, 3] : [3, 2, 0];
  const stations: OrderedStation[] = [];
  for (const lane of order) {
    for (const exerciseId of lanes[lane]!) {
      if (exerciseId === main || stations.some((s) => s.exerciseId === exerciseId) || !safeAccessory(g, exerciseId, reduced)) continue;
      const ex = exerciseById.get(exerciseId)!;
      const unit = ex.prescription.unit === 'reps' || ex.prescription.unit === 'amrap' ? 'reps' : 'sec';
      const repCap = coached ? Math.floor(COACHED_WORK_SEC / SEC_PER_UNIT.reps / (perSide.has(exerciseId) ? 2 : 1)) : 8;
      const amount = unit === 'reps' ? Math.min(ex.prescription.min || 6, repCap) : 20;
      const station = { slotId: `${id}-${stations.length + 1}`, exerciseId, target: { unit, amount } } as const;
      if (resolveStation(g, station, exerciseId, coached)) {
        stations.push(station);
        break;
      }
    }
  }
  if (stations.length < 2) return null;
  const name = [upper ? 'Upper-body technique rotation' : 'Legs & core technique rotation', 'Controlled movement circuit', 'Core & posture circuit', 'Easy movement circuit'][slot]!;
  const base = { id, name, durationSec: minutes * 60, stations };
  return coached
    ? { ...base, kind: 'coached', workSec: COACHED_WORK_SEC, restSec: reduced ? 30 : 20, transitionSec: COACHED_TRANSITION_SEC }
    : { ...base, kind: 'self-paced' };
}

function checkedReplacement(g: Gym, row: LibraryBlock, source: OrderedBlock, main: string, variant: LiftVariant, reduced: boolean) {
  if (source.kind !== row.kind || row.stations.length < 2 || row.durationSec > source.durationSec) return;
  const focus = variant.startsWith('lower') ? ['squat', 'hinge', 'lunge', 'carry-core'] : ['horizontal-push', 'horizontal-pull', 'vertical-push', 'vertical-pull', 'carry-core'];
  const occupied = new Set(row.stations.map((s) => s.exerciseId));
  if (occupied.size !== row.stations.length || occupied.has(main)) return;
  const exercises = row.stations.map((s) => exerciseById.get(s.exerciseId));
  if (exercises.filter((e) => e?.group === 'conditioning').length > 1
    || !exercises.some((e) => e && focus.includes(e.group))) return;
  if (row.stations.some(({ exerciseId, target, load }) => !safeAccessory(g, exerciseId, reduced)
    || target.amount <= 0 || target.amount > ({ reps: 15, sec: 45, cal: 0, m: 30 }[target.unit])
    || (load !== undefined && load > (reduced ? 0 : 15)))) return;

  let index = -1;
  const block = copyWorkoutBlock(libraryWorkoutBlock(row), () => ++index === 0 ? source.id : `${source.id}-${index}`);
  if (block.kind === 'coached') {
    if (!block.stations || block.workSec > 45 || block.restSec > 60 || block.transitionSec > 60
      || block.stations.some((station) => station.target.unit !== 'sec' && accessoryWorkSec(station) > block.workSec)) return;
    const cycle = coachedSchedule(block, block.stations).flat().reduce((sum, phase) => sum + phase.sec, 0);
    if (cycle > block.durationSec || (reduced && block.restSec + block.transitionSec < 10)) return;
  }
  return block;
}

async function liftRecommendation(db: GymDb, input: PlanInput, candidate: Candidate, sourceId: string, now: Date) {
  const variant = candidate.variant!;
  const g = await loadMixedGym(db, now);
  const dayInput = liftDayInputFrom(g.snapshot, variant, DEFAULT_LIFT_BUDGET_MIN, liftDaySeed(input.today, variant, DEFAULT_LIFT_BUDGET_MIN));
  const mainCandidates = LIFT_TEMPLATES[variant].slots.flatMap((slot) => slot.candidates)
    .filter((id) => g.week > JOINT_FRIENDLY_WEEKS || exerciseById.get(id)?.jointFriendly)
    .filter((id) => !!availableDemo(g, id));
  if (!mainCandidates.length) return;
  const gymMains = new Map(mainCandidates.map((id) => [id, availableDemo(g, id)!.equipmentId]));
  const liftDay = generateLiftDay({
    ...dayInput, mainCandidates,
    resolveEquipmentId: (id, item, week) => gymMains.get(id) ?? dayInput.resolveEquipmentId(id, item, week),
  });
  const main = liftDay.blocks.find((b) => b.kind === 'lift' && !b.warmup);
  if (main?.kind !== 'lift' || !gymMains.has(main.exerciseId)) return;
  const { exerciseId, equipmentId, sets, repMin, repMax, restSec } = main;
  const prefix = `${input.today}-${variant}`;
  const strength: OrderedBlock = { id: `${prefix}-strength`, kind: 'strength', exerciseId, equipmentId, sets, repMin, repMax, restSec };
  const reduced = liftDay.deload || liftDay.rampIn || !input.hasLiftHistory;
  const circuits = LIFT_DAY_SHAPES[0].map((minutes, slot) => generatedAccessory(g, variant, exerciseId, `${prefix}-circuit-${slot + 1}`, minutes, slot, reduced));
  if (circuits.some((b) => !b)) return;
  const blocks: OrderedBlock[] = [{ ...todayPreparation, id: `${prefix}-prep` }, strength, ...circuits.flatMap((b) => b ?? []),
    { ...todayRecovery, id: `${prefix}-recovery` }];
  const name = `${candidate.title} · ${variant.startsWith('lower') ? 'Legs & Core' : 'Upper Body & Core'}`;
  const prepare = (draft: OrderedBlock[]) => {
    const ordered = { name, blocks: draft };
    if (!validAuthoredWorkout(ordered)) return null;
    const prepared = prepareOrderedStart(g, ordered, sourceId, now, true);
    if (!prepared) return null;
    const durationSec = orderedDurationSec(prepared.mixed.prescription.blocks);
    return durationSec >= FULL_WORKOUT_MIN_SEC && durationSec <= maxLiftSec ? { prepared, durationSec } : null;
  };
  const fallback = prepare(blocks);
  if (!fallback) return;
  const checked = (await db.libraryBlocks.toArray()).filter((row) => row.recommend);
  const focusScore = (row: LibraryBlock) => row.stations.filter(({ exerciseId: id }) => {
    const group = exerciseById.get(id)?.group;
    return variant.startsWith('lower') ? group === 'squat' || group === 'hinge' || group === 'lunge'
      : group?.endsWith('-push') || group?.endsWith('-pull');
  }).length;
  checked.sort((a, b) => focusScore(b) - focusScore(a) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  for (const index of [2, 3, 4, 5]) {
    for (const row of checked) {
      const block = checkedReplacement(g, row, blocks[index]!, exerciseId, variant, reduced);
      if (!block) continue;
      const replacement = prepare(blocks.map((b, i) => index === i ? block : b));
      if (replacement) return { ...replacement, variant, libraryId: row.id };
    }
  }
  return { ...fallback, variant };
}

async function resolveToday(db: GymDb, now: Date): Promise<TodayDecision> {
  const input = await loadPlanInput(db, now);
  const ranked = rankToday(input, { recommendWorkout: true });
  const activities = enabled(input.activities);
  const state = { budget: ranked.budget };
  const rest = ranked.candidates.find((c) => c.id === 'rest' && c.status === 'eligible');
  if (rest && activities.length) return { ...state, kind: 'rest', reason: rest.reasons[0]! };

  for (const candidate of ranked.candidates) {
    if (candidate.tile !== 'lift' || candidate.status !== 'eligible') continue;
    const sourceId = `today:${input.today}:${candidate.id}`;
    const lift = await liftRecommendation(db, input, candidate, sourceId, now);
    if (!lift) continue;
    const { durationSec, ...prepared } = lift;
    const { prescription } = prepared.prepared.mixed;
    const lineup = await workoutPreview(db, prescription.blocks, now);
    const workout = { ...prepared, lineup };
    return {
      ...state, kind: 'workout', title: prescription.name, reason: candidate.reasons[0] ?? '', durationSec, sourceId, workout,
      revision: snapshotValue({ sourceId, workout, durationSec, candidate: candidate.id, activities, programStart: input.programStart,
        daysPerWeek: input.daysPerWeek, budget: ranked.budget }),
    };
  }
  return { ...state, kind: 'unavailable', reason: 'Open Workouts or review your training preferences.' };
}

export function loadTodayRecommendation(db: GymDb, now = new Date()) {
  return db.transaction('r', stores(db), async () => await resolveToday(db, now));
}

export function startTodayRecommendation(db: GymDb, reviewed: TodayRecommendation, at?: Date) {
  return db.transaction('rw', stores(db), async () => {
    // Sample after gaining the lock so a queued Start also observes local rollover.
    const now = at ?? new Date();
    const same = await db.sessions.where('type').equals('custom').filter((s) => !s.endedAt && s.mixed?.sourceId === reviewed.sourceId).first();
    const open = same ?? await findTodayOpen(db, now);
    if (open) {
      if (same) return { kind: 'resume' as const, route: todaySessionRoute(open) };
      return { kind: 'open' as const, session: open };
    }
    const current = await resolveToday(db, now);
    if (current.kind !== 'workout' || current.revision !== reviewed.revision) return { kind: 'stale' as const, current };
    const { prepared, variant } = current.workout;
    const id = await writePreparedOrdered(db, prepared, now, undefined, variant);
    return { kind: 'started' as const, route: `/workout/session/${id}` };
  });
}
