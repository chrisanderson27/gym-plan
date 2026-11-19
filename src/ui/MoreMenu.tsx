import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FeedbackRow } from '../data/types';
import { FeedbackSheet } from './feedback/FeedbackSheet';
import { MoreIcon } from './icons';
import { Sheet } from './Sheet';

export type FeedbackContext = FeedbackRow['context'];

export interface MenuItem {
  id: string;
  label: string;
  icon?: ComponentChildren;
  onSelect: () => void;
}

type Feedback = { kind: 'workout' | 'exercise' | 'set'; context: FeedbackContext };

export function snapshotContext(context: FeedbackContext, screen: string): FeedbackContext {
  return { ...context, screen };
}

export function MoreMenu({ items = [], feedback }: { items?: MenuItem[]; feedback?: Feedback }) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<FeedbackContext | null>(null);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!saved) return;
    const timeout = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timeout);
  }, [saved]);

  return (
    <>
      <button ref={trigger} type="button" class="more" data-testid="more" aria-label="More" aria-haspopup="dialog"
        onClick={() => setOpen(true)}><MoreIcon /></button>
      {saved && <span role="status" class="fb-saved">Feedback saved</span>}
      {open && (
        <Sheet label="More" onClose={() => setOpen(false)}>
          <h2>More</h2>
          <div class="sheet-options">
            {items.map(({ id, label, icon, onSelect }) => (
              <button key={id} type="button" class="btn" data-testid={`more-${id}`} onClick={() => { setOpen(false); onSelect(); }}>
                {icon}{label}
              </button>
            ))}
            {feedback && (
              <button type="button" class="btn" data-testid="more-feedback" onClick={() => {
                const { context } = feedback;
                setSnap(snapshotContext(context, location.hash || '#/'));
                setOpen(false);
              }}>Feedback</button>
            )}
          </div>
          <button type="button" class="btn" onClick={() => setOpen(false)}>Close</button>
        </Sheet>
      )}
      {snap && feedback && (
        <FeedbackSheet kind={feedback.kind} context={snap} onClose={(didSave) => {
          setSnap(null);
          if (didSave) setSaved(true);
          requestAnimationFrame(() => trigger.current?.focus());
        }} />
      )}
    </>
  );
}
