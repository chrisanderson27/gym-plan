import { exerciseById, LIFT_TEMPLATES, PER_SIDE_IDS } from '../content';
import { coachedSchedule, COACHED_TRANSITION_SEC, COACHED_WORK_SEC } from '../engine/block/coached';
import { generateLiftDay } from '../engine/block/generate';
import { DEFAULT_LIFT_BUDGET_MIN, JOINT_FRIENDLY_WEEKS, LIFT_DAY_SHAPES, SEC_PER_UNIT } from '../engine/config';
import { muscleReadiness } from '../engine/lift/readiness';
import { enabled } from '../engine/plan/activities';
import { rankToday } from '../engine/plan/pick';
import type { BudgetLine, Candidate, PlanInput } from '../engine/plan/types';
import { BLOCK_HARD_MAX_ROUNDS, BLOCK_ROUNDS, blockBalanceIssues, ROUND_SLACK_SEC, blockRoundSeconds, FULL_WORKOUT_MIN_SEC, isHardBlockIssue, orderedDurationSec } from '../engine/templates';
import { groupOf } from '../engine/block/rules';
import type { GymDb } from './db';
import { findOpenLiftSession, LIFT_EXERCISES } from './lift';
import { blockExerciseOf, liftDayInputFrom, liftDaySeed } from './liftday';
import { availableDemo, findOpenMixedSession, loadMixedGym, prepareOrderedStart, resolveStation, workoutPreview, writePreparedOrdered } from './mixedSession';
import { loadPlanInput } from './plan';
import type { ExecutableCoachedBlock, LibraryBlock, LiftVariant, OrderedBlock, OrderedSelfPacedBlock, OrderedStation, Session } from './types';
import { snapshotValue, validAuthoredWorkout } from './validate';
import { copyWorkoutBlock, libraryWorkoutBlock, todayAccessorySlots, todayPreparation, todayRecovery } from './workoutChoices';

type Gym = Awaited<ReturnType<typeof loadMixedGym>>;
type AccessorySlot = Pick<Extract<OrderedBlock, { kind: 'coached' | 'self-paced' }>, 'id' | 'kind' | 'durationSec'>;
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
const accessoryWorkSec = ({ exerciseId, target }: Pick<OrderedStation, 'exerciseId' | 'target'>) =>
  target.amount * SEC_PER_UNIT[target.unit] * (target.unit === 'reps' && PER_SIDE_IDS.has(exerciseId) ? 2 : 1);

export function todaySessionRoute(s: Session) {
  return s.mixed ? `/workout/session/${s.id}` : `/${s.type === 'custom' ? 'lift' : s.type}/session/${s.id}`;
}

export function findTodayLegacyOpen(db: GymDb, now: Date) {
  return findOpenLiftSession(db, now, ['lift', 'custom', 'burn', 'hybrid']);
}

