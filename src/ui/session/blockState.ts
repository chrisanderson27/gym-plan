import type { Block } from '../../data/types';

export const blockStateKey = (sessionId: string, blockId: string) => `block:${sessionId}:${blockId}`;

export function clearBlockStates({ id, blocks }: { id: string; blocks: readonly Pick<Block, 'id' | 'kind'>[] }) {
  for (const block of blocks) {
    if (block.kind !== 'circuit') continue;
    try {
      localStorage.removeItem(blockStateKey(id, block.id));
    } catch {
      // Browser storage cleanup is best effort after the workout has been discarded.
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stationValues<T>(value: unknown, accepts: (entry: unknown) => entry is T): Record<number, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, T] => /^(0|[1-9]\d*)$/.test(entry[0]) && accepts(entry[1]),
  ));
}

export function restoreBlockState(saved: unknown) {
  const { startedAtMs, rounds, swapped, loads } = isRecord(saved) ? saved : {};
  return {
    startedAtMs: typeof startedAtMs === 'number' && Number.isFinite(startedAtMs) ? startedAtMs : null,
    rounds: typeof rounds === 'number' && Number.isSafeInteger(rounds) && rounds >= 0 ? rounds : 0,
    swapped: stationValues(swapped, (value): value is true => value === true),
    loads: stationValues(loads, (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0),
  };
}
