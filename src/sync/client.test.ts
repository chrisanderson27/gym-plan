import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let client: typeof import('./client');
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  client = await import('./client');
});

it('uses the generated database schema for the client', () => {
  expectTypeOf(client.supabase).toEqualTypeOf<SupabaseClient<Database> | null>();
});
afterAll(() => vi.unstubAllEnvs());

describe('readCloudConfig', () => {
  it.each([
    {},
    { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
    { VITE_SUPABASE_URL: '  ', VITE_SUPABASE_PUBLISHABLE_KEY: '\t' },
    { VITE_SUPABASE_URL: 'https://example.test' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key' },
  ])('rejects incomplete configuration (%j)', (env) => {
    expect(client.readCloudConfig(env)).toBeNull();
  });

  it('trims both configured values', () => {
    expect(client.readCloudConfig({
      VITE_SUPABASE_URL: ' https://example.test ',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' public-key ',
    })).toEqual({ url: 'https://example.test', key: 'public-key' });
  });

  it('initializes no client in a keyless build', () => {
    expect(client.isCloudConfigured).toBe(false);
    expect(client.supabase).toBeNull();
  });
});
