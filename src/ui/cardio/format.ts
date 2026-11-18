import { localDate } from '../../engine/dates';

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
