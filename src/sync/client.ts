import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const AUTH_STORAGE_KEY = 'gym-plan:auth';

export function readCloudConfig(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}): { url: string; key: string } | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

const cfg = readCloudConfig(import.meta.env);
export const isCloudConfigured = cfg !== null;
export const supabase = cfg ? createClient<Database>(cfg.url, cfg.key, {
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
}) : null;
