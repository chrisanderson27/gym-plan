import { exerciseById } from '../content';
import { EQUIPMENT_PREFS } from '../content/equipment-prefs';
import { RUN_FORMATS } from '../content/run-formats';
import { COACHED_EXERCISE_IDS, PHASE3_EXERCISE_IDS, coachedEquipmentId, coachedPose, phase3EquipmentId, phase3Pose, runDemo } from '../content/stationDemos';
import { coachedSchedule, initialCoached, nextCoached, projectCoached, sameCoachedPhase } from '../engine/block/coached';
import { elapsedClamped, finishClock, pauseClock, reconcileClock, resumeClock, startClock } from '../engine/block/session';
import { stationUnits } from '../engine/block/progression';
import { FINISH_RPE, LOWER_MUSCLES, PRIMARY_SET_WEIGHT, SECONDARY_SET_WEIGHT } from '../engine/config';
import { localDate } from '../engine/dates';
import { exerciseAllowed } from '../engine/gym/eligibility';
import { classifyHard } from '../engine/hard';
import { hybridCardio } from '../engine/hybrid';
import { swapCandidates } from '../engine/lift/generator';
import { summarizeLiftSession } from '../engine/lift/session';
import { weekFractionalSets, weeklyTarget } from '../engine/lift/volume';
import { generateRun } from '../engine/run/generator';
import { runPhases, runTotalMs } from '../engine/run/segments';
import { workoutShortfallSec } from '../engine/templates';
import { weekIndex } from '../engine/week';
import { loadCardioSnapshot, runWalkRatioOf, type CardioSnapshot } from './cardio';
import type { GymDb } from './db';
import { newId } from './ids';
import { blockPrescriptionPatch, ensureEquipmentInstance, LIFT_EXERCISES, loadLiftSnapshot, resolveEquipmentId } from './lift';
import { toBlockExercise } from './liftday';
import { loggedMixedSets, mixedSetId, reconcileMixedStrength } from './mixedSets';
import { presetById } from './presets';
import { loadRunnable, orderedStrengthToLift, replayLiftFlags, type Runnable } from './templates';
import type { Block, CardioModality, CoachedCheckpoint, OrderedRunBlock, RunBlock, EffectiveStation, LiftBlock, MixedCursor, MixedDraft, MixedExecution, MixedResult, MixedTimer,
  LiftVariant, OrderedBlock, OrderedPrescription, OrderedStation, OrderedStrengthBlock, Session, SetRow } from './types';
import { isAcceptedStrength, snapshotValue } from './validate';

export class MixedInputError extends Error {}
export class StaleWorkoutError extends MixedInputError {}
export class ShortWorkoutError extends MixedInputError {
  constructor(readonly shortfallSec: number) {
    super('This workout is shorter than 45 minutes. Extend it to start.');
  }
}

type Source = { templateId: string } | { sessionId: string } | { presetId: string };
type Action = { type: 'start' | 'pause' | 'resume' | 'expire' | 'finish' | 'skip' }
  | { type: 'next'; observed: CoachedCheckpoint }
  | { type: 'round'; expectedTapped: number; expectedStations: EffectiveStation[] }
  | { type: 'swap-station'; slotId: string; exerciseId: string | null; expectedExerciseId: string }
  | { type: 'swap-strength'; exerciseId: string; expectedExerciseId: string }
  | { type: 'review' | 'continue'; rounds?: number | null; partial?: MixedDraft['partial'] | null; run?: RunActuals }
  | { type: 'set'; reps: number; weight: number; expectedExerciseId: string; expectedEquipmentId?: string };

export interface RunActuals { distanceMi: number; durationSec: number; modality: CardioModality; rpe: number; painFlag: boolean }