function generatedAccessory(g: Gym, variant: LiftVariant, main: string, source: AccessorySlot, slot: number, reduced: boolean,
  safeAccessory: (exerciseId: string) => boolean): OrderedBlock | null {
  const upper = variant.startsWith('upper');
  const lanes = todayAccessorySlots[upper ? 'upper' : 'lower'];
  const coached = source.kind === 'coached';
  const stations: OrderedStation[] = [];
  const groups: (ReturnType<typeof groupOf> | undefined)[] = [];
  // One move per role, and each block starts on a different role, so a short list never loops two moves for minutes.
  const order = lanes.map((_, i) => (i + slot) % lanes.length);
  for (const [k, lane] of order.entries()) {
    for (const exerciseId of lanes[lane]!) {
      if (exerciseId === main || stations.some((s) => s.exerciseId === exerciseId) || !safeAccessory(exerciseId)) continue;
      const exercise = blockExerciseOf(exerciseId);
      const group = exercise && groupOf(exercise);
      // The same rules the presets meet: no same-group neighbours, the loop back to the first included, and one core move.
      if (group === groups.at(-1) || (k === order.length - 1 && group === groups[0])
        || (group === 'core' && groups.includes('core'))) continue;
      const ex = exerciseById.get(exerciseId)!;
      const unit = ex.prescription.unit === 'reps' || ex.prescription.unit === 'amrap' ? 'reps' : 'sec';
      const repCap = coached ? Math.floor(COACHED_WORK_SEC / SEC_PER_UNIT.reps / (PER_SIDE_IDS.has(exerciseId) ? 2 : 1)) : 8;
      // Self-paced holds run 30 s, so four stations make a round long enough for an 8-minute block to loop at most 4 times.
      const amount = unit === 'reps' ? Math.min(ex.prescription.min || 6, repCap) : coached ? 20 : 30;
      const station = { slotId: `${source.id}-${stations.length + 1}`, exerciseId, target: { unit, amount } } as const;
      if (resolveStation(g, station, exerciseId, coached)) {
        stations.push(station);
        groups.push(group);
        break;
      }
    }
  }
  // A skipped last role can leave the loop closing on two moves of one group.
  while (stations.length > 2 && groups.at(-1) === groups[0]) {
    stations.pop();
    groups.pop();
  }
  if (stations.length < 2) return null;
  const name = [upper ? 'Upper-body technique rotation' : 'Legs & core technique rotation', 'Controlled movement circuit', 'Core & posture circuit', 'Easy movement circuit'][slot]!;
  const base = { ...source, name, stations };
  const block: ExecutableCoachedBlock | OrderedSelfPacedBlock = coached
    ? { ...base, kind: 'coached', workSec: COACHED_WORK_SEC, restSec: reduced ? 30 : 20, transitionSec: COACHED_TRANSITION_SEC }
    : { ...base, kind: 'self-paced' };
  // The slot keeps its minutes, so Today keeps its length. With full gear four stations fit 2-4 rounds; when missing gear
  // thins the lineup, the block shrinks rather than loop past the builder's hard limit.
  const round = blockRoundSeconds(block, blockExerciseOf)!;
  const longest = Math.floor((BLOCK_HARD_MAX_ROUNDS * round) / 30) * 30;
  const shortest = Math.ceil((BLOCK_ROUNDS.min * round - ROUND_SLACK_SEC) / 30) * 30;
  return { ...block, durationSec: Math.min(longest, Math.max(shortest, source.durationSec)) };
}

