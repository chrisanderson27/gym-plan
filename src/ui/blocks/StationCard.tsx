import { exerciseById } from '../../content';
import { POSES } from '../../content/poses';
import { exerciseName } from '../labels';
import { PauseIcon, PlayIcon, SwapIcon } from '../icons';
import { StickFigure } from '../pose/StickFigure';
import { PoseView } from '../slots/PoseView';
import { stationGearLabel } from './gearLabel';

const PER_SIDE = new Set(['reverse-lunge', 'step-up', 'bulgarian-split-squat', 'dead-bug']);

export function stationTargetLine(exerciseId: string, amount: string | number, unit: string, load?: string | number) {
  const side = unit === 'reps' && PER_SIDE.has(exerciseId) ? ' / side' : '';
  return `${amount} ${unit}${side}${Number(load) ? ` · ${load} lb` : ''}`;
}

export function StationCard({ exerciseId, equipmentId, poseId, index, target, playing, onPlay, onSwap, disabled, status }: {
  exerciseId: string;
  equipmentId?: string;
  poseId?: string;
  index: number;
  target: string;
  playing: boolean;
  onPlay: () => void;
  onSwap?: () => void;
  disabled?: boolean;
  status?: string;
}) {
  const name = exerciseName(exerciseId);
  const exercise = exerciseById.get(exerciseId);
  const pose = poseId ? POSES[poseId] : undefined;
  const gear = stationGearLabel(exercise ?? { id: exerciseId, equipment: [] });
  return (
    <article class="gym-card" data-exercise-id={exerciseId} data-equipment-id={equipmentId}>
      <div class="station-card-head">
        <p class="gym-idx">{String(index + 1).padStart(2, '0')}</p>
        {onSwap && <button type="button" class="station-swap" aria-label={`Swap ${name}`} disabled={disabled} onClick={onSwap}><SwapIcon /></button>}
      </div>
      {pose && <StickFigure key={`${exerciseId}:${equipmentId}:${poseId}`} def={pose} label={name} testId={`pose-${exerciseId}`} running={playing} />}
      <PoseView exerciseId={exerciseId} />
      <h3>{name}</h3>
      <p class="gym-meta">{gear}</p>
      <p class="gym-target">{target}</p>
      {status && <p class="gym-meta">{status}</p>}
      {pose && (
        <button type="button" class="block-icon" aria-label={playing ? `Pause ${name}` : `Play ${name}`} aria-pressed={playing} onClick={onPlay}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
    </article>
  );
}
