import { DRILLS } from '../../content/drills';
import { SWIM_EFFORT_WORDS, SWIM_STROKE_WORDS } from '../../content/swim-workouts';
import type { PoolUnit, SwimItem } from '../../data/types';
import { localDate } from '../../engine/dates';
import { fmtClock } from '../../engine/swim/sendoff';

/** 125 → "2:05". */
export const fmtMSS = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "7:00" → 420, "95" → 95; anything else → undefined. */
export function parseMSS(text: string): number | undefined {
  const t = text.trim();
  const m = /^(\d+):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : undefined;
}

/** Local calendar day of an ISO instant, for "Last …" lines. */
export const dayOf = (iso: string): string => localDate(new Date(iso));

export function itemLine(item: SwimItem, unit: PoolUnit): string {
  const { reps, distance, swimKind, drillId, stroke, intensity, seconds, mode } = item;
  const strokeWord = SWIM_STROKE_WORDS[stroke];
  const what = swimKind === 'swim' ? strokeWord
    : swimKind === 'pull' ? `pull ${strokeWord}`
    : swimKind === 'drill' ? DRILLS.find((drill) => drill.id === drillId)?.name ?? 'drill'
    : swimKind;
  const effort = swimKind === 'kick' || swimKind === 'drill' ? '' : ` · ${SWIM_EFFORT_WORDS[intensity]}`;
  const timing = seconds === undefined ? ''
    : mode === 'sendoff' ? ` · leave every ${fmtClock(seconds)}`
    : ` · ${seconds < 60 ? `${seconds} s` : fmtClock(seconds)} rest`;
  return `${reps === 1 ? '' : `${reps} × `}${distance} ${unit} ${what}${effort}${timing}`;
}
