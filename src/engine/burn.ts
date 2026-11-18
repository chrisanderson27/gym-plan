import type { IntervalBlock, ISODateTime, TimedPhase } from '../data/types';

export interface BurnInput {
  blocks: IntervalBlock[];
  budgetMin: number;
  excluded: ReadonlySet<string>;
  substitutesOf: Readonly<Record<string, string[]>>;
  labelOf: Readonly<Record<string, string>>;
  /** Injected: the engine cannot import data/ids. */
  makeId: () => string;
}
export interface BurnResult {
  blocks: IntervalBlock[];
  totalMin: number;
  swaps: { from: string; to: string }[];
}

const phaseSec = (b: IntervalBlock) => b.phases.reduce((n, p) => n + p.sec, 0);
const blockSec = (b: IntervalBlock) => b.rounds * phaseSec(b);
const totalSec = (bs: IntervalBlock[]) => bs.reduce((n, b) => n + blockSec(b), 0);
const isFixed = (b: IntervalBlock) => b.phases.every((p) => p.role === 'warmup' || p.role === 'cooldown');

/** Budget → exclusions → fresh ids. A template that cannot shrink enough sheds its last blocks. */
export function generateBurn({ blocks, budgetMin, excluded, substitutesOf, labelOf, makeId }: BurnInput): BurnResult {
  const budgetSec = budgetMin * 60;
  const fixed = blocks.filter(isFixed).reduce((n, b) => n + blockSec(b), 0);
  const main = blocks.filter((b) => !isFixed(b)).reduce((n, b) => n + blockSec(b), 0);
  const factor = main > 0 ? Math.max(0, budgetSec - fixed) / main : 1;

  const swaps: { from: string; to: string }[] = [];
  let out: IntervalBlock[] = blocks.map((b) => {
    const rounds = isFixed(b) ? b.rounds : Math.max(1, Math.round(b.rounds * factor));
    const phases = b.phases.map((p): TimedPhase => {
      if (!p.exerciseId || !excluded.has(p.exerciseId)) return { ...p };
      const to = (substitutesOf[p.exerciseId] ?? []).find((s) => !excluded.has(s));
      if (!to) {
        const { exerciseId: _drop, ...rest } = p;
        void _drop;
        return { ...rest, label: 'Choice: bodyweight' };
      }
      if (!swaps.some((s) => s.from === p.exerciseId && s.to === to)) swaps.push({ from: p.exerciseId, to });
      return { ...p, exerciseId: to, label: labelOf[to] ?? to };
    });
    return { ...b, id: makeId(), rounds, phases };
  });

  // Blocks already at one round: shed trailing non-fixed blocks until near the budget (keep ≥ 1).
  while (totalSec(out) > budgetSec + 120 && out.filter((b) => !isFixed(b)).length > 1) {
    const idx = out.map((b) => !isFixed(b)).lastIndexOf(true);
    out = out.filter((_, i) => i !== idx);
  }
  return { blocks: out, totalMin: Math.round(totalSec(out) / 60), swaps };
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
