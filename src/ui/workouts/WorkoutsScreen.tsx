import { useMemo, useRef, useState } from 'preact/hooks';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { missingCoachedSchedule } from '../../data/mixedSession';
import { editableLiftTemplate, listMine, saveOrderedWorkout } from '../../data/templates';
import type { OrderedPrescription, Settings, Template } from '../../data/types';
import { copyWorkoutBlock, matchingSuggestion, suggestedWorkouts } from '../../data/workoutChoices';
import { localDate } from '../../engine/dates';
import { orderedDurationMin, templateDurationMin } from '../../engine/templates';
import { weekIndex } from '../../engine/week';
import { BookmarkIcon, CalendarIcon, HistoryIcon, PlayIcon, PlusIcon } from '../icons';
import { ALL_TEMPLATE_TYPES } from '../mine/MineRow';
import { MoreMenu } from '../MoreMenu';
import { OrderedStart } from './OrderedStart';
import { WorkoutEditor } from './WorkoutEditor';
import { WorkoutPreview } from './WorkoutPreview';

type Suggestion = (typeof suggestedWorkouts)[number];
type Preview = { ordered: OrderedPrescription; id?: string; suggestion?: Suggestion; removed?: boolean };
type Overlay = { preview: Preview } | { edit?: { id: string; baseline: OrderedPrescription } };
const legacyCategory = { lift: 'Strength', custom: 'Strength', burn: 'Burn', run: 'Run', swim: 'Swim', hybrid: 'Hybrid' };

