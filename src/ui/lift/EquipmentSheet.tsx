import { useState } from 'preact/hooks';
import { defaultEquipmentFor, exerciseById } from '../../content';
import { db } from '../../data/db';
import { updateEquipmentSteps } from '../../data/lift';
import type { Equipment } from '../../data/types';

export function EquipmentSheet({
  exerciseId,
  currentId,
  equipment,
  onChoose,
  onClose,
}: {
  exerciseId: string;
  currentId: string;
  equipment: Map<string, Equipment>;
  onChoose: (equipmentId: string) => void;
  onClose: () => void;
}) {
  const ex = exerciseById.get(exerciseId);
  const seedIds = [...new Set((ex?.equipment ?? []).map(defaultEquipmentFor))];
  const instances = [...equipment.values()].filter((e) => !e.builtin && ex && e.name.startsWith(`${ex.name} — `)).map((e) => e.id);
  const options = [...new Set([currentId, ...seedIds, ...instances])].filter((id) => equipment.has(id));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [by, setBy] = useState('');
  const [error, setError] = useState('');

  const saveSteps = async () => {
    const f = Number(from), t = Number(to), b = Number(by);
    if (!(b > 0) || !(t >= f) || from === '' || to === '') {
      setError('Enter from, to and a step greater than 0');
      return;
    }
    const steps: number[] = [];
    for (let v = f; v <= t + 1e-9; v += b) steps.push(Math.round(v * 100) / 100);
    try {
      await updateEquipmentSteps(db, currentId, steps);
      setError('');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div class="sheet" role="dialog" aria-label="Equipment">
      <h2>Equipment</h2>
      {options.map((id) => (
        <button key={id} type="button" class={id === currentId ? 'chip on' : 'chip'} onClick={() => onChoose(id)}>
          {equipment.get(id)?.name}
        </button>
      ))}
      <h3>Edit steps for {equipment.get(currentId)?.name}</h3>
      <label>From<input inputMode="decimal" value={from} onInput={(e) => setFrom(e.currentTarget.value)} /></label>
      <label>To<input inputMode="decimal" value={to} onInput={(e) => setTo(e.currentTarget.value)} /></label>
      <label>By<input inputMode="decimal" value={by} onInput={(e) => setBy(e.currentTarget.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={saveSteps}>Save steps</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
