import { useState } from 'preact/hooks';
import { db } from '../../data/db';
import { deleteLibraryBlock } from '../../data/libraryBlocks';
import { useLiveQuery } from '../../data/live';
import type { LibraryBlock, Settings } from '../../data/types';
import { localDate } from '../../engine/dates';
import { weekIndex } from '../../engine/week';
import { CalendarIcon, LayersIcon, PlusIcon, SwapIcon } from '../icons';
import { navigate } from '../router';

const kindLabel = (kind: LibraryBlock['kind']) => (kind === 'coached' ? 'Coached rotation' : 'Self-paced circuit');

export function BlocksScreen({ settings }: { settings: Settings }) {
  const week = weekIndex(localDate(new Date()), settings.programStart);
  const rows = useLiveQuery(() => db.libraryBlocks.toArray(), []);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <main class="screen shell-screen">
      <header class="pref-top">
        <div class="pref-brand">
          <span class="pref-mark" aria-hidden="true"><svg width="16" height="19" viewBox="0 0 16 19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
          <p class="wordmark">Gym Plan.</p>
        </div>
        <p class="week-chip"><CalendarIcon />Week {week}</p>
      </header>
      <p class="pref-eyebrow"><svg class="pref-dot" width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="3" fill="currentColor" /></svg>Training library</p>
      <h1>My Blocks</h1>
      <p class="pref-lead">Your favorite pieces, ready to mix and match.</p>
      <a class="btn primary block-new" href="#/blocks/new"><PlusIcon /> New block</a>
      {rows && rows.length === 0 && (
        <section class="block-empty">
          <span class="block-empty-icon" aria-hidden="true"><LayersIcon /></span>
          <h2>No saved blocks yet</h2>
          <p>Save a block from Today, try the suggested pair below, or build one from scratch.</p>
        </section>
      )}
      <h2 class="block-suggest-head">Start with a suggestion</h2>
      <section class="block-suggest">
        <span class="block-suggest-tile" aria-hidden="true"><SwapIcon /></span>
        <div>
          <h3>Dumbbell &amp; core pairing</h3>
          <p>2 stations · 8 min · Coached rotation</p>
        </div>
        <button type="button" class="block-ghost" onClick={() => navigate('/blocks/suggest')}>Customize</button>
      </section>
      {(rows ?? []).map((row) => (
        <section key={row.id} class="card">
          <a class="block-name" href={`#/blocks/${row.id}`}>{row.name}</a>
          <p>{row.stations.length} stations · {row.durationSec / 60} min · {kindLabel(row.kind)}</p>
          {confirmId === row.id ? (
            <div role="group" aria-label={`Remove ${row.name}?`}>
              <p>Remove {row.name}? This can't be undone.</p>
              <button type="button" data-testid="block-remove-confirm" onClick={() => { setConfirmId(null); void deleteLibraryBlock(db, row.id); }}>Yes, remove</button>
              <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmId(row.id)}>Remove {row.name}</button>
          )}
        </section>
      ))}
    </main>
  );
}
