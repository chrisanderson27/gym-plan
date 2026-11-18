import { useState } from 'preact/hooks';
import { db } from '../../data/db';
import { addFeedback, correctFeedback } from '../../data/feedback';
import { FEEDBACK_TAGS, type FeedbackKind, type FeedbackRow, type FeedbackTag } from '../../data/types';
import { tagLabel } from '../labels';
import { Sheet } from '../Sheet';

/** Tag chips + notes. With `original` it writes a correction (a new row with `ref`), never an edit. */
export function FeedbackSheet({
  kind,
  context,
  original,
  onClose,
}: {
  kind: FeedbackKind;
  context: FeedbackRow['context'];
  original?: FeedbackRow;
  onClose: (saved: boolean) => void;
}) {
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const toggle = (t: FeedbackTag) => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);

  const save = async () => {
    try {
      if (original) await correctFeedback(db, original, { tags, text });
      else await addFeedback(db, { kind, tags, text, context });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  };

  return (
    <Sheet label="Feedback" onClose={() => onClose(false)}>
      <h2>{original ? 'Correct feedback' : 'Feedback'}</h2>
      <div class="chips">
        {FEEDBACK_TAGS.map((t) => (
          <button key={t} type="button" class={tags.includes(t) ? 'chip on' : 'chip'} aria-pressed={tags.includes(t)} data-testid={`feedback-tag-${t}`} onClick={() => toggle(t)}>
            {tagLabel(t)}
          </button>
        ))}
      </div>
      <textarea aria-label="Notes" rows={3} value={text} onInput={(e) => setText(e.currentTarget.value)} />
      {error && <p class="warn">{error}</p>}
      <div class="sheet-actions">
        <button type="button" class="primary" data-testid="feedback-save" disabled={tags.length === 0 && text.trim() === ''} onClick={save}>Save</button>
        <button type="button" onClick={() => onClose(false)}>Cancel</button>
      </div>
    </Sheet>
  );
}