export function WorkoutsScreen({ settings }: { settings: Settings }) {
  const rows = useLiveQuery(() => listMine(db, ALL_TEMPLATE_TYPES), []);
  const matches = useMemo(() => new Map(rows?.flatMap((row) => row.ordered
    ? [[row.id, matchingSuggestion(row.ordered)] as const] : [])), [rows]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(false);
  const newWorkout = useRef<HTMLButtonElement>(null);
  const fallbackFocus = () => newWorkout.current;
  const close = () => { if (!pending.current) setOverlay(null); };

  const saveSuggestion = async (suggestion: Suggestion, showPreview: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(suggestion.name);
    setSaveError(null);
    const ordered = { name: suggestion.name, blocks: suggestion.blocks.map((block) => copyWorkoutBlock(block)) };
    try {
      const id = await saveOrderedWorkout(db, ordered);
      if (showPreview) setOverlay({ preview: { ordered, id } });
    } catch {
      setSaveError(suggestion.name);
    } finally {
      pending.current = false;
      setSaving(null);
    }
  };

  function card(row: { ordered?: OrderedPrescription; template?: Template; suggestion?: Suggestion }) {
    const { template, suggestion } = row;
    const ordered = row.ordered ?? suggestion;
    const match = template ? matches.get(template.id) : suggestion;
    const name = template?.name ?? suggestion!.name;
    const count = ordered?.blocks.length ?? template!.blocks.length;
    const duration = ordered ? orderedDurationMin(ordered.blocks) : templateDurationMin(template!.blocks);
    const url = template && `#/mine/${template.id}`;
    const preview = () => {
      if (ordered) setOverlay({ preview: { ordered, id: template?.id, suggestion } });
    };
    const needsRepair = ordered?.blocks.some(missingCoachedSchedule);
    return (
      <article class="workout-card" key={template?.id ?? name} aria-label={name}>
        <p class="pref-eyebrow">{match?.category ?? (template && !ordered ? legacyCategory[template.type] : 'Custom workout')}</p>
        <h3>{name}</h3>
        {match && <p class="workout-description">{match.description}</p>}
        <p class="workout-meta"><HistoryIcon />{duration > 0 && `${duration} min · `}{count} {count === 1 ? 'block' : 'blocks'}</p>
        {needsRepair && <p class="workout-warning">Needs a station schedule. Open Preview to edit.</p>}
        <div class="workout-actions">
          {suggestion ? <button type="button" class="primary" disabled={!!saving} onClick={() => saveSuggestion(suggestion, false)}><BookmarkIcon />Save workout</button>
            : ordered && template ? <OrderedStart source={{ templateId: template.id }} ordered={ordered} disabled={needsRepair}><PlayIcon />Start workout</OrderedStart>
              : <a class="btn primary" href={url}><PlayIcon />Start workout</a>}
          {ordered ? <button type="button" class="workout-preview-action" disabled={!!saving} onClick={preview}>Preview</button>
            : <a class="btn workout-preview-action" href={url}>Preview</a>}
          {template && editableLiftTemplate(template) && <a class="btn" href={`#/builder/${template.id}`}>Edit</a>}
          {suggestion && saveError === name && <p class="workout-error" role="alert">Could not save the workout. Try again.</p>}
        </div>
      </article>
    );
  }

  const preview = overlay && 'preview' in overlay ? overlay.preview : null;
  const repair = preview?.ordered.blocks.some(missingCoachedSchedule);
  const refreshPreview = async (id: string, shown: OrderedPrescription) => {
    const row = await db.templates.get(id);
    setOverlay((current) => current && 'preview' in current && current.preview.ordered === shown
      ? { preview: row?.ordered ? { id, ordered: row.ordered } : { ...current.preview, removed: true } } : current);
  };

  return (
    <main class="screen shell-screen workouts">
      <header class="pref-top">
        <div class="pref-brand">
          <span class="pref-mark" aria-hidden="true"><svg width="16" height="19" viewBox="0 0 16 19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
          <p class="wordmark">Gym Plan.</p>
        </div>
        <p class="week-chip"><CalendarIcon />Week {weekIndex(localDate(new Date()), settings.programStart)}</p>
      </header>
      <p class="pref-eyebrow"><span class="workout-dot" />Training library</p>
      <h1>My Workouts</h1>
      <p class="pref-lead">Repeat a favorite or put together a class of your own.</p>
      <button type="button" class="primary workout-new" ref={newWorkout} onClick={() => setOverlay({})}><PlusIcon />New workout</button>
      <section class="workout-saved" aria-label="Saved workouts">
        {rows?.length === 0 && <div class="workout-card"><h2>No saved workouts yet</h2><p>Build one or save a suggestion below.</p></div>}
        {rows?.map((template) => card({ template, ordered: template.ordered }))}
      </section>
      <section class="workout-suggested" aria-labelledby="suggested-workouts">
        <h2 id="suggested-workouts">Suggested workouts</h2>
        {suggestedWorkouts.map((suggestion) => card({ suggestion }))}
      </section>
      <footer class="workout-footer"><MoreMenu feedback={{ kind: 'workout', context: {} }} /></footer>
      {overlay && !('preview' in overlay) && <WorkoutEditor edit={overlay.edit} onClose={close} fallbackFocus={fallbackFocus} />}
      {preview && <WorkoutPreview ordered={preview.ordered} onClose={close} fallbackFocus={fallbackFocus}>
        {preview.removed ? <p class="workout-error" role="alert">This workout was removed.</p> : preview.id ? (
          <>
            <OrderedStart source={{ templateId: preview.id }} ordered={preview.ordered} disabled={repair}
              onStale={() => refreshPreview(preview.id!, preview.ordered)}><PlayIcon />Start workout</OrderedStart>
            <button type="button" onClick={() => setOverlay({ edit: { id: preview.id!, baseline: preview.ordered } })}>Edit workout</button>
          </>
        ) : preview.suggestion && (
          <>
            <button type="button" class="primary" disabled={!!saving} onClick={() => saveSuggestion(preview.suggestion!, true)}><BookmarkIcon />Save workout</button>
            {saveError === preview.suggestion.name && <p class="workout-error" role="alert">Could not save the workout. Try again.</p>}
          </>
        )}
      </WorkoutPreview>}
    </main>
  );
}
