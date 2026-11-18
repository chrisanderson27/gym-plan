import { db } from '../data/db';
import { useLiveQuery } from '../data/live';
import { loadPlanInput } from '../data/plan';
import { rankToday } from '../engine/plan/pick';
import type { Settings } from '../data/types';
import { BackupBanner } from './BackupBanner';
import { Tile } from './Tile';
import { ACTIONS, TILES } from './tiles';

export function Home({ settings }: { settings: Settings }) {
  const plan = useLiveQuery(async () => rankToday(await loadPlanInput(db)), []);
  const byId = (id: string) => TILES.find((t) => t.id === id)!;
  const statusOf = (tile: string) => {
    const c = plan?.candidates.find((x) => x.tile === tile);
    return c ? { status: c.status, ...(c.reasons[0] ? { reason: c.reasons[0] } : {}) } : undefined;
  };
  const pick = plan ? { ...byId('pick'), subtitle: plan.pick.title, why: plan.why, route: plan.pick.route } : byId('pick');
  return (
    <main class="screen">
      <header class="bar">
        <h1>gym-plan</h1>
        <a class="gear" href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      <BackupBanner settings={settings} />
      {plan && (
        <p class="budget" data-testid="budget">
          {plan.budget.map((l) => (
            <span key={l.id} class={`budget-${l.status}`} data-testid={`budget-${l.id}`}>{l.label} {l.done}/{l.id === 'rest' || l.id === 'hard' ? l.max : l.min}</span>
          ))}
        </p>
      )}
      <div class="grid">
        <div class="span2">
          <Tile tile={pick} />
        </div>
        <Tile tile={byId('lift')} {...(statusOf('lift') ? { status: statusOf('lift')! } : {})} />
        <Tile tile={byId('burn')} {...(statusOf('burn') ? { status: statusOf('burn')! } : {})} />
        <Tile tile={byId('run')} {...(statusOf('run') ? { status: statusOf('run')! } : {})} />
        <Tile tile={byId('swim')} {...(statusOf('swim') ? { status: statusOf('swim')! } : {})} />
        <div class="span2">
          <Tile tile={byId('hybrid')} {...(statusOf('hybrid') ? { status: statusOf('hybrid')! } : {})} />
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
