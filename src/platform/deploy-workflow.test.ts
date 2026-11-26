import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

it('requires a web app manifest in the Pages build', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8')) as {
    jobs: { build: { steps: { name?: string; run?: string }[] } };
  };
  const build = workflow.jobs.build.steps.find(({ name }) => name === 'Build for Pages');
  expect(build?.run?.split(' && ')).toContain('test -f dist/manifest.webmanifest');
});
