import type { CircuitBlock, CircuitStation, Equipment, StationTarget, StationUnit } from '../../data/types';
import {
  BLOCK_DROP_PCT, BLOCK_DROP_SESSIONS, BLOCK_START_LOAD_PCT,
  SEC_PER_M_CARRY, SEC_PER_UNIT, STATION_TARGETS, TRANSITION_SEC,
} from '../config';
import { calibrationStart } from '../lift/progression';
import { nearestStep, stepBy } from '../lift/steps';
import type { HistorySession } from '../lift/types';
import { kitOf, type BlockExerciseShape } from './rules';
import { circuitWork } from './work';

type StationDraft = { exercise: BlockExerciseShape; equipmentId?: string; itemId?: string; unit?: StationUnit };
export type Draft = StationDraft & { backup?: StationDraft };
type BlockPrescriptionInput = {
  slotKey: string;
  stations: Draft[];
  durationSec: number;
  role: CircuitBlock['role'];
  history: HistorySession[];
  equipment: Map<string, Equipment>;
  workingWeightOf(exId: string, eqId: string): number | undefined;
};

export function slotKeyOf(session: { type: string; variant?: string; templateId?: string }, label?: string): string {
  return session.type === 'burn' ? `burn:${session.templateId}:${label}` : `${session.variant}:${label}`;
}

function targetOf(ex: BlockExerciseShape, role: CircuitBlock['role'], requestedUnit?: StationUnit): StationTarget {
  const lane = role === 'finisher' ? 'short' : 'normal';
  const unit = requestedUnit && (ex.targets?.includes(requestedUnit) || requestedUnit === ex.unit)
    ? requestedUnit
    : ex.targets?.[0] ?? (ex.unit === 'amrap' || ex.unit === 'steps' ? 'reps' : ex.unit);
  const min = ex.unitMin ?? (ex.repMin || 8);
  const max = ex.unitMax ?? (ex.repMax || min + 4);
  const amount = unit === 'reps'
    ? (STATION_TARGETS.reps[lane] === 'min' ? min : Math.round((min + max) / 2))
    : unit === 'm'
      ? STATION_TARGETS.m[ex.group === 'carry-core' ? 'carry' : 'erg'][lane]
      : STATION_TARGETS[unit][lane];
  return { unit, amount };
}

/** Units the builder may offer. An empty `targets` list falls through to the unit `targetOf` would pick. */
export function stationUnits(ex: BlockExerciseShape): StationUnit[] {
  if (ex.targets && ex.targets.length > 0) return [...ex.targets];
  return [ex.unit === 'amrap' || ex.unit === 'steps' ? 'reps' : ex.unit];
}

/** Normal lane, optionally for one offered unit. The finisher short lane stays out of the builder. */
export function stationTarget(ex: BlockExerciseShape, requestedUnit?: StationUnit): StationTarget {
  return targetOf(ex, 'block', requestedUnit);
}

export function defaultStationTarget(ex: BlockExerciseShape): StationTarget {
  return targetOf(ex, 'block');
}

function roundDownToStep(steps: number[], weight: number): number {
  const nearest = nearestStep(steps, weight);
  return nearest > weight ? stepBy(steps, nearest, -1) : nearest;
}

function freshStation(draft: StationDraft, input: BlockPrescriptionInput): Omit<CircuitStation, 'backup'> {
  const { exercise, equipmentId, itemId } = draft;
  const station: Omit<CircuitStation, 'backup'> = {
    exerciseId: exercise.id, equipmentId, itemId, target: targetOf(exercise, input.role, draft.unit),
  };
  const eq = equipmentId === undefined ? undefined : input.equipment.get(equipmentId);
  if (eq && eq.kind !== 'bodyweight' && !exercise.equipment.every((tag) => tag === 'bodyweight') && kitOf(exercise) !== 'cardio') {
    const weight = input.workingWeightOf(exercise.id, eq.id);
    station.load = weight === undefined ? calibrationStart(eq) : roundDownToStep(eq.steps, weight * BLOCK_START_LOAD_PCT);
  }
  return station;
}

function secondsFor(target: StationTarget, ex: BlockExerciseShape): number {
  const perUnit = target.unit === 'm' && ex.group === 'carry-core' ? SEC_PER_M_CARRY : SEC_PER_UNIT[target.unit];
  return target.amount * perUnit + TRANSITION_SEC;
}

export function prescribeBlock(input: BlockPrescriptionInput): { targetRounds: number; stations: CircuitStation[] } {
  const stations: CircuitStation[] = input.stations.map((draft) => ({
    ...freshStation(draft, input),
    ...(draft.backup && { backup: freshStation(draft.backup, input) }),
  }));
  const stationKey = (ids: string[]) => JSON.stringify(ids.sort());
  const plannedKey = stationKey(stations.map((station) => station.exerciseId));
  const recent = [...input.history]
    .sort((a, b) => a.session.date.localeCompare(b.session.date))
    .flatMap(({ session }) => session.blocks.filter((block): block is CircuitBlock =>
      block.kind === 'circuit' && !!block.log && slotKeyOf(session, block.label) === input.slotKey
      && stationKey(block.log.stations.map((station) => station.exerciseId)) === plannedKey))
    .slice(-(BLOCK_DROP_SESSIONS + 1));

  const last = recent.at(-1);
  if (!last) {
    const roundSec = stations.reduce((sec, station, i) => sec + secondsFor(station.target, input.stations[i]!.exercise), 0);
    return { targetRounds: Math.max(1, Math.floor(input.durationSec / roundSec)), stations };
  }

  const log = last.log!;
  const hit = log.completedRounds >= last.targetRounds;
  const work = recent.map((block) => circuitWork(block)!.perStation);
  const consecutiveMisses = recent.length === BLOCK_DROP_SESSIONS + 1
    && recent.slice(1).every((block) => block.log && block.log.completedRounds < block.targetRounds);
  for (const station of stations) {
    if (station.load === undefined || station.equipmentId === undefined) continue;
    const i = log.stations.findIndex((entry) => entry.exerciseId === station.exerciseId);
    const actual = log.stations[i];
    const previous = last.stations[i];
    if (!actual || actual.swappedFromExerciseId || previous?.equipmentId !== station.equipmentId) continue;
    const load = actual.actualLoad ?? previous.load;
    const eq = input.equipment.get(station.equipmentId);
    if (load === undefined || !eq) continue;

    const amounts = work.map((entries) => entries.find((entry) => entry.exerciseId === station.exerciseId));
    const dropped = consecutiveMisses && amounts.slice(1).every((current, j) => {
      const prior = amounts[j];
      return current && prior && current.unit === prior.unit && current.amount < prior.amount * (1 - BLOCK_DROP_PCT);
    });
    station.load = dropped ? roundDownToStep(eq.steps, load * (1 - BLOCK_DROP_PCT)) : hit ? stepBy(eq.steps, load, 1) : load;
  }

  return { targetRounds: Math.max(1, hit ? last.targetRounds - 1 : log.completedRounds + 1), stations };
}
