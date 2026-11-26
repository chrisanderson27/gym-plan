import { defineConfig, devices } from '@playwright/test';

const liveUrl = 'http://127.0.0.1:4174/gym-plan/';
// Workers reload this config without the CLI arguments and inherit the selection.
process.env.GYM_PLAN_LIVE ??= process.argv.some((arg, index, args) =>
  arg === '--project=webkit-live' || (arg === '--project' && args[index + 1] === 'webkit-live'),
) ? '1' : '0';
const runLive = process.env.GYM_PLAN_LIVE === '1';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173/gym-plan/' },
  projects: [
    { name: 'webkit', testDir: 'e2e', use: { ...devices['iPhone 14'], colorScheme: 'dark' } },
    ...(runLive ? [
      { name: 'webkit-live', testDir: 'e2e-live', use: { ...devices['iPhone 14'], baseURL: liveUrl } },
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
