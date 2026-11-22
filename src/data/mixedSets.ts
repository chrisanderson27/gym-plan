import type { AcceptedStrength, Session, SetRow } from './types';
import { isAcceptedStrength, validStrengthReps } from './validate';

export const mixedSetId = (sessionId: string, blockId: string, slot: number) => JSON.stringify([sessionId, blockId, slot]);

export function loggedMixedSets(sessionId: string, blockId: string, rows: SetRow[]): SetRow[] {
  return rows.filter((row) => Number.isInteger(row.idx) && row.idx >= 0 && row.idx < 30
    && row.id === mixedSetId(sessionId, blockId, row.idx));
}

export function reconcileMixedStrength(session: Session, blockId: string, rows: SetRow[], localStrength?: AcceptedStrength): boolean {
  const mixed = session.mixed;
  const accepted = mixed?.strength[blockId];
  if (!mixed || !accepted) return false;
  const logged = loggedMixedSets(session.id, blockId, rows);
  const first = logged.reduce<SetRow | undefined>((earliest, row) => !earliest || row.idx < earliest.idx ? row : earliest, undefined);
  if (!first) return false;

  const matches = (value: Pick<AcceptedStrength, 'exerciseId' | 'equipmentId'>) =>
    value.exerciseId === first.exerciseId && value.equipmentId === first.equipmentId;
  const diverged = !logged.every(matches);
  let kept = accepted;
  if (!diverged && !matches(accepted)) {
    if (isAcceptedStrength(localStrength) && matches(localStrength)) kept = localStrength;
    else if (first.exerciseId.trim() && first.equipmentId.trim()) {
      const repMin = validStrengthReps(first.targetReps) ? first.targetReps : accepted.repMin;
      kept = {
        ...accepted, exerciseId: first.exerciseId, equipmentId: first.equipmentId,
        targetWeight: Number.isFinite(first.targetWeight) && first.targetWeight >= 0 ? first.targetWeight : undefined,
        repMin, repMax: Math.max(repMin, accepted.repMax), rirTarget: undefined,
        label: first.setKind === 'calibration' ? 'Calibration' : undefined,
      };
    }
  }
  const cursor = mixed.cursor.blockId === blockId ? mixed.cursor : undefined;
  const setSlot = Math.max(cursor?.setSlot ?? 0, ...logged.map((row) => row.idx + 1));
  const sets = Math.max(kept.sets, setSlot);
  let changed = false;
  if (kept !== accepted || sets !== accepted.sets) {
    mixed.strength[blockId] = { ...kept, sets };
    session.blocks = session.blocks.map((row) => row.id === blockId ? { ...row, ...kept, sets } : row);
    session.flags = { ...session.flags, calibration: session.blocks.some((row) => row.kind === 'lift' && row.label === 'Calibration') };
    changed = true;
  }
  if (cursor) {
    // Keep divergent actuals under their recorded identities and close the block to further sets.
    const stage = diverged || !matches(kept) || cursor.stage === 'review' || setSlot >= sets ? 'review' : 'active';
    if (stage !== cursor.stage || setSlot !== cursor.setSlot) {
      mixed.cursor = { ...cursor, stage, setSlot };
      changed = true;
    }
  }
  const result = Object.hasOwn(mixed.results, blockId) ? mixed.results[blockId] : undefined;
  if (result?.status === 'skipped') {
    result.status = 'completed';
    changed = true;
  }
  return changed;
}

/** Restore keeps local set rows absent from the backup. Project that work into the imported session. */
export function reconcileMixedSets(session: Session, rows: SetRow[], local?: Session): boolean {
  let changed = false;
  for (const block of session.mixed?.prescription.blocks ?? []) {
    if (block.kind === 'strength' && reconcileMixedStrength(session, block.id, rows, local?.mixed?.strength[block.id])) changed = true;
  }
  return changed;
}
