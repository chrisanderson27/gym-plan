import { exerciseById } from '../../content';
import { LIFT_EXERCISES } from '../../data/lift';
import type { ExerciseOverride } from '../../data/types';
import { swapCandidates } from '../../engine/lift/generator';
import { Sheet } from '../Sheet';

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
    <Sheet label="Swap exercise" onClose={onClose}>
      <h2>Swap</h2>
      {options.length === 0 && <p class="dim">No alternatives available.</p>}
      <div class="sheet-options">
        {options.map((id) => (
          <button key={id} type="button" data-testid={`swap-${id}`} onClick={() => onPick(id)}>
            {exerciseById.get(id)?.name ?? id}
          </button>
        ))}
      </div>
      <button type="button" class="sheet-cancel" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}
