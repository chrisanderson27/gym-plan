import { spawnSync } from 'node:child_process';
import { readLocalStack } from './supabase-env.mjs';

const { apiUrl, publishableKey } = readLocalStack();
const build = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-live'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const preview = spawnSync('npx', ['vite', 'preview', '--outDir', 'dist-live', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  stdio: 'inherit',
});
if (preview.error) throw preview.error;
process.exit(preview.status ?? 1);
