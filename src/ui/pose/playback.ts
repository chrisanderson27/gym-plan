import { useEffect, useState } from 'preact/hooks';

/** What the user last chose on a surface. `ids` is the lineup an explicit pause applied to. */
export interface PlaybackChoice { scope: string; id: string | null; ids: string }

export interface PlaybackInput { scope: string; ids: readonly string[]; active?: string | null; choice: PlaybackChoice | null }

/**
 * One moving figure per surface. A choice survives only within its scope: an explicit pause until the lineup changes,
 * and a picked card while it is still shown. Otherwise the active (or first) card plays.
 */
export function resolvePlaying({ scope, ids, active, choice }: PlaybackInput): string | null {
  if (choice && choice.scope === scope) {
    if (choice.id === null ? choice.ids === ids.join('|') : ids.includes(choice.id)) return choice.id;
  }
  return active && ids.includes(active) ? active : ids[0] ?? null;
}

export function nextChoice(input: Omit<PlaybackInput, 'choice'> & { choice: PlaybackChoice | null }, id: string): PlaybackChoice {
  const playing = resolvePlaying(input);
  return { scope: input.scope, id: playing === id ? null : id, ids: input.ids.join('|') };
}

/** Demo playback state for one surface. It never touches the clock, drafts or logged results. */
export function useDemoPlayback(scope: string, ids: readonly string[], active?: string | null) {
  const [choice, setChoice] = useState<PlaybackChoice | null>(null);
  const input = { scope, ids, active, choice };
  return {
    playingId: resolvePlaying(input),
    toggle: (id: string) => setChoice(nextChoice(input, id)),
  };
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const prefersReduced = () => typeof matchMedia === 'function' && matchMedia(REDUCED).matches;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReduced);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}
