import { LIMITS } from '../limits';

export interface DraftCheckInput {
  name: string;
  kind: 'self-paced' | 'coached';
  minutes: string;
  workSec: number;
  restSec: number;
  transitionSec: number;
  stations: { exerciseId: string; unit: string; amount: string; load: string }[];
}

export const minutesOk = (raw: string) => /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 60;
export const amountMax = (unit: string) => (unit === 'sec' ? LIMITS.workSec : unit === 'm' ? 5000 : LIMITS.targetReps);
export const amountOk = (raw: string, unit: string) => raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0 && Number(raw) <= amountMax(unit);
export const loadOk = (raw: string) => raw.trim() === '' || (Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 2000);
export const targetMessage = (unit: string) => `Enter a target greater than 0 and at most ${amountMax(unit)}.`;
const secOk = (n: number, min: number) => Number.isFinite(n) && n >= min && n <= LIMITS.workSec;

/** The first reason Save/Preview is unavailable, or undefined when the draft is valid. */
export function draftProblem(d: DraftCheckInput): string | undefined {
  if (d.name.trim().length === 0) return 'Add a block name to continue.';
  if (!minutesOk(d.minutes)) return 'Enter minutes from 1 to 60.';
  if (d.kind === 'coached') {
    if (!secOk(d.workSec, 1)) return `Work time must be 1 to ${LIMITS.workSec} seconds.`;
    if (!secOk(d.restSec, 0)) return `Rest time must be 0 to ${LIMITS.workSec} seconds.`;
    if (!secOk(d.transitionSec, 0)) return `Transition time must be 0 to ${LIMITS.workSec} seconds.`;
  }
  if (d.stations.length < 1) return 'Add at least one exercise.';
  if (d.stations.length > 6) return 'A block holds at most 6 exercises.';
  if (new Set(d.stations.map((s) => s.exerciseId)).size !== d.stations.length) return 'Each exercise can only appear once.';
  const bad = d.stations.find((s) => !amountOk(s.amount, s.unit));
  if (bad) return targetMessage(bad.unit);
  if (d.stations.some((s) => !loadOk(s.load))) return 'Load must be a number from 0 to 2000.';
  return undefined;
}
