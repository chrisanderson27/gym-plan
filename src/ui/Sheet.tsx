import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * Bottom-sheet overlay: fixed to the viewport bottom over a dimmed backdrop, so it opens where the user tapped.
 * Focus moves into it on open and returns to the opener on close; Esc and the backdrop close it.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <>
      <div class="sheet-backdrop" data-testid="sheet-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div ref={ref} class="sheet overlay" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>
  );
}
