import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('pre-approves only exact local Supabase commands and named scripts', () => {
  const config = readFileSync(new URL('../../.claude/orchestrator.toml', import.meta.url), 'utf8');
  const worker = config.split(/^\[/m).find((section) => section.startsWith('worker]'));
  const allow = JSON.parse(worker?.match(/^allow\s*=\s*(\[[\s\S]*?\])/m)?.[1] ?? '[]') as string[];

  expect(allow.filter((rule) => /supabase|node scripts\//.test(rule)).sort()).toEqual([
    'Bash(node scripts/check-gym-privacy.mjs)',
    'Bash(node scripts/live-server.mjs)',
    'Bash(node scripts/make-icons.mjs)',
    'Bash(npx supabase db reset)',
    'Bash(npx supabase gen types typescript --local --schema public)',
    'Bash(npx supabase gen types typescript --local)',
    'Bash(npx supabase start)',
    'Bash(npx supabase status -o env)',
    'Bash(npx supabase status)',
    'Bash(npx supabase stop)',
    'Bash(npx supabase test db)',
  ]);
});
