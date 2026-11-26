import type { TableName } from './tables';
import { SyncError, type SyncRow, type SyncTransport } from './transport';

const base = '2026-01-01T00:00:00';
const sortValue = (timestamp: string) =>
  timestamp.replace(/(?:\.(\d+))?(?:Z|\+00:00)$/, (_, fraction: string | undefined) => '.' + (fraction ?? '').padEnd(6, '0'));

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createFakeServer() {
  const tables = new Map<TableName, Map<string, SyncRow>>();
  let tick = 0;
  let held = { value: '', remaining: 0 };
  let failure: 'offline' | 'error' | 'abort' | undefined;
  const clock = {
    next() {
      if (held.remaining > 0) {
        held.remaining--;
        return held.value;
      }
      return `${base}.${String(++tick).padStart(6, '0')}+00:00`;
    },
    repeat(value: string, count: number) {
      held = { value, remaining: count };
    },
  };

  function rows(table: TableName) {
    let data = tables.get(table);
    if (!data) {
      data = new Map();
      tables.set(table, data);
    }
    return data;
  }

  function check(signal: AbortSignal) {
    signal.throwIfAborted();
    const kind = failure;
    failure = undefined;
    if (kind === 'abort') throw new DOMException('Aborted', 'AbortError');
    if (kind) throw new SyncError(new Error(kind), kind === 'offline');
  }

  const transport: SyncTransport = {
    async push(table, incoming, signal) {
      check(signal);
      const stored = rows(table);
      const latest = new Map<string, (typeof incoming)[number]>();
      for (const row of incoming) {
        const prior = latest.get(row.id);
        if (!prior || Date.parse(row.client_updated_at) >= Date.parse(prior.client_updated_at)) latest.set(row.id, row);
      }
      return [...latest.values()].flatMap((row) => {
        const old = stored.get(row.id);
        if (old && Date.parse(row.client_updated_at) < Date.parse(old.client_updated_at)) return [];
        stored.set(row.id, { ...row, updated_at: clock.next(), deleted_at: row.deleted_at ?? null });
        return [{ id: row.id, client_updated_at: row.client_updated_at }];
      });
    },
    async pull(table, from, limit, signal) {
      check(signal);
      return [...rows(table).values()].filter((row) => {
        const timestamp = sortValue(row.updated_at);
        if (!from) return true;
        if ('since' in from) return timestamp >= sortValue(from.since);
        const after = sortValue(from.after.updatedAt);
        return timestamp > after || (timestamp === after && row.id > from.after.id);
      }).sort((a, b) => compare(sortValue(a.updated_at), sortValue(b.updated_at)) || compare(a.id, b.id)).slice(0, limit);
    },
    async fetchByIds(table, ids, signal) {
      check(signal);
      return ids.flatMap((id) => {
        const row = rows(table).get(id);
        return row ? [row] : [];
      });
    },
  };
  return {
    transport, rows, clock,
    seed(table: TableName, incoming: (Omit<SyncRow, 'updated_at'> & { updated_at?: string })[]) {
      for (const row of incoming) rows(table).set(row.id, { ...row, updated_at: row.updated_at ?? clock.next() });
    },
    failNext(kind: typeof failure) { failure = kind; },
  };
}
