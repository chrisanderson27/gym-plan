import { expect, it, vi } from 'vitest';
import { useLiveQuery } from '../../data/live';
import type { Runnable } from '../../data/templates';
import { TemplateRunScreen } from './TemplateRunScreen';

vi.mock('../../data/live', () => ({ useLiveQuery: vi.fn() }));

const blocks: Runnable['blocks'] = [
  { id: 'warmup', kind: 'lift', warmup: true, exerciseId: 'rower', sets: 1, repMin: 0, repMax: 0 },
  {
    id: 'block', kind: 'circuit', role: 'block', podId: 'turf', label: 'Block A', durationSec: 480,
    targetRounds: 3, stations: [], log: { completedRounds: 3, actualDurationSec: 480, stations: [] },
  },
];

it.each([
  { sessionId: 'history-burn' },
  { templateId: 'saved-burn' },
])('a legacy Burn row repeats through the conversion state, not a standalone chooser (%o)', (source) => {
  const run: Runnable = { type: 'burn', templateId: 'saved-burn', name: 'Prior Burn', blocks };
  vi.mocked(useLiveQuery).mockReturnValue({ run, snap: {} });

  const screen = TemplateRunScreen(source);
  expect(typeof screen.type).toBe('function');
  expect((screen.type as { name: string }).name).toBe('LegacyAgain');
  expect(screen.props.run).toBe(run);
});
