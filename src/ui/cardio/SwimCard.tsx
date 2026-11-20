import { DRILLS } from '../../content/drills';
import { SWIM_GEAR_SUBSTITUTES } from '../../content/swim-workouts';
import type { PoolUnit, SwimSetBlock } from '../../data/types';
import { itemLine } from './format';
import { tagLabel } from '../labels';

const SECTION_NAMES: Record<SwimSetBlock['section'], string> = {
  warmup: 'Warm-up', drill: 'Drill', kick: 'Kick', pull: 'Pull', main: 'Main set', cooldown: 'Cool-down',
};
const drillName = (id: string | undefined) => DRILLS.find((d) => d.id === id);

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
              <div key={n}>
                <p class="swim-line">
                  {itemLine(i, poolUnit)}
                  {i.equipment.length > 0 && <small> ({i.equipment.map(tagLabel).join(', ')})</small>}
                </p>
                {cue && <small class="swim-cue">{cue}</small>}
              </div>
            );
          })}
        </div>
      ))}
      <p class="swim-total"><strong>Total {totalDistance} {poolUnit}</strong></p>
      {gear.length > 0 && (
        <ul class="dim">
          {gear.map((g) => <li key={g}><small>{SWIM_GEAR_SUBSTITUTES[g] ?? tagLabel(g)}</small></li>)}
        </ul>
      )}
    </section>
  );
}
