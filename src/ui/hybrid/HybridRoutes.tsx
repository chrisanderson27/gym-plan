import type { LiftVariant } from '../../data/types';
import { SessionScreen } from '../lift/SessionScreen';
import { HybridCardioScreen } from './HybridCardioScreen';
import { HybridScreen } from './HybridScreen';

const VARIANTS: LiftVariant[] = ['upper-a', 'upper-b', 'lower-a', 'lower-b'];

export function HybridRoutes({ route }: { route: string }) {
  const [, sub, arg] = route.split('/').filter(Boolean);
  // The lift part is the ordinary session screen, so it keeps the demos and every level of feedback.
  if (sub === 'session' && arg) return <SessionScreen sessionId={arg} />;
  if (sub === 'cardio' && arg) return <HybridCardioScreen sessionId={arg} />;
  return <HybridScreen {...(VARIANTS.includes(sub as LiftVariant) ? { initial: sub as LiftVariant } : {})} />;
}
