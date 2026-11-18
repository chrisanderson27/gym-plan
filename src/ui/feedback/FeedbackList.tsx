import { useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { listFeedback } from '../../data/feedback';
import { useLiveQuery } from '../../data/live';
import type { FeedbackRow } from '../../data/types';
import { localDate } from '../../engine/dates';
import { toJsonl, toMarkdown } from '../../engine/feedback';
import { datedFileName, deliverFile } from '../../platform/share';
import { screenName, sessionTypeLabel, tagLabel } from '../labels';
import { FeedbackSheet } from './FeedbackSheet';

/** The Markdown export keeps raw ids (it is a developer-facing file); the on-screen list never shows them. */
const exportContext = (c: FeedbackRow['context']): string =>
  [
    c.exerciseId && (exerciseById.get(c.exerciseId)?.name ?? c.exerciseId),
    c.equipmentId && `on ${c.equipmentId}`,
    c.templateId && `template ${c.templateId}`,
    c.sessionId && `session ${c.sessionId}`,
    c.screen,
  ].filter(Boolean).join(' · ');

/** "2026-11-17 · Lift session" — the date and the screen it was written on, in words. */
const headline = (r: FeedbackRow): string => [localDate(new Date(r.ts)), screenName(r.context.screen) ?? sessionTypeLabel(r.kind)].join(' · ');

/** "Squat · Leg press — Plate" — exercise and equipment by name; an unknown id is dropped, never shown. */
const subject = (c: FeedbackRow['context'], equipment: Map<string, string>): string =>
  [c.exerciseId && exerciseById.get(c.exerciseId)?.name, c.equipmentId && equipment.get(c.equipmentId)].filter(Boolean).join(' · ');

/** Settings section: append-only feedback list, corrections, and JSONL / Markdown export. */
export function FeedbackList({ onMessage }: { onMessage: (m: string) => void }) {
  const rows = useLiveQuery(() => listFeedback(db), []);
  const equipment = useLiveQuery(async () => new Map((await db.equipment.toArray()).map((e) => [e.id, e.name])), []) ?? new Map<string, string>();
  const [sheet, setSheet] = useState<{ original?: FeedbackRow } | null>(null);
  const corrected = new Set((rows ?? []).flatMap((r) => (r.ref ? [r.ref] : [])));
  const empty = !rows || rows.length === 0;

  const exportAs = async (ext: 'jsonl' | 'md', preferShare: boolean) => {
    const all = await listFeedback(db);
    const now = new Date();
    const text = ext === 'jsonl' ? toJsonl(all) : toMarkdown(all, exportContext, localDate(now));
    const types = ext === 'jsonl' ? ['application/x-ndjson', 'text/plain'] : ['text/markdown', 'text/plain'];
    const result = await deliverFile(datedFileName('feedback', ext, now), text, { preferShare, types });
    onMessage(result === 'cancelled' ? 'Export cancelled.' : result === 'shared' ? 'Feedback shared.' : 'Feedback downloaded.');
  };

  return (
    <section>
      <h2>Feedback</h2>
      <button type="button" data-testid="feedback-new" onClick={() => setSheet({})}>New feedback</button>
      {empty && <p class="dim">No feedback yet</p>}
      {!empty && <div class="card fb-list">
      {(rows ?? []).map((r) => (
        <div key={r.id} class={corrected.has(r.id) ? 'fb-row corrected' : 'fb-row'} data-testid="feedback-row">
          <div class="fb-head">
            <strong>{headline(r)}</strong>
            {corrected.has(r.id) && <span class="dim">(corrected)</span>}
            {r.ref && <span class="dim">(correction)</span>}
          </div>
          {subject(r.context, equipment) && <p class="dim" data-testid="feedback-subject">{subject(r.context, equipment)}</p>}
          {r.tags.length > 0 && <p data-testid="feedback-tags">{r.tags.map(tagLabel).join(', ')}</p>}
          {r.text && <p>{r.text}</p>}
          <button type="button" class="link" onClick={() => setSheet({ original: r })}>Correct</button>
        </div>
      ))}
      </div>}
      <button type="button" disabled={empty} onClick={() => exportAs('jsonl', true)}>Share feedback (JSONL)</button>
      <button type="button" disabled={empty} onClick={() => exportAs('jsonl', false)}>Download feedback (JSONL)</button>
      <button type="button" disabled={empty} onClick={() => exportAs('md', false)}>Download feedback (Markdown)</button>
      {sheet && (
        <FeedbackSheet
          kind={sheet.original?.kind ?? 'app'}
          context={sheet.original?.context ?? { screen: location.hash || '#/settings' }}
          original={sheet.original}
          onClose={(saved) => { setSheet(null); if (saved) onMessage('Feedback saved'); }}
        />
      )}
    </section>
  );
}
