import { SEED_EQUIPMENT } from '../src/content';
import { BURN_TEMPLATES } from '../src/content/burn-templates';
import { burnInputFrom } from '../src/data/burn';
import { liftDayInputFrom } from '../src/data/liftday';
import type { LiftVariant, Session, SetRow } from '../src/data/types';
import { generateBurn } from '../src/engine/burn';
import { generateLiftDay } from '../src/engine/block/generate';

/**
 * An open legacy lift row, built with the same generator the old Lift screen used. Since PRD 4 P8 nothing starts a legacy lift,
 * so specs seed one by backup and enter it through Today's Resume link.
 */
export function openLegacyLift({ variant, now, programStart, history = [], id = 'open-lift' }: {
  variant: LiftVariant;
  now: Date;
  programStart: string;
  history?: { session: Session; sets: SetRow[] }[];
  id?: string;
}): Session {
  const equipment = new Map(SEED_EQUIPMENT.map((entry) => [entry.id, entry]));
  const snapshot = { now: now.toISOString(), programStart, history, overrides: new Map(), equipment };
  const plan = generateLiftDay(liftDayInputFrom(snapshot, variant, 60, 0));
  return {
    id, date: now.toISOString(), type: 'lift', variant, blocks: plan.blocks, hard: false, hardCardio: false, rpe: null,
    durationMin: 0, notes: '',
    flags: { ...(plan.main.mode === 'calibrate' ? { calibration: true } : {}), ...(plan.deload ? { deload: true } : {}) },
  };
}

/** An open legacy Burn row (warm-up, circuit blocks, cool-down) built with the generator the removed Burn screen used. */
export function openLegacyBurn({ now, programStart, id = 'open-burn' }: { now: Date; programStart: string; id?: string }): Session {
  const equipment = new Map(SEED_EQUIPMENT.map((entry) => [entry.id, entry]));
  const snapshot = { now: now.toISOString(), programStart, history: [], overrides: new Map(), equipment };
  const template = BURN_TEMPLATES[0]!;
  const plan = generateBurn(burnInputFrom(snapshot, template, 45));
  return {
    id, date: now.toISOString(), type: 'burn', templateId: template.id, blocks: plan.blocks, hard: false, hardCardio: false,
    rpe: null, durationMin: 0, notes: '',
  };
}
