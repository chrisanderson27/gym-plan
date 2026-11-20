import type { MenuItem } from '../MoreMenu';

type Action = () => void;
type WorkoutActions = { onFinish?: Action; onDiscard?: Action };

function item(id: string, label: string, onSelect?: Action): MenuItem[] {
  return onSelect ? [{ id, label, onSelect }] : [];
}

function workoutItems({ onFinish, onDiscard }: WorkoutActions): MenuItem[] {
  return [
    ...item('finish-now', 'Finish workout', onFinish),
    ...item('discard', 'Discard workout', onDiscard),
  ];
}

export function exerciseChangeItems(actions: WorkoutActions & {
  onSwap?: Action;
  onEquipment?: Action;
  onNotAtMyGym?: Action;
  onUndo?: Action;
  onPain?: Action;
}): MenuItem[] {
  return [
    ...item('swap', 'Swap exercise', actions.onSwap),
    ...item('equipment', 'Equipment', actions.onEquipment),
    ...item('not-at-gym', 'Not at my gym', actions.onNotAtMyGym),
    ...item('undo-set', 'Undo last set', actions.onUndo),
    ...item('pain', 'Pain on last set', actions.onPain),
    ...workoutItems(actions),
  ];
}

export function blockChangeItems(actions: WorkoutActions & {
  onEndBlock?: Action;
  onSkipBlock?: Action;
  onNotAtMyGym?: Action;
}): MenuItem[] {
  return [
    ...item('end-block', 'End block', actions.onEndBlock),
    ...item('skip-block', 'Skip block', actions.onSkipBlock),
    ...item('not-at-gym', 'Not at my gym', actions.onNotAtMyGym),
    ...workoutItems(actions),
  ];
}
