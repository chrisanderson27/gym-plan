import type { ComponentChildren } from 'preact';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { acceptedPlanNotes, missingCoachedSchedule, workoutPreview } from '../../data/mixedSession';
import type { OrderedPrescription } from '../../data/types';
import { stationWorkSec } from '../../engine/block/coached';
import { StationCard, stationTargetLine } from '../blocks/StationCard';
import { CloseIcon } from '../icons';
import { modalityName, orderedDurationLabel, runKindName, workoutBlockKind, workoutBlockName } from '../labels';
import { useDemoPlayback } from '../pose/playback';
import { Sheet } from '../Sheet';

export function WorkoutPreview({ ordered, onClose, fallbackFocus, children }: {
  ordered: OrderedPrescription; onClose: () => void; fallbackFocus: () => HTMLElement | null;
  children: ComponentChildren;
}) {
  const snapshot = useLiveQuery(async () => ({ ordered, demos: await workoutPreview(db, ordered.blocks) }), [ordered]);
  const notes = useLiveQuery(async () => ({ ordered, notes: await acceptedPlanNotes(db, ordered.blocks) }), [ordered]);
  const note = (index: number) => notes?.ordered === ordered ? notes.notes[index] : undefined;
  const demos = snapshot?.ordered === ordered ? snapshot.demos : undefined;
  const keyOf = (block: OrderedPrescription['blocks'][number], stationIndex: number, demo: { equipmentId?: string; poseId?: string }) => {
    const station = (block.kind === 'coached' || block.kind === 'self-paced') ? block.stations?.[stationIndex] : undefined;
    return `${block.id}:${station?.slotId ?? ''}:${demo.equipmentId ?? ''}:${demo.poseId ?? ''}`;
  };
  // One moving figure for the whole sheet: the first card in render order, unless the user picks another.
  const cardKeys = ordered.blocks.flatMap((block, index) => (demos?.[index] ?? []).flatMap((demo, i) => demo.poseId ? [keyOf(block, i, demo)] : []));
  const { playingId, toggle } = useDemoPlayback('workout-preview', cardKeys);

  return (
    <Sheet label={`Preview ${ordered.name}`} onClose={onClose} fallbackFocus={fallbackFocus}>
      <div class="workout-preview">
        <header class="workout-dialog-head">
          <div>
            <h2 class="workout-preview-name">{ordered.name}</h2>
            <p class="workout-meta">{orderedDurationLabel(ordered.blocks)} · {ordered.blocks.length} {ordered.blocks.length === 1 ? 'block' : 'blocks'}</p>
          </div>
          <button type="button" class="workout-close" aria-label="Close preview" onClick={onClose}><CloseIcon /></button>
        </header>
        <ol class="workout-preview-list">
          {ordered.blocks.map((block, index) => (
            <li key={block.id}>
              <h3>{workoutBlockName(block)}</h3>
              <p class="workout-meta">{workoutBlockKind[block.kind]} · {orderedDurationLabel([block])}</p>
              {block.kind === 'coached' && block.stations &&
                <p>{block.workSec} sec shared work · {block.restSec} sec rest · {block.transitionSec} sec transition</p>}
              {missingCoachedSchedule(block) && <p>Needs a station schedule. Edit to replace or remove this block.</p>}
              {(block.kind === 'preparation' || block.kind === 'recovery') && <p>{block.instructions}</p>}
              {note(index) && <p class="workout-warning" data-testid="accepted-plan-note">{note(index)}</p>}
              {block.kind === 'run' && <p>{runKindName(block.runKind)} · {modalityName(block.modality)} · {Math.round(block.durationSec / 60)} min planned. Your running limits can shorten what Start plans.</p>}
              <div class="gym-grid">
                {demos?.[index]?.map((demo, stationIndex) => {
                  const station = (block.kind === 'coached' || block.kind === 'self-paced') ? block.stations?.[stationIndex] : undefined;
                  const key = keyOf(block, stationIndex, demo);
                  const target = station ? stationTargetLine(demo.exerciseId, station.target.amount, station.target.unit, station.load)
                    : block.kind === 'strength' ? `${block.sets} sets · ${block.repMin}–${block.repMax} reps${block.targetWeight === undefined ? '' : ` · ${block.targetWeight} lb`}`
                      : '';
                  return <StationCard key={key} {...demo} index={stationIndex} target={target}
                    interval={block.kind === 'coached' && block.stations && station && station.target.unit !== 'sec' ? stationWorkSec(station.target, block.workSec) : undefined}
                    playing={playingId === key} onPlay={() => toggle(key)} />;
                })}
              </div>
            </li>
          ))}
        </ol>
        <div class="workout-actions">{children}</div>
      </div>
    </Sheet>
  );
}
