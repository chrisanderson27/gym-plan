import { useEffect, useState } from 'preact/hooks';
import { buildExport, ImportError, importExport, markBackedUp, parseExport } from '../data/backup';
import { db } from '../data/db';
import { saveSettings } from '../data/settings';
import type { PoolUnit, Settings as SettingsRow } from '../data/types';
import { daysBetween, localDate } from '../engine/dates';
import { isStandalone } from '../platform/display';
import { deliverFile, backupFileName } from '../platform/share';
import { isPersisted } from '../platform/storage';
import { FeedbackList } from './feedback/FeedbackList';

declare const __APP_VERSION__: string;

export function SettingsScreen({ settings }: { settings: SettingsRow }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    isPersisted().then(setPersisted);
  }, []);

  const backupLabel = (() => {
    if (!settings.backupAt) return 'never';
    const days = daysBetween(localDate(new Date(settings.backupAt)), localDate(new Date()));
    return days <= 0 ? 'today' : `${days} days ago`;
  })();

  const doExport = async (preferShare: boolean) => {
    const now = new Date();
    const file = await buildExport(db, now, __APP_VERSION__);
    const result = await deliverFile(backupFileName(now), JSON.stringify(file), { preferShare });
    if (result === 'cancelled') return setMessage('Export cancelled.');
    await markBackedUp(db, file.exportedAt);
    setMessage(result === 'shared' ? 'Backup shared.' : 'Backup downloaded.');
  };

  const doImport = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const { file, warnings } = parseExport(await f.text());
      const { written } = await importExport(db, file);
      const counts = Object.entries(written)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join(', ');
      setMessage(`Imported ${counts || 'nothing'}. ${warnings.join(' ')}`.trim());
    } catch (err) {
      setMessage(err instanceof ImportError ? err.message : 'Import failed.');
    }
    input.value = '';
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>Settings</h1>
        <a class="gear" href="#/">
          Home
        </a>
      </header>
      <label>
        Goal weight (lb)
        <input inputMode="decimal" value={settings.goalWeightLb} onChange={(e) => { const v = Number(e.currentTarget.value); if (v > 0) saveSettings(db, { goalWeightLb: v }); }} />
      </label>
      <label>
        Pool unit
        <select value={settings.poolUnit} onChange={(e) => saveSettings(db, { poolUnit: e.currentTarget.value as PoolUnit })}>
          <option value="yd">yards</option>
          <option value="m">meters</option>
        </select>
      </label>
      <label>
        Pool length
        <input inputMode="decimal" value={settings.poolLength} onChange={(e) => { const v = Number(e.currentTarget.value); if (v > 0) saveSettings(db, { poolLength: v }); }} />
      </label>
      <label>
        Program start (week 1)
        <input type="date" value={settings.programStart} onChange={(e) => { if (e.currentTarget.value) saveSettings(db, { programStart: e.currentTarget.value }); }} />
      </label>

      <h2>Storage</h2>
      <p>{persisted === true ? 'Storage: persistent ✓' : persisted === false ? 'Storage: ⚠ best-effort — export regularly' : 'Storage: unknown — export regularly'}</p>
      <p>Running as Home Screen app: {isStandalone() ? 'yes' : 'no'}</p>

      <h2>Backup</h2>
      <p>Last backup: {backupLabel}</p>
      <button type="button" onClick={() => doExport(true)}>Export (share)</button>
      <button type="button" onClick={() => doExport(false)}>Download backup</button>
      <label>
        Import backup
        <input type="file" accept=".json,application/json" onChange={doImport} />
      </label>
      <FeedbackList onMessage={setMessage} />
      {message && <p role="status">{message}</p>}
      <p class="dim">gym-plan v{__APP_VERSION__}</p>
    </main>
  );
}
