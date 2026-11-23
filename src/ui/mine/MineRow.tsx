import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { editableLiftTemplate, listMine } from '../../data/templates';
import type { SessionType } from '../../data/types';
import { orderedDurationMin, templateDurationMin } from '../../engine/templates';

export const ALL_TEMPLATE_TYPES: SessionType[] = ['lift', 'custom', 'burn', 'run', 'swim', 'hybrid'];

/** Saved and built templates for the given session types. Renders nothing when there are none. */
export function MineRow({ types, title = 'Mine' }: { types: SessionType[]; title?: string }) {
  const rows = useLiveQuery(() => listMine(db, types), [types.join(',')]);
  if (!rows || rows.length === 0) return null;
  return (
    <section class="mine-row" data-testid="mine-row">
      <h2>{title}</h2>
      <ul class="rows">
        {rows.map((t) => {
          // An unknown (0) duration is hidden rather than shown as "0 min".
          const min = t.ordered ? orderedDurationMin(t.ordered.blocks) : templateDurationMin(t.blocks);
          return (
          <li key={t.id} class="row-item">
            <a class="row" href={'#/mine/' + t.id} data-testid={`mine-${t.id}`}>
              <span class="row-label">{t.name}</span>
              {min > 0 && <span class="row-meta">{min} min</span>}
            </a>
            {editableLiftTemplate(t) && <a class="btn" href={'#/builder/' + t.id}>edit</a>}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
