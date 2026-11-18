import type { Status } from '../engine/plan/types';
import type { TileDef } from './tiles';

/** A blocked tile is only marked, never disabled: the user may override the plan. */
export function Tile({ tile, compact, status }: { tile: TileDef; compact?: boolean; status?: { status: Status; reason?: string } }) {
  const cls = `tile${compact ? ' tile-compact' : ''}`;
  if (tile.ready) {
    return (
      <a class={cls} href={tile.route} data-testid={`tile-${tile.id}`}>
        <strong>{tile.title}</strong>
        {tile.subtitle && <span>{tile.subtitle}</span>}
        {tile.why && <small>{tile.why}</small>}
        {status && (
          <small class={`status status-${status.status}`} data-testid={`status-${tile.id}`}>
            {status.status}{status.reason ? ' · ' + status.reason : ''}
          </small>
        )}
      </a>
    );
  }
  return (
    <button type="button" class={`${cls} tile-disabled`} aria-disabled="true" data-testid={`tile-${tile.id}`} onClick={(e) => e.preventDefault()}>
      <strong>{tile.title}</strong>
      {tile.subtitle && <span>{tile.subtitle}</span>}
      {tile.why && <small>{tile.why}</small>}
      <small class="soon">coming soon</small>
    </button>
  );
}
