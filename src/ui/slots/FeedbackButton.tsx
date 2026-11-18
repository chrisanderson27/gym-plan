import { useEffect, useState } from 'preact/hooks';
import type { FeedbackRow } from '../../data/types';
import { FeedbackSheet } from '../feedback/FeedbackSheet';

export type FeedbackContext = FeedbackRow['context'];

/** One-tap feedback from any workout, exercise or set. Owns its sheet and persistence, so a screen only passes ids. */
export function FeedbackButton({ kind, context }: { kind: 'workout' | 'exercise' | 'set'; context: FeedbackContext }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <>
      <button
        type="button"
        class="fb"
        data-testid={`feedback-${kind}`}
        aria-label={`Feedback on this ${kind === 'workout' ? 'workout' : kind}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        💬
      </button>
      {saved && <span role="status" class="dim">Feedback saved</span>}
      {open && (
        <FeedbackSheet
          kind={kind}
          context={{ ...context, screen: location.hash || '#/' }}
          onClose={(didSave) => { setOpen(false); if (didSave) setSaved(true); }}
        />
      )}
    </>
  );
}
