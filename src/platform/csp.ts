const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'";

export function buildCsp(supabaseUrl?: string): string {
  const url = supabaseUrl?.trim();
  if (!url) return policy;

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch (cause) {
    throw new Error('VITE_SUPABASE_URL must be a valid URL', { cause });
  }
  if (origin === 'null') throw new Error('VITE_SUPABASE_URL must have an origin');
  return policy.replace("connect-src 'self'", `connect-src 'self' ${origin}`);
}
