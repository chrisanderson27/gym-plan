import type { Block, CircuitBlock, LiftBlock, RunBlock, SetRow } from '../../data/types';
import { isWorking } from './types';

export type Step =
  | { kind: 'note'; block: LiftBlock; role: 'warmup' | 'cooldown' }
  | { kind: 'lift'; blocks: LiftBlock[] }
  | { kind: 'circuit'; block: CircuitBlock }
  | { kind: 'cardio'; block: RunBlock };

export function isLiftDayCooldown(block: Block): boolean {
  // Recognise saved lift days generated before notes had roles.
  return block.kind === 'lift' && !!block.warmup
    && (block.role ? block.role === 'cooldown' : !!block.label?.startsWith('Cool-down'));
}

export function sessionSteps(blocks: readonly Block[]): Step[] {
  const steps: Step[] = [];
  let working = false;
  let previous: Block | undefined;
  for (const block of blocks) {
    const last = steps.at(-1);
    if (block.kind === 'lift') {
      if (block.warmup) {
        const role = block.role ?? (working || isLiftDayCooldown(block) ? 'cooldown' : 'warmup');
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

const matchesLift = (set: SetRow, block: LiftBlock): boolean =>
  set.exerciseId === block.exerciseId && set.equipmentId === (block.equipmentId ?? '');

export function stepDone(step: Step, sets: readonly SetRow[]): boolean {
  if (step.kind === 'circuit') return !!step.block.log;
  if (step.kind !== 'lift') return false;
  return step.blocks.every((b) => {
    const mine = sets.filter((s) => matchesLift(s, b));
    return mine.some((s) => s.setKind === 'calibration')
      || mine.filter(isWorking).length >= b.sets;
  });
}

export function resumeIndex(steps: readonly Step[], sets: readonly SetRow[]): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (stepDone(step, sets)) return i + 1;
    if (step.kind === 'lift' && step.blocks.some((block) => sets.some(
      (set) => matchesLift(set, block) && (isWorking(set) || set.setKind === 'calibration'),
    ))) return i;
  }
  return 0;
}

export function upNext(steps: readonly Step[], i: number, n = 2): Step[] {
  return steps.slice(i + 1, i + 1 + n);
}
