import { defineConfig, devices } from '@playwright/test';

const liveUrl = 'http://127.0.0.1:4174/gym-plan/';
const liveProject = 'webkit-live';

export function resolveLiveFlag(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  let hasProjectOption = false;
  let readingProjects = false;

  for (const arg of argv) {
    if (arg === '--') break;
    if (arg === '--project') {
      hasProjectOption = true;
      readingProjects = true;
      continue;
    }

    if (arg.startsWith('-')) readingProjects = false;
    const inlineProject = arg.startsWith('--project=');
    if (inlineProject) hasProjectOption = true;
    if (!inlineProject && !readingProjects) continue;

    const selector = inlineProject ? arg.slice('--project='.length) : arg;
    const pattern = selector.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp(`^${pattern}$`, 'i').test(liveProject)) return '1';
  }

  return hasProjectOption ? '0' : (env.GYM_PLAN_LIVE ?? '0');
}

// Workers reload this config without the CLI arguments and inherit the selection.
const liveFlag = resolveLiveFlag(process.argv.slice(2), process.env);
process.env.GYM_PLAN_LIVE = liveFlag;
const runLive = liveFlag === '1';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173/gym-plan/' },
  projects: [
    { name: 'webkit', testDir: 'e2e', use: { ...devices['iPhone 14'], colorScheme: 'dark' } },
    ...(runLive ? [
      { name: liveProject, testDir: 'e2e-live', use: { ...devices['iPhone 14'], baseURL: liveUrl } },
    ] : []),
  ],
  // webServer applies to the whole config, so the WebKit suite must never start the Docker-dependent server.
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/gym-plan/',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    ...(runLive ? [{
      command: 'node scripts/live-server.mjs',
      url: liveUrl,
      reuseExistingServer: false,
      timeout: 180_000,
    }] : []),
  ],
});
