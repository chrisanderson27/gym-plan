import { useEffect, useState } from 'preact/hooks';
import { exerciseById } from '../../content';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { LIFT_EXERCISES } from '../../data/lift';
import { legacyWorkoutDraft } from '../../data/workoutChoices';
import { shortfallLabel, workoutShortfallSec } from '../../engine/templates';
import { editableLiftTemplate, saveBuilt, startFromBlocks, WorkoutSaveError } from '../../data/templates';
import type { LiftBlock } from '../../data/types';
import { TRACKED_MUSCLES } from '../../engine/config';
import { moveBlock, newLiftBlock, pairWithNext, removeBlock, unpair } from '../../engine/templates';
import { equipmentTagName, muscleName } from '../labels';
import { navigate } from '../router';
import { MoreMenu } from '../MoreMenu';

// Rep-based lifts only; the warm-up machines (repMax 0) are not builder material.
const CHOICES = [...LIFT_EXERCISES.values()].filter((e) => e.repMax > 0);
const EQUIPMENT = [...new Set(CHOICES.flatMap((e) => e.equipment))].sort((a, b) => equipmentTagName(a).localeCompare(equipmentTagName(b)));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n) || lo));

export function BuilderScreen({ templateId }: { templateId?: string }) {
  const [id, setId] = useState<string | undefined>(templateId);
  const [name, setName] = useState('');
  const [blocks, setBlocks] = useState<LiftBlock[]>([]);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equip, setEquip] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!templateId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!templateId) return;
    db.templates.get(templateId).then((t) => {
      if (editableLiftTemplate(t)) {
        setName(t.name);
        setBlocks(t.blocks.filter((b): b is LiftBlock => b.kind === 'lift'));
        setLoaded(true);
      } else setError('This workout cannot be edited in the lift builder. Find your workout in Workouts.');
    }).catch(() => setError('Could not load the workout.'));
  }, [templateId]);

  const results = CHOICES.filter((e) => {
    const n = exerciseById.get(e.id)?.name ?? e.id;
    return n.toLowerCase().includes(query.toLowerCase()) && (!muscle || e.primary.includes(muscle)) && (!equip || e.equipment.includes(equip));
  }).slice(0, 20);
  // The shared 45-minute floor uses the same estimate as Workouts, on the converted draft.
  const shortfall = workoutShortfallSec(legacyWorkoutDraft({ name, blocks }).draft.blocks);
  const ok = name.trim().length > 0 && blocks.length > 0 && shortfall === 0;
  const patch = (blockId: string, p: Partial<LiftBlock>) => setBlocks(blocks.map((b) => (b.id === blockId ? { ...b, ...p } : b)));

  const save = async () => saveBuilt(db, { ...(id ? { id } : {}), name, blocks });
  const submit = async (start: boolean) => {
    setBusy(true);
    setError('');
    try {
      const tid = await save();
      if (!start) return navigate('/progress');
      setId(tid);
      const sid = await startFromBlocks(db, { type: 'custom', blocks, templateId: tid, name });
      navigate('/lift/session/' + sid);
    } catch (reason) {
      setError(reason instanceof WorkoutSaveError ? reason.message : 'Could not save or start the workout. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <main class="screen"><h1>Build a session</h1>
    {error ? <p role="alert">{error}</p> : <p>Loading workout…</p>}
    <a class="btn" href="#/workouts">Workouts</a>
  </main>;

  return (
    <main class="screen">
      <header class="bar">
        <h1>Build a session</h1>
        <a class="gear" href="#/progress">Progress</a>
        <MoreMenu feedback={{ kind: 'workout', context: {} }} />
      </header>
      <label>
        Name
        <input data-testid="builder-name" value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        Search exercises
        <input data-testid="builder-search" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      <div class="chips">
        <select aria-label="Muscle" value={muscle} onChange={(e) => setMuscle(e.currentTarget.value)}>
          <option value="">Any muscle</option>
          {TRACKED_MUSCLES.map((m) => <option key={m} value={m}>{muscleName(m)}</option>)}
        </select>
        <select aria-label="Equipment" value={equip} onChange={(e) => setEquip(e.currentTarget.value)}>
          <option value="">Any equipment</option>
          {EQUIPMENT.map((m) => <option key={m} value={m}>{equipmentTagName(m)}</option>)}
        </select>
      </div>
      <ul class="plan">
        {results.map((e) => (
          <li key={e.id}>
            <span>{exerciseById.get(e.id)?.name ?? e.id}</span>
            <button type="button" data-testid={`builder-add-${e.id}`} disabled={blocks.some((b) => b.exerciseId === e.id)} onClick={() => setBlocks([...blocks, newLiftBlock({ id: e.id, repMin: e.repMin, repMax: e.repMax }, newId)])}>Add</button>
          </li>
        ))}
      </ul>
      <h2>Session ({blocks.length})</h2>
      {blocks.map((b, i) => (
        <section key={b.id} class={b.supersetGroup ? 'card superset' : 'card'} data-testid={`builder-block-${i}`}>
          <h2>{exerciseById.get(b.exerciseId)?.name ?? b.exerciseId}</h2>
          <div class="chips">
            <label>Sets
              <input type="number" inputMode="numeric" data-testid={`builder-sets-${i}`} value={b.sets} onInput={(e) => patch(b.id, { sets: clamp(Number(e.currentTarget.value), 1, 10) })} />
            </label>
            <label>Max reps
              <input type="number" inputMode="numeric" data-testid={`builder-repmax-${i}`} value={b.repMax} onInput={(e) => patch(b.id, { repMax: clamp(Number(e.currentTarget.value), b.repMin, 30) })} />
            </label>
          </div>
          <div class="chips">
            <button type="button" data-testid={`builder-up-${i}`} aria-label="Move up" onClick={() => setBlocks(moveBlock(blocks, b.id, -1))}>↑</button>
            <button type="button" data-testid={`builder-down-${i}`} aria-label="Move down" onClick={() => setBlocks(moveBlock(blocks, b.id, 1))}>↓</button>
            <button type="button" class={b.supersetGroup ? 'chip on' : 'chip'} data-testid={`builder-pair-${i}`} aria-pressed={!!b.supersetGroup}
              onClick={() => setBlocks(b.supersetGroup ? unpair(blocks, b.id) : pairWithNext(blocks, b.id, newId))}>
              {b.supersetGroup ? 'superset' : 'pair with next'}
            </button>
            <button type="button" data-testid={`builder-remove-${i}`} onClick={() => setBlocks(removeBlock(blocks, b.id))}>Remove</button>
          </div>
        </section>
      ))}
      {!ok && <p class="dim" data-testid="builder-hint">{name.trim().length === 0 ? 'Name your workout to start' : blocks.length === 0 ? 'Add an exercise to start' : `Add at least ${shortfallLabel(shortfall)} of work to reach 45 minutes`}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" class="primary" data-testid="builder-start" disabled={!ok || busy} onClick={() => submit(true)}>Start</button>
      <button type="button" data-testid="builder-save" disabled={!ok || busy} onClick={() => submit(false)}>Save</button>
    </main>
  );
}
