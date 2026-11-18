import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173/gym-plan/' },
  projects: [{ name: 'webkit', use: { ...devices['iPhone 14'], colorScheme: 'dark' } }],
  // reuseExistingServer: works whether or not the orchestrator already has :4173 up, and in CI.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/gym-plan/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
