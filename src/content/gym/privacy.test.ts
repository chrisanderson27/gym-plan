import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const check = (terms?: string) => {
  const env = { ...process.env, GYM_FORBIDDEN_TERMS: terms };
  if (terms === undefined) delete env.GYM_FORBIDDEN_TERMS;
  return spawnSync(process.execPath, ['scripts/check-gym-privacy.mjs'], { cwd, env, encoding: 'utf8' });
};

it('passes with no private terms configured', () => {
  const result = check();
  expect(result.status, result.stderr).toBe(0);
});

it('finds no configured forbidden terms in tracked files', () => {
  const result = check(process.env.GYM_FORBIDDEN_TERMS);
  expect(result.status, result.stderr).toBe(0);
});

it('checks tracked files against private terms case-insensitively without printing the terms', () => {
  const term = 'GYM-PLAN/';
  const result = check(` 
${term}
`);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Forbidden gym term in tracked files');
  expect(result.stderr.toLowerCase()).not.toContain(term.toLowerCase());
});

it('treats configured terms as literal strings', () => {
  const result = check('gym' + '.plan/');
  expect(result.status, result.stderr).toBe(0);
});
