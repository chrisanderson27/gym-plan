import type { OrderedPrescription, Session, SetRow, Template } from './types';

export const MIXED_AT = new Date('2026-11-22T16:00:00Z');
const priorDate = '2026-11-20T16:00:00Z';

const ordered: OrderedPrescription = {
  name: 'Legs & Core',
  blocks: [
    { id: 'prep', kind: 'preparation', durationSec: 60, exerciseId: 'calf-raise', instructions: 'Move through easy calf raises.' },
    { id: 'press', kind: 'strength', exerciseId: 'leg-press', equipmentId: 'plate-loaded', sets: 2, repMin: 8, repMax: 12 },
    { id: 'thrust', kind: 'strength', exerciseId: 'hip-thrust', equipmentId: 'barbell-olympic', sets: 1, repMin: 8, repMax: 12 },
    { id: 'circuit', kind: 'self-paced', name: 'Legs & core circuit', durationSec: 480, stations: [
      { slotId: 'lunge', exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 12 } },
      { slotId: 'push', exerciseId: 'push-up', target: { unit: 'reps', amount: 12 } },
      { slotId: 'row', exerciseId: 'rower', target: { unit: 'm', amount: 200 } },
      { slotId: 'bug', exerciseId: 'dead-bug', target: { unit: 'reps', amount: 10 } },
      { slotId: 'carry', exerciseId: 'farmer-carry', target: { unit: 'm', amount: 30 }, load: 25 },
      { slotId: 'hold', exerciseId: 'plank', target: { unit: 'sec', amount: 35 } },
    ] },
    { id: 'recovery', kind: 'recovery', durationSec: 60, instructions: 'Walk slowly and let your breathing settle.' },
  ],
};

export const MIXED_TEMPLATE: Template = {
  id: 'legs-core', name: ordered.name, type: 'custom', source: 'saved', createdAt: priorDate, ordered,
  blocks: ordered.blocks.flatMap((b) => b.kind === 'strength' ? [{ ...b, kind: 'lift' }] : []),
};

const coached: OrderedPrescription = {
  ...ordered,
  blocks: ordered.blocks.map((block) => block.id !== 'thrust' ? block : {
    id: 'rotation', kind: 'coached', name: 'Four-station rotation', durationSec: 720,
    workSec: 45, restSec: 0, transitionSec: 0,
    stations: [
      { slotId: 'box', exerciseId: 'box-step-up', equipmentId: 'bodyweight', target: { unit: 'sec', amount: 45 } },
      { slotId: 'cable', exerciseId: 'seated-cable-row', equipmentId: 'cable-stack', target: { unit: 'reps', amount: 12 } },
      { slotId: 'squat', exerciseId: 'goblet-squat', equipmentId: 'dumbbells', target: { unit: 'reps', amount: 12 } },
      { slotId: 'bike', exerciseId: 'air-bike', equipmentId: 'air-bike', target: { unit: 'sec', amount: 45 } },
    ],
  }),
};

export const COACHED_TEMPLATE: Template = {
  ...MIXED_TEMPLATE, id: 'legs-core-coached', ordered: coached,
  blocks: MIXED_TEMPLATE.blocks.filter((block) => block.id !== 'thrust'),
};

export const PRIOR_LIFT: Session = {
  id: 'previous-press', type: 'lift', date: priorDate, endedAt: '2026-11-20T16:30:00Z',
  blocks: MIXED_TEMPLATE.blocks, durationMin: 30, hard: false, hardCardio: false, rpe: 7, notes: '',
};
export const PRIOR_SET: SetRow = {
  id: 'previous-press-0', sessionId: PRIOR_LIFT.id, exerciseId: 'leg-press', equipmentId: 'plate-loaded',
  idx: 0, targetWeight: 120, targetReps: 10, weight: 120, reps: 10, painFlag: false,
};
