import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types';
import type { TableName } from './tables';

export type SyncRow = {
  id: string;
  data: Record<string, unknown>;
  client_updated_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PushRow = { id: string; data: Record<string, unknown>; client_updated_at: string; deleted_at?: string };
type AcceptedRow = Pick<SyncRow, 'id' | 'client_updated_at'>;
type PullFrom = { after: { updatedAt: string; id: string } } | { since: string } | null;

export interface SyncTransport {
  push(table: TableName, rows: PushRow[], signal: AbortSignal): Promise<AcceptedRow[]>;
  pull(table: TableName, from: PullFrom, limit: number, signal: AbortSignal): Promise<SyncRow[]>;
  fetchByIds(table: TableName, ids: string[], signal: AbortSignal): Promise<SyncRow[]>;
}

export class SyncError extends Error {
  constructor(cause: unknown, readonly offline = globalThis.navigator?.onLine === false ||
    cause instanceof TypeError || (typeof cause === 'object' && cause !== null &&
      'message' in cause && typeof cause.message === 'string' && cause.message.startsWith('TypeError:'))) {
    super('Sync request failed', { cause });
  }
}

async function read<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await query;
    if (error) throw error;
    return data as T;
  } catch (error) {
    throw new SyncError(error);
  }
}

const quoted = (value: string) => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';

export function createSupabaseTransport(client: SupabaseClient<Database>): SyncTransport {
  const select = (table: TableName) => client.from(table).select('id,data,client_updated_at,updated_at,deleted_at');

  return {
    push(table, rows, signal) {
      return read<AcceptedRow[]>(client.rpc('push_rows', { p_table: table, p_rows: rows as Json }).abortSignal(signal));
    },
    pull(table, from, limit, signal) {
      const query = select(table);
      if (from && 'since' in from) query.gte('updated_at', from.since);
      if (from && 'after' in from) {
        const ts = quoted(from.after.updatedAt);
        query.or(`updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${quoted(from.after.id)})`);
      }
      return read<SyncRow[]>(query.order('updated_at').order('id').limit(limit).abortSignal(signal));
    },
    async fetchByIds(table, ids, signal) {
      const rows: SyncRow[] = [];
      for (let start = 0; start < ids.length; start += 100) {
        rows.push(...await read<SyncRow[]>(select(table).in('id', ids.slice(start, start + 100)).abortSignal(signal)));
      }
      return rows;
    },
  };
}
