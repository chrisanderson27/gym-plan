import type { ComponentChildren } from 'preact';
import { POSES } from '../../content/poses';
import { phase3Pose } from '../../content/stationDemos';
import type { loadSessionDetail } from '../../data/history';
import { loggedMixedSets } from '../../data/mixedSets';
import type { Equipment } from '../../data/types';
import { circuitWork } from '../../engine/block/work';
import { stationTargetLine } from '../blocks/StationCard';
import type { LineupRow } from '../home/WorkoutLineup';
import { durationLabel, exerciseName, mixedBlockName, modalityName, runKindName, workoutBlockKind } from '../labels';
import { StickFigure } from '../pose/StickFigure';
import { MixedResultActuals } from '../session/MixedResultActuals';
import { circuitSummary } from './circuit-summary';

export type SessionDetail = NonNullable<Awaited<ReturnType<typeof loadSessionDetail>>>;

function LoggedMovement({ index, name, gear, poseId, children }: {
  index: number; name: string; gear?: string; poseId?: string; children: ComponentChildren;
}) {
  const pose = poseId ? POSES[poseId] : undefined;
  return <li class="logged-movement">
    {pose && <div class="logged-movement-figure"><StickFigure def={pose} label={name} testId="logged-pose" running={false} /></div>}
    <div class="logged-movement-detail">
      <div><span class="logged-movement-index num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span> <strong>{name}</strong></div>
      {gear && <p class="logged-movement-gear">{gear}</p>}
      {children}
    </div>
  </li>;
}

