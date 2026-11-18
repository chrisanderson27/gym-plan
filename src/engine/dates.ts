import type { LocalDate } from '../data/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time calendar day. */
export function localDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Parsed as UTC midnight so DST shifts never change a whole-day difference.
const utcMs = (d: LocalDate) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((utcMs(b) - utcMs(a)) / 86_400_000);
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(utcMs(d) + n * 86_400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
