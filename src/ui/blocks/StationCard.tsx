import { exerciseById, PER_SIDE_IDS } from '../../content';
import { POSES } from '../../content/poses';
import { exerciseName } from '../labels';
import { SwapIcon } from '../icons';
import { PosePlaybackButton, PoseView } from '../slots/PoseView';
import { stationGearLabel } from './gearLabel';

export function stationTargetLine(exerciseId: string, amount: string | number, unit: string, load?: string | number) {
  const side = unit === 'reps' && PER_SIDE_IDS.has(exerciseId) ? ' / side' : '';
  return `${amount} ${unit}${side}${Number(load) ? ` · ${load} lb` : ''}`;
}

export function StationCard({ exerciseId, equipmentId, equipmentName, poseId, index, target, playing, onPlay, onSwap, disabled, status, marker, interval }: {
  exerciseId: string;
  equipmentId?: string;
  equipmentName?: string;
  poseId?: string;
  index: number;
  target: string;
  playing: boolean;
  onPlay: () => void;
  onSwap?: () => void;
  disabled?: boolean;
  status?: string;
  marker?: 'Now' | 'Next';
  interval?: number;
}) {
  const name = exerciseName(exerciseId);
  const exercise = exerciseById.get(exerciseId);
  const pose = poseId ? POSES[poseId] : undefined;
  const gear = equipmentName ?? stationGearLabel(exercise ?? { id: exerciseId, equipment: [] });
  return (
    <article class="gym-card" data-exercise-id={exerciseId} data-equipment-id={equipmentId} data-marker={marker}>
      <div class="station-card-head">
        <p class="gym-idx">{String(index + 1).padStart(2, '0')}</p>
        {marker && <span class="mixed-eyebrow num">{marker}</span>}
        {onSwap && <button type="button" class="station-swap" aria-label={`Swap ${name}`} disabled={disabled} onClick={onSwap}><SwapIcon /></button>}
      </div>
      <PoseView key={`${exerciseId}:${equipmentId}:${poseId}`} exerciseId={exerciseId} poseId={poseId} running={playing} />
      <h3>{name}</h3>
      <p class="gym-meta">{gear}</p>
      {(target || interval !== undefined) && <p class="gym-target">{target}{interval !== undefined && <span class="gym-work">{interval} sec work</span>}</p>}
      {status && <p class="gym-meta">{status}</p>}
      {pose && <PosePlaybackButton name={name} playing={playing} onPlay={onPlay} />}
    </article>
  );
}
