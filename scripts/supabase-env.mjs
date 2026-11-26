import { execFileSync } from 'node:child_process';

export function readLocalStack() {
  let output;
  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
  } catch {
    throw new Error('Local Supabase is unavailable. Run npx supabase start.');
  }

  const env = Object.fromEntries(
    Array.from(output.matchAll(/^([A-Z_][A-Z0-9_]*)="([^"\r\n]*)"\r?$/gm), ([, key, value]) => [key, value]),
  );
  const apiUrl = env.API_URL;
  const publishableKey = env.PUBLISHABLE_KEY || env.ANON_KEY;
  const mailUrl = env.MAILPIT_URL || env.INBUCKET_URL || 'http://127.0.0.1:54324';
  if (!apiUrl || !publishableKey) {
    throw new Error('Local Supabase status did not provide API_URL and a publishable or anon key.');
  }
  return { apiUrl, publishableKey, mailUrl };
}
