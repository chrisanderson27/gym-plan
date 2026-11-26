import type { Page } from '@playwright/test';
import type { TableName } from '../src/sync/tables';
import type { PushRow, SyncRow } from '../src/sync/transport';

export function syncServer() {
  const tables = new Map<string, Map<string, SyncRow>>();
  const pushes: { table: TableName; rows: PushRow[] }[] = [];

  function rows(table: string) {
    let data = tables.get(table);
    if (!data) {
      data = new Map();
      tables.set(table, data);
    }
    return data;
  }

  return { rows, pushes, rejectPush: false };
}

export async function mockRest(page: Page, server: ReturnType<typeof syncServer>) {
  const seen = new WeakSet<SyncRow>();
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    const url = new URL(request.url());
    const path = url.pathname.split('/rest/v1/')[1]!;
    if (path === 'rpc/push_rows' && request.method() === 'POST') {
      const { p_table: table, p_rows: rows } = request.postDataJSON() as { p_table: TableName; p_rows: PushRow[] };
      server.pushes.push({ table, rows });
      if (server.rejectPush) {
        await route.fulfill({ status: 500, headers, json: { code: 'test', message: 'Push unavailable' } });
        return;
      }
      const updated_at = new Date().toISOString();
      const accepted = rows.map((row) => {
        const saved = { ...row, updated_at, deleted_at: row.deleted_at ?? null };
        server.rows(table).set(row.id, saved);
        return saved;
      });
      await route.fulfill({ headers, json: accepted });
      return;
    }

    const incoming = [...server.rows(path).values()].filter((row) => !seen.has(row)).sort((a, b) =>
      a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
    for (const row of incoming) seen.add(row);
    await route.fulfill({ headers, json: incoming });
  });
}
