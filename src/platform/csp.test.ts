import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

const keylessPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'";

describe('buildCsp', () => {
  it.each([undefined, '', '  '])('keeps the original policy for %j', (url) => {
    expect(buildCsp(url)).toBe(keylessPolicy);
  });

  it.each([
    ['https://abc.supabase.co/', 'https://abc.supabase.co'],
    ['https://abc.supabase.co/rest/v1', 'https://abc.supabase.co'],
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
  ])('allows only the configured origin for %s', (url, origin) => {
    expect(buildCsp(url)).toBe(keylessPolicy.replace("connect-src 'self'", `connect-src 'self' ${origin}`));
  });

  it('rejects an invalid URL', () => {
    expect(() => buildCsp('garbage')).toThrow(/VITE_SUPABASE_URL/);
  });
});
