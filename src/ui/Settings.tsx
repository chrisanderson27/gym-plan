import { useEffect, useState } from 'preact/hooks';
import { EXERCISES, exerciseById } from '../content';
import { EQUIPMENT_PREFS } from '../content/equipment-prefs';
import { buildExport, ImportError, importExport, markBackedUp, parseExport } from '../data/backup';
import { db } from '../data/db';
import { setNotAtMyGym } from '../data/lift';
import { useLiveQuery } from '../data/live';
import { enabledActivities, poolOf, saveSettings, toggleUnavailableEquipment } from '../data/settings';
import type { PoolUnit, Settings as SettingsRow } from '../data/types';
import { daysBetween, localDate } from '../engine/dates';
import type { Activity } from '../engine/plan/activities';
import { weekIndex } from '../engine/week';
import { isStandalone } from '../platform/display';
import { deliverFile, backupFileName } from '../platform/share';
import { isPersisted } from '../platform/storage';
import { FeedbackList } from './feedback/FeedbackList';
import { ArrowRightIcon, CalendarIcon, ChevronIcon, PersonIcon, PlusIcon, WorkoutsIcon } from './icons';
import { PoolSheet } from './PoolSheet';
import { Sheet } from './Sheet';

declare const __APP_VERSION__: string;

export function SettingsScreen({ settings }: { settings: SettingsRow }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const [activityError, setActivityError] = useState(false);
  const [showPool, setShowPool] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const overrides = useLiveQuery(() => db.exerciseOverrides.toArray(), []);
  const excluded = (overrides ?? []).filter((row) => row.notAtMyGym);
  const excludedIds = new Set(excluded.map((row) => row.exerciseId));
  const unavailable = new Set(settings.unavailableEquipment ?? []);
  const activities = enabledActivities(settings);
  const week = weekIndex(localDate(new Date()), settings.programStart);
  const toggleActivity = (activity: Activity, on: boolean) => {
    const next = on ? [...new Set([...activities, activity])] : activities.filter((item) => item !== activity);
    setActivityError(!next.length);
    if (next.length) void saveSettings(db, { activities: next });
  };
  const toggleEquipment = (id: string, available: boolean) => {
    void toggleUnavailableEquipment(db, id, !available);
  };
  const choices = EXERCISES.filter((exercise) => !exercise.retired && !excludedIds.has(exercise.id));
  const pool = poolOf(settings);
  // Backup result sits next to the backup controls; feedback results stay under the feedback section.
  const [backupMsg, setBackupMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => {
    isPersisted().then(setPersisted);
  }, []);

  const backupLabel = (() => {
    if (!settings.backupAt) return 'never';
    const days = daysBetween(localDate(new Date(settings.backupAt)), localDate(new Date()));
    return days <= 0 ? 'today' : `${days} days ago`;
  })();

  const doExport = async (preferShare: boolean) => {
    const file = await buildExport(db, undefined, __APP_VERSION__);
    const result = await deliverFile(backupFileName(new Date(file.exportedAt)), JSON.stringify(file), { preferShare });
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
    <main class="screen preferences">
      <header class="pref-top">
        <div class="pref-brand">
          <span class="pref-mark" aria-hidden="true"><svg width="16" height="19" viewBox="0 0 16 19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
          <p class="wordmark">Gym Plan.</p>
        </div>
        <p class="week-chip"><CalendarIcon />Week {week}</p>
      </header>
      <p class="pref-eyebrow"><svg class="pref-dot" width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="3" fill="currentColor" /></svg>Make it yours</p>
      <h1>Preferences</h1>
      <p class="pref-lead">These settings shape future recommendations, not just today.</p>

      <section class="card">
        <div class="pref-head">
          <span class="pref-tile pref-tile-peach" aria-hidden="true"><PersonIcon /></span>
          <div>
            <h2>Excluded exercises</h2>
            <p class="pref-support">We won’t recommend these or offer them as swaps.</p>
          </div>
        </div>
        {excluded.length === 0 ? <p class="pref-empty">No exercises excluded.</p> : excluded.map((row) => {
          const name = exerciseById.get(row.exerciseId)?.name ?? row.exerciseId;
          return (
            <p key={row.exerciseId} class="pref-copy">
              <span>{name}</span>
              <button type="button" onClick={() => { void setNotAtMyGym(db, row.exerciseId, false); }}>Remove {name}</button>
            </p>
          );
        })}
        <button type="button" class="pref-exclude" onClick={() => setExcludeOpen(true)}><PlusIcon />Exclude an exercise</button>
      </section>

      <section class="card">
        <div class="pref-head">
          <span class="pref-tile pref-tile-mint" aria-hidden="true"><WorkoutsIcon /></span>
          <div>
            <h2>Available equipment</h2>
            <p class="pref-support">We’ll favor movements you can do in your gym.</p>
          </div>
        </div>
        <div class="pref-equip-head">
          <span>Equipment checklist</span>
          <ChevronIcon />
        </div>
        {EQUIPMENT_PREFS.map((row) => (
          <label key={row.id} class="check pref-equip">
            <input type="checkbox" checked={!unavailable.has(row.id)} onChange={(e) => toggleEquipment(row.id, e.currentTarget.checked)} />
            <span>{row.label}</span>
          </label>
        ))}
      </section>

      <section class="card">
        <h2>Workout cues & activities</h2>
        <label class="check pref-cue">
          <span class="pref-copy">
            <span class="pref-cue-title">Sound cues</span>
            <span class="pref-cue-sub">Chime at station changes and block finishes.</span>
          </span>
          <input type="checkbox" checked={settings.soundCues !== false} onChange={(e) => { void saveSettings(db, { soundCues: e.currentTarget.checked }); }} />
        </label>
        <label class="check pref-cue">
          <span class="pref-copy">
            <span class="pref-cue-title">Swimming</span>
            <span class="pref-cue-sub">Show simple lap-pool sessions.</span>
          </span>
          <input type="checkbox" checked={activities.includes('swim')} onChange={(e) => toggleActivity('swim', e.currentTarget.checked)} />
        </label>
        {activityError && <p role="status">Keep at least one activity enabled.</p>}
        {activities.includes('swim') && (
          <>
            <a class="training-link" href="#/swim" data-testid="pref-swim-open">Open lap swim <ArrowRightIcon /></a>
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
                <button type="button" class="btn" onClick={() => setShowPool(true)}>Set pool</button>
                {showPool && <PoolSheet onClose={() => setShowPool(false)} />}
              </>
            )}
          </>
        )}
      </section>

      {excludeOpen && (
        <Sheet label="Exclude an exercise" onClose={() => setExcludeOpen(false)}>
          <h2>Exclude an exercise</h2>
          <div class="sheet-options">
            {choices.map((exercise) => (
              <button key={exercise.id} type="button" onClick={() => { void setNotAtMyGym(db, exercise.id, true); setExcludeOpen(false); }}>{exercise.name}</button>
            ))}
          </div>
        </Sheet>
      )}

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
