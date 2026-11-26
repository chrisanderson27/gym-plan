import { expect, it, vi } from 'vitest';

it.each([
  { args: ['playwright', 'test'], inheritedLive: undefined, live: false },
  { args: ['playwright', 'test', '--project=webkit'], inheritedLive: undefined, live: false },
  { args: ['playwright', 'test', '--project=webkit-live'], inheritedLive: undefined, live: true },
  { args: ['playwright', 'test', '--project', 'webkit-live'], inheritedLive: undefined, live: true },
  { args: ['workerProcessEntry.js'], inheritedLive: '1', live: true },
])('selects the live project and server together for $args', async ({ args, inheritedLive, live }) => {
  const originalArgv = process.argv;
  process.argv = ['node', ...args];
  vi.stubEnv('GYM_PLAN_LIVE', inheritedLive);
  vi.resetModules();
  try {
    const { default: config } = await import('../../playwright.config');
    const liveProject = config.projects?.find(({ name }) => name === 'webkit-live');
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    const liveServer = servers.find((server) => server?.command === 'node scripts/live-server.mjs');

    expect(Boolean(liveProject)).toBe(live);
    expect(Boolean(liveServer)).toBe(live);
    expect(liveServer?.url).toBe(liveProject?.use?.baseURL);
    expect(process.env.GYM_PLAN_LIVE).toBe(live ? '1' : '0');
  } finally {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
  }
});
