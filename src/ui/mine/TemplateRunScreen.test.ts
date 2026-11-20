import { expect, it, vi } from 'vitest';
import { BURN_TEMPLATES } from '../../content/burn-templates';
import { useLiveQuery } from '../../data/live';
import type { Runnable } from '../../data/templates';
import { BurnScreen } from '../cardio/BurnScreen';
import { TemplateRunScreen } from './TemplateRunScreen';

vi.mock('../../data/live', () => ({ useLiveQuery: vi.fn() }));

const templateId = BURN_TEMPLATES[1]!.id;
const blocks: Runnable['blocks'] = [
  { id: 'warmup', kind: 'lift', warmup: true, exerciseId: 'rower', sets: 1, repMin: 0, repMax: 0 },
  {
    id: 'block', kind: 'circuit', role: 'block', podId: 'turf', label: 'Block A', durationSec: 480,
    targetRounds: 3, stations: [], log: { completedRounds: 3, actualDurationSec: 480, stations: [] },
  },
];

it.each([
  { source: { sessionId: 'history-burn' }, storedId: templateId, expectedId: templateId },
  { source: { templateId: 'saved-burn' }, storedId: 'saved-burn', expectedId: undefined },
])('opens a fresh Burn plan for $storedId even when the source starts with a lift block', ({ source, storedId, expectedId }) => {
  const run: Runnable = { type: 'burn', templateId: storedId, name: 'Prior Burn', blocks };
  vi.mocked(useLiveQuery).mockReturnValue({ run, snap: {} });

  const screen = TemplateRunScreen(source);
  expect(screen.type).toBe(BurnScreen);
  expect(screen.props).toEqual({ templateId: expectedId });
});
