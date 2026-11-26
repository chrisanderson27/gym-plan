import type { StoreName } from '../data/stores';
import type { Database } from './database.types';

export type TableName = keyof Database['public']['Tables'];

export const SYNC_TABLES = {
  exerciseOverrides: 'exercise_overrides',
  equipment: 'equipment',
  sessions: 'sessions',
  sets: 'sets',
  runs: 'runs',
  swims: 'swims',
  tests: 'tests',
  bodyLogs: 'body_logs',
  templates: 'templates',
  feedback: 'feedback',
  settings: 'settings',
  libraryBlocks: 'library_blocks',
} satisfies Record<StoreName, TableName>;

export const RELATED_STORES: readonly StoreName[] = ['sessions', 'sets', 'runs', 'swims'];

export function sessionIdOf(store: StoreName, row: Record<string, unknown>): string | undefined {
  const id = store === 'sessions' ? row.id : RELATED_STORES.includes(store) ? row.sessionId : undefined;
  return typeof id === 'string' ? id : undefined;
}

const epoch = new Date(0).toISOString();

export function rowUpdatedAt(store: StoreName, row: Record<string, unknown>): string {
  const value = row.updatedAt;
  return (store === 'settings' || store === 'libraryBlocks') &&
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
    ? value : epoch;
}
