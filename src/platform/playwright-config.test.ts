import { expect, it } from 'vitest';
import { resolveLiveFlag } from '../../playwright.config';

it.each([
  { args: ['test'], inheritedLive: undefined, live: '0' },
  { args: ['test', '--project=webkit'], inheritedLive: undefined, live: '0' },
  { args: ['test', '--project=webkit-live'], inheritedLive: undefined, live: '1' },
  { args: ['test', '--project', 'webkit-live'], inheritedLive: undefined, live: '1' },
  { args: [], inheritedLive: '1', live: '1' },
  { args: ['test', '--project=webkit'], inheritedLive: '1', live: '0' },
  { args: ['test', '--project=webkit-live'], inheritedLive: '0', live: '1' },
  { args: ['test', '--project', 'webkit', 'webkit-live'], inheritedLive: undefined, live: '1' },
  { args: ['test', '--project=*live'], inheritedLive: undefined, live: '1' },
  { args: ['test', '--project=webkit,webkit-live'], inheritedLive: undefined, live: '0' },
  { args: ['test', '--project', 'webkit', '--grep', 'webkit-live'], inheritedLive: undefined, live: '0' },
])('resolves the live flag for $args with inherited flag $inheritedLive', ({ args, inheritedLive, live }) => {
  expect(resolveLiveFlag(args, { GYM_PLAN_LIVE: inheritedLive })).toBe(live);
});
