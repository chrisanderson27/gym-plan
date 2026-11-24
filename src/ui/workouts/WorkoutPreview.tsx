import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { missingCoachedSchedule, workoutPreview } from '../../data/mixedSession';
import type { OrderedPrescription } from '../../data/types';
import { stationWorkSec } from '../../engine/block/coached';
import { StationCard, stationTargetLine } from '../blocks/StationCard';
import { CloseIcon } from '../icons';
import { orderedDurationLabel, workoutBlockKind, workoutBlockName } from '../labels';
import { Sheet } from '../Sheet';

export function WorkoutPreview({ ordered, onClose, fallbackFocus, children }: {
  ordered: OrderedPrescription; onClose: () => void; fallbackFocus: () => HTMLElement | null;
  children: ComponentChildren;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const snapshot = useLiveQuery(async () => ({ ordered, demos: await workoutPreview(db, ordered.blocks) }), [ordered]);
  const demos = snapshot?.ordered === ordered ? snapshot.demos : undefined;

  return (
    <Sheet label={`Preview ${ordered.name}`} onClose={onClose} fallbackFocus={fallbackFocus}>
      <div class="workout-preview">
        <header class="workout-dialog-head">
          <div>
            <h2>{ordered.name}</h2>
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
              <div class="gym-grid">
                {demos?.[index]?.map((demo, stationIndex) => {
                  const station = (block.kind === 'coached' || block.kind === 'self-paced') ? block.stations?.[stationIndex] : undefined;
                  const key = `${block.id}:${station?.slotId ?? ''}:${demo.equipmentId ?? ''}:${demo.poseId ?? ''}`;
                  const target = station ? stationTargetLine(demo.exerciseId, station.target.amount, station.target.unit, station.load)
                    : block.kind === 'strength' ? `${block.sets} sets · ${block.repMin}–${block.repMax} reps${block.targetWeight === undefined ? '' : ` · ${block.targetWeight} lb`}`
                      : '';
                  return <StationCard key={key} {...demo} index={stationIndex} target={target}
                    interval={block.kind === 'coached' && block.stations && station && station.target.unit !== 'sec' ? stationWorkSec(station.target, block.workSec) : undefined}
                    playing={playing === key} onPlay={() => setPlaying(playing === key ? null : key)} />;
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
