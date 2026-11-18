import { LIFT_TEMPLATES, exerciseById } from '../content';

/** Display helpers: ids stay in storage, they are mapped to names only when rendered. */

const VARIANT_RE = /\b(?:upper|lower)-[ab]\b/g;

export const variantName = (v: string): string => (v in LIFT_TEMPLATES ? LIFT_TEMPLATES[v as keyof typeof LIFT_TEMPLATES].name : v);

export const exerciseName = (id: string): string => exerciseById.get(id)?.name ?? id;

/** "After lower-a: upper-b" -> "After Lower A: Upper B". Free text passes through otherwise unchanged. */
export const humanize = (text: string): string => text.replace(VARIANT_RE, (m) => variantName(m));

/** "too-easy" -> "Too easy". */
export const tagLabel = (tag: string): string => {
  const s = tag.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const sessionTypeLabel = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;