export function loggedLineup({ session, sets, run, swim }: SessionDetail, equipment: ReadonlyMap<string, Equipment>, illustrated = false) {
  const gear = new Map<string, string>();
  const blocks: LineupRow[] = [];
  const nameOf = (id?: string) => id ? equipment.get(id)?.name ?? id : undefined;
  const used = (id?: string, exerciseId?: string) => {
    if (id && id !== 'bodyweight') gear.set(id, nameOf(id)!);
    if (exerciseId === 'step-up' || exerciseId === 'box-step-up') gear.set('plyo-box', 'Plyo box');
    if (exerciseId === 'hip-thrust' || exerciseId === 'bulgarian-split-squat') gear.set('flat-bench', 'Flat bench');
  };
  const setActual = (set: typeof sets[number]) => `${set.weight} lb × ${set.reps}${set.setKind === 'calibration' ? ' · Calibration' : ''}${set.rir !== undefined ? ` · RIR ${set.rir}` : ''}${set.painFlag ? ' · pain' : ''}`;
  const renderSets = (rows: typeof sets) => {
    if (!illustrated) return <ul class="plan">{rows.map((set) => <li key={set.id}>
      <span>{exerciseName(set.exerciseId)}{nameOf(set.equipmentId) && ` · ${nameOf(set.equipmentId)}`}</span>
      <span>{setActual(set)}</span>
    </li>)}</ul>;
    const groups: Array<typeof sets> = [];
    for (const set of rows) {
      const previous = groups.at(-1);
      if (previous?.[0]?.exerciseId === set.exerciseId && previous[0].equipmentId === set.equipmentId) previous.push(set);
      else groups.push([set]);
    }
    return <ol class="logged-movements">{groups.map((group, index) => {
      const set = group[0]!;
      const item = equipment.get(set.equipmentId);
      return <LoggedMovement key={set.id} index={index} name={exerciseName(set.exerciseId)}
        gear={nameOf(set.equipmentId)} poseId={item && phase3Pose(set.exerciseId, item)}>
        {group.map((actual) => <p class="logged-movement-value num" key={actual.id}>{setActual(actual)}</p>)}
      </LoggedMovement>;
    })}</ol>;
  };

  const mixed = session.mixed;
  if (mixed) {
    for (const block of mixed.prescription.blocks) {
      const result = Object.hasOwn(mixed.results, block.id) ? mixed.results[block.id] : undefined;
      if (!result) continue;
      const strength = mixed.strength[block.id];
      const rows = block.kind === 'strength' ? loggedMixedSets(session.id, block.id, sets) : [];
      for (const row of rows) used(row.equipmentId, row.exerciseId);
      for (const change of result.stationChanges ?? []) {
        for (const station of change.stations) if (!station.skipped) used(station.equipmentId, station.exerciseId);
      }
      if (result.status === 'completed') {
        const lastChange = result.stationChanges?.at(-1)?.afterRound ?? 0;
        const stations = result.stations?.filter((station) => !station.skipped) ?? [];
        const rounds = result.rounds ?? mixed.drafts[block.id]?.tapped ?? 0;
        const partialIndex = result.partial ? stations.findIndex((s) => s.slotId === result.partial?.slotId) : -1;
        for (const [index, station] of stations.entries()) {
          if (rounds > lastChange || index < partialIndex || (index === partialIndex && result.partial!.count > 0)) {
            used(station.equipmentId, station.exerciseId);
          }
        }
      }
      const title = mixedBlockName(block);
      const elapsed = Math.floor(result.elapsedMs / 1000);
      const stationName = (s: NonNullable<typeof result.stations>[number]) =>
        s.swappedFromExerciseId ? `${exerciseName(s.swappedFromExerciseId)} → ${exerciseName(s.exerciseId)}` : exerciseName(s.exerciseId);
      const stationValue = (s: NonNullable<typeof result.stations>[number]) =>
        s.skipped ? 'Skipped' : `Target ${stationTargetLine(s.exerciseId, s.target.amount, s.target.unit, s.load)}`;
      blocks.push({ id: block.id, kind: block.kind, subtitle: workoutBlockKind[block.kind],
        duration: elapsed > 0 ? durationLabel(elapsed) : undefined,
        title: strength && exerciseName(strength.exerciseId) !== title ? `${title} → ${exerciseName(strength.exerciseId)}` : title,
        content: <>
          <p>{result.status === 'skipped' ? 'Skipped' : 'Completed'}{block.kind !== 'strength' && ` · ${elapsed} sec`}</p>
          {(block.kind !== 'coached' || result.status !== 'skipped') && <MixedResultActuals result={result} coached={block.kind === 'coached'} />}
          {rows.length > 0 && renderSets(rows)}
          {result.stationChanges?.map((change, index, changes) => {
            const first = (changes[index - 1]?.afterRound ?? 0) + 1;
            const unit = block.kind === 'coached' ? 'Rotation' : 'Tapped round';
            const label = first === change.afterRound ? `${unit} ${first}` : `${unit}s ${first}–${change.afterRound}`;
            return <p key={change.afterRound}>{label} · {change.stations.filter((s) => !s.skipped).map((s) =>
              [exerciseName(s.exerciseId), nameOf(s.equipmentId)].filter(Boolean).join(' · ')).join(', ')}</p>;
          })}
          {result.stations && (illustrated ? <ol class="logged-movements">{result.stations.map((s, index) =>
            <LoggedMovement key={s.slotId} index={index} name={stationName(s)} gear={nameOf(s.equipmentId)} poseId={s.poseId}>
              <p class="logged-movement-value num">{stationValue(s)}</p>
            </LoggedMovement>
          )}</ol> : <ul class="plan">{result.stations.map((s) => <li key={s.slotId}>
            <span>{stationName(s)}{nameOf(s.equipmentId) && ` · ${nameOf(s.equipmentId)}`}</span>
            <span>{stationValue(s)}</span>
          </li>)}</ul>)}
        </>,
      });
    }
    return { blocks, gear: [...gear.values()] };
  }

  const byExercise = new Map<string, typeof sets>();
  for (const set of sets) {
    byExercise.set(set.exerciseId, [...(byExercise.get(set.exerciseId) ?? []), set]);
    used(set.equipmentId, set.exerciseId);
  }
  for (const [id, rows] of byExercise) blocks.push({ id, kind: 'strength', title: exerciseName(id), content: renderSets(rows) });

  for (const block of session.blocks) {
    if (block.kind === 'interval') {
      blocks.push({ id: block.id, title: block.label ?? 'Interval block',
        content: <p>{block.result?.actualSec === undefined ? 'Time unreported' : durationLabel(block.result.actualSec)}</p> });
    }
    if (block.kind !== 'circuit') continue;
    const work = circuitWork(block);
    for (const [index, station] of (block.log?.stations ?? []).entries()) {
      const planned = block.stations[index];
      const gearId = planned?.exerciseId === station.exerciseId ? planned?.equipmentId
        : planned?.backup?.exerciseId === station.exerciseId ? planned.backup.equipmentId : undefined;
      if (gearId) used(gearId, station.exerciseId);
    }
    blocks.push({ id: block.id, kind: 'self-paced', title: `${block.label ?? 'Block'} · ${circuitSummary(block)}`, content: <>
      {block.log && <p>{durationLabel(block.log.actualDurationSec)}</p>}
      {work && <ul class="plan">{work.perStation.map(({ exerciseId, unit, amount }, index) => <li key={index}>
        <span>{exerciseName(exerciseId)}{block.log?.stations[index]?.swappedFromExerciseId && ' · swapped'}</span>
        <span>{amount} {unit}</span>
      </li>)}</ul>}
    </> });
  }
  if (run) blocks.push({ id: 'run', kind: 'run', title: `${modalityName(run.modality ?? 'run')} · ${runKindName(run.kind)}`,
    content: <p>{durationLabel(run.durationSec)}{run.distanceMi > 0 && ` · ${run.distanceMi} mi`} · RPE {run.rpe}</p> });
  if (swim) blocks.push({ id: 'swim', kind: 'swim', title: 'Swim',
    content: <p>{swim.distance} {swim.poolUnit} · RPE {swim.rpe}</p> });
  return { blocks, gear: [...gear.values()] };
}
