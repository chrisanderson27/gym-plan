import { useMemo, useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { missingCoachedSchedule, workoutPreview } from '../../data/mixedSession';
import { saveOrderedWorkout, StaleWorkoutSaveError, WorkoutSaveError } from '../../data/templates';
import type { OrderedBlock, OrderedPrescription } from '../../data/types';
import { validAuthoredWorkout } from '../../data/validate';
import { WORKOUT_PRESETS } from '../../data/presets';
import { copyWorkoutBlock, libraryWorkoutBlock, runWorkoutChoices, starterWorkoutBlocks, strengthWorkoutChoices, workoutBlockContent } from '../../data/workoutChoices';
import { moveBlock, shortfallLabel, workoutShortfallSec } from '../../engine/templates';
import { BlocksIcon, BookmarkIcon, CloseIcon, FlameIcon, LiftIcon, PlusIcon, RunIcon, SwapIcon, WindIcon } from '../icons';
import { NAME_MAX, orderedDurationLabel, workoutBlockKind, workoutBlockName } from '../labels';
import { Sheet } from '../Sheet';

const icons = { preparation: FlameIcon, strength: LiftIcon, coached: SwapIcon, 'self-paced': BlocksIcon, recovery: WindIcon, run: RunIcon };
type DraftBlock = { id: string; block: OrderedBlock; choiceId?: string };
const choiceKey = (block: { id: string }, source: string) => `${source}:${block.id}`;
const builtIns = starterWorkoutBlocks.map((block) => ({ id: choiceKey(block, 'starter'), block }));
const strengthChoices = strengthWorkoutChoices.map((block) => ({ id: choiceKey(block, 'strength'), block }));
const runChoices = runWorkoutChoices.map((block) => ({ id: choiceKey(block, 'run'), block }));
// Preset blocks give a short workout real work to extend with. Duplicates by content are listed once.
const presetChoices = (() => {
  const seen = new Set(builtIns.concat(runChoices).map(({ block }) => workoutBlockContent(block)));
  return WORKOUT_PRESETS.flatMap((preset) => preset.blocks.flatMap((block) => {
    const content = workoutBlockContent(block);
    if (block.kind === 'preparation' || block.kind === 'recovery' || block.kind === 'strength' || block.kind === 'run' || seen.has(content)) return [];
    seen.add(content);
    return [{ id: choiceKey({ id: `${preset.id}:${block.id}` }, 'preset'), block }];
  }));
})();

export function WorkoutEditor({ edit, initial, onSaved, onClose, fallbackFocus }: {
  edit?: { id: string; baseline: OrderedPrescription }; initial?: OrderedPrescription; onSaved?: (id: string) => void;
  onClose: () => void; fallbackFocus: () => HTMLElement | null;
}) {
  const start = edit?.baseline ?? initial;
  const label = edit ? 'Edit workout' : 'Build a workout';
  const [name, setName] = useState(start?.name ?? '');
  const [selected, setSelected] = useState<DraftBlock[]>(() => start?.blocks.map((block) => ({ id: block.id, block })) ?? []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [moreStrength, setMoreStrength] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const library = useLiveQuery(async () => {
    const rows = await db.libraryBlocks.toArray();
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, []);
  const choices = useMemo(() => [
    ...builtIns,
    ...(library ?? []).map((source) => ({ id: choiceKey(source, 'library'), block: libraryWorkoutBlock(source) })),
    ...runChoices,
    ...(moreStrength ? [...strengthChoices, ...presetChoices] : []),
  ], [library, moreStrength]);
  const rows = useMemo(() => {
    // Keep a source row paired to the same copy when the workout order changes.
    const candidates = [...selected].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const fingerprints = new Map(selected.map(({ id, block }) => [id, workoutBlockContent(block)]));
    const matched = new Set<string>();
    return choices.map((choice) => {
      const content = workoutBlockContent(choice.block);
      const entry = candidates.find((item) => !matched.has(item.id) && (item.choiceId
        ? item.choiceId === choice.id : content !== undefined && fingerprints.get(item.id) === content));
      if (entry) matched.add(entry.id);
      return { ...choice, entry, updated: !!entry && (content === undefined || content !== fingerprints.get(entry.id)) };
    }).concat(selected.filter((item) => !matched.has(item.id))
      .map((entry) => ({ id: entry.id, block: entry.block, entry, updated: false })));
  }, [choices, selected]);
  const blocks = useMemo(() => selected.map((item) => item.block), [selected]);
  const gym = useLiveQuery(async () => ({ blocks, demos: await workoutPreview(db, blocks) }), [blocks]);
  const ordered = { name: name.trim().slice(0, NAME_MAX), blocks };
  const shortfall = workoutShortfallSec(blocks);
  const canSave = validAuthoredWorkout(ordered) && shortfall === 0;
  const hasRun = blocks.some((block) => block.kind === 'run');
  const full = selected.length >= 30;

  const copy = (source: OrderedBlock, id: string): DraftBlock => {
    const block = copyWorkoutBlock(source);
    return { block, id: block.id, choiceId: id };
  };

  const submit = async (asNew = false) => {
    if (pending.current || !canSave) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const id = await saveOrderedWorkout(db, ordered, asNew ? undefined : edit);
      onSaved?.(id);
      onClose();
    } catch (reason) {
      setConflict(reason instanceof StaleWorkoutSaveError);
      setError(reason instanceof WorkoutSaveError ? reason.message : 'Could not save the workout. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const close = () => { if (!pending.current) onClose(); };

  return (
    <Sheet label={label} onClose={close} placement="top" fallbackFocus={fallbackFocus}>
      <form class="workout-editor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header class="workout-dialog-head">
          <div><p class="pref-eyebrow">My Workouts</p><h2>{label}</h2></div>
          <button type="button" class="workout-close" aria-label="Close workout builder" disabled={busy} onClick={close}><CloseIcon /></button>
        </header>
        <label class="workout-name">Workout name
          <input ref={nameInput} required maxLength={NAME_MAX} placeholder="e.g. Friday Strength" value={name} onInput={(event) => setName(event.currentTarget.value)} />
        </label>
        <h3>Add blocks in workout order</h3>
        <ul class="workout-choices" aria-label="Workout blocks">
          {rows.map(({ id, block: source, entry, updated }) => {
            const block = entry?.block ?? source;
            const Icon = icons[block.kind];
            const title = workoutBlockName(block);
            const index = entry ? selected.indexOf(entry) : -1;
            const open = !!entry && expanded === entry.id;
            const triggerId = `pick-${entry?.id ?? id}`;
            const repair = missingCoachedSchedule(block);
            const invalid = !repair && !!entry && !validAuthoredWorkout({ name: title, blocks: [block] });
            const warnings = gym?.blocks === blocks && index >= 0 ? gym.demos[index]?.filter((demo) => demo.status) : [];
            const canCopy = entry && id !== entry.id;
            const focusTrigger = () => document.getElementById(triggerId)?.focus();
            const move = (direction: -1 | 1) => {
              if (!entry) return;
              focusTrigger();
              setSelected((items) => moveBlock(items, entry.id, direction));
            };
            const remove = () => {
              setSelected((items) => items.filter((item) => item.id !== entry?.id));
              setExpanded(null);
              if (id === entry?.id) nameInput.current?.focus();
              else focusTrigger();
            };
            return (
              <li key={id} class="workout-choice" data-kind={block.kind}>
                <div class="workout-choice-row">
                  <span class="workout-kind-tile"><Icon /></span>
                  <div class="workout-choice-text"><strong>{title}</strong><small>{orderedDurationLabel([block])} · {workoutBlockKind[block.kind]}</small></div>
                  <button id={triggerId} type="button" class="workout-pick"
                    aria-label={entry ? `${title}, block ${index + 1}, actions` : `Add ${title}`}
                    aria-expanded={entry ? open : undefined} disabled={busy || (!entry && (full || (block.kind === 'run' && hasRun)))}
                    onClick={() => entry ? setExpanded(open ? null : entry.id) : setSelected((items) => [...items, copy(source, id)])}>
                    <span>{entry ? index + 1 : <PlusIcon />}</span>
                  </button>
                </div>
                {!entry && block.kind === 'run' && hasRun && <p class="workout-warning">One running segment per workout.</p>}
                {repair && <p class="workout-warning">Missing station schedule. Add a coached block with a schedule, then remove this block.</p>}
                {invalid && <p class="workout-warning">Invalid timing or targets. Remove this block and fix its prescription in Blocks.</p>}
                {!!warnings?.length && <p class="workout-warning">{[...new Set(warnings.map((demo) => demo.status))].join(' ')}</p>}
                {open && entry && <div class="workout-actions workout-choice-actions">
                  <button type="button" disabled={busy || index === 0} onClick={() => move(-1)}>Move up</button>
                  <button type="button" disabled={busy || index === selected.length - 1} onClick={() => move(1)}>Move down</button>
                  <button type="button" disabled={busy} onClick={remove}>Remove</button>
                  {canCopy && <button type="button" disabled={busy || full} onClick={() => setSelected((items) => [...items, copy(source, id)])}>Add another</button>}
                  {updated && <button type="button" disabled={busy} onClick={() => {
                    const replacement = copy(source, id);
                    setSelected((items) => items.map((item) => item.id === entry.id ? replacement : item));
                    setExpanded(null);
                    focusTrigger();
                  }}>Replace with current block</button>}
                </div>}
              </li>
            );
          })}
          {!moreStrength && <li><button type="button" class="workout-more" onClick={() => setMoreStrength(true)}>More strength blocks</button></li>}
        </ul>
        <p class="workout-floor" role="status" aria-live="polite" data-short={shortfall > 0 ? 'true' : 'false'}>
          {shortfall > 0 ? `Add at least ${shortfallLabel(shortfall)} to reach 45 minutes.` : 'Meets the 45-minute minimum.'}
        </p>
        {error && <p class="workout-error" role="alert">{error}</p>}
        {conflict && <button type="button" disabled={!canSave || busy} onClick={() => submit(true)}>Save as new workout</button>}
        <button type="submit" class="primary workout-save" disabled={!canSave || busy}><BookmarkIcon />Save workout</button>
      </form>
    </Sheet>
  );
}
