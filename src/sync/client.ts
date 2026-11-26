import { createClient } from '@supabase/supabase-js';

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
// TODO(P1): regenerate types from the local Supabase stack.
export const supabase = cfg ? createClient(cfg.url, cfg.key, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
}) : null;
