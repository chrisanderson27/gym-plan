import type { CircuitBlock, StationUnit } from '../../data/types';

export function circuitWork(block: CircuitBlock): { perStation: { exerciseId: string; unit: StationUnit; amount: number }[]; total: number } | null {
  const { log, stations } = block;
  if (!log) return null;

  const partial = log.partialReps;
  const index = partial ? Math.max(0, Math.min(stations.length, Math.trunc(partial.stationIndex))) : -1;
  let total = 0;
  const perStation = stations.map((station, i) => {
    const actual = log.stations[i];
    const { backup } = station;
    const target = backup && actual?.exerciseId === backup.exerciseId ? backup.target : station.target;
    const amount = log.completedRounds * target.amount
      + (i < index ? target.amount : i === index ? (partial?.count ?? 0) : 0);
    if (target.amount > 0) total += amount / target.amount;
    return { exerciseId: actual?.exerciseId ?? station.exerciseId, unit: target.unit, amount };
  });
  return { perStation, total };
}

export function isLoadedCircuit({ log, stations }: CircuitBlock): boolean {
  return !!log && (log.completedRounds > 0 || !!log.partialReps)
    && stations.some((station, i) => (log.stations[i]?.actualLoad ?? station.load ?? 0) > 0);
}
