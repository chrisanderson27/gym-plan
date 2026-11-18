import type { LiftVariant } from '../../data/types';
import type { PlanInput, PlanSession } from './types';

export const NOW = new Date('2026-03-12T12:00:00');
export const HOUR = 3_600_000;
export const TODAY = '2026-03-12';

const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;

export function session(hoursAgo: number, o: Partial<PlanSession> = {}): PlanSession {
  const start = NOW.getTime() - hoursAgo * HOUR;
  const d = new Date(start);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    id: 's' + n++, start: iso(start), end: iso(start), day, type: 'lift', hard: false, hardCardio: false, lower: false, heavyLegs: false,
    lifted: false, hardRun: false, finished: true, ...o,
  };
}

export const lowerA = (hoursAgo: number) => session(hoursAgo, { type: 'lift', variant: 'lower-a', lower: true, heavyLegs: true, lifted: true });
export const upperA = (hoursAgo: number) => session(hoursAgo, { type: 'lift', variant: 'upper-a', lifted: true });
export const burn = (hoursAgo: number) => session(hoursAgo, { type: 'burn', hard: true, hardCardio: true });
export const hardRun = (hoursAgo: number) => session(hoursAgo, { type: 'run', runKind: 'intervals', hard: true, hardCardio: true, hardRun: true });

export function input(sessions: PlanSession[], o: Partial<PlanInput> = {}): PlanInput {
  const half = (variant: LiftVariant) => ({ variant, ready: true, hoursLeft: 0, blocking: [] as string[] });
  return {
    now: NOW.toISOString(), today: TODAY, programStart: '2026-02-09', daysPerWeek: 5, sessions,
    lift: { upper: half('upper-a'), lower: half('lower-a') }, hasLiftHistory: true, ...o,
  };
}
