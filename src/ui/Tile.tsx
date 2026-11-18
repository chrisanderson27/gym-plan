import type { TileDef } from './tiles';

export function Tile({ tile, compact }: { tile: TileDef; compact?: boolean }) {
  const cls = `tile${compact ? ' tile-compact' : ''}`;
  if (tile.ready) {
    return (
      <a class={cls} href={tile.route} data-testid={`tile-${tile.id}`}>
        <strong>{tile.title}</strong>
        {tile.subtitle && <span>{tile.subtitle}</span>}
        {tile.why && <small>{tile.why}</small>}
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
