import type { ExerciseOverride, LiftBlock, LiftVariant } from '../../data/types';
import {
  JOINT_FRIENDLY_WEEKS,
  MIN_EXERCISES,
  MIN_PER_SET,
  PRIMARY_SET_WEIGHT,
  SECONDARY_SET_WEIGHT,
  VOLUME_CEILING,
  WARMUP_MIN,
} from '../config';
import { localDate } from '../dates';
import { isRampInWeek, weekIndex } from '../week';
import { deloadState } from './deload';
import { isLowerBarbell, prescribe } from './progression';
import { summarizeLiftSession } from './session';
import { isWorking, type LiftExercise, type LiftSnapshot, type Prescription } from './types';
import { fractionalSets, weekSets } from './volume';

export interface LiftPlan {
  variant: LiftVariant;
  deload: boolean;
  rampIn: boolean;
  weekIdx: number;
  blocks: LiftBlock[];
  prescriptions: Map<string, Prescription>;
  estMin: number;
  dropped: string[];
}

export interface SubOpts {
  jointFriendlyOnly?: boolean;
  exclude?: Set<string>;
}

const WARMUP_MACHINES = ['air-bike', 'rower', 'elliptical'];
const CALIBRATION_EST_SETS = 4;
const MAX_SWAP_CANDIDATES = 6;

