import type { Block, CircuitBlock, LiftBlock, RunBlock, SetRow } from '../../data/types';
import { isWorking } from './types';

export type Step =
  | { kind: 'note'; block: LiftBlock; role: 'warmup' | 'cooldown' }
  | { kind: 'lift'; blocks: LiftBlock[] }
  | { kind: 'circuit'; block: CircuitBlock }
  | { kind: 'cardio'; block: RunBlock };

export function sessionSteps(blocks: readonly Block[]): Step[] {
  const steps: Step[] = [];
  let working = false;
  let previous: Block | undefined;
  for (const block of blocks) {
    const last = steps.at(-1);
    if (block.kind === 'lift') {
      if (block.warmup) {
        const role = working || block.label?.startsWith('Cool-down') ? 'cooldown' : 'warmup';
        steps.push({ kind: 'note', block, role });
      } else if (last?.kind === 'lift' && previous?.kind === 'lift' && block.supersetGroup && previous.supersetGroup === block.supersetGroup) {
        last.blocks.push(block);
      } else {
        steps.push({ kind: 'lift', blocks: [block] });
      }
    } else if (block.kind === 'circuit') {
      steps.push({ kind: 'circuit', block });
    } else if (block.kind === 'run') {
      steps.push({ kind: 'cardio', block });
    }
    working ||= block.kind !== 'lift' || !block.warmup;
    previous = block;
  }
  return steps;
}

export function stepDone(step: Step, sets: readonly SetRow[]): boolean {
  if (step.kind === 'circuit') return !!step.block.log;
  if (step.kind !== 'lift') return false;
  return step.blocks.every((b) => {
    const mine = sets.filter((s) => s.exerciseId === b.exerciseId && s.equipmentId === (b.equipmentId ?? ''));
    return mine.some((s) => s.setKind === 'calibration')
      || mine.filter(isWorking).length >= b.sets;
  });
}

export function resumeIndex(steps: readonly Step[], sets: readonly SetRow[]): number {
  return steps.reduce((index, step, i) => stepDone(step, sets) ? i + 1 : index, 0);
}

export function upNext(steps: readonly Step[], i: number, n = 2): Step[] {
  return steps.slice(i + 1, i + 1 + n);
}
