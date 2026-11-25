import { exerciseById } from '../../content';
import { POSES } from '../../content/poses';
import { PauseIcon, PlayIcon } from '../icons';
import { StickFigure } from '../pose/StickFigure';

/** Stick-figure demo when the exercise has a pose; its text cues otherwise. */
export function PoseView({ exerciseId, poseId, running }: { exerciseId: string; poseId?: string; running?: boolean }) {
  const ex = exerciseById.get(exerciseId);
  const def = poseId ? POSES[poseId] : undefined;
  const figure = def && <StickFigure def={def} label={ex?.name ?? exerciseId} testId={`pose-${exerciseId}`} running={running} />;
  if (figure && running === undefined) return figure;
  const cues = ex?.cues ?? [];
  return (
    <>{figure}{cues.length > 0 && (
      <ul class="cues" data-testid={`cues-${exerciseId}`}>
        {cues.map((c) => <li key={c}>{c}</li>)}
      </ul>
    )}</>
  );
}

export function PosePlaybackButton({ name, playing, onPlay }: { name: string; playing: boolean; onPlay: () => void }) {
  return <button type="button" class="block-icon" aria-label={playing ? `Pause ${name}` : `Play ${name}`} aria-pressed={playing} onClick={onPlay}>
    {playing ? <PauseIcon /> : <PlayIcon />}
  </button>;
}
