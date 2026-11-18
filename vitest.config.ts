import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the PWA plugin never runs under test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});
