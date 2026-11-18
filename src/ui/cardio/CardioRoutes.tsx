import type { Settings } from '../../data/types';
import { BurnScreen } from './BurnScreen';
import { CssTestScreen } from './CssTestScreen';
import { RunScreen } from './RunScreen';
import { SwimScreen } from './SwimScreen';

export function CardioRoutes({ route }: { route: string; settings: Settings }) {
  const [area, sub] = route.split('/').filter(Boolean);
  if (area === 'burn') return <BurnScreen />;
  if (area === 'run') return <RunScreen {...(sub === 'easy' || sub === 'long' || sub === 'intervals' ? { initialKind: sub } : {})} />;
  if (area === 'swim' && sub === 'css') return <CssTestScreen />;
  return <SwimScreen />;
}
