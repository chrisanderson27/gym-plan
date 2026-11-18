import type { LiftVariant, RunBlock } from '../data/types';
import { CARDIO_MODALITY_LABELS, HYBRID_LEG_DEFAULT, HYBRID_LEG_MODALITIES } from './config';
import type { RunPlan } from './run/generator';

export const isLowerVariant = (v: LiftVariant): boolean => v.startsWith('lower');

/**
 * Upper days keep the generated run as is (the run guardrails already capped it). Lower days move the
 * cardio onto a machine so the legs are not pounded twice; that row is excluded from run guardrails.
 */
export function hybridCardio({ variant, run, modality }: { variant: LiftVariant; run: RunPlan; modality?: (typeof HYBRID_LEG_MODALITIES)[number] }): {
  block: RunBlock; plannedSec: number; warmupSec: number; cooldownSec: number; reasons: string[];
} {
  const base = { plannedSec: run.plannedSec, warmupSec: run.warmupSec, cooldownSec: run.cooldownSec };
  if (!isLowerVariant(variant)) return { block: run.block, ...base, reasons: [...run.reasons] };
  const machine = modality ?? HYBRID_LEG_DEFAULT;
  const machineName = CARDIO_MODALITY_LABELS[machine];
  const { format: _format, ...rest } = run.block;
  void _format;
  const block: RunBlock = run.block.runKind === 'intervals'
    ? { ...rest, modality: machine }
    : { ...rest, modality: machine, repeats: 1, segments: [{ role: 'run', sec: run.plannedSec }] };
  // A run-walk ratio means nothing on a machine: relabel it (intervals keep their ratio, easy days are steady).
  const intervals = run.block.runKind === 'intervals';
  const reasons = run.reasons.map((r) => {
    const m = /^run-walk (\d+:\d+ s)/.exec(r);
    if (!m) return r;
    return intervals ? `${machineName} intervals ${m[1]}` : `${machineName} steady (no walk breaks)`;
  });
  return { block, ...base, reasons: [...reasons, `leg day: ${machineName.toLowerCase()} instead of running`] };
}
