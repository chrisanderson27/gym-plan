import type { SwimItem, SwimSetBlock } from '../data/types';

export interface SwimWorkoutDef {
  id: string;
  name: string;
  focus: string;
  minWeek: number;
  blocks: SwimSetBlock[];
}

export const SWIM_STROKE_WORDS: Record<SwimItem['stroke'], string> = {
  FR: 'freestyle', BK: 'backstroke', BR: 'breaststroke', FL: 'butterfly', IM: 'medley', CH: 'choice',
};

export const SWIM_EFFORT_WORDS: Record<SwimItem['intensity'], string> = {
  EZ: 'easy', MOD: 'steady', CSS: 'threshold', FAST: 'fast', SPRINT: 'sprint',
};

/** What to do when a piece of gear is missing. Gear is not a stored inventory (PRD §5). */
export const SWIM_GEAR_SUBSTITUTES: Record<string, string> = {
  paddles: 'No paddles: pull with fists closed',
  board: 'No board: kick on your back or in streamline',
  fins: 'No fins: shorten to 25s',
  buoy: 'No buoy: swim easy, focus on the catch',
};

// `mode`/`seconds` are filled by the generator from the CSS test (or the rest fallback).
const item = (
  reps: number, distance: number, swimKind: SwimItem['swimKind'], intensity: SwimItem['intensity'],
  extra: Partial<SwimItem> = {},
): SwimItem => ({ reps, distance, stroke: 'FR', swimKind, equipment: [], mode: 'rest', intensity, ...extra });
const set = (id: string, section: SwimSetBlock['section'], items: SwimItem[], rounds = 1): SwimSetBlock => ({
  id, kind: 'swim', section, rounds, items,
});

const warm = (id: string, d: number) => set(`${id}-warm`, 'warmup', [item(1, d, 'swim', 'EZ')]);
const drill = (id: string, a: string, b: string) =>
  set(`${id}-drill`, 'drill', [item(2, 50, 'drill', 'EZ', { drillId: a, equipment: ['fins'] }), item(2, 50, 'drill', 'EZ', { drillId: b })]);
const kick = (id: string) => set(`${id}-kick`, 'kick', [item(4, 50, 'kick', 'MOD', { equipment: ['board'] })]);
const cool = (id: string, d: number) => set(`${id}-cool`, 'cooldown', [item(1, d, 'swim', 'EZ')]);

export const SWIM_WORKOUTS: SwimWorkoutDef[] = [
  {
    id: 'swim-easy-technique', name: 'Easy technique', focus: 'Drills and easy aerobic swimming', minWeek: 1,
    blocks: [
      warm('s1', 300), drill('s1', 'catch-up', 'fingertip-drag'), kick('s1'),
      set('s1-main', 'main', [item(4, 150, 'swim', 'MOD')]), cool('s1', 200),
    ],
  },
  {
    id: 'swim-aerobic', name: 'Aerobic base', focus: 'Steady aerobic volume', minWeek: 1,
    blocks: [
      warm('s2', 300), drill('s2', 'six-kick-switch', 'catch-up'), kick('s2'),
      set('s2-main', 'main', [item(6, 150, 'swim', 'MOD')]), cool('s2', 200),
    ],
  },
  {
    id: 'swim-css-intro', name: 'CSS intro', focus: 'Threshold pace with pull', minWeek: 1,
    blocks: [
      warm('s3', 400), drill('s3', 'single-arm-forward', 'catch-up'), kick('s3'),
      set('s3-pull', 'pull', [item(4, 50, 'pull', 'MOD', { equipment: ['buoy'] })]),
      set('s3-main', 'main', [item(8, 100, 'swim', 'CSS')]), cool('s3', 200),
    ],
  },
  {
    id: 'swim-speed-pull', name: 'Speed and pull', focus: 'Fast 50s and paddle pull', minWeek: 3,
    blocks: [
      warm('s4', 400), drill('s4', 'single-arm-forward', 'fist-drill'), kick('s4'),
      set('s4-pull', 'pull', [item(4, 100, 'pull', 'MOD', { equipment: ['buoy', 'paddles'] })]),
      set('s4-main', 'main', [item(8, 50, 'swim', 'FAST'), item(4, 100, 'swim', 'CSS')]),
      set('s4-cool', 'cooldown', [item(2, 100, 'swim', 'EZ')]),
    ],
  },
  {
    id: 'swim-endurance', name: 'Endurance', focus: 'Long repeats at a strong aerobic pace', minWeek: 4,
    blocks: [
      warm('s5', 400), drill('s5', 'bilateral-breathing', 'count-strokes'), kick('s5'),
      set('s5-pull', 'pull', [item(4, 100, 'pull', 'MOD', { equipment: ['buoy'] })]),
      set('s5-main', 'main', [item(5, 200, 'swim', 'CSS')]), cool('s5', 300),
    ],
  },
  {
    id: 'swim-ladder', name: 'Ladder', focus: 'Up-and-down ladder at CSS', minWeek: 8,
    blocks: [
      warm('s6', 400), drill('s6', 'three-three-three', 'catch-up'), kick('s6'),
      set('s6-pull', 'pull', [item(4, 100, 'pull', 'MOD', { equipment: ['buoy', 'paddles'] })]),
      set('s6-main', 'main', [100, 200, 300, 400, 300, 200, 100].map((d) => item(1, d, 'swim', 'CSS'))),
      cool('s6', 200),
    ],
  },
];
