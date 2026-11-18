import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { createModalStack } from './modalStack';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Safari does not focus a button on click (and may leave an old input as activeElement), so the opener is the control whose
// click opened the sheet, recorded at click time. A click only counts as the opener for a short window.
const TRIGGER_WINDOW_MS = 1000;
let lastTrigger: HTMLElement | null = null;
let lastTriggerAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    lastTrigger = (e.target as Element | null)?.closest<HTMLElement>('button, a[href]') ?? null;
    lastTriggerAt = Date.now();
  }, true);
}
function recentTrigger(): HTMLElement | null {
  return lastTrigger && Date.now() - lastTriggerAt < TRIGGER_WINDOW_MS && document.contains(lastTrigger) ? lastTrigger : null;
}

let lockCount = 0;
let lockedY = 0;

/** Freezes the page behind a sheet (iOS-safe: the body is pinned at the current offset) and restores the scroll position. */
function lockScroll() {
  if (lockCount++ > 0) return;
  lockedY = window.scrollY;
  document.body.style.top = `-${lockedY}px`;
  document.documentElement.classList.add('sheet-lock');
}
function unlockScroll() {
  if (--lockCount > 0) return;
  document.documentElement.classList.remove('sheet-lock');
  document.body.style.top = '';
  window.scrollTo(0, lockedY);
}

interface Modal { dialog: HTMLElement; backdrop: HTMLElement | null }

// Inert is owned by the stack: every mark we made is cleared and re-applied for the current top modal, so a nested sheet's
// container is never inert, closing the inner one re-opens the outer, and the page is released only when the last one closes.
let marked: Element[] = [];
const stack = createModalStack<Modal>({
  clear() {
    marked.forEach((el) => el.removeAttribute('inert'));
    marked = [];
  },
  /** Marks everything outside the top modal (dialog + backdrop) inert, walking up so the sheet may sit anywhere in the tree. */
  mark({ dialog, backdrop }) {
    const keep: Element[] = [dialog, ...(backdrop ? [backdrop] : [])];
    let node: Element | null = dialog;
    while (node && node !== document.body) {
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      for (const sib of Array.from(parent.children)) {
        if (keep.includes(sib) || sib === node || sib.hasAttribute('inert') || sib.tagName === 'SCRIPT') continue;
        sib.setAttribute('inert', '');
        marked.push(sib);
      }
      node = parent;
    }
  },
});

/**
 * Bottom-sheet overlay: fixed to the viewport bottom over a dimmed backdrop, so it opens where the user tapped.
 * Modal: Tab cycles inside it, the page behind is inert and does not scroll. Focus moves in on open and returns to the opener
 * on close; Esc and the backdrop close it.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Layout effect: the key trap and inert background must be live in the same frame the dialog appears (no gap for Tab to escape).
  useLayoutEffect(() => {
    const current = document.activeElement as HTMLElement | null;
    // The control whose click opened this sheet wins; otherwise (keyboard / programmatic open) whatever had focus.
    const opener = recentTrigger() ?? (current && current !== document.body ? current : null);
    const dialog = ref.current;
    const modal: Modal | null = dialog ? { dialog, backdrop: backdropRef.current } : null;
    lockScroll();
    if (modal) stack.push(modal);
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (modal && !stack.isTop(modal)) return; // only the top-most sheet handles keys
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      // Fallback for engines without `inert`: cycle focus by hand.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      const active = document.activeElement;
      // Always driven by hand (not just at the ends): engines differ on which controls Tab reaches, and the cycle must never leave the dialog.
      e.preventDefault();
      if (items.length === 0) {
        dialog.focus();
        return;
      }
      const at = active ? items.indexOf(active as HTMLElement) : -1;
      const next = at === -1 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next]!.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (modal) stack.remove(modal);
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <>
      <div ref={backdropRef} class="sheet-backdrop" data-testid="sheet-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div ref={ref} class="sheet overlay" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>
  );
}
