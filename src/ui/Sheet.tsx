import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Safari does not focus a button on click, so activeElement can be <body> when a sheet opens: remember the last clicked control as the trigger.
let lastTrigger: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => { lastTrigger = (e.target as Element | null)?.closest<HTMLElement>('button, a[href]') ?? null; }, true);
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

/** Marks everything outside `keep` (the dialog and its backdrop) inert, walking up so the sheet may sit anywhere in the tree. */
function inertBackground(keep: Element[]): () => void {
  const marked: Element[] = [];
  let node: Element | null = keep[0] ?? null;
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
  return () => marked.forEach((el) => el.removeAttribute('inert'));
}

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

  useEffect(() => {
    const current = document.activeElement as HTMLElement | null;
    const opener = current && current !== document.body ? current : lastTrigger;
    const dialog = ref.current;
    lockScroll();
    const restoreInert = dialog ? inertBackground([dialog, ...(backdropRef.current ? [backdropRef.current] : [])]) : () => {};
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
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
      restoreInert();
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
