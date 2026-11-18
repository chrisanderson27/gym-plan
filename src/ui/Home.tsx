import type { Settings } from '../data/types';
import { BackupBanner } from './BackupBanner';
import { Tile } from './Tile';
import { ACTIONS, TILES } from './tiles';

export function Home({ settings }: { settings: Settings }) {
  const byId = (id: string) => TILES.find((t) => t.id === id)!;
  return (
    <main class="screen">
      <header class="bar">
        <h1>gym-plan</h1>
        <a class="gear" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      <BackupBanner settings={settings} />
      <div class="grid">
        <div class="span2">
          <Tile tile={byId('pick')} />
        </div>
        <Tile tile={byId('lift')} />
        <Tile tile={byId('burn')} />
        <Tile tile={byId('run')} />
        <Tile tile={byId('swim')} />
        <div class="span2">
          <Tile tile={byId('hybrid')} />
        </div>
      </div>
      <div class="actions">
        {ACTIONS.map((a) => (
          <Tile key={a.id} tile={a} compact />
        ))}
      </div>
    </main>
  );
}
