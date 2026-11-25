import { FULL_WORKOUT_MIN_SEC } from '../../engine/templates';
import type { Settings } from '../../data/types';
import { BurnSessionScreen } from './BurnSessionScreen';
import { BurnScreen } from './BurnScreen';
import { CssTestScreen } from './CssTestScreen';
import { RunScreen } from './RunScreen';
import { SwimScreen } from './SwimScreen';

export function CardioRoutes({ route }: { route: string; settings: Settings }) {
  const [area, sub, id] = route.split('/').filter(Boolean);
  if (area === 'burn' && sub === 'session' && id) return <BurnSessionScreen key={id} sessionId={id} />;
  if (area === 'burn') return <BurnScreen key={route} minBudgetMin={FULL_WORKOUT_MIN_SEC / 60} />;
  if (area === 'run') return <RunScreen key={sub ?? 'easy'} {...(sub === 'easy' || sub === 'long' || sub === 'intervals' ? { initialKind: sub } : {})} />;
  if (area === 'swim' && sub === 'css') return <CssTestScreen />;
  return <SwimScreen />;
}
