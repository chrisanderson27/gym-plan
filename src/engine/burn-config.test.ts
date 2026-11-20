import { expect, it, vi } from 'vitest';
import { BURN_TEMPLATES } from '../content/burn-templates';
import { burnInputFrom } from '../data/burn';
import { generateBurn } from './burn';
import { BLOCK_LONG_MIN, BLOCK_SHORT_MIN } from './config';

vi.mock('./config', async (original) => ({
  ...await original<typeof import('./config')>(), BLOCK_LONG_MIN: 11, BLOCK_SHORT_MIN: 7,
}));

vi.mock(import('./block/rules'), async (original) => {
  const rules = await original();
  return { ...rules, PROFILES: { ...rules.PROFILES, burn: { ...rules.PROFILES.burn, minGroups: 2 } } };
});

it('shortens Burn using the configured durations and accepts the configured group minimum', () => {
  const template = {
    ...BURN_TEMPLATES[0]!, blocks: [{ label: 'Block A', role: 'block' as const, minutes: BLOCK_LONG_MIN,
      stations: [{ exerciseId: 'goblet-squat' }, { exerciseId: 'push-up' }] }],
  };
  const input = burnInputFrom({
    now: '2026-11-19T12:00:00Z', programStart: '2026-10-22', history: [], overrides: new Map(), equipment: new Map(),
  }, template, 19);
  expect(generateBurn(input).blocks.filter((block) => block.kind === 'circuit'))
    .toMatchObject([{ durationSec: BLOCK_SHORT_MIN * 60, stations: [{ exerciseId: 'goblet-squat' }, { exerciseId: 'push-up' }] }]);
});
