import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { OrderedBlock } from '../../data/types';
import type { TodayRecommendation } from '../../data/recommendation';
import { orderedBlockSeconds } from '../../engine/templates';
import { stationTargetLine } from '../blocks/StationCard';
import { BlocksIcon, ChevronIcon, FlameIcon, LayersIcon, LiftIcon, ListIcon, RunIcon, SwapIcon, SwimIcon, WindIcon, WorkoutsIcon } from '../icons';
import { durationLabel, estimatedMinutesLabel, exerciseName, mixedBlockName, workoutBlockKind } from '../labels';
import { useDemoPlayback } from '../pose/playback';
import { PosePlaybackButton, PoseView } from '../slots/PoseView';

export type LineupRow = {
  id: string; title: string; subtitle?: string; duration?: string;
  kind?: OrderedBlock['kind'] | 'run' | 'swim'; content: ComponentChildren;
};

const blockIcons = {
  preparation: FlameIcon, strength: LiftIcon, coached: SwapIcon, 'self-paced': BlocksIcon,
  recovery: WindIcon, run: RunIcon, swim: SwimIcon,
};

export function WorkoutLineup({ gear, rows, completed = false, onDisclosure, onExpandedChange }: {
  gear: string[]; rows: LineupRow[]; completed?: boolean; onDisclosure?: () => void; onExpandedChange?: (open: ReadonlySet<string>) => void;
}) {
  const [more, setMore] = useState(completed);
  const [expanded, setExpanded] = useState(() => new Set(completed ? rows.map((row) => row.id) : []));
  const all = expanded.size === rows.length;
  useEffect(() => { onExpandedChange?.(expanded); }, [expanded]);
  return <>
    {gear.length > 0 && <section class="training-equipment">
      <h2><LiftIcon />Equipment to gather</h2>
      <ul aria-label={completed ? 'Equipment used' : 'Required equipment'}>
        {(more ? gear : gear.slice(0, 4)).map((name) => {
          const Icon = name === 'Dumbbells' ? WorkoutsIcon : name === 'Plyo box' ? BlocksIcon : LayersIcon;
          return <li key={name}><Icon /><span>{name}</span></li>;
        })}
        {gear.length > 4 && <li class="training-equipment-overflow">
          <button type="button" class="training-link" aria-expanded={more}
            aria-label={more ? 'Show less equipment' : `+${gear.length - 4} more equipment`} onClick={() => setMore(!more)}>
            <span>{more ? 'Show less' : `+${gear.length - 4} more`}</span>
          </button>
        </li>}
      </ul>
    </section>}
    {rows.length > 0 && <section class="training-lineup" aria-label="Workout lineup">
      <header class="training-section-head">
        <div><h2>Workout lineup</h2><p>Open a block to see what’s inside.</p></div>
        <button type="button" class="training-link" aria-expanded={all} onClick={() => { onDisclosure?.(); setExpanded(new Set(all ? [] : rows.map((row) => row.id))); }}>
          <ListIcon />{all ? 'Collapse all' : 'Expand all'}
        </button>
      </header>
      <ol class="training-card">
        {rows.map((row) => {
          const open = expanded.has(row.id);
          const panelId = `today-block-${row.id}`;
          const Icon = row.kind ? blockIcons[row.kind] : LayersIcon;
          return <li key={row.id} data-block-id={row.id} data-kind={row.kind}>
            <button type="button" class="training-block-row" aria-expanded={open} aria-controls={panelId} onClick={() => {
              if (open) onDisclosure?.();
              const next = new Set(expanded);
              if (open) next.delete(row.id);
              else next.add(row.id);
              setExpanded(next);
            }}>
              <span class="training-block-icon"><Icon /></span>
              <span><strong>{row.title}</strong>{row.subtitle && <small>{row.subtitle}</small>}</span>
              {row.duration && <span class="training-pill num">{row.duration}</span>}
              <ChevronIcon />
            </button>
            <div id={panelId} hidden={!open} class="training-block-content">{open && row.content}</div>
          </li>;
        })}
      </ol>
    </section>}
  </>;
}

export function RecommendedLineup({ recommendation }: { recommendation: TodayRecommendation }) {
  const { workout } = recommendation;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { blocks } = workout.prepared.mixed.prescription;
  const gear = new Set(workout.lineup.flatMap((moves) => moves.flatMap((move) => move.equipmentName?.split(' · ') ?? []))
    .filter((label) => label.toLowerCase() !== 'bodyweight'));
  // Only expanded rows render figures, so the first card in an open row is the one that plays.
  const keyOf = (blockId: string, slotId: string | undefined, slot: number) => `${blockId}:${slotId ?? slot}`;
  const ids = blocks.flatMap((block, index) => {
    if (!open.has(block.id)) return [];
    const stations = block.kind === 'coached' || block.kind === 'self-paced' ? block.stations : undefined;
    return workout.lineup[index]!.flatMap((move, slot) => move.poseId ? [keyOf(block.id, stations?.[slot]?.slotId, slot)] : []);
  });
  const { playingId, toggle } = useDemoPlayback('today-lineup', ids);
  return <WorkoutLineup gear={[...gear]} onExpandedChange={setOpen} rows={blocks.map((block, index) => {
    const moves = workout.lineup[index]!;
    const stations = block.kind === 'coached' || block.kind === 'self-paced' ? block.stations : undefined;
    return {
      id: block.id, kind: block.kind, title: mixedBlockName(block),
      subtitle: `${workoutBlockKind[block.kind]}${moves.length ? ` · ${moves.length} ${moves.length === 1 ? 'exercise' : 'exercises'}` : ''}`,
      duration: block.kind === 'strength' ? `${estimatedMinutesLabel(orderedBlockSeconds(block))} est.` : durationLabel(orderedBlockSeconds(block)),
      content: <>
        {'instructions' in block && <p>{block.instructions}</p>}
        {block.kind === 'coached' && <p>{block.workSec} s work · {block.restSec} s rest · {block.transitionSec} s transition</p>}
        {moves.map((move, slot) => {
          const station = stations?.[slot];
          const key = keyOf(block.id, station?.slotId, slot);
          const name = exerciseName(move.exerciseId);
          return <article class="training-movement" key={key} data-exercise-id={move.exerciseId} data-equipment-id={move.equipmentId}>
            <header><strong>{name}</strong>{move.poseId && <PosePlaybackButton name={name} playing={playingId === key} onPlay={() => toggle(key)} />}</header>
            {move.equipmentName && <p>{move.equipmentName}</p>}
            {block.kind === 'strength' && <p>{block.label && `${block.label} · `}{block.sets} × {block.repMin}–{block.repMax} reps
              {block.targetWeight !== undefined && ` · ${block.targetWeight} lb`}
              {block.rirTarget !== undefined && ` · RIR ${block.rirTarget}`}
              {block.restSec !== undefined && ` · ${block.restSec} s rest`}</p>}
            {station && <p>Target {stationTargetLine(move.exerciseId, station.target.amount, station.target.unit, station.load)}</p>}
            <PoseView exerciseId={move.exerciseId} poseId={move.poseId} running={playingId === key} />
          </article>;
        })}
      </>,
    };
  })} />;
}
