import { expect, test } from 'vitest';
import { mixedSetId } from '../../data/mixedSets';
import { session, topSets } from '../../data/p4-test-utils';
import type { Equipment, Session } from '../../data/types';
import { loggedLineup } from './MixedLoggedLineup';

test('a finished session that logged gear lists it as equipment for the Today complete state', () => {
  const sets = topSets('m', 1).map((row) => ({ ...row, id: mixedSetId('m', 'lift', row.idx) }));
  const mixed = {
    kind: 'ordered', sourceId: 's', stations: {}, strength: {}, timers: {}, drafts: {}, results: {},
    prescription: { id: 'p', name: 'Gear day', blocks: [{ id: 'lift', kind: 'strength', exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', sets: 3, repMin: 8, repMax: 12 }] },
    cursor: { blockId: 'lift', stage: 'entry', setSlot: 0 },
  } as unknown as NonNullable<Session['mixed']>;
  const detail = { session: session('m', 1, { type: 'custom', mixed }), sets };
  const equipment = new Map([['pin-stack', { id: 'pin-stack', name: 'Pin stack' } as Equipment]]);
  expect(loggedLineup(detail, equipment, true).gear).toEqual(['Pin stack']);
  expect(loggedLineup({ ...detail, sets: [] }, equipment, true).gear).toEqual([]);
});
