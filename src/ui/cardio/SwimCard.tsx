import { DRILLS } from '../../content/drills';
import { SWIM_GEAR_SUBSTITUTES } from '../../content/swim-workouts';
import type { PoolUnit, SwimItem, SwimSetBlock } from '../../data/types';
import { fmtClock } from '../../engine/swim/sendoff';

const SECTION_NAMES: Record<SwimSetBlock['section'], string> = {
  warmup: 'Warm-up', drill: 'Drill', kick: 'Kick', pull: 'Pull', main: 'Main set', cooldown: 'Cool-down',
};
const drillName = (id: string | undefined) => DRILLS.find((d) => d.id === id);

/** Standard notation: "4x100 FR CSS @ 2:05" or "4x50 kick :20 rest". */
export function itemLine(i: SwimItem): string {
  const what = i.swimKind === 'swim' ? i.stroke : i.swimKind === 'pull' ? `pull ${i.stroke}` : i.swimKind === 'drill' ? (drillName(i.drillId)?.name ?? 'drill') : i.swimKind;
  const intensity = i.swimKind === 'kick' || i.swimKind === 'drill' ? '' : ` ${i.intensity}`;
  const timing = i.seconds === undefined ? '' : i.mode === 'sendoff' ? ` @ ${fmtClock(i.seconds)}` : ` ${fmtClock(i.seconds)} rest`;
  return `${i.reps}x${i.distance} ${what}${intensity}${timing}`;
}

export function SwimCard({ blocks, totalDistance, poolUnit }: { blocks: SwimSetBlock[]; totalDistance: number; poolUnit: PoolUnit }) {
  const gear = [...new Set(blocks.flatMap((b) => b.items.flatMap((i) => i.equipment)))];
  return (
    <section class="swim-card" data-testid="swim-card">
      {blocks.map((b) => (
        <div key={b.id}>
          <h3>{SECTION_NAMES[b.section]}{b.rounds > 1 ? ` · ${b.rounds} rounds` : ''}</h3>
          {b.items.map((i, n) => {
            const cue = i.swimKind === 'drill' ? drillName(i.drillId)?.cue : undefined;
            return (
              <p key={n} class="swim-line">
                {itemLine(i)}
                {i.equipment.length > 0 && <small> ({i.equipment.join(', ')})</small>}
                {cue && <small class="dim"> — {cue}</small>}
              </p>
            );
          })}
        </div>
      ))}
      <p class="swim-total"><strong>Total {totalDistance} {poolUnit}</strong></p>
      {gear.length > 0 && (
        <ul class="dim">
          {gear.map((g) => <li key={g}><small>{SWIM_GEAR_SUBSTITUTES[g] ?? g}</small></li>)}
        </ul>
      )}
    </section>
  );
}
