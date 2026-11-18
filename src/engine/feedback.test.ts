import { describe, expect, it } from 'vitest';
import type { FeedbackRow } from '../data/types';
import { feedbackFileStem, toJsonl, toMarkdown } from './feedback';

const row = (id: string, over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id, v: 1, ts: '2026-11-12T12:00:00.000Z', kind: 'workout', tags: ['other'], text: 'x', context: {}, ...over,
});

describe('feedback export', () => {
  it('JSONL: one parseable line per row, sorted by id', () => {
    const rows = [row('C', { text: 'line\nbreak "q" 💪' }), row('A'), row('B', { ref: 'A', context: { sessionId: 's' } })];
    const out = toJsonl(rows);
    const lines = out.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l))).toEqual([rows[1], rows[2], rows[0]]);
  });

  it('JSONL of nothing is empty', () => {
    expect(toJsonl([])).toBe('');
  });

  it('Markdown carries tags, text, context and corrections', () => {
    const md = toMarkdown([row('A', { tags: ['pain', 'too-hard'], text: 'ow' }), row('B', { ref: 'A' })], () => 'Leg press', '2026-11-12');
    expect(md).toContain('# Feedback — 2026-11-12');
    expect(md).toContain('pain, too-hard');
    expect(md).toContain('Corrects A');
    expect(md).toContain('Context: Leg press');
  });

  it('names the file stem', () => {
    expect(feedbackFileStem('2026-11-12')).toBe('feedback-2026-11-12');
  });
});