/** Substitutes first, then same movement group; never an excluded / not-at-my-gym exercise. */
export function swapCandidates(
  exId: string,
  exercises: Map<string, LiftExercise>,
  overrides: Map<string, ExerciseOverride>,
  opts: SubOpts = {},
): string[] {
  const src = exercises.get(exId);
  if (!src) return [];
  const ok = (id: string) => {
    const e = exercises.get(id);
    return !!e && id !== exId && !overrides.get(id)?.notAtMyGym && !opts.exclude?.has(id) && (!opts.jointFriendlyOnly || e.jointFriendly);
  };
  const out: string[] = [];
  for (const id of [...src.substitutes, ...[...exercises.values()].filter((e) => e.group === src.group).map((e) => e.id)]) {
    if (ok(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_SWAP_CANDIDATES) break;
  }
  return out;
}

export const pickSubstitute = (
  exId: string,
  exercises: Map<string, LiftExercise>,
  overrides: Map<string, ExerciseOverride>,
  opts: SubOpts = {},
): string | null => swapCandidates(exId, exercises, overrides, opts)[0] ?? null;

interface Entry {
  block: LiftBlock;
  ex: LiftExercise;
  presc: Prescription;
  calibrate: boolean;
}

const estSets = (e: Entry) => (e.calibrate ? CALIBRATION_EST_SETS : e.block.sets);
const estimate = (entries: Entry[]) => WARMUP_MIN + entries.reduce((n, e) => n + estSets(e) * MIN_PER_SET[e.ex.repClass], 0);

export function generateLift(input: {
  variant: LiftVariant;
  budgetMin: number;
  template: { slots: { candidates: string[]; sets?: number }[] };
  exercises: Map<string, LiftExercise>;
  snapshot: LiftSnapshot;
  resolveEquipmentId: (exId: string) => string;
  forceCalibrate?: boolean;
}): LiftPlan {
  const { variant, budgetMin, template, exercises, snapshot, resolveEquipmentId, forceCalibrate } = input;
  const weekIdx = weekIndex(localDate(new Date(snapshot.now)), snapshot.programStart);
  const rampIn = isRampInWeek(weekIdx);

  const missed = new Map<string, number>();
  for (const h of snapshot.history) {
    const blocks = h.session.blocks.filter((b): b is LiftBlock => b.kind === 'lift');
    if (blocks.length) missed.set(h.session.id, summarizeLiftSession(blocks, h.sets).missedExercises.length);
  }
  const deload = deloadState(snapshot, missed).deload;

  const jfOnly = weekIdx <= JOINT_FRIENDLY_WEEKS;
  const chosen = new Set<string>();
  const dropped: string[] = [];
  const entries: Entry[] = [];

  for (const slot of template.slots) {
    const usable = (id: string) => {
      const e = exercises.get(id);
      return !!e && !chosen.has(id) && !snapshot.overrides.get(id)?.notAtMyGym && (!jfOnly || e.jointFriendly);
    };
    let id = slot.candidates.find(usable);
    if (!id && slot.candidates[0]) {
      id = pickSubstitute(slot.candidates[0], exercises, snapshot.overrides, { jointFriendlyOnly: jfOnly, exclude: chosen }) ?? undefined;
    }
    const ex = id ? exercises.get(id) : undefined;
    const eq = ex ? snapshot.equipment.get(resolveEquipmentId(ex.id)) : undefined;
    if (!ex || !eq) {
      dropped.push(slot.candidates[0] ?? 'unknown');
      continue;
    }
    chosen.add(ex.id);

    const pair = snapshot.history
      .filter((h) => !h.session.flags?.deload && h.sets.some((s) => s.exerciseId === ex.id && s.equipmentId === eq.id))
      .map((h) => ({ session: h.session, sets: h.sets.filter((s) => s.exerciseId === ex.id && s.equipmentId === eq.id) }));
    const hasWorking = pair.some((h) => h.sets.some(isWorking));
    const presc = prescribe(ex, eq, forceCalibrate && !hasWorking ? [] : pair, { deload, rampIn, isLowerBarbell: isLowerBarbell(ex, eq) });
    const calibrate = presc.mode === 'calibrate';
    const sets = calibrate ? 1 : (slot.sets ?? presc.sets);
    entries.push({
      block: {
        id: '',
        kind: 'lift',
        exerciseId: ex.id,
        equipmentId: eq.id,
        sets,
        repMin: ex.repMin,
        repMax: ex.repMax,
        targetWeight: presc.weight,
        rirTarget: presc.rirTarget,
        label: calibrate ? 'Calibration' : undefined,
      },
      ex,
      presc: { ...presc, sets },
      calibrate,
    });
  }

  // Time budget: drop tail slots first, then trim sets isolation → machine → compound (floor 2).
  while (estimate(entries) > budgetMin && entries.length > MIN_EXERCISES) {
    dropped.push(entries.pop()!.ex.id);
  }
  for (const cls of ['isolation', 'machine', 'compound', 'other'] as const) {
    for (const e of entries) {
      while (estimate(entries) > budgetMin && !e.calibrate && e.ex.repClass === cls && e.block.sets > 2) e.block.sets--;
    }
  }

  // Ceiling: cut the last slots that hit a muscle already near the weekly ceiling (floor 1 set).
  const done = fractionalSets(weekSets(snapshot), exercises);
  const planned = new Map<string, number>();
  const weights = (e: Entry) => [...e.ex.primary.map((m) => [m, PRIMARY_SET_WEIGHT] as const), ...e.ex.secondary.map((m) => [m, SECONDARY_SET_WEIGHT] as const)];
  const total = (m: string) => (done.get(m) ?? 0) + entries.reduce((n, e) => n + (e.calibrate ? 0 : e.block.sets * (weights(e).find(([x]) => x === m)?.[1] ?? 0)), 0);
  for (const e of entries) for (const [m] of weights(e)) planned.set(m, 0);
  for (const m of planned.keys()) {
    for (const e of [...entries].reverse()) {
      while (total(m) > VOLUME_CEILING && !e.calibrate && e.block.sets > 1 && weights(e).some(([x]) => x === m)) e.block.sets--;
    }
  }

  const warm = WARMUP_MACHINES.find((id) => exercises.has(id) && !snapshot.overrides.get(id)?.notAtMyGym) ?? WARMUP_MACHINES[0]!;
  const warmBlock: LiftBlock = {
    id: 'b0',
    kind: 'lift',
    exerciseId: warm,
    sets: 1,
    repMin: 0,
    repMax: 0,
    warmup: true,
    label: 'Warm-up · 7 min',
    notes: "3–5 min easy bike or rower, then hip airplane, world's greatest stretch, band pull-apart, glute bridge, cat-cow, ankle rocks",
  };
  const blocks: LiftBlock[] = [warmBlock];
  const prescriptions = new Map<string, Prescription>();
  entries.forEach((e, i) => {
    e.block.id = `b${i + 1}`;
    prescriptions.set(e.block.id, { ...e.presc, sets: e.block.sets });
    blocks.push(e.block);
  });

  return { variant, deload, rampIn, weekIdx, blocks, prescriptions, estMin: estimate(entries), dropped };
}
