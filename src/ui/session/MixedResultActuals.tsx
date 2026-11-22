import type { MixedResult } from '../../data/types';
import { exerciseName } from '../labels';

export function MixedResultActuals({ result, coached }: { result: MixedResult; coached: boolean }) {
  const { rounds, partial } = result;
  const station = partial && result.stations?.find((s) => s.slotId === partial.slotId);
  const unit = coached ? 'rotation' : 'round';
  return <>
    {rounds !== undefined && <p>{rounds === null ? `${coached ? 'Rotations' : 'Rounds'} unreported`
      : `${rounds} ${unit}${rounds === 1 && coached ? '' : 's'}`}</p>}
    {partial && station && <p>Partial · {exerciseName(station.exerciseId)} · {partial.count} {partial.unit}</p>}
  </>;
}
