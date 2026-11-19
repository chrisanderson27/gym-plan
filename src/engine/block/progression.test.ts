import { expect, it } from 'vitest';
import type { CircuitBlock, Equipment } from '../../data/types';
import type { HistorySession } from '../lift/types';
import { prescribeBlock } from './progression';
import type { BlockExerciseShape } from './rules';

const eq: Equipment = { id: 'bells', name: 'Bells', kind: 'kb', steps: [10, 15, 20, 25, 30, 35, 40, 45, 50] };
const squat: BlockExerciseShape = {
  id: 'squat', group: 'squat', equipment: ['kb'], primary: ['quads'], secondary: [], substitutes: [],
  unit: 'reps', unitMin: 8, unitMax: 12, repClass: 'other', repMin: 8, repMax: 12, jointFriendly: true,
};
const push: BlockExerciseShape = { ...squat, id: 'push', group: 'horizontal-push', equipment: ['bodyweight'] };
const rower: BlockExerciseShape = { ...squat, id: 'rower', group: 'conditioning', equipment: ['cardio-machine'], unit: 'sec', targets: ['cal', 'm', 'sec'] };
const drafts = [{ exercise: squat, equipmentId: eq.id }, { exercise: push }, { exercise: rower }];
const make = (history: HistorySession[] = [], working: number | undefined = 45, role: CircuitBlock['role'] = 'block') => prescribeBlock({
  slotKey: 'lower-a:Block A', stations: drafts, durationSec: 480, role, history,
  equipment: new Map([[eq.id, eq]]), workingWeightOf: () => working,
});

function previous(day: number, rounds: number, targetRounds = 4, swapped = false): HistorySession {
  const date = `2026-11-${String(day).padStart(2, '0')}T12:00:00Z`;
  const stations = make().stations;
  stations[0]!.load = 50;
  const block: CircuitBlock = {
    id: 'old', kind: 'circuit', role: 'block', label: 'Block A', podId: 'turf', durationSec: 480, targetRounds, stations,
    log: {
      completedRounds: rounds, actualDurationSec: 480,
      stations: [{ exerciseId: squat.id, actualLoad: 50, ...(swapped && { swappedFromExerciseId: 'other' }) },
        { exerciseId: push.id }, { exerciseId: rower.id }],
    },
  };
  return {
    session: { id: date, date, type: 'lift', variant: 'lower-a', blocks: [block], rpe: null, hard: false, hardCardio: false, durationMin: 30, notes: '' },
    sets: [],
  };
}

it('starts at 87.5 percent rounded down and estimates rounds from mixed targets', () => {
  const start = make();
  expect(start.stations.map((station) => station.load)).toEqual([35, undefined, undefined]);
  expect(start.stations.map((station) => station.target)).toEqual([
    { unit: 'reps', amount: 10 }, { unit: 'reps', amount: 10 }, { unit: 'cal', amount: 15 },
  ]);
  expect(start.targetRounds).toBe(3);
  const withoutWork = prescribeBlock({
    slotKey: 'lower-a:Block A', stations: drafts, durationSec: 480, role: 'block',
    history: [], equipment: new Map([[eq.id, eq]]), workingWeightOf: () => undefined,
  });
  expect(withoutWork.stations[0]?.load).toBe(20);
  expect(make([], 45, 'finisher').stations.map((station) => station.target.amount)).toEqual([8, 8, 8]);
});

it('steps up on a hit and lowers the target, keeping bodyweight and cardio unloaded', () => {
  const hit = previous(3, 4);
  const old = hit.session.blocks[0] as CircuitBlock;
  old.log!.stations[0]!.actualLoad = 40;
  expect(make([hit])).toMatchObject({ targetRounds: 3, stations: [{ load: 45 }, {}, {}] });
});

it('keeps load on a miss and sets the next target to completed rounds plus one', () => {
  expect(make([previous(3, 2)])).toMatchObject({ targetRounds: 3, stations: [{ load: 50 }, {}, {}] });
});

it('drops load after two consecutive volume reductions above 10 percent, overriding a hit', () => {
  expect(make([previous(1, 9), previous(2, 7), previous(3, 5)]).stations[0]?.load).toBe(45);
  expect(make([previous(1, 9), previous(2, 9), previous(3, 5)]).stations[0]?.load).toBe(50);
  expect(make([previous(1, 10), previous(2, 9), previous(3, 8)]).stations[0]?.load).toBe(50);
});

it('starts fresh for a formerly swapped station', () => {
  expect(make([previous(3, 4, 4, true)])).toMatchObject({ targetRounds: 3, stations: [{ load: 35 }, {}, {}] });
});

it('excludes logs from another variant, slot or station set', () => {
  const otherVariant = previous(1, 12);
  otherVariant.session.variant = 'lower-b';
  const otherSlot = previous(2, 12);
  otherSlot.session.blocks[0]!.label = 'Block B';
  const otherStations = previous(3, 12);
  (otherStations.session.blocks[0] as CircuitBlock).log!.stations[0]!.exerciseId = 'another-squat';
  expect(make([otherVariant, otherSlot, otherStations])).toEqual(make());
});
