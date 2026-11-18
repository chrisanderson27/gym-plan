import type { Appearance } from '../data/types';

/** Mirror read by public/theme-init.js before first paint. Keep both in sync. */
export const APPEARANCE_KEY = 'gym-plan:appearance';

/** Sets <html data-theme> to the preference; CSS resolves 'system' via prefers-color-scheme. */
export function applyAppearance(a: Appearance): void {
  document.documentElement.dataset.theme = a;
  try {
    localStorage.setItem(APPEARANCE_KEY, a);
  } catch {
    /* storage blocked: attribute still applied */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--app-bar-bg').trim();
  // Best-effort: only a resolved colour is useful; a raw var() chain is skipped.
  if (meta && bar && !bar.startsWith('var(')) meta.setAttribute('content', bar);
}
