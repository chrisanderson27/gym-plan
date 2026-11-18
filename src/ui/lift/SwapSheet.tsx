import { exerciseById } from '../../content';
import { LIFT_EXERCISES } from '../../data/lift';
import type { ExerciseOverride } from '../../data/types';
import { swapCandidates } from '../../engine/lift/generator';

export function SwapSheet({
  exerciseId,
  overrides,
  exclude,
  onPick,
  onClose,
}: {
  exerciseId: string;
  overrides: Map<string, ExerciseOverride>;
  exclude: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const options = swapCandidates(exerciseId, LIFT_EXERCISES, overrides, { exclude });
  return (
    <div class="sheet" role="dialog" aria-label="Swap exercise">
      <h2>Swap</h2>
      {options.length === 0 && <p class="dim">No alternatives available.</p>}
      {options.map((id) => (
        <button key={id} type="button" data-testid={`swap-${id}`} onClick={() => onPick(id)}>
          {exerciseById.get(id)?.name ?? id}
        </button>
      ))}
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}
