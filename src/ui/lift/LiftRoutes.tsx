import type { LiftVariant, Settings } from '../../data/types';
import { GymScreen } from './GymScreen';
import { LiftHome } from './LiftHome';
import { SessionScreen } from './SessionScreen';
import { VolumeScreen } from './VolumeScreen';

const VARIANTS: LiftVariant[] = ['upper-a', 'upper-b', 'lower-a', 'lower-b'];

export function LiftRoutes({ route }: { route: string; settings: Settings }) {
  const parts = route.split('/').filter(Boolean); // ['lift', ...]
  const [, sub, arg] = parts;
  if (sub === 'calibrate' && VARIANTS.includes(arg as LiftVariant)) return <LiftHome autoStart={arg as LiftVariant} />;
  if (sub === 'session' && arg) return <SessionScreen sessionId={arg} />;
  if (sub === 'volume') return <VolumeScreen />;
  if (sub === 'gym') return <GymScreen />;
  return <LiftHome />;
}
