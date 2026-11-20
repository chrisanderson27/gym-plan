import type { Block, CircuitBlock, LiftVariant } from '../../data/types';
import {
  BLOCK_ATTEMPTS, BLOCK_STATIONS, BLOCK_TRANSITION_MIN, COOLDOWN_MIN, FINISHER_MIN, JOINT_FRIENDLY_WEEKS,
  LIFT_DAY_MAIN_SETS, LIFT_DAY_SHAPES, MAIN_REST_SEC, MIN_PER_SET, WARMUP_MIN,
} from '../config';
import { localDate } from '../dates';
import { availableOn, floors, type Option } from '../gym/availability';
import type { GymItemShape, GymProfileShape } from '../gym/types';
import { deloadState } from '../lift/deload';
import { pickSubstitute } from '../lift/generator';
import { isLowerBarbell, prescribe } from '../lift/progression';
import { isWorking, type LiftSnapshot, type Prescription } from '../lift/types';
import { isRampInWeek, weekIndex } from '../week';
import { prescribeBlock, type Draft } from './progression';
import { mulberry32, shuffle } from './rng';
import { countsAsCardio, FINISHER_INTENSITY_IDS, groupOf, kitOf, NO_BLOCK_IDS, PROFILES, type BlockExerciseShape } from './rules';
import { blockContext, validateBlock, type BlockContext } from './validate';

export interface LiftDayInput {
  variant: LiftVariant;
  budgetMin: number;
  seed: number;
  profile: GymProfileShape;
  exercises: Map<string, BlockExerciseShape>;
  snapshot: LiftSnapshot;
  mainCandidates: string[];
  resolveEquipmentId(exerciseId: string, item: GymItemShape | undefined, weekIdx: number): string;
  makeId(): string;
  preferFloor?: number;
  bodyweightIds: readonly string[];
  notAtMyGym?: ReadonlySet<string>;
}

export interface LiftDayPlan {
  variant: LiftVariant;
  floor: number;
  deload: boolean;
  rampIn: boolean;
  weekIdx: number;
  blocks: Block[];
  main: Prescription;
  estMin: number;
  dropped: string[];
}

type Choice = { option: Option; ex: BlockExerciseShape; group: ReturnType<typeof groupOf>; kit: ReturnType<typeof kitOf> };
const minutesFor = (shape: readonly number[]) => shape.reduce((total, minutes) => total + minutes + BLOCK_TRANSITION_MIN, 0);

export function estimateLiftDayMinutes(
  blocks: readonly Block[], exercises: ReadonlyMap<string, Pick<BlockExerciseShape, 'repClass'>>,
): number {
  return blocks.reduce((minutes, block) => {
    if (block.kind === 'circuit') return minutes + block.durationSec / 60 + BLOCK_TRANSITION_MIN;
    if (block.kind === 'lift' && !block.warmup) {
      return minutes + block.sets * MIN_PER_SET[exercises.get(block.exerciseId)?.repClass ?? 'other'];
    }
    return minutes;
  }, WARMUP_MIN + COOLDOWN_MIN);
}

function chooseStations(
  pool: Choice[], size: number, finisher: boolean, rand: () => number,
): Choice[] {
  const picked: Choice[] = [];
  const groups = new Set<Choice['group']>();
  const intensity = (choice: Choice) => choice.kit === 'cardio' || FINISHER_INTENSITY_IDS.includes(choice.ex.id);
  let fixed = 0;
  let cardio = 0;
  let intense = false;
  for (const choice of shuffle(pool, rand)) {
    const isCardio = countsAsCardio(choice.group, choice.kit);
    if (picked.some((entry) => entry.ex.id === choice.ex.id) || picked.at(-1)?.group === choice.group) continue;
    if (choice.kit === 'fixed' && fixed >= PROFILES.lift.fixedMax) continue;
    if (isCardio && cardio >= PROFILES.lift.cardioMax) continue;
    const remaining = size - picked.length - 1;
    if (groups.size + Number(!groups.has(choice.group)) + remaining < PROFILES.lift.minGroups) continue;
    if (!remaining && (picked[0]?.group === choice.group || (finisher && !intense && !intensity(choice)))) continue;
    picked.push(choice);
    groups.add(choice.group);
    fixed += Number(choice.kit === 'fixed');
    cardio += Number(isCardio);
    intense ||= intensity(choice);
    if (picked.length === size) break;
  }
  return picked;
}

