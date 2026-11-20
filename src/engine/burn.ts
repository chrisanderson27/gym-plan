import type { Block, CircuitBlock, Equipment, ISODateTime, LiftBlock, StationUnit } from '../data/types';
import { pickBackup, primaryPod, workingWeightsOf, type Choice } from './block/generate';
import { prescribeBlock, slotKeyOf, type Draft } from './block/progression';
import { groupOf, kitOf, NO_BLOCK_IDS, PROFILES, type BlockExerciseShape } from './block/rules';
import { blockContext, validateBlock } from './block/validate';
import { BLOCK_LONG_MIN, BLOCK_SHORT_MIN, BLOCK_TRANSITION_MIN, BURN_BUDGET_SLACK_MIN, BURN_COOLDOWN_MIN, BURN_WARMUP_MIN } from './config';
import { availableOn, defaultBurnPods, zoneOf } from './gym/availability';
import type { GymItemShape, GymProfileShape } from './gym/types';
import type { HistorySession } from './lift/types';

export interface BurnStationSpec { exerciseId: string; unit?: StationUnit }
export interface BurnBlockSpec { label: string; minutes: number; role: CircuitBlock['role']; stations: BurnStationSpec[] }
export interface BurnTemplateShape { id: string; blocks: BurnBlockSpec[] }
export interface BurnInput {
  template: BurnTemplateShape;
  budgetMin: number;
  weekIdx: number;
  profile: GymProfileShape;
  exercises: Map<string, BlockExerciseShape>;
  bodyweightIds: readonly string[];
  notAtMyGym: ReadonlySet<string>;
  history: HistorySession[];
  equipment: Map<string, Equipment>;
  resolveEquipmentId(exerciseId: string, item: GymItemShape | undefined, weekIdx: number): string;
  makeId(): string;
  /** Pods the stations may use. Defaults to the turf. */
  pods?: readonly string[];
}
export interface BurnResult {
  blocks: Block[];
  totalMin: number;
  swaps: { from: string; to: string }[];
  dropped: string[];
}

function burnMinutes(minutes: number[]): number {
  return Math.round(minutes.reduce((total, time) => total + time + BLOCK_TRANSITION_MIN, BURN_WARMUP_MIN + BURN_COOLDOWN_MIN));
}

export function estimateBurnMinutes(blocks: readonly Block[]): number {
  return burnMinutes(blocks.flatMap((block) => block.kind === 'circuit' ? [block.durationSec / 60] : []));
}

function buildCircuits(input: BurnInput, specs: BurnBlockSpec[], pods: readonly string[], floor: number | undefined) {
  const { template, profile, exercises, bodyweightIds, notAtMyGym, history, equipment, weekIdx, resolveEquipmentId } = input;
  const pool = floor === undefined ? [] : availableOn(profile, floor, { notAtMyGym, bodyweightIds }).flatMap((option): Choice[] => {
    const ex = exercises.get(option.exerciseId);
    return ex && pods.includes(option.podId) && !NO_BLOCK_IDS.includes(ex.id)
      ? [{ option, ex, group: groupOf(ex), kit: kitOf(ex) }] : [];
  });
  const ctx = blockContext(profile, exercises);
  const workingWeights = workingWeightsOf(history);
  const draftOf = ({ ex, option }: Choice, unit?: StationUnit) => ({
    exercise: ex, itemId: option.itemId, unit,
    equipmentId: resolveEquipmentId(ex.id, option.itemId === undefined ? undefined : ctx.item(option.itemId), weekIdx),
  });

  const swaps: BurnResult['swaps'] = [];
  const dropped: string[] = [];
  const circuits: CircuitBlock[] = [];
  for (const { label, minutes, role, stations } of specs) {
    const choices: Choice[] = [];
    const drafts: Draft[] = [];
    for (const { exerciseId, unit } of stations) {
      const ex = exercises.get(exerciseId);
      const group = ex && groupOf(ex);
      const candidates = new Set([exerciseId, ...(ex?.substitutes ?? []), ...pool.filter((c) => c.group === group).map((c) => c.ex.id)]);
      let match: { choice: Choice; backup?: Choice } | undefined;
      for (const id of candidates) {
        if (choices.some((c) => c.ex.id === id)) continue;
        for (const choice of pool) {
          if (choice.ex.id !== id || !choice.option.anchorOk) continue;
          const backup = pickBackup(choice, pool);
          if (choice.option.count === 1 && !backup) continue;
          match = { choice, backup };
          break;
        }
        if (match) break;
      }
      if (!match) {
        dropped.push(`station:${exerciseId}`);
        continue;
      }
      const { choice, backup } = match;
      choices.push(choice);
      drafts.push({ ...draftOf(choice, unit), ...(backup && { backup: draftOf(backup, unit) }) });
      if (choice.ex.id !== exerciseId && !swaps.some(({ from, to }) => from === exerciseId && to === choice.ex.id)) {
        swaps.push({ from: exerciseId, to: choice.ex.id });
      }
    }
    if (drafts.length < PROFILES.burn.minGroups) {
      dropped.push(`block:${label}`);
      continue;
    }
    const durationSec = minutes * 60;
    const prescription = prescribeBlock({
      slotKey: slotKeyOf({ type: 'burn', templateId: template.id }, label), stations: drafts, durationSec, role,
      history, equipment, workingWeightOf: (id, equipmentId) => workingWeights.get(id)?.get(equipmentId),
    });
    const block: CircuitBlock = { id: '', kind: 'circuit', role, label, durationSec, podId: primaryPod(choices), ...prescription };
    if (validateBlock(block, ctx, 'burn').length) dropped.push(`block:${label}`);
    else circuits.push(block);
  }
  return { circuits, swaps, dropped };
}

