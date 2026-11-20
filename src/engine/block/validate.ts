import type { Block, CircuitBlock, CircuitStation } from '../../data/types';
import { anchorOk, zoneOf } from '../gym/availability';
import type { GymItemShape, GymProfileShape } from '../gym/types';
import { countsAsCardio, groupOf, kitOf, NO_BLOCK_IDS, PROFILES, type BlockExerciseShape } from './rules';

export interface BlockContext {
  exercise(id: string): BlockExerciseShape | undefined;
  item(id: string): GymItemShape | undefined;
  podsOfItem(id: string): string[];
  zoneOfPod(id: string): string;
  floorOfPod?(id: string): number | undefined;
  mainFloor?: number;
}

export function blockContext(profile: GymProfileShape, exercises: Map<string, BlockExerciseShape>, mainFloor?: number): BlockContext {
  const items = new Map(profile.items.map((item) => [item.id, item]));
  const zoneFloors = new Map(profile.zones.map((zone) => [zone.id, zone.floor]));
  const podsByItem = new Map<string, string[]>();
  for (const pod of profile.pods) {
    for (const item of pod.items) {
      let pods = podsByItem.get(item);
      if (!pods) podsByItem.set(item, pods = []);
      pods.push(pod.id);
    }
  }
  return {
    exercise: (id) => exercises.get(id),
    item: (id) => items.get(id),
    podsOfItem: (id) => podsByItem.get(id) ?? [],
    zoneOfPod: (id) => zoneOf(profile, id),
    floorOfPod: (id) => zoneFloors.get(zoneOf(profile, id)),
    mainFloor,
  };
}

function stationPods(station: Omit<CircuitStation, 'backup'>, ctx: BlockContext, zone: string): string[] {
  return station.itemId === undefined ? [] : ctx.podsOfItem(station.itemId).filter((pod) => ctx.zoneOfPod(pod) === zone);
}

export function validateBlock(block: CircuitBlock, ctx: BlockContext, profile: keyof typeof PROFILES): string[] {
  const rules = PROFILES[profile];
  const violations = new Set<string>();
  const groups = block.stations.map((station) => {
    const ex = ctx.exercise(station.exerciseId);
    return ex && groupOf(ex);
  });
  if (new Set(groups.filter(Boolean)).size < rules.minGroups) violations.add('groups<3');
  if (groups.some((group, i) => group !== undefined && group === groups[(i + 1) % groups.length])) {
    violations.add('adjacent-same-group');
  }
  const kits = block.stations.map((station) => {
    const ex = ctx.exercise(station.exerciseId);
    return ex && kitOf(ex);
  });
  if (kits.filter((kit) => kit === 'fixed').length > rules.fixedMax) violations.add('fixed>max');
  if (groups.filter((group, i) => countsAsCardio(group, kits[i])).length > rules.cardioMax) {
    violations.add('cardio>max');
  }

  const zone = ctx.zoneOfPod(block.podId);
  if (!zone) violations.add('multi-zone');
  for (const [i, station] of block.stations.entries()) {
    const item = station.itemId === undefined ? undefined : ctx.item(station.itemId);
    const pods = stationPods(station, ctx, zone);
    if (station.itemId !== undefined && (!item || pods.length === 0)) violations.add('multi-zone');
    if (NO_BLOCK_IDS.includes(station.exerciseId)) violations.add('banned-lift');
    if (item?.count === 1 && (!station.backup || station.backup.itemId === station.itemId
      || station.backup.exerciseId === station.exerciseId)) violations.add('single-count-no-backup');
    if (item && !anchorOk(item)) violations.add('anchor-not-ok');

    if (station.backup) {
      const ex = ctx.exercise(station.backup.exerciseId);
      if (!ex || !groups[i] || groupOf(ex) !== groups[i]) violations.add('backup-group-mismatch');
      if (NO_BLOCK_IDS.includes(station.backup.exerciseId)) violations.add('banned-lift');
      if (station.backup.itemId !== undefined) {
        const backups = stationPods(station.backup, ctx, zone);
        if (!ctx.item(station.backup.itemId) || !backups.some((pod) => !station.itemId || pods.includes(pod))) {
          violations.add('multi-zone');
        }
      }
    }
  }
  return [...violations];
}

export function validateLiftDay(blocks: Block[], ctx: BlockContext): string[] {
  const violations = new Set<string>();
  const floors = new Set<number>();
  if (ctx.mainFloor !== undefined && blocks.some((block) => block.kind === 'lift' && !block.warmup)) floors.add(ctx.mainFloor);
  for (const block of blocks) {
    if (block.kind !== 'circuit') continue;
    for (const violation of validateBlock(block, ctx, 'lift')) violations.add(violation);
    const floor = ctx.floorOfPod?.(block.podId);
    if (floor !== undefined) floors.add(floor);
    for (const { itemId, backup } of block.stations) {
      for (const id of [itemId, backup?.itemId]) {
        const item = id === undefined ? undefined : ctx.item(id);
        if (item) floors.add(item.floor);
      }
    }
  }
  if (floors.size > 1) violations.add('multi-floor');
  return [...violations];
}
