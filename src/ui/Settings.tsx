import { useEffect, useRef, useState } from 'preact/hooks';
import { buildExport, ImportError, importExport, markBackedUp, parseExport } from '../data/backup';
import { db } from '../data/db';
import { enabledActivities, poolOf, saveSettings } from '../data/settings';
import type { Appearance, PoolUnit, Settings as SettingsRow } from '../data/types';
import { daysBetween, localDate } from '../engine/dates';
import { isStandalone } from '../platform/display';
import { deliverFile, backupFileName } from '../platform/share';
import { isPersisted } from '../platform/storage';
import { FeedbackList } from './feedback/FeedbackList';
import { ActivityChoices, DirectionChoices } from './Onboarding';
import { PoolSheet } from './PoolSheet';

declare const __APP_VERSION__: string;

export function SettingsScreen({ settings }: { settings: SettingsRow }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const [activityError, setActivityError] = useState(false);
  const [showPool, setShowPool] = useState(false);
  const pool = poolOf(settings);
  // Backup result sits next to the backup controls; feedback results stay under the feedback section.
  const [backupMsg, setBackupMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => {
    isPersisted().then(setPersisted);
  }, []);

  // Local draft so live-query renders never reset a field mid-edit; it follows the stored goal (e.g. after an import) whenever the field is not focused.
  const [goalDraft, setGoalDraft] = useState(String(settings.goalWeightLb));
  const goalFocused = useRef(false);
  useEffect(() => {
    if (!goalFocused.current) setGoalDraft(String(settings.goalWeightLb));
  }, [settings.goalWeightLb]);

  const backupLabel = (() => {
    if (!settings.backupAt) return 'never';
    const days = daysBetween(localDate(new Date(settings.backupAt)), localDate(new Date()));
    return days <= 0 ? 'today' : `${days} days ago`;
  })();

  const doExport = async (preferShare: boolean) => {
    const now = new Date();
    const file = await buildExport(db, now, __APP_VERSION__);
    const result = await deliverFile(backupFileName(now), JSON.stringify(file), { preferShare });
    if (result === 'cancelled') return setBackupMsg({ text: 'Export cancelled.' });
    await markBackedUp(db, file.exportedAt);
    setBackupMsg({ text: result === 'shared' ? 'Backup shared.' : 'Backup downloaded.' });
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
      setBackupMsg({ text: `Imported ${counts || 'nothing'}. ${warnings.join(' ')}`.trim() });
    } catch (err) {
      setBackupMsg({ text: err instanceof ImportError ? err.message : 'Import failed.', error: true });
    }
    input.value = '';
  };

  return (
    <main class="screen">
      <header class="bar"><h1>Settings</h1></header>
      <h2>Appearance</h2>
      <label>
        Appearance
        <select data-testid="appearance" value={settings.appearance ?? 'light'} onChange={(e) => saveSettings(db, { appearance: e.currentTarget.value as Appearance })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>

      <h2>Goals</h2>
      <DirectionChoices direction={settings.goalDirection ?? 'lose'} onChange={(goalDirection) => saveSettings(db, { goalDirection })} />
      <label>
        Goal weight (lb)
        <input
          inputMode="decimal"
          value={goalDraft}
          onFocus={() => { goalFocused.current = true; }}
          onBlur={() => { goalFocused.current = false; }}
          onInput={(e) => setGoalDraft(e.currentTarget.value)}
          onChange={(e) => { const v = Number(e.currentTarget.value); if (Number.isFinite(v) && v > 0) saveSettings(db, { goalWeightLb: v }); }}
        />
      </label>
      <h2>Activities</h2>
      <ActivityChoices activities={enabledActivities(settings)} onChange={(activities) => {
        setActivityError(!activities.length);
        if (activities.length) void saveSettings(db, { activities });
      }} />
      {activityError && <p role="status">Keep at least one activity enabled.</p>}

      <h2>Pool</h2>
      {pool ? (
        <>
          <label>
            Pool unit
            <select value={pool.poolUnit} onChange={(e) => saveSettings(db, { poolUnit: e.currentTarget.value as PoolUnit })}>
              <option value="yd">yards</option>
              <option value="m">meters</option>
            </select>
          </label>
          <label>
            Pool length
            <input inputMode="decimal" value={pool.poolLength} onChange={(e) => { const v = Number(e.currentTarget.value); if (Number.isFinite(v) && v > 0) saveSettings(db, { poolLength: v }); }} />
          </label>
        </>
      ) : (
        <>
          <p>Set on first swim</p>
          <button type="button" class="btn" onClick={() => setShowPool(true)}>Set pool</button>
          {showPool && <PoolSheet onClose={() => setShowPool(false)} />}
        </>
      )}
      <h2>Program start</h2>
      <label>
        Program start (week 1)
        <input type="date" value={settings.programStart} onChange={(e) => { if (e.currentTarget.value) saveSettings(db, { programStart: e.currentTarget.value }); }} />
      </label>

      <h2>Backup</h2>
      <p>Last backup: {backupLabel}</p>
      <button type="button" onClick={() => doExport(true)}>Export (share)</button>
      <button type="button" onClick={() => doExport(false)}>Download backup</button>
      <label class="filebtn">
        Import backup
        <input class="visually-hidden" type="file" accept=".json,application/json" onChange={doImport} />
      </label>
      {backupMsg && (
        <p role={backupMsg.error ? 'alert' : 'status'} class={backupMsg.error ? 'warn' : 'ok'} data-testid="backup-message">{backupMsg.text}</p>
      )}
      <details data-testid="developer">
        <summary>Developer</summary>
        <FeedbackList onMessage={setMessage} />
        {message && <p role="status" class="ok">{message}</p>}
        <p>{persisted === true ? 'Storage: persistent' : persisted === false ? 'Storage: best-effort' : 'Storage: unknown'}</p>
        <p>Running as Home Screen app: {isStandalone() ? 'yes' : 'no'}</p>
      </details>
      <p class="dim">gym-plan v{__APP_VERSION__}</p>
    </main>
  );
}
