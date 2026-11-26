import { expect, it } from 'vitest';
import type { SyncStatus } from '../../sync/engine';
import { changesLabel, syncStatusLabel } from './copy';

it.each([[0, '0 changes'], [1, '1 change'], [2, '2 changes']])('labels %i pending changes', (count, label) => {
  expect(changesLabel(count)).toBe(label);
});

const now = new Date(2026, 4, 10, 15);
const today = new Date(2026, 4, 10, 14, 5).toISOString();
const yesterday = new Date(2026, 4, 9, 14, 5).toISOString();
const cases: [SyncStatus['state'], number, string | null, string][] = [
  ['idle', 2, today, '2 changes waiting'],
  ['idle', 0, today, 'Synced · 2:05 PM'],
  ['idle', 0, yesterday, 'Synced · May 9'],
  ['idle', 0, null, 'Not synced yet'],
  ['syncing', 0, null, 'Syncing…'],
  ['offline', 1, null, 'Offline · 1 change waiting'],
  ['offline', 0, null, 'Offline'],
  ['error', 0, null, "Couldn't sync"],
  ['paused', 0, null, 'Paused'],
  ['owner-mismatch', 0, null, 'Waiting for your choice'],
  ['off', 0, null, ''],
];

it.each(cases)('labels %s with %i pending and timestamp %s', (state, pending, lastSyncedAt, expected) => {
  expect(syncStatusLabel({ state, pending, lastSyncedAt }, now)).toBe(expected);
});
