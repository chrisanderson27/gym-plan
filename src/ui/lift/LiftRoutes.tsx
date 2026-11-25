import type { Settings } from '../../data/types';
import { SessionScreen } from './SessionScreen';

/** Only the legacy resume route is left: every standalone lift chooser redirects in canonicalRoute. */
export function LiftRoutes({ route }: { route: string; settings: Settings }) {
  const [, sub, arg] = route.split('/').filter(Boolean);
  return sub === 'session' && arg ? <SessionScreen key={arg} sessionId={arg} /> : null;
}
