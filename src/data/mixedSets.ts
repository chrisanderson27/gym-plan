import type { MixedCursor, MixedExecution, Session, SetRow } from './types';

export const mixedSetId = (sessionId: string, blockId: string, slot: number) => JSON.stringify([sessionId, blockId, slot]);

export function loggedMixedSets(sessionId: string, blockId: string, rows: SetRow[]): SetRow[] {
  return rows.filter((row) => Number.isInteger(row.idx) && row.idx >= 0 && row.idx < 30
    && row.id === mixedSetId(sessionId, blockId, row.idx));
}

export function resumeMixedStrength(mixed: MixedExecution, cursor: MixedCursor, rows: SetRow[]): MixedCursor {
  const setSlot = Math.max(cursor.setSlot, ...rows.map((row) => row.idx + 1));
  if (setSlot === cursor.setSlot) return cursor;
  const stage = cursor.stage === 'review' || setSlot >= mixed.strength[cursor.blockId]!.sets ? 'review' : 'active';
  return { ...cursor, stage, setSlot };
}

/** Restore keeps local set rows absent from the backup. Project that work into the imported session. */
export function reconcileMixedSets(session: Session, rows: SetRow[], local?: Session): boolean {
  const mixed = session.mixed;
  if (!mixed) return false;
  let changed = false;
  for (const block of mixed.prescription.blocks) {
    if (block.kind !== 'strength') continue;
    const logged = loggedMixedSets(session.id, block.id, rows);
    const first = logged.reduce<SetRow | undefined>((earliest, row) => !earliest || row.idx < earliest.idx ? row : earliest, undefined);
    if (!first) continue;

    const accepted = mixed.strength[block.id]!;
    const localStrength = local?.mixed?.strength[block.id];
    const matches = (value: typeof localStrength) => value?.exerciseId === first.exerciseId && value.equipmentId === first.equipmentId;
    const kept = matches(accepted) ? accepted : matches(localStrength) ? localStrength! : {
      ...accepted, exerciseId: first.exerciseId, equipmentId: first.equipmentId, targetWeight: first.targetWeight,
      repMin: first.targetReps, repMax: Math.max(first.targetReps, accepted.repMax), rirTarget: undefined,
      label: first.setKind === 'calibration' ? 'Calibration' : undefined,
    };
    const sets = Math.max(kept.sets, ...logged.map((row) => row.idx + 1));
    if (kept !== accepted || sets !== accepted.sets) {
      mixed.strength[block.id] = { ...kept, sets };
      session.blocks = session.blocks.map((row) => row.id === block.id ? { ...row, ...kept, sets } : row);
      session.flags = { ...session.flags, calibration: session.blocks.some((row) => row.kind === 'lift' && row.label === 'Calibration') };
      changed = true;
    }
    if (mixed.cursor.blockId === block.id) {
      const cursor = resumeMixedStrength(mixed, mixed.cursor, logged);
      changed ||= cursor !== mixed.cursor;
      mixed.cursor = cursor;
    }
    const result = Object.hasOwn(mixed.results, block.id) ? mixed.results[block.id] : undefined;
    if (result?.status === 'skipped') {
      result.status = 'completed';
      changed = true;
    }
  }
  return changed;
}
