import type { GymItemShape, GymProfileShape } from './types';

export interface Option {
  exerciseId: string;
  itemId?: string;
  podId: string;
  zone: string;
  floor: number;
  count: number;
  anchorOk: boolean;
}

export const anchorOk = (item: GymItemShape): boolean => item.verified || (item.confidence !== 'G' && !item.pending);
export const floors = (profile: GymProfileShape): number[] => [...new Set(profile.zones.map((zone) => zone.floor))];
export const zoneOf = (profile: GymProfileShape, podId: string): string =>
  profile.pods.find((pod) => pod.id === podId)?.zone ?? '';

export function availableOn(
  profile: GymProfileShape,
  floor: number,
  { notAtMyGym, bodyweightIds }: { notAtMyGym: ReadonlySet<string>; bodyweightIds: readonly string[] },
): Option[] {
  const zones = new Set(profile.zones.filter((zone) => zone.floor === floor).map((zone) => zone.id));
  const items = new Map(profile.items.filter((item) => item.floor === floor).map((item) => [item.id, item]));
  const options: Option[] = [];
  for (const pod of profile.pods) {
    if (!zones.has(pod.zone)) continue;
    const location = { floor, podId: pod.id, zone: pod.zone };
    for (const id of pod.items) {
      const item = items.get(id);
      if (!item) continue;
      for (const exerciseId of item.exercises) {
        options.push({ ...location, exerciseId, itemId: id, count: item.count, anchorOk: anchorOk(item) });
      }
    }
    for (const exerciseId of bodyweightIds) {
      options.push({ ...location, exerciseId, count: Infinity, anchorOk: true });
    }
  }
  return options.filter((option) => !notAtMyGym.has(option.exerciseId));
}