function checkedReplacement(row: LibraryBlock, source: AccessorySlot, main: string, variant: LiftVariant, reduced: boolean,
  safeAccessory: (exerciseId: string) => boolean) {
  if (source.kind !== row.kind || row.stations.length < 2 || row.durationSec > source.durationSec) return;
  if (blockBalanceIssues(row, blockExerciseOf).some(isHardBlockIssue)) return;
  const focus = variant.startsWith('lower') ? ['squat', 'hinge', 'lunge', 'carry-core'] : ['horizontal-push', 'horizontal-pull', 'vertical-push', 'vertical-pull', 'carry-core'];
  const occupied = new Set(row.stations.map((s) => s.exerciseId));
  if (occupied.size !== row.stations.length || occupied.has(main)) return;
  const exercises = row.stations.map((s) => exerciseById.get(s.exerciseId));
  if (exercises.filter((e) => e?.group === 'conditioning').length > 1
    || !exercises.some((e) => e && focus.includes(e.group))) return;
  if (row.stations.some(({ exerciseId, target, load }) => !safeAccessory(exerciseId)
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
  const gymMains = new Map(LIFT_TEMPLATES[variant].slots.flatMap((slot) => slot.candidates)
    .filter((id) => g.week > JOINT_FRIENDLY_WEEKS || exerciseById.get(id)?.jointFriendly)
    .flatMap((id) => {
      const demo = availableDemo(g, id);
      if (!demo) return [];
      const { equipmentId } = demo;
      if (g.snapshot.equipment.get(equipmentId)!.steps.some((load) => !Number.isFinite(load) || load < 0)
        || g.snapshot.history.some(({ session, sets }) => !session.flags?.deload && sets.some((set) =>
          set.exerciseId === id && set.equipmentId === equipmentId && set.setKind !== 'warmup'
          && (!Number.isFinite(set.weight) || set.weight < 0)))) return [];
      return [[id, equipmentId] as const];
    }));
  const mainCandidates = [...gymMains.keys()];
  if (!mainCandidates.length) return;
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
  const readiness = muscleReadiness(g.snapshot, LIFT_EXERCISES);
  const safeAccessory = (id: string) => {
    const exercise = exerciseById.get(id);
    return !!exercise && (g.week > JOINT_FRIENDLY_WEEKS || exercise.jointFriendly)
      && exercise.impact !== 'high' && exercise.impact !== 'med' && (!reduced || id !== 'goblet-squat')
      && [...exercise.primary, ...exercise.secondary].every((muscle) => readiness.get(muscle)?.ready !== false);
  };
  const slots = LIFT_DAY_SHAPES[0].map((minutes, index): AccessorySlot => ({
    id: `${prefix}-circuit-${index + 1}`, kind: index === 0 ? 'coached' : 'self-paced', durationSec: minutes * 60,
  }));
  const circuits = slots.map((slot, index) => generatedAccessory(g, variant, exerciseId, slot, index, reduced, safeAccessory));
  const name = `${candidate.title} · ${variant.startsWith('lower') ? 'Legs & Core' : 'Upper Body & Core'}`;
  const prepare = (accessories: (OrderedBlock | null)[]) => {
    if (accessories.some((block) => block === null)) return null;
    const blocks = [{ ...todayPreparation, id: `${prefix}-prep` }, strength, ...accessories.flatMap((block) => block ?? []),
      { ...todayRecovery, id: `${prefix}-recovery` }];
    const ordered = { name, blocks };
    if (!validAuthoredWorkout(ordered)) return null;
    const prepared = prepareOrderedStart(g, ordered, sourceId, now, true);
    if (!prepared || !validAuthoredWorkout(prepared.mixed.prescription)) return null;
    const durationSec = orderedDurationSec(prepared.mixed.prescription.blocks);
    return durationSec >= FULL_WORKOUT_MIN_SEC && durationSec <= maxLiftSec ? { prepared, durationSec } : null;
  };
  const checked = (await db.libraryBlocks.toArray()).filter((row) => row.recommend);
  const focusScore = (row: LibraryBlock) => row.stations.filter(({ exerciseId: id }) => {
    const group = exerciseById.get(id)?.group;
    return variant.startsWith('lower') ? group === 'squat' || group === 'hinge' || group === 'lunge'
      : group?.endsWith('-push') || group?.endsWith('-pull');
  }).length;
  checked.sort((a, b) => focusScore(b) - focusScore(a) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  for (const [index, slot] of slots.entries()) {
    for (const row of checked) {
      const block = checkedReplacement(row, slot, exerciseId, variant, reduced, safeAccessory);
      if (!block) continue;
      const replacement = prepare(circuits.map((b, i) => index === i ? block : b));
      if (replacement) return { ...replacement, variant, libraryId: row.id };
    }
  }
  const fallback = prepare(circuits);
  if (fallback) return { ...fallback, variant };
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
    const open = same ?? await findOpenMixedSession(db) ?? await findTodayLegacyOpen(db, now);
    if (open) {
      // The accepted prescription retains the reviewed seed. Execution can materialize its instance or later swap.
      if (same && snapshotValue(same.mixed?.prescription) === snapshotValue(reviewed.workout.prepared.mixed.prescription)) {
        return { kind: 'resume' as const, route: todaySessionRoute(open) };
      }
      return { kind: 'open' as const, session: open };
    }
    const current = await resolveToday(db, now);
    if (current.kind !== 'workout' || current.revision !== reviewed.revision) return { kind: 'stale' as const, current };
    const { prepared, variant } = current.workout;
    const id = await writePreparedOrdered(db, prepared, now, undefined, variant);
    return { kind: 'started' as const, route: `/workout/session/${id}` };
  });
}
