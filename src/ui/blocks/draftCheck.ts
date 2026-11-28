import { exerciseById } from '../../content';
import { blockExerciseOf as exerciseOf } from '../../data/liftday';
import type { StationUnit } from '../../data/types';
import {
  BLOCK_HARD_MAX_ROUNDS, BLOCK_MAX_STATIONS, BLOCK_ROUNDS, blockBalanceIssues, blockRoundSeconds, blockSecondsForRounds, isHardBlockIssue, type BlockIssue, type RoundBlock,
} from '../../engine/templates';
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

/** The first reason Save is unavailable, or undefined when the draft can be saved. */
export function draftProblem(d: DraftCheckInput): string | undefined {
  return draftFieldProblem(d) ?? issueMessages(d, balance(d).filter(isHardBlockIssue))[0];
}

/** A field that cannot be read. Preview needs only this; the balance limits guard Save, not looking. */
export function draftFieldProblem(d: DraftCheckInput): string | undefined {
  if (d.name.trim().length === 0) return 'Add a block name to continue.';
  if (!minutesOk(d.minutes)) return 'Enter minutes from 1 to 60.';
  if (d.kind === 'coached') {
    if (!secOk(d.workSec, 1)) return `Work time must be 1 to ${LIMITS.workSec} seconds.`;
    if (!secOk(d.restSec, 0)) return `Rest time must be 0 to ${LIMITS.workSec} seconds.`;
    if (!secOk(d.transitionSec, 0)) return `Transition time must be 0 to ${LIMITS.workSec} seconds.`;
  }
  if (d.stations.length < 1) return 'Add at least one exercise.';
  if (d.stations.length > BLOCK_MAX_STATIONS) return `A block holds at most ${BLOCK_MAX_STATIONS} exercises.`;
  if (new Set(d.stations.map((s) => s.exerciseId)).size !== d.stations.length) return 'Each exercise can only appear once.';
  const bad = d.stations.find((s) => !amountOk(s.amount, s.unit));
  if (bad) return targetMessage(bad.unit);
  if (d.stations.some((s) => !loadOk(s.load))) return 'Load must be a number from 0 to 2000.';
  return undefined;
}

/** Balance reasons the user may save past. Empty until the draft is otherwise valid, so it never stacks on a field error. */
export function draftWarnings(d: DraftCheckInput): string[] {
  if (draftProblem(d) !== undefined) return [];
  return issueMessages(d, balance(d).filter((issue) => !isHardBlockIssue(issue)));
}

/** Whole minutes for three rounds of these stations, when the current length is out of range. */
export function draftFitMinutes(d: DraftCheckInput): number | undefined {
  const block = roundBlock(d);
  if (!block || !balance(d).some((issue) => issue.kind === 'too-many-rounds' || issue.kind === 'too-few-rounds')) return undefined;
  const sec = blockSecondsForRounds(block, exerciseOf, BLOCK_ROUNDS.target);
  return sec === undefined ? undefined : Math.min(60, Math.max(1, Math.round(sec / 60)));
}

/** Plain-language meta for a valid draft or saved row: "6 exercises × about 3 rounds". */
export function roundsLine(block: RoundBlock): string | undefined {
  const n = block.stations?.length ?? 0;
  const round = blockRoundSeconds(block, exerciseOf);
  if (!round) return undefined;
  const rounds = Math.max(1, Math.round(block.durationSec / round));
  return `${n} ${n === 1 ? 'exercise' : 'exercises'} × about ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
}

// Names read mid-sentence lose their first capital, except proper names such as Romanian deadlift.
const PROPER = new Set(['Assault', 'Bulgarian', 'EZ-bar', 'Pallof', 'Romanian', 'SkiErg', 'Smith']);
const nameOf = (id: string) => {
  const name = exerciseById.get(id)?.name ?? id;
  return PROPER.has(name.split(' ')[0]!) ? name : name.charAt(0).toLowerCase() + name.slice(1);
};
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const GROUP_WORD = { lower: 'leg', push: 'push', pull: 'pull', core: 'core', cardio: 'cardio' } as const;

function roundBlock(d: DraftCheckInput): RoundBlock | undefined {
  if (!minutesOk(d.minutes) || d.stations.some((s) => !amountOk(s.amount, s.unit))) return undefined;
  const stations = d.stations.map((s) => ({ exerciseId: s.exerciseId, target: { unit: s.unit as StationUnit, amount: Number(s.amount) } }));
  return d.kind === 'coached'
    ? { kind: 'coached', durationSec: Number(d.minutes) * 60, stations, workSec: d.workSec, restSec: d.restSec, transitionSec: d.transitionSec }
    : { kind: 'self-paced', durationSec: Number(d.minutes) * 60, stations };
}

function balance(d: DraftCheckInput): BlockIssue[] {
  const block = roundBlock(d);
  return block ? blockBalanceIssues(block, exerciseOf) : [];
}

function issueMessages(d: DraftCheckInput, issues: BlockIssue[]): string[] {
  const n = d.stations.length;
  const count = `${n} ${n === 1 ? 'exercise' : 'exercises'}`;
  const fit = draftFitMinutes(d);
  const fix = (other: string) => (fit === undefined || String(fit) === d.minutes ? ` ${capital(other)}.` : ` Use ${fit} min or ${other}.`);
  const stretched = issues.some((issue) => issue.kind === 'too-many-rounds');
  return issues.flatMap((issue): string[] => {
    switch (issue.kind) {
      case 'too-many-rounds': {
        // A refused block never claims the limit it broke: 6.2 rounds reads "about 7", not "about 6".
        const times = issue.rounds > BLOCK_HARD_MAX_ROUNDS ? Math.ceil(issue.rounds) : Math.round(issue.rounds);
        return [`${count} for ${d.minutes} minutes repeats about ${times} times.${fix('add exercises')}`];
      }
      case 'too-few-rounds':
        return [`${count} for ${d.minutes} minutes fits less than ${BLOCK_ROUNDS.min} rounds.${fix('remove exercises')}`];
      case 'too-few-exercises':
        // The repeat count already says this block is too thin for its length.
        return stretched ? [] : [`A ${d.minutes}-minute block works best with at least ${issue.min} exercises.`];
      case 'adjacent-group': {
        const names = Array.from({ length: issue.length }, (_, k) => nameOf(d.stations[(issue.from + k) % n]!.exerciseId));
        const list = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
        const wraps = issue.from + issue.length > n;
        return [`${capital(list)} are ${names.length > 2 ? `${names.length} ${GROUP_WORD[issue.group]} moves in a row` : 'back to back'}${wraps ? ' when the block loops' : ''}. Put a different move between them.`];
      }
      case 'too-much-core':
        return [`${issue.count} of ${n} exercises are core moves. Keep it to ${issue.max}.`];
      case 'too-few-groups':
        return [`These exercises cover ${issue.count} movement ${issue.count === 1 ? 'group' : 'groups'}. Mix in at least ${issue.min} of legs, push, pull, core and cardio.`];
      default:
        return [];
    }
  });
}