const PHASE_LIFTS = new Map([...LIFT_EXERCISES].filter(([id, lift]) => lift.repMin > 0 && PHASE3_EXERCISE_IDS.some((known) => known === id)));
const required = new Map([
  ['step-up', ['dumbbells', 'plyo-box']], ['bulgarian-split-squat', ['dumbbells', 'flat-bench']],
  ['hip-thrust', ['flat-bench']], ['box-step-up', ['plyo-box']],
]);
const get = <T,>(map: Record<string, T>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
const nonnegative = (v: number) => Number.isFinite(v) && v >= 0;

export async function loadMixedGym(db: GymDb, now: Date) {
  const [snapshot, settings] = await Promise.all([loadLiftSnapshot(db, now), db.settings.get('settings')]);
  const unavailable = new Set(settings?.unavailableEquipment);
  const blockedTags = new Set(EQUIPMENT_PREFS.filter((pref) => unavailable.has(pref.id)).flatMap((pref) => pref.blockTags));
  const excluded = new Set([...snapshot.overrides.values()].filter((o) => o.notAtMyGym).map((o) => o.exerciseId));
  return { snapshot, excluded, blockedTags, unavailable, week: weekIndex(localDate(now), snapshot.programStart) };
}
type Gym = Awaited<ReturnType<typeof loadMixedGym>>;

function verifiedDemo(g: Gym, exerciseId: string, preferred?: string, coached = false) {
  const exercise = exerciseById.get(exerciseId);
  if (!exercise) return null;
  const seed = coached ? coachedEquipmentId(exerciseId) : phase3EquipmentId(exerciseId);
  const equipmentId = preferred ?? resolveEquipmentId(g.snapshot, exercise, g.week, seed);
  const equipment = g.snapshot.equipment.get(equipmentId);
  if (!equipment) return null;
  const poseId = coached ? coachedPose(exerciseId, equipment) : phase3Pose(exerciseId, equipment);
  return poseId ? { equipmentId, poseId, equipmentName: equipment.name } : null;
}

export function availableDemo(g: Gym, exerciseId: string, preferred?: string, coached = false) {
  const exercise = exerciseById.get(exerciseId);
  if (!exercise || exercise.retired || required.get(exerciseId)?.some((id) => g.unavailable.has(id))
    || !exerciseAllowed({ id: exerciseId, tags: exercise.equipment }, g.excluded, g.snapshot.checklistBlocked ?? new Set(), g.blockedTags)) return null;
  const demo = verifiedDemo(g, exerciseId, preferred, coached);
  if (!demo || g.blockedTags.has(g.snapshot.equipment.get(demo.equipmentId)!.kind)) return null;
  return demo;
}

function strengthEquipmentId(g: Gym, { exerciseId, equipmentId }: OrderedStrengthBlock) {
  return equipmentId ?? verifiedDemo(g, exerciseId)?.equipmentId ?? phase3EquipmentId(exerciseId);
}

function stationUnitMatches(station: OrderedStation) {
  const exercise = exerciseById.get(station.exerciseId);
  return !!exercise && stationUnits(toBlockExercise(exercise)).includes(station.target.unit);
}

export function missingCoachedSchedule(block: OrderedBlock) {
  return block.kind === 'coached' && !block.stations;
}

export async function workoutPreview(db: GymDb, blocks: OrderedBlock[], now = new Date()) {
  const g = await loadMixedGym(db, now);
  return blocks.map((block) => {
    const describe = (exerciseId: string, equipmentId?: string, supported = true, forceCoached = false) => {
      const coached = forceCoached || block.kind === 'coached';
      const verified = supported && verifiedDemo(g, exerciseId, equipmentId, coached);
      const available = verified && availableDemo(g, exerciseId, equipmentId, coached);
      const extraGear = required.get(exerciseId)?.filter((id) => verified && id !== verified.equipmentId)
        .map((id) => EQUIPMENT_PREFS.find((pref) => pref.id === id)?.label);
      return {
        exerciseId, equipmentId: verified ? verified.equipmentId : equipmentId,
        equipmentName: verified ? [verified.equipmentName, ...(extraGear ?? [])].filter(Boolean).join(' · ')
          : equipmentId ? g.snapshot.equipment.get(equipmentId)?.name : undefined,
        poseId: available ? available.poseId : undefined,
        status: !verified ? 'Demo unavailable. Replace or skip this movement before training.'
          : !available ? 'Unavailable at your gym. Replace or skip this movement before training.' : undefined,
      };
    };
    if (block.kind === 'strength') {
      const supported = PHASE_LIFTS.has(block.exerciseId);
      const equipmentId = supported ? strengthEquipmentId(g, block) : block.equipmentId;
      return [describe(block.exerciseId, equipmentId, supported)];
    }
    if (block.kind === 'coached' || block.kind === 'self-paced') {
      return (block.stations ?? []).map((station) => describe(station.exerciseId, station.equipmentId, stationUnitMatches(station)));
    }
    if (block.kind === 'run') {
      const demo = runDemo(block.modality);
      if (!demo.exerciseId) return [{ exerciseId: 'treadmill', equipmentId: undefined, equipmentName: undefined, poseId: demo.poseId, status: undefined }];
      return [describe(demo.exerciseId, undefined, true, !!demo.coached)];
    }
    return block.exerciseId ? [describe(block.exerciseId)] : [];
  });
}

/** What Start would accept today for each block, read-only. Safety guardrails can shorten sets or run seconds below the prescription. */
export async function acceptedPlanNotes(db: GymDb, blocks: OrderedBlock[], now = new Date()): Promise<(string | undefined)[]> {
  if (!blocks.length) return [];
  const g = await loadMixedGym(db, now);
  const runInputs = blocks.some((b) => b.kind === 'run') ? await loadCardioSnapshot(db, now) : undefined;
  let prepared: ReturnType<typeof prepareOrderedStart>;
  try {
    prepared = prepareOrderedStart(g, { name: 'preview', blocks }, 'preview', now, false, runInputs);
  } catch {
    return blocks.map(() => undefined);
  }
  return blocks.map((block) => {
    if (block.kind === 'strength') {
      const sets = prepared?.mixed.strength[block.id]?.sets;
      return sets !== undefined && sets < block.sets ? `Today: ${sets} of ${block.sets} sets within your weekly limits.` : undefined;
    }
    if (block.kind === 'run') {
      const run = prepared?.blocks.find((b): b is RunBlock => b.kind === 'run' && b.id === block.id);
      const sec = run ? runTotalMs(runPhases(run)) / 1000 : block.durationSec;
      return sec < block.durationSec - 30 ? `Today: ${Math.round(sec / 60)} min run within your running limits.` : undefined;
    }
    return undefined;
  });
}

/** Lower-body workout: the session variant, else any strength block whose primary muscles are lower-body. */
function isLowerWorkout(ordered: OrderedPrescription, variant?: LiftVariant) {
  if (variant) return variant.startsWith('lower');
  return ordered.blocks.some((b) => b.kind === 'strength'
    && LIFT_EXERCISES.get(b.exerciseId)?.primary.some((m) => (LOWER_MUSCLES as readonly string[]).includes(m)));
}

/** Plans the prescribed run through the existing generator and lower-day machine swap. The prescription stays as authored. */
export function planOrderedRun(cardio: CardioSnapshot, programStart: string, block: OrderedRunBlock, lower: boolean, now: Date): RunBlock {
  const run = generateRun({
    now: now.toISOString(), today: localDate(now), programStart, history: cardio.runHistory, kind: block.runKind,
    formats: RUN_FORMATS, lastDoneByFormat: cardio.lastIntervalFormat, durationMin: Math.max(5, Math.round(block.durationSec / 60)),
    makeId: () => block.id,
  });
  const machine = block.modality === 'bike' || block.modality === 'row' ? block.modality : undefined;
  const out = hybridCardio({ variant: lower || machine ? 'lower-a' : 'upper-a', run, ...(machine ? { modality: machine } : {}) }).block;
  return { ...out, id: block.id };
}

export function resolveStation(g: Gym, original: OrderedStation, exerciseId = original.exerciseId, coached = false): EffectiveStation | null {
  const demo = availableDemo(g, exerciseId, exerciseId === original.exerciseId ? original.equipmentId : undefined, coached);
  if (!demo || !stationUnitMatches({ ...original, exerciseId })) return null;
  const { equipmentId, poseId } = demo;
  const equipment = g.snapshot.equipment.get(equipmentId);
  const load = equipment?.kind === 'bodyweight' || equipment?.kind === 'cardio' ? undefined : original.load;
  return { slotId: original.slotId, exerciseId, target: original.target, load, equipmentId, poseId };
}

function stationChoices(g: Gym, original: OrderedStation, current: EffectiveStation, coached: boolean) {
  const ex = exerciseById.get(current.exerciseId);
  const supported = current.equipmentId && current.poseId && stationUnitMatches(current)
    && availableDemo(g, current.exerciseId, current.equipmentId, coached)?.poseId === current.poseId;
  const options = coached ? [...(ex?.substitutes ?? []), ...COACHED_EXERCISE_IDS] : !supported ? PHASE3_EXERCISE_IDS : ex?.substitutes ?? [];
  return [...new Set([original.exerciseId, current.exerciseId, ...options])].flatMap((id) => {
    const next = resolveStation(g, original, id, coached);
    return next && (id !== current.exerciseId || next.equipmentId !== current.equipmentId || !supported || current.skipped) ? [next] : [];
  });
}

function strengthChoices(g: Gym, block: OrderedStrengthBlock, current: string) {
  const equipmentId = strengthEquipmentId(g, block);
  const compatible = new Map([...PHASE_LIFTS].filter(([id]) => availableDemo(g, id, id === block.exerciseId ? equipmentId : undefined)));
  const substitutes = swapCandidates(current, PHASE_LIFTS, g.snapshot.overrides);
  return [...new Set([block.exerciseId, ...substitutes, ...(!PHASE_LIFTS.has(current) ? compatible.keys() : [])])]
    .filter((id) => (id !== current || id === block.exerciseId) && compatible.has(id));
}

function strengthWeights(exerciseId: string) {
  const ex = LIFT_EXERCISES.get(exerciseId);
  const weights = new Map<string, number>();
  for (const muscle of ex?.primary ?? []) weights.set(muscle, PRIMARY_SET_WEIGHT);
  for (const muscle of ex?.secondary ?? []) weights.set(muscle, (weights.get(muscle) ?? 0) + SECONDARY_SET_WEIGHT);
  return weights;
}

function countStrengthSets(done: Map<string, number>, weights: Map<string, number>, sets: number) {
  for (const [muscle, weight] of weights) done.set(muscle, (done.get(muscle) ?? 0) + sets * weight);
}

function strengthCapacity(g: Gym, exerciseId: string, done: Map<string, number>, count: number) {
  const weights = strengthWeights(exerciseId);
  const limit = weeklyTarget(g.week).ceiling;
  const sets = Math.max(0, Math.min(count, ...[...weights].map(([muscle, weight]) => Math.floor((limit - (done.get(muscle) ?? 0)) / weight))));
  countStrengthSets(done, weights, sets);
  return sets;
}

function prepareStrength(g: Gym, block: OrderedStrengthBlock, exerciseId: string,
  flags: ReturnType<typeof replayLiftFlags>, done: Map<string, number>, strict = false): LiftBlock | null {
  const exercise = exerciseById.get(exerciseId);
  const original = exerciseId === block.exerciseId;
  const demo = availableDemo(g, exerciseId, original ? strengthEquipmentId(g, block) : undefined);
  const lift = LIFT_EXERCISES.get(exerciseId);
  if (!exercise || !demo || !lift || lift.repMin < 1 || (strict && !PHASE_LIFTS.has(exerciseId))) return null;
  const base = { ...orderedStrengthToLift(block), exerciseId, ...(!original ? { repMin: lift.repMin, repMax: lift.repMax } : {}) };
  const patch = blockPrescriptionPatch(g.snapshot, exerciseId, demo.equipmentId, flags, undefined, base);
  const planned = flags.deload || strict ? Math.min(block.sets, patch.sets ?? block.sets) : block.sets;
  const count = patch.label === 'Calibration' && !strict ? planned : strengthCapacity(g, exerciseId, done, planned);
  if (count === 0) return null;
  return { ...base, ...patch, sets: count, equipmentId: demo.equipmentId };
}

/** Bundled presets have no database row. A removed preset resolves to null. */
export function presetRunnable(presetId: string): Runnable | null {
  const preset = presetById(presetId);
  return preset ? { type: 'custom', name: preset.name, blocks: [], ordered: structuredClone({ name: preset.name, blocks: preset.blocks }) } : null;
}

export async function startMixedSession(db: GymDb, source: Source, now = new Date(), expected?: OrderedPrescription): Promise<string> {
  const sourceId = 'templateId' in source ? 'template:' + source.templateId : 'presetId' in source ? 'preset:' + source.presetId : 'session:' + source.sessionId;
  return db.transaction('rw', [db.sessions, db.templates, db.sets, db.settings, db.equipment, db.exerciseOverrides, db.runs, db.tests], async () => {
    const open = await db.sessions.where('type').equals('custom').filter((s) => !s.endedAt && s.mixed?.sourceId === sourceId).first();
    if (open) return open.id;
    if ('sessionId' in source && !(await db.sessions.get(source.sessionId))?.endedAt) {
      throw new MixedInputError('Finish the original workout before repeating it.');
    }
    const run = 'presetId' in source ? presetRunnable(source.presetId) : await loadRunnable(db, source);
    if (expected && snapshotValue(run?.ordered) !== snapshotValue(expected)) {
      throw new StaleWorkoutError('This workout changed. Review the current plan before starting.');
    }
    if (!run?.ordered || !run.ordered.blocks.length) throw new MixedInputError('This workout is unavailable.');
    if (run.ordered.blocks.some(missingCoachedSchedule)) throw new MixedInputError('Coached blocks without a station schedule are unavailable.');
    // The open-session return above comes first, so an active short workout always resumes.
    const shortfall = workoutShortfallSec(run.ordered.blocks);
    if (shortfall > 0) throw new ShortWorkoutError(shortfall);
    const g = await loadMixedGym(db, now);
    const variant = 'sessionId' in source ? (await db.sessions.get(source.sessionId))?.variant : undefined;
    const runInputs = run.ordered.blocks.some((b) => b.kind === 'run') ? await loadCardioSnapshot(db, now) : undefined;
    const prepared = prepareOrderedStart(g, run.ordered, sourceId, now, false, runInputs, variant);
    return writePreparedOrdered(db, prepared!, now, run.templateId, variant);
  });
}

export function prepareOrderedStart(g: Gym, ordered: OrderedPrescription, sourceId: string, now: Date, strict = false,
  runInputs?: CardioSnapshot, variant?: LiftVariant) {
  const prescription = structuredClone(ordered);
  const flags = replayLiftFlags(g.snapshot, now);
  const volume = weekFractionalSets(g.snapshot, LIFT_EXERCISES);
  const mixed: MixedExecution = {
    kind: 'ordered', sourceId, prescription, stations: {}, strength: {}, timers: {}, drafts: {}, results: {},
    cursor: { blockId: prescription.blocks[0]!.id, stage: 'entry', setSlot: 0 },
  };
  const blocks: Block[] = [];
  const lower = isLowerWorkout(prescription, variant);
  for (const b of prescription.blocks) {
    if (b.kind === 'run') {
      if (!runInputs) {
        if (strict) return null;
        throw new MixedInputError('Running history is required to plan this workout.');
      }
      blocks.push(planOrderedRun(runInputs, g.snapshot.programStart, b, lower, now));
    } else if (b.kind === 'strength') {
      const accepted = prepareStrength(g, b, b.exerciseId, flags, volume, strict);
      if (strict && !accepted) return null;
      const lift = accepted ?? orderedStrengthToLift(b);
      blocks.push(lift);
      const { exerciseId, equipmentId, sets, repMin, repMax, targetWeight, rirTarget, label } = lift;
      const effective = { exerciseId, equipmentId: accepted ? equipmentId : undefined, sets, repMin, repMax, targetWeight, rirTarget, label };
      mixed.strength = { ...mixed.strength, [b.id]: effective };
      if (strict) {
        if (!isAcceptedStrength(effective)) return null;
        Object.assign(b, effective);
      }
    } else if ((b.kind === 'self-paced' || b.kind === 'coached') && b.stations) {
      const resolved = b.stations.map((s) => resolveStation(g, s, s.exerciseId, b.kind === 'coached'));
      if (strict && resolved.some((s, index) => !s || s.load !== b.stations![index]!.load)) return null;
      const stations = b.stations.map((s, index) => resolved[index] ?? { ...s, poseId: undefined });
      mixed.stations = { ...mixed.stations, [b.id]: stations };
      if (strict) b.stations = stations.map(({ poseId: _poseId, ...station }) => {
        void _poseId;
        return station;
      });
      mixed.drafts = { ...mixed.drafts, [b.id]: { rounds: null, tapped: 0 } };
    }
  }
  return { mixed, blocks, flags };
}

async function materializeStrength(db: GymDb, block: LiftBlock) {
  const exercise = exerciseById.get(block.exerciseId)!;
  return ensureEquipmentInstance(db, exercise, block.equipmentId!);
}

export async function writePreparedOrdered(db: GymDb, prepared: NonNullable<ReturnType<typeof prepareOrderedStart>>,
  now: Date, templateId?: string, variant?: LiftVariant): Promise<string> {
  const { mixed, blocks, flags } = structuredClone(prepared);
  for (const block of blocks) {
    if (block.kind !== 'lift') continue;
    const strength = mixed.strength[block.id]!;
    if (strength.equipmentId) {
      block.equipmentId = await materializeStrength(db, block);
      strength.equipmentId = block.equipmentId;
    }
  }
  const id = newId();
  await db.sessions.add({
    id, type: 'custom', date: now.toISOString(), templateId, variant, blocks, mixed,
    hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '',
    flags: { deload: flags.deload, calibration: blocks.some((b) => b.kind === 'lift' && b.label === 'Calibration') },
  });
  return id;
}

export function findOpenMixedSession(db: GymDb): Promise<Session | undefined> {
  return db.sessions.orderBy('date').reverse().filter((s) => !!s.mixed && !s.endedAt).first();
}

export async function mixedOptions(db: GymDb, b: OrderedBlock, mixed: MixedExecution, now = new Date()) {
  const g = await loadMixedGym(db, now);
  if ((b.kind === 'self-paced' || b.kind === 'coached') && b.stations) {
    const coached = b.kind === 'coached';
    const effective = get(mixed.stations, b.id) ?? [];
    // Active coached lineups retain their accepted gym eligibility while settings change.
    const demo = coached && mixed.cursor.stage === 'active' ? verifiedDemo : availableDemo;
    const available = new Set(effective.filter((s) =>
      !s.skipped && s.equipmentId && s.poseId && stationUnitMatches(s) && demo(g, s.exerciseId, s.equipmentId, coached)?.poseId === s.poseId
    ).map((s) => s.slotId));
    return {
      stations: Object.fromEntries(b.stations.map((s, i) => [s.slotId, stationChoices(g, s, effective[i]!, coached)])),
      available,
      ready: (!coached || available.size > 0) && effective.every((s) => s.skipped || available.has(s.slotId)),
    };
  }
  if (b.kind === 'strength') {
    const accepted = get(mixed.strength, b.id);
    const demo = accepted?.equipmentId && PHASE_LIFTS.has(accepted.exerciseId)
      ? availableDemo(g, accepted.exerciseId, accepted.equipmentId) : null;
    return {
      strength: strengthChoices(g, b, accepted?.exerciseId ?? b.exerciseId)
        .filter((id) => id !== accepted?.exerciseId || !demo),
      ready: !!demo,
      poseId: demo?.poseId,
    };
  }
  if (b.kind === 'run') {
    const planned = runDemo(b.modality);
    const demo = planned.exerciseId ? availableDemo(g, planned.exerciseId, undefined, !!planned.coached) : null;
    return { ready: !planned.exerciseId || !!demo, poseId: planned.poseId, equipmentId: demo?.equipmentId };
  }
  const demo = b.kind !== 'coached' && b.exerciseId ? availableDemo(g, b.exerciseId) : null;
  return { ready: b.kind !== 'coached' && (!b.exerciseId || !!demo), poseId: demo?.poseId, equipmentId: demo?.equipmentId };
}

function checkActual(partial: MixedDraft['partial'], stations: EffectiveStation[]) {
  if (partial && (!nonnegative(partial.count) || !stations.some((s) => !s.skipped && s.slotId === partial.slotId && s.target.unit === partial.unit))) {
    throw new MixedInputError('Enter work for an available station using its target unit.');
  }
}

function sameLineup(stations: EffectiveStation[], expected: EffectiveStation[]) {
  return stations.length === expected.length && stations.every((station, i) => {
    const other = expected[i]!;
    return station.slotId === other.slotId && station.exerciseId === other.exerciseId && station.equipmentId === other.equipmentId
      && !!station.skipped === !!other.skipped && station.target.unit === other.target.unit
      && station.target.amount === other.target.amount && station.load === other.load;
  });
}

export async function updateMixedSession(db: GymDb, id: string, expected: MixedCursor, action: Action, now = new Date()): Promise<Session | undefined> {
  return db.transaction('rw', [db.sessions, db.sets, db.equipment, db.exerciseOverrides, db.settings, db.runs, db.tests], async () => {
    const session = await db.sessions.get(id);
    const m = session?.mixed;
    if (!session || !m || session.endedAt) return session;
    const { blockId, stage, setSlot } = m.cursor;
    if (expected.blockId !== blockId || expected.stage !== stage || expected.setSlot !== setSlot) return session;
    const index = m.prescription.blocks.findIndex((b) => b.id === blockId);
    const b = m.prescription.blocks[index];
    if (!b || (b.kind === 'coached' && !b.stations)) return session;
    const strengthRows = b.kind === 'strength' ? await db.sets.where('sessionId').equals(id).toArray() : undefined;
    if (strengthRows && reconcileMixedStrength(session, blockId, strengthRows)) {
      await db.sessions.put(session);
      return session;
    }
    const nowMs = now.getTime();
    let clock = get(m.timers, blockId);
    const draft = get(m.drafts, blockId);
    const stations = get(m.stations, blockId);
    const strength = get(m.strength, blockId);
    const setStage = (next: MixedCursor['stage'], slot = setSlot) => { m.cursor = { blockId, stage: next, setSlot: slot }; };
    const saveClock = (next: MixedTimer) => { m.timers = { ...m.timers, [blockId]: next }; };
    const saveDraft = (next: MixedDraft) => { m.drafts = { ...m.drafts, [blockId]: next }; };
    const reconcile = stage === 'active' && clock ? reconcileClock(clock, nowMs) : undefined;
    if (stage === 'active' && b.kind === 'coached' && b.stations && clock?.coached && stations) {
      const schedule = coachedSchedule(b, stations.filter((s) => !s.skipped));
      clock = { ...clock, coached: projectCoached(schedule, clock.coached, elapsedClamped(clock, nowMs)).at };
      saveClock(clock);
    }
    const openReview = (frozen: MixedTimer) => {
      saveClock(frozen);
      if (frozen.coached && draft) saveDraft({ ...draft, rounds: frozen.coached.rotations });
      setStage('review');
    };
    if (reconcile?.openedReview) {
      openReview({ ...clock!, frozenElapsedMs: reconcile.clock.frozenElapsedMs });
      await db.sessions.put(session);
      return session;
    }

    switch (action.type) {
      case 'start': {
        if (stage !== 'entry' || b.kind === 'strength') return session;
        if (!(await mixedOptions(db, b, m, now)).ready) throw new MixedInputError('Replace or skip unavailable movements first.');
        const acceptedRun = b.kind === 'run' ? session.blocks.find((row): row is RunBlock => row.kind === 'run' && row.id === b.id) : undefined;
        const durationMs = acceptedRun ? runTotalMs(runPhases(acceptedRun)) : b.durationSec * 1000;
        saveClock({ ...startClock({ startedAt: null, pausedAt: null, pausedMs: 0, durationMs }, nowMs),
          ...(b.kind === 'coached' ? { coached: initialCoached } : {}) });
        setStage('active');
        break;
      }
      case 'pause':
      case 'resume':
        if (stage !== 'active' || !clock || (action.type === 'pause' ? clock.pausedAt !== null : clock.pausedAt === null)) return session;
        saveClock(action.type === 'pause' ? pauseClock(clock, nowMs) : resumeClock(clock, nowMs));
        break;
      case 'expire':
        return session;
      case 'next': {
        if (stage !== 'active' || !clock?.coached || clock.pausedAt !== null || !stations || !sameCoachedPhase(clock.coached, action.observed)) return session;
        if (!(await mixedOptions(db, b, m, now)).ready) throw new MixedInputError('Replace unavailable movements or finish the block.');
        const next = nextCoached(clock.coached, stations.filter((s) => !s.skipped).length, elapsedClamped(clock, nowMs));
        if (next.rotations >= Number.MAX_SAFE_INTEGER - (clock.durationMs - next.phaseStartMs)) throw new MixedInputError('This rotation cannot advance further.');
        saveClock({ ...clock, coached: next });
        break;
      }
      case 'round':
        if (b.kind !== 'self-paced' || stage !== 'active' || !draft || !stations || !clock || clock.pausedAt !== null || draft.tapped !== action.expectedTapped) return session;
        if (!sameLineup(stations, action.expectedStations)) throw new MixedInputError('The station lineup changed. Check the current stations before logging a round.');
        if (!(await mixedOptions(db, b, m, now)).ready) throw new MixedInputError('Replace or skip unavailable movements first.');
        saveDraft({ ...draft, tapped: draft.tapped + 1, rounds: draft.tapped + 1 });
        break;
      case 'finish':
        if (stage !== 'active') return session;
        if (clock) openReview(finishClock(clock, nowMs));
        else setStage('review');
        break;
      case 'skip':
        if (stage !== 'entry') return session;
        if (b.kind !== 'strength') saveClock({ startedAt: null, pausedAt: null, pausedMs: 0, durationMs: b.durationSec * 1000, frozenElapsedMs: 0 });
        setStage('review');
        break;
      case 'review': {
        if (stage !== 'review' || !draft || !stations || clock?.startedAt === null) return session;
        const rounds = action.rounds === undefined ? draft.rounds : action.rounds;
        if (rounds !== null && (!Number.isSafeInteger(rounds) || rounds < 0)) throw new MixedInputError('Enter a whole number of rounds or leave it blank.');
        const partial = action.partial === undefined ? draft.partial : action.partial ?? undefined;
        checkActual(partial, stations);
        saveDraft({ ...draft, rounds, partial });
        break;
      }
      case 'swap-station': {
        if ((b.kind !== 'self-paced' && b.kind !== 'coached') || !b.stations || stage === 'review' || !stations || !draft) return session;
        const original = b.stations.find((s) => s.slotId === action.slotId);
        const current = stations.find((s) => s.slotId === action.slotId);
        if (!original || !current || current.exerciseId !== action.expectedExerciseId) return session;
        if (b.kind === 'coached' && stage === 'active' && (action.exerciseId === null || current.skipped)) return session;
        if (draft.partial?.slotId === current.slotId) throw new MixedInputError('This station already has partial work recorded.');
        const next = action.exerciseId === null ? { ...current, skipped: true }
          : stationChoices(await loadMixedGym(db, now), original, current, b.kind === 'coached').find((s) => s.exerciseId === action.exerciseId);
        if (!next) throw new MixedInputError('That replacement is unavailable. Choose another movement.');
        const changes = draft.stationChanges ?? [];
        const rounds = clock?.coached?.rotations ?? draft.tapped;
        if (rounds > (changes.at(-1)?.afterRound ?? 0)) {
          saveDraft({ ...draft, stationChanges: [...changes, { afterRound: rounds, stations }] });
        }
        m.stations = { ...m.stations, [blockId]: stations.map((s) => s.slotId !== next.slotId ? s : {
          ...next, swappedFromExerciseId: next.exerciseId !== original.exerciseId ? original.exerciseId : undefined,
        }) };
        break;
      }
      case 'swap-strength': {
        if (b.kind !== 'strength' || stage !== 'entry' || !strength || strength.exerciseId !== action.expectedExerciseId) return session;
        const g = await loadMixedGym(db, now);
        if (!strengthChoices(g, b, strength.exerciseId).includes(action.exerciseId)) throw new MixedInputError('That replacement is unavailable.');
        const flags = { ...replayLiftFlags(g.snapshot, now), deload: !!session.flags?.deload };
        const volume = weekFractionalSets(g.snapshot, LIFT_EXERCISES);
        for (const later of m.prescription.blocks.slice(index + 1)) {
          const accepted = get(m.strength, later.id);
          if (!accepted?.equipmentId || accepted.label === 'Calibration') continue;
          const remaining = accepted.sets - loggedMixedSets(id, later.id, strengthRows!).length;
          countStrengthSets(volume, strengthWeights(accepted.exerciseId), remaining);
        }
        const next = prepareStrength(g, b, action.exerciseId, flags, volume);
        if (next) next.equipmentId = await materializeStrength(db, next);
        if (!next) throw new MixedInputError('No strength sets available for that movement.');
        m.strength = { ...m.strength, [blockId]: next };
        session.blocks = session.blocks.map((row) => row.id === blockId ? next : row);
        session.flags = { ...session.flags, calibration: session.blocks.some((row) => row.label === 'Calibration') };
        break;
      }
      case 'set': {
        if (strength && (strength.exerciseId !== action.expectedExerciseId || strength.equipmentId !== action.expectedEquipmentId)) {
          throw new MixedInputError('This movement changed. Check the current exercise before logging a set.');
        }
        if (!strength?.equipmentId || stage === 'review' || setSlot >= strength.sets) return session;
        if (!(await mixedOptions(db, b, m, now)).ready) throw new MixedInputError('This movement is unavailable. Swap or finish the block.');
        if (!nonnegative(action.weight) || !Number.isSafeInteger(action.reps) || action.reps < 1) throw new MixedInputError('Enter a weight and a positive whole number of reps.');
        const row: SetRow = {
          id: mixedSetId(id, blockId, setSlot), sessionId: id, exerciseId: strength.exerciseId,
          equipmentId: strength.equipmentId, idx: setSlot, targetWeight: strength.targetWeight ?? 0, targetReps: strength.repMin,
          weight: action.weight, reps: action.reps, painFlag: false, ts: now.toISOString(),
          setKind: strength.label === 'Calibration' ? 'calibration' : 'working',
        };
        await db.sets.add(row);
        setStage(setSlot + 1 === strength.sets ? 'review' : 'active', setSlot + 1);
        break;
      }
      case 'continue': {
        if (stage !== 'review') return session;
        const status = strength ? (setSlot === 0 ? 'skipped' : 'completed') : clock?.startedAt === null ? 'skipped' : 'completed';
        const rounds = status === 'skipped' ? draft?.rounds : action.rounds === undefined ? draft?.rounds : action.rounds;
        if (rounds != null && (!Number.isSafeInteger(rounds) || rounds < 0)) throw new MixedInputError('Enter a whole number of rounds or leave it blank.');
        const partial = status === 'skipped' || action.partial === undefined ? draft?.partial : action.partial ?? undefined;
        checkActual(partial, stations ?? []);
        if (draft && (action.rounds !== undefined || action.partial !== undefined)) saveDraft({ ...draft, rounds: rounds ?? null, partial });
        if (b.kind === 'run' && status === 'completed') {
          const v = action.run;
          const planned = session.blocks.find((row): row is RunBlock => row.kind === 'run' && row.id === blockId);
          if (!planned || !v || !nonnegative(v.distanceMi) || !(v.durationSec > 0) || !Number.isSafeInteger(v.rpe) || v.rpe < 1 || v.rpe > 10) {
            throw new MixedInputError('Enter the distance, duration and effort for this run.');
          }
          const ratio = runWalkRatioOf(planned);
          await db.runs.put({
            sessionId: id, kind: planned.runKind, modality: v.modality, distanceMi: v.distanceMi, durationSec: Math.round(v.durationSec),
            intervals: planned.segments, ...(ratio ? { runWalkRatio: ratio } : {}), rpe: v.rpe, painFlag: v.painFlag,
          });
        }
        const result: MixedResult = { status, elapsedMs: clock?.frozenElapsedMs ?? 0,
          ...(draft ? { rounds: rounds ?? null, partial, stations, stationChanges: draft.stationChanges } : {}) };
        m.results = { ...m.results, [blockId]: result };
        const next = m.prescription.blocks[index + 1];
        if (next) {
          m.cursor = { blockId: next.id, stage: 'entry', setSlot: 0 };
          if (next.kind === 'strength') {
            const rows = strengthRows ?? await db.sets.where('sessionId').equals(id).toArray();
            reconcileMixedStrength(session, next.id, rows);
          }
        } else {
          const sets = strengthRows ?? await db.sets.where('sessionId').equals(id).toArray();
          const lifts = session.blocks.filter((row): row is LiftBlock => row.kind === 'lift');
          const { fatigue } = summarizeLiftSession(lifts, sets);
          Object.assign(session, {
            endedAt: now.toISOString(), rpe: null, ...classifyHard({ type: session.type, rpe: null, runKinds: await loggedRunKinds(db, id) }),
            durationMin: Math.max(0, Math.round((nowMs - Date.parse(session.date)) / 60_000)),
            flags: { ...session.flags, fatigue },
          });
        }
        break;
      }
    }
    await db.sessions.put(session);
    return session;
  });
}

export async function rateMixedSession(db: GymDb, id: string, rpe: number): Promise<void> {
  if (!Object.values(FINISH_RPE).some((value) => value === rpe)) throw new MixedInputError('Invalid effort.');
  await db.transaction('rw', db.sessions, db.runs, async () => {
    const session = await db.sessions.get(id);
    if (!session?.mixed || !session.endedAt) throw new MixedInputError('This workout is unfinished.');
    await db.sessions.update(id, { rpe, ...classifyHard({ type: session.type, rpe, runKinds: await loggedRunKinds(db, id) }) });
  });
}

/** A mixed session holds at most one run row. Its kind drives the hard-cardio flag. */
async function loggedRunKinds(db: GymDb, sessionId: string) {
  const row = await db.runs.get(sessionId);
  return row ? [row.kind] : [];
}
