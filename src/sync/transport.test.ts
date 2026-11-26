import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { mixedSetId } from '../data/mixedSets';
import type { Database } from './database.types';
import { createSupabaseTransport } from './transport';

function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json([]));
  const client = createClient<Database>('https://x.supabase.test', 'k', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const transport = createSupabaseTransport(client);
  const signal = new AbortController().signal;
  return { fetch, transport, signal };
}

it('posts exactly the RPC arguments and forwards the abort signal', async () => {
  const { fetch, transport, signal } = setup();
  const rows = [{ id: 'x', data: { id: 'x' }, client_updated_at: '2026-01-01T00:00:00.000Z' }];
  await transport.push('sessions', rows, signal);
  const [url, request] = fetch.mock.calls[0]!;
  expect(String(url)).toBe('https://x.supabase.test/rest/v1/rpc/push_rows');
  expect(request?.method).toBe('POST');
  expect(request?.signal).toBe(signal);
  expect(JSON.parse(String(request?.body))).toEqual({ p_table: 'sessions', p_rows: rows });
});

it('preserves raw microseconds and quotes both values in the keyset query', async () => {
  const { fetch, transport, signal } = setup();
  const updatedAt = '2026-01-01T00:00:00.412345+00:00';
  await transport.pull('sessions', { after: { updatedAt, id: 's.1' } }, 1000, signal);
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe('/rest/v1/sessions');
  expect(url.searchParams.get('or')).toBe(`(updated_at.gt."${updatedAt}",and(updated_at.eq."${updatedAt}",id.gt."s.1"))`);
  expect(url.searchParams.get('order')).toBe('updated_at.asc,id.asc');
  expect(url.searchParams.get('limit')).toBe('1000');
});

it('supports the overlap bound and chunks deferred ids at 100', async () => {
  const { fetch, transport, signal } = setup();
  const since = '2026-01-01T00:00:00.412Z';
  await transport.pull('body_logs', { since }, 1000, signal);
  expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('updated_at')).toBe('gte.' + since);
  await transport.fetchByIds('body_logs', Array.from({ length: 101 }, (_, i) => 'id-' + i), signal);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('id')?.split(',')).toHaveLength(100);
  expect(new URL(String(fetch.mock.calls[2]?.[0])).searchParams.get('id')).toBe('in.("id-100")');
});

it('classifies a fetch TypeError as offline and REST errors as errors', async () => {
  const { fetch, transport, signal } = setup();
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(transport.push('sessions', [], signal)).rejects.toMatchObject({ offline: true });
  fetch.mockResolvedValueOnce(Response.json({ message: 'denied' }, { status: 403 }));
  await expect(transport.pull('sessions', null, 1000, signal)).rejects.toMatchObject({ offline: false });
});

it('escapes reserved characters in deferred IDs without losing valid mixed-set IDs', async () => {
  const { fetch, transport, signal } = setup();
  const mixedId = mixedSetId('session', 'block', 1);
  const row = { id: mixedId, data: {} };
  fetch.mockImplementationOnce(async (input) => {
    const filter = new URL(String(input)).searchParams.get('id');
    return filter === String.raw`in.("[\"session\",\"block\",1]","bad,(\"\\)")`
      ? Response.json([row])
      : Response.json({ message: 'Invalid id filter' }, { status: 400 });
  });

  await expect(transport.fetchByIds('sets', [mixedId, 'bad,("\\)', ''], signal)).resolves.toEqual([row]);
  expect(fetch).toHaveBeenCalledOnce();
});