export function generateBurn(input: BurnInput): BurnResult {
  const { template, budgetMin, profile, exercises, makeId } = input;
  const specs = [...template.blocks];
  const overBudget = () => burnMinutes(specs.map((spec) => spec.minutes)) > budgetMin + BURN_BUDGET_SLACK_MIN;
  while (overBudget() && specs.filter((spec) => spec.role !== 'finisher').length > 1) {
    specs.splice(specs.map((spec) => spec.role !== 'finisher').lastIndexOf(true), 1);
  }
  while (overBudget()) {
    const i = specs.map((spec) => spec.minutes).lastIndexOf(BLOCK_LONG_MIN);
    if (i < 0) break;
    specs[i] = { ...specs[i]!, minutes: BLOCK_SHORT_MIN };
  }

  const pods = input.pods ?? defaultBurnPods(profile);
  const floorByZone = new Map(profile.zones.map((zone) => [zone.id, zone.floor]));
  const floors = pods.flatMap((pod) => {
    const floor = floorByZone.get(zoneOf(profile, pod));
    return floor === undefined ? [] : [floor];
  });
  const [preferred, ...fallbacks] = new Set(floors);
  let plan = buildCircuits(input, specs, pods, preferred);
  for (const floor of fallbacks) {
    if (plan.circuits.length === specs.length) break;
    const alternative = buildCircuits(input, specs, pods, floor);
    if (alternative.circuits.length > plan.circuits.length) plan = alternative;
  }
  const { circuits, swaps, dropped } = plan;

  const firstCardio = circuits.flatMap((block) => block.stations).find(({ exerciseId }) => {
    const ex = exercises.get(exerciseId);
    return ex && kitOf(ex) === 'cardio';
  });
  const machine = firstCardio?.itemId ? profile.items.find((item) => item.id === firstCardio.itemId)?.type : undefined;
  const movement = firstCardio
    ? `Easy ${(machine ?? firstCardio.exerciseId).replaceAll('-', ' ')}`
    : 'Easy walking in place';
  const note: LiftBlock = { id: '', kind: 'lift', warmup: true, exerciseId: firstCardio?.exerciseId ?? '', sets: 1, repMin: 0, repMax: 0 };
  const blocks: Block[] = [
    { ...note, role: 'warmup', label: `Warm-up · ${BURN_WARMUP_MIN} min`, notes: `${movement} for 3 min, then leg swings, inchworms, hip openers` },
    ...circuits,
    { ...note, role: 'cooldown', label: `Cool-down · ${BURN_COOLDOWN_MIN} min`, notes: 'Walk, then stretch hips, hamstrings and chest' },
  ];
  return { blocks: blocks.map((block) => ({ ...block, id: makeId() })), totalMin: estimateBurnMinutes(blocks), swaps, dropped };
}

/** Least recently done template; ties go to list order, never-done first. */
export function nextBurnTemplate(templateIds: string[], lastDone: Record<string, ISODateTime | undefined>): string {
  let best = templateIds[0] ?? '';
  let bestAt = lastDone[best] ?? '';
  for (const id of templateIds.slice(1)) {
    const at = lastDone[id] ?? '';
    if (at < bestAt) { best = id; bestAt = at; }
  }
  return best;
}
