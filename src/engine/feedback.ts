import type { FeedbackRow, LocalDate } from '../data/types';

const byId = (rows: FeedbackRow[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Rows verbatim (ULID order), so an AI can join on ids against the full backup export. */
export function toJsonl(rows: FeedbackRow[]): string {
  return rows.length === 0 ? '' : byId(rows).map((r) => JSON.stringify(r)).join('\n') + '\n';
}

export const feedbackFileStem = (date: LocalDate): string => `feedback-${date}`;

export function toMarkdown(rows: FeedbackRow[], label: (ctx: FeedbackRow['context']) => string, today: string): string {
  const out = [`# Feedback — ${today}`, ''];
  for (const r of byId(rows)) {
    out.push(`## ${new Date(r.ts).toLocaleString()} · ${r.kind} · ${r.tags.join(', ') || 'no tags'}`, '');
    if (r.ref) out.push(`Corrects ${r.ref}`, '');
    if (r.text) out.push(r.text, '');
    const ctx = label(r.context);
    if (ctx) out.push(`Context: ${ctx}`, '');
  }
  return out.join('\n');
}
