import { useEffect, useState } from 'preact/hooks';
import type { FeedbackRow } from '../../data/types';
import { FeedbackSheet } from '../feedback/FeedbackSheet';

export type FeedbackContext = FeedbackRow['context'];

/** Copy of the context at the moment feedback is opened, so later prop changes (e.g. timer steps) can't retarget it. */
export function snapshotContext(context: FeedbackContext, screen: string): FeedbackContext {
  return { ...context, screen };
}

/** One-tap feedback from any workout, exercise or set. Owns its sheet and persistence, so a screen only passes ids. */
export function FeedbackButton({ kind, context }: { kind: 'workout' | 'exercise' | 'set'; context: FeedbackContext }) {
  const [snap, setSnap] = useState<FeedbackContext | null>(null);
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
        onClick={(e) => { e.stopPropagation(); setSnap(snapshotContext(context, location.hash || '#/')); }}
      >
        💬
      </button>
      {saved && <span role="status" class="dim">Feedback saved</span>}
      {snap && (
        <FeedbackSheet
          kind={kind}
          context={snap}
          onClose={(didSave) => { setSnap(null); if (didSave) setSaved(true); }}
        />
      )}
    </>
  );
}