function primaryPod(choices: Choice[]): string {
  const counts = new Map<string, number>();
  for (const { option } of choices) counts.set(option.podId, (counts.get(option.podId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

function buildCircuits(
  input: LiftDayInput, choices: Choice[], shape: readonly (keyof typeof BLOCK_STATIONS)[],
  mainId: string, jfOnly: boolean, ctx: BlockContext, weekIdx: number,
): { circuits: CircuitBlock[]; dropped: string[] } {
  const { profile, snapshot, seed, variant, resolveEquipmentId } = input;
  const rand = mulberry32(seed);
  const allowed = choices.filter(({ ex }) => ex.id !== mainId && (!jfOnly || ex.jointFriendly) && !NO_BLOCK_IDS.includes(ex.id));
  const used = new Set<string>();
  const circuits: CircuitBlock[] = [];
  const dropped: string[] = [];
  let priorZone: string | undefined;
  const zones = shuffle([...new Set(allowed.map(({ option }) => option.zone))], rand);

  const draftOf = ({ ex, option }: Choice) => ({
    exercise: ex, itemId: option.itemId,
    equipmentId: resolveEquipmentId(ex.id, option.itemId === undefined ? undefined : ctx.item(option.itemId), weekIdx),
  });
  const workingWeights = new Map<string, Map<string, number>>();
  for (const { session, sets } of snapshot.history) {
    if (session.flags?.deload) continue;
    for (const set of sets) {
      if (!isWorking(set)) continue;
      let weights = workingWeights.get(set.exerciseId);
      if (!weights) workingWeights.set(set.exerciseId, weights = new Map());
      weights.set(set.equipmentId, set.weight);
    }
  }

  for (const [index, minutes] of shape.entries()) {
    const role = minutes === FINISHER_MIN ? 'finisher' : 'block';
    const label = role === 'finisher' ? 'Finisher' : `Block ${String.fromCharCode(65 + index)}`;
    const neighbours = profile.zones.find((zone) => zone.id === priorZone)?.neighbours ?? [];
    const priority = (zone: string) => zone === priorZone ? 0 : neighbours.includes(zone) ? 1 : 2;
    const zoneOrder = [...zones].sort((a, b) => priority(a) - priority(b));
    const size = BLOCK_STATIONS[minutes];
    let built: CircuitBlock | undefined;

    for (const zone of zoneOrder) {
      const pool = allowed.filter((choice) => choice.option.zone === zone && !used.has(choice.ex.id));
      const backups = new Map<Choice, Choice>();
      for (const choice of pool) {
        const swaps = pool.filter((other) => other.option.podId === choice.option.podId
          && other.ex.id !== choice.ex.id && other.group === choice.group
          && (choice.option.count !== 1 || other.option.itemId !== choice.option.itemId));
        const backup = swaps.find((other) => other.option.anchorOk && choice.ex.substitutes.includes(other.ex.id))
          ?? swaps.find((other) => other.option.anchorOk) ?? swaps[0];
        if (backup) backups.set(choice, backup);
      }
      const primaries = pool.filter((choice) => choice.option.anchorOk && (choice.option.count !== 1 || backups.has(choice)));
      if (new Set(primaries.map((choice) => choice.ex.id)).size < size
        || new Set(primaries.map((choice) => choice.group)).size < PROFILES.lift.minGroups) continue;

      for (let attempt = 0; attempt < BLOCK_ATTEMPTS; attempt++) {
        const picked = chooseStations(primaries, size, role === 'finisher', rand);
        if (picked.length < size) continue;
        const drafts: Draft[] = picked.map((choice) => {
          const backup = backups.get(choice);
          return { ...draftOf(choice), ...(backup && { backup: draftOf(backup) }) };
        });
        const durationSec = minutes * 60;
        const prescription = prescribeBlock({
          slotKey: `${variant}:${label}`, stations: drafts, durationSec, role,
          history: snapshot.history, equipment: snapshot.equipment,
          workingWeightOf: (id, equipmentId) => workingWeights.get(id)?.get(equipmentId),
        });
        const block: CircuitBlock = { id: '', kind: 'circuit', role, label, durationSec, podId: primaryPod(picked), ...prescription };
        if (validateBlock(block, ctx, 'lift').length) continue;
        built = block;
        priorZone = zone;
        for (const { exerciseId } of block.stations) used.add(exerciseId);
        break;
      }
      if (built) break;
    }
    if (built) circuits.push(built);
    else dropped.push(`block:${label}`);
  }
  return { circuits, dropped };
}

export function generateLiftDay(input: LiftDayInput): LiftDayPlan {
  const { snapshot, variant, profile, mainCandidates, exercises, budgetMin, preferFloor = 2, bodyweightIds } = input;
  const weekIdx = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  const rampIn = isRampInWeek(weekIdx);
  const { deload } = deloadState(snapshot);
  const jfOnly = weekIdx <= JOINT_FRIENDLY_WEEKS;
  const notAtMyGym = new Set(input.notAtMyGym);
  for (const [id, override] of snapshot.overrides) if (override.notAtMyGym) notAtMyGym.add(id);
  const ctx = blockContext(profile, exercises);

  function buildOnFloor(floor: number, allowSubstitute: boolean): LiftDayPlan {
    const choices = availableOn(profile, floor, { notAtMyGym, bodyweightIds }).flatMap((option): Choice[] => {
      const ex = exercises.get(option.exerciseId);
      return ex ? [{ option, ex, group: groupOf(ex), kit: kitOf(ex) }] : [];
    });
    const availableMain = new Map<string, string>();
    for (const { option, ex } of choices) {
      if (availableMain.has(ex.id) || !option.anchorOk || ex.unit !== 'reps' || (jfOnly && !ex.jointFriendly)) continue;
      const item = option.itemId === undefined ? undefined : ctx.item(option.itemId);
      const equipmentId = input.resolveEquipmentId(ex.id, item, weekIdx);
      if (snapshot.equipment.has(equipmentId)) availableMain.set(ex.id, equipmentId);
    }
    const first = mainCandidates[0];
    let mainId = mainCandidates.find((id) => availableMain.has(id));
    if (!mainId && allowSubstitute && first) {
      const exclude = new Set([...exercises.keys()].filter((id) => !availableMain.has(id)));
      mainId = pickSubstitute(first, exercises, snapshot.overrides, { jointFriendlyOnly: jfOnly, exclude }) ?? undefined;
    }

    const blocks: Block[] = [];
    const warm = choices.find(({ option, kit, ex }) => option.anchorOk && kit === 'cardio' && (!jfOnly || ex.jointFriendly));
    const warmId = warm?.ex.id ?? '';
    const easyMovement = warm ? `Easy ${warm.ex.id.replaceAll('-', ' ')}` : 'Easy walking in place';
    blocks.push({
      id: '', kind: 'lift', exerciseId: warmId, sets: 1, repMin: 0, repMax: 0, warmup: true, role: 'warmup',
      label: `Warm-up · ${WARMUP_MIN} min`,
      notes: `${easyMovement} for 3–5 min, then hip airplane, world's greatest stretch, glute bridge, cat-cow, ankle rocks`,
    });

    let main: Prescription = { mode: 'hold', weight: 0, reps: 0, sets: 0, rirTarget: 0, reason: 'No available main lift' };
    const dropped: string[] = [];
    if (mainId) {
      const ex = exercises.get(mainId)!;
      const equipmentId = availableMain.get(mainId)!;
      const eq = snapshot.equipment.get(equipmentId)!;
      main = prescribe(ex, eq, snapshot.history.filter(({ session }) => !session.flags?.deload), {
        deload, rampIn, isLowerBarbell: isLowerBarbell(ex, eq),
      });
      if (main.mode !== 'calibrate') {
        const { min, max, reducedMin } = LIFT_DAY_MAIN_SETS;
        main.sets = Math.min(max, Math.max(deload || rampIn ? reducedMin : min, main.sets));
      }
      blocks.push({
        id: '', kind: 'lift', exerciseId: mainId, equipmentId, sets: main.sets,
        repMin: ex.repMin, repMax: ex.repMax, targetWeight: main.weight, rirTarget: main.rirTarget,
        restSec: MAIN_REST_SEC, label: 'Main lift',
      });
    } else {
      dropped.push('main');
    }

    const baseMin = estimateLiftDayMinutes(blocks, exercises);
    const lastShape = LIFT_DAY_SHAPES[LIFT_DAY_SHAPES.length - 1]!;
    const shape = LIFT_DAY_SHAPES.find((shape) => baseMin + minutesFor(shape) <= budgetMin) ?? lastShape;
    const { circuits, dropped: missedBlocks } = mainId
      ? buildCircuits(input, choices, shape, mainId, jfOnly, ctx, weekIdx)
      : { circuits: [], dropped: [] };
    blocks.push(...circuits, {
      id: '', kind: 'lift', exerciseId: warmId, sets: 1, repMin: 0, repMax: 0, warmup: true, role: 'cooldown',
      label: `Cool-down · ${COOLDOWN_MIN} min`,
      notes: `${easyMovement}, then stretch hips, hamstrings and chest`,
    });
    const estMin = estimateLiftDayMinutes(blocks, exercises);
    return { variant, floor, deload, rampIn, weekIdx, blocks, main, estMin, dropped: [...dropped, ...missedBlocks] };
  }

  let preferred: LiftDayPlan | undefined;
  for (const floor of [preferFloor, ...floors(profile).filter((floor) => floor !== preferFloor)]) {
    const plan = buildOnFloor(floor, false);
    if (plan.blocks.some((block) => block.kind === 'circuit')) {
      return { ...plan, blocks: plan.blocks.map((block) => ({ ...block, id: input.makeId() })) };
    }
    if (floor === preferFloor) preferred = plan;
  }
  const fallback = preferred?.main.sets ? preferred : buildOnFloor(preferFloor, true);
  return {
    ...fallback,
    blocks: fallback.blocks.map((block) => ({ ...block, id: input.makeId() })),
    dropped: [`floor:${preferFloor}`, ...fallback.dropped],
  };
}
