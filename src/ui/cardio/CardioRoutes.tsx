import type { Settings } from '../../data/types';
import { BurnSessionScreen } from './BurnSessionScreen';
import { CssTestScreen } from './CssTestScreen';
import { SwimScreen } from './SwimScreen';

export function CardioRoutes({ route }: { route: string; settings: Settings }) {
  const [area, sub, id] = route.split('/').filter(Boolean);
  if (area === 'burn' && sub === 'session' && id) return <BurnSessionScreen key={id} sessionId={id} />;
  if (area === 'swim' && sub === 'css') return <CssTestScreen />;
  return <SwimScreen />;
}
