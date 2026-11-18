import type { IntervalBlock, TimedPhase } from '../data/types';

export interface BurnTemplate {
  id: string;
  name: string;
  summary: string;
  blocks: IntervalBlock[];
}

type Role = TimedPhase['role'];
const ph = (role: Role, sec: number, label: string, exerciseId?: string): TimedPhase => ({
  role, sec, label, ...(exerciseId ? { exerciseId } : {}),
});
const work = (sec: number, label: string, exerciseId?: string) => ph('work', sec, label, exerciseId);
const rest = (sec: number, label = 'Rest') => ph('rest', sec, label);
const trans = (sec: number) => ph('transition', sec, 'Transition');
const blk = (id: string, label: string, rounds: number, phases: TimedPhase[]): IntervalBlock => ({ id, kind: 'interval', label, rounds, phases });

const warmup6 = (id: string) =>
  blk(`${id}-warmup`, 'Warm-up', 1, [ph('warmup', 180, 'Easy row', 'rower'), ph('warmup', 180, 'Mobility')]);
const cooldown5 = (id: string) => blk(`${id}-cooldown`, 'Cool-down', 1, [ph('cooldown', 300, 'Walk + stretch')]);

// 9 stations; no two neighbours share a movement pattern.
const STATIONS: [string, string][] = [
  ['kb-swing', 'Kettlebell swing'], ['air-bike', 'Air bike'], ['reverse-lunge', 'Reverse lunge'],
  ['seated-cable-row', 'Seated cable row'], ['ski-erg', 'Ski erg'], ['push-up', 'Push-up'],
  ['goblet-squat', 'Goblet squat'], ['farmer-carry', 'Farmer carry'], ['dead-bug', 'Dead bug'],
];
const lap = (n: number, workSec: number, restSec: number, tail: boolean): IntervalBlock =>
  blk(`circuit-lap-${n}`, `Lap ${n} (${workSec}:${restSec})`, 1, [
    ...STATIONS.flatMap(([id, name], i) => [work(workSec, name, id), { ...rest(restSec), station: i + 1 }]),
    ...(tail ? [rest(60, 'Lap rest')] : []),
  ]);

export const BURN_TEMPLATES: BurnTemplate[] = [
  {
    id: 'burn-tread-floor',
    name: 'Tread / Bike / Ski + floor',
    summary: '55 min: treadmill intervals, floor strength, bike and ski blocks, kettlebell finisher',
    blocks: [
      warmup6('tf'),
      blk('tf-tread', 'Treadmill', 3, [work(120, 'Base pace', 'treadmill'), work(60, 'Push', 'treadmill'), rest(60, 'Recover')]),
      blk('tf-floor', 'Floor', 3, [
        work(45, 'Goblet squat', 'goblet-squat'), trans(15), work(45, 'One-arm DB row', 'one-arm-db-row'), trans(15),
        work(45, 'Seated DB press', 'seated-db-press'), trans(15), work(45, 'Plank', 'plank'), rest(15),
      ]),
      blk('tf-bike', 'Bike', 6, [work(30, 'Hard', 'air-bike'), rest(60, 'Easy spin')]),
      blk('tf-ski', 'Ski', 4, [work(60, 'Ski erg', 'ski-erg'), rest(60)]),
      blk('tf-finisher', 'Finisher', 3, [work(40, 'Kettlebell swing', 'kb-swing'), rest(20)]),
      cooldown5('tf'),
    ],
  },
  {
    id: 'burn-station-circuit',
    name: 'F45-style station circuit',
    summary: '54 min: four 9-station laps at 40:20, 40:20, 35:25, 30:30, then ropes',
    blocks: [
      warmup6('sc'),
      lap(1, 40, 20, true), lap(2, 40, 20, true), lap(3, 35, 25, true), lap(4, 30, 30, false),
      blk('sc-finisher', 'Finisher', 4, [work(40, 'Battle ropes', 'battle-ropes'), rest(20)]),
      cooldown5('sc'),
    ],
  },
  {
    id: 'burn-strength-hybrid',
    name: 'Strength-biased hybrid',
    summary: '52 min: two timed dumbbell strength blocks around a bike interval block',
    blocks: [
      warmup6('sh'),
      blk('sh-a', 'Strength A', 4, [
        work(45, 'Goblet squat', 'goblet-squat'), rest(30), work(45, 'DB bench press', 'db-bench'), rest(30),
        work(45, 'One-arm DB row', 'one-arm-db-row'), rest(45),
      ]),
      blk('sh-bike', 'Bike', 10, [work(30, 'Hard', 'air-bike'), rest(60, 'Easy spin')]),
      blk('sh-b', 'Strength B', 4, [
        work(40, 'Reverse lunge', 'reverse-lunge'), rest(20), work(40, 'Seated DB press', 'seated-db-press'), rest(20),
        work(30, 'Farmer carry', 'farmer-carry'),
      ]),
      cooldown5('sh'),
    ],
  },
];
