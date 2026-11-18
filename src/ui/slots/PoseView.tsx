import { exerciseById } from '../../content';
import { POSES } from '../../content/poses';
import { StickFigure } from '../pose/StickFigure';

/** Stick-figure demo when the exercise has a pose; its text cues otherwise. */
export function PoseView({ exerciseId, poseId }: { exerciseId: string; poseId?: string }) {
  const ex = exerciseById.get(exerciseId);
  const def = poseId ? POSES[poseId] : undefined;
  if (def) return <StickFigure def={def} label={ex?.name ?? exerciseId} testId={`pose-${exerciseId}`} />;
  const cues = ex?.cues ?? [];
  if (cues.length === 0) return null;
  return (
    <ul class="cues" data-testid={`cues-${exerciseId}`}>
      {cues.map((c) => <li key={c}>{c}</li>)}
    </ul>
  );
}
