import type { LiftVariant } from '../data/types';

/** Static slot lists per variant: the generator takes the first usable candidate of each slot. */
export const LIFT_TEMPLATES: Record<LiftVariant, { name: string; focus: string; slots: { candidates: string[] }[] }> = {
  'lower-a': {
    name: 'Lower A',
    focus: 'squat focus',
    slots: [
      { candidates: ['leg-press', 'hack-squat', 'goblet-squat', 'smith-squat'] },
      { candidates: ['romanian-deadlift', 'trap-bar-deadlift', 'hip-thrust'] },
      { candidates: ['bulgarian-split-squat', 'reverse-lunge', 'step-up'] },
      { candidates: ['leg-extension'] },
      { candidates: ['leg-curl'] },
      { candidates: ['calf-raise'] },
      { candidates: ['dead-bug', 'pallof-press'] },
    ],
  },
  'lower-b': {
    name: 'Lower B',
    focus: 'hinge focus',
    slots: [
      { candidates: ['trap-bar-deadlift', 'romanian-deadlift'] },
      { candidates: ['hip-thrust', 'cable-pull-through'] },
      { candidates: ['hack-squat', 'leg-press', 'goblet-squat'] },
      { candidates: ['leg-curl'] },
      { candidates: ['hip-adduction', 'hip-abduction'] },
      { candidates: ['calf-raise'] },
      { candidates: ['pallof-press', 'cable-crunch'] },
    ],
  },
  'upper-a': {
    name: 'Upper A',
    focus: 'horizontal',
    slots: [
      { candidates: ['chest-press-machine', 'db-bench', 'bench-press'] },
      { candidates: ['chest-supported-row', 'seated-cable-row', 'one-arm-db-row'] },
      { candidates: ['incline-db-bench', 'cable-fly', 'pec-deck'] },
      { candidates: ['seated-cable-row', 'one-arm-db-row'] },
      { candidates: ['lateral-raise'] },
      { candidates: ['triceps-pushdown'] },
      { candidates: ['db-curl', 'cable-curl'] },
    ],
  },
  'upper-b': {
    name: 'Upper B',
    focus: 'vertical',
    slots: [
      { candidates: ['shoulder-press-machine', 'seated-db-press', 'landmine-press'] },
      { candidates: ['lat-pulldown', 'assisted-pull-up'] },
      { candidates: ['incline-db-bench', 'chest-press-machine'] },
      { candidates: ['chest-supported-row', 'seated-cable-row'] },
      { candidates: ['face-pull', 'reverse-pec-deck'] },
      { candidates: ['hammer-curl', 'cable-curl'] },
      { candidates: ['overhead-triceps-extension', 'triceps-pushdown'] },
    ],
  },
};
