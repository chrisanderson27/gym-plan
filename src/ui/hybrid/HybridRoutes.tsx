import { SessionScreen } from '../lift/SessionScreen';
import { HybridCardioScreen } from './HybridCardioScreen';

export function HybridRoutes({ route }: { route: string }) {
  const [, sub, arg] = route.split('/').filter(Boolean);
  // The lift part is the ordinary session screen, so it keeps the demos and every level of feedback.
  if (sub === 'session' && arg) return <SessionScreen sessionId={arg} />;
  if (sub === 'cardio' && arg) return <HybridCardioScreen sessionId={arg} />;
  return null;
}
