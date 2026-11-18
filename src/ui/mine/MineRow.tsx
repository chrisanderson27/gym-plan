import { db } from '../../data/db';
import { useLiveQuery } from '../../data/live';
import { listMine } from '../../data/templates';
import type { SessionType } from '../../data/types';
import { templateDurationMin } from '../../engine/templates';

/** Saved and built templates for the given session types. Renders nothing when there are none. */
export function MineRow({ types }: { types: SessionType[] }) {
  const rows = useLiveQuery(() => listMine(db, types), [types.join(',')]);
  if (!rows || rows.length === 0) return null;
  return (
    <section class="mine-row" data-testid="mine-row">
      <h2>Mine</h2>
      <ul class="rows">
        {rows.map((t) => (
          <li key={t.id} class="row-item">
            <a class="row" href={'#/mine/' + t.id} data-testid={`mine-${t.id}`}>
              <span class="row-label">{t.name}</span>
              <span class="row-meta">{templateDurationMin(t.blocks)} min</span>
            </a>
            {t.source === 'built' && <a class="btn" href={'#/builder/' + t.id}>edit</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}
