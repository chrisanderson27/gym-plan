import { resolvePlaying } from '../pose/playback';

export interface DemoCard { blockId: string; exerciseId: string; calibrating: boolean; hasPose: boolean }

/** One moving figure per surface: the lone focus card, else the first calibrating card with a pose. */
export function demoLineup(cards: readonly DemoCard[], candidateId: string | undefined) {
  const shown = cards.length === 1 && candidateId ? cards.filter((c) => c.blockId === candidateId) : cards.filter((c) => c.calibrating);
  return shown.filter((c) => c.hasPose).map((c) => c.exerciseId);
}

export const playingIn = (ids: readonly string[]) => ids.filter((id) => resolvePlaying({ scope: 'lift-step', ids, choice: null }) === id);
