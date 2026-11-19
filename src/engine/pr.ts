import type { CircuitBlock, SetRow } from '../data/types';
import { circuitWork } from './block/work';
import { isWorking, type HistorySession } from './lift/types';

export type PR =
  | { kind: 'weight-at-reps'; exerciseId: string; equipmentId: string; weight: number; reps: number; prev: number }
  | { kind: 'reps-at-weight'; exerciseId: string; equipmentId: string; weight: number; reps: number; prev: number }
  | { kind: 'block-work'; blockId: string; total: number; prev: number };

export function setPRs(set: SetRow, history: HistorySession[], sessionId: string): PR[] {
  if (!isWorking(set)) return [];
  const { exerciseId, equipmentId, weight, reps } = set;
  let prevWeight = -Infinity;
  let prevReps = -Infinity;
  for (const { session, sets } of history) {
    if (session.id === sessionId) continue;
    for (const prior of sets) {
      if (prior.exerciseId !== exerciseId || prior.equipmentId !== equipmentId || !isWorking(prior)) continue;
      if (prior.reps === reps) prevWeight = Math.max(prevWeight, prior.weight);
      if (prior.weight === weight) prevReps = Math.max(prevReps, prior.reps);
    }
  }
  const records: PR[] = [];
  if (prevWeight !== -Infinity && weight > prevWeight) {
    records.push({ kind: 'weight-at-reps', exerciseId, equipmentId, weight, reps, prev: prevWeight });
  }
  if (prevReps !== -Infinity && reps > prevReps) {
    records.push({ kind: 'reps-at-weight', exerciseId, equipmentId, weight, reps, prev: prevReps });
  }
  return records;
}

function comparableBlock(block: CircuitBlock) {
  const work = circuitWork(block);
  if (!work || block.log!.stations.some((station) => station.swappedFromExerciseId)) return null;
  const exerciseIds = new Set(work.perStation.map((station) => station.exerciseId));
  return { key: JSON.stringify([...exerciseIds].sort()), total: work.total };
}

export function sessionPRs(s: HistorySession, history: HistorySession[]): PR[] {
  const prior = history.filter(({ session }) => session.id !== s.session.id);
  const best = new Map<string, Exclude<PR, { kind: 'block-work' }>>();
  for (const set of s.sets) {
    for (const record of setPRs(set, prior, s.session.id)) {
      if (record.kind === 'block-work') continue;
      const key = JSON.stringify([record.kind, record.exerciseId, record.equipmentId]);
      const incumbent = best.get(key);
      if (!incumbent || (record.kind === 'weight-at-reps' ? record.weight > incumbent.weight : record.reps > incumbent.reps)) {
        best.set(key, record);
      }
    }
  }

  const bestCircuitWork = new Map<string, number>();
  for (const { session } of prior) {
    for (const block of session.blocks) {
      if (block.kind !== 'circuit') continue;
      const comparison = comparableBlock(block);
      if (comparison) {
        const { key, total } = comparison;
        bestCircuitWork.set(key, Math.max(bestCircuitWork.get(key) ?? 0, total));
      }
    }
  }
  const records: PR[] = [...best.values()];
  for (const block of s.session.blocks) {
    if (block.kind !== 'circuit') continue;
    const comparison = comparableBlock(block);
    if (!comparison) continue;
    const prev = bestCircuitWork.get(comparison.key);
    if (prev !== undefined && comparison.total > prev) records.push({ kind: 'block-work', blockId: block.id, total: comparison.total, prev });
  }
  return records;
}
