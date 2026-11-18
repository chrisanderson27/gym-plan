# e2e profile — gym-plan

- **App:** offline-first PWA, Vite + Preact. Served for e2e by `vite preview` at
  `http://localhost:4173/gym-plan/` (Vite `base: '/gym-plan/'`).
- **Auth:** none. Single user, all data in IndexedDB on the device.
- **First run:** onboarding asks bodyweight, goal weight, pool unit and length. A fresh browser
  profile always lands there; clear site data to reset.
- **Viewport:** design target is an iPhone (one-handed, light theme default; Appearance in Settings: System/Light/Dark, `<html data-theme>` holds the preference). Prefer a ~390×844 viewport.
- **Service worker:** registers with `registerType: 'prompt'`; an update shows a prompt, never reloads.

## Learned quirks
<!-- e2e workers append here -->

### Age backupAt in IndexedDB to show the backup banner
_Learned 2026-11-17 · costs: one wasted re-import_
**You'll see:** no "Last backup N days ago" banner after a seed import, because importing stamps `settings.backupAt` = file `exportedAt`, so a lower `backupAt` in the file is ignored.
**Do:** after importing, `eval` an IndexedDB write. Open `gym-plan`, get `settings`/`settings`, set `backupAt` to now − 20 d, put it back, then reload. Onboarding has no Appearance control, so for a Dark onboarding shot set `document.documentElement.dataset.theme='dark'` and say it was forced.
**Where:** `#/` banner, `#/settings`.

### Keep video runs short; `record stop` can hang the daemon
_Learned 2026-11-17 · costs: ~5 min of stalled commands_
**You'll see:** after a ~40-min headed run, `record stop` fails with "Resource temporarily unavailable (os error 35)". Later commands to that session time out, and `run.webm` has frames but no duration header.
**Do:** stop and restart recording for each segment (light pass, dark pass), or stop the recording before a long screenshot sweep. Run `close` in the background and don't block on it.
**Where:** any long visual sweep.

### Stop the recording on its own before close when sessions run in parallel
_Learned 2026-11-17 · costs: ~10 min of hung commands and a partial run.webm_
**You'll see:** with several parallel sessions recording, `record stop` fails with "Resource temporarily unavailable (os error 35) … daemon may be busy". After that, `close` hangs forever while the daemon and its ffmpeg sit idle at 0% CPU.
**Do:** run `record stop` as its own command and check that it printed success before you `finish`/`close`. If it is wedged, find your own daemon: it is the parent PID of the ffmpeg whose output path is your `media/run.webm` (`ps -o pid,ppid,command`). SIGTERM is ignored, so `kill -KILL` that daemon, its Chrome child and that ffmpeg, then check `agent-browser session list`. Note in media/index.md that the webm is partial.
**Where:** any parallel orchestrated run.

### Reset a session's data from a non-app URL; import never lowers backupAt
_Learned 2026-11-17 · costs: one wasted import + a blocked delete per run_
**You'll see:** importing an old backup leaves "Last backup: today" (import keeps the newest backupAt), and `indexedDB.deleteDatabase('gym-plan')` from `about:blank` throws / from an app page stays blocked.
**Do:** to test the stale-backup banner, wipe first: `open http://localhost:4173/gym-plan/manifest.webmanifest`, `eval` deleteDatabase there (resolves `deleted`), reopen the app, onboard, then import a file with old `exportedAt` + `settings.backupAt` and `settings.updatedAt` in the future.
**Where:** `#/settings`, Home banner.

### Offline reload reports navigator.onLine true; probe with an uncached fetch
_Learned 2026-11-17 · costs: one verification round_
**You'll see:** after `set offline on` + `reload`, `navigator.onLine` reads `true`, but the network is still blocked. A plain `open` of a hash route doesn't make the SW control the page either.
**Do:** `reload` once online first, so `navigator.serviceWorker.controller` is set. Then go offline, reload, and prove it with `eval "fetch('/gym-plan/x-'+Date.now()).catch(e=>'failed')"`.
**Where:** offline / service worker checks.

### Drive cardio timers with Skip and read phase from data-role
_Learned 2026-11-17 · costs: a source lookup per run; real-time Burn is 30–60 min_
**You'll see:** Burn/Run timers run in real time; phase colour is only a background colour.
**Do:** loop `find testid timer-skip click` until the text `Session complete` appears (~27 skips for a 30 min Burn). Read the phase from `[data-testid=timer]` `data-role` (warmup/cooldown blue, work red, rest green, transition grey). Confirm saved rows by reading IndexedDB `gym-plan` stores `sessions`, `runs`, `swims`, `tests` with `eval`.
**Where:** `#/burn`, `#/run` timer; `#/swim`.

### Stop the recording in its own command before finish/close
_Learned 2026-11-17 · costs: a 2-min hung command, a failed `record stop`_
**You'll see:** after a ~10 min session, `record stop` chained with `finish` and `close` hits the 120 s Bash timeout, then fails with "Resource temporarily unavailable (os error 35) … daemon may be busy".
**Do:** run `record stop` alone with `run_in_background` (or a long timeout), wait for it to exit, then `finish` and `close`. Pick a pose-less exercise for text cues with Swap → `Assisted dip` on chest press.
**Where:** the end of any recorded run.

### Re-snapshot after ticking a set row
_Learned 2026-11-18 · costs: one verification eval per run_
**You'll see:** after the first ✓ on a lift set row, a "pain" button appears in that row and every later `@ref` on the session screen shifts.
**Do:** re-snapshot between ticks, or verify with `[data-testid=set-<exercise>-<idx>]` (class `done`). Never reuse refs from before the first tick.
**Where:** `#/lift/session/<id>`.

### Scope weight/reps +/− buttons to their set row
_Learned 2026-11-18 · costs: one silent data change and a revert_
**You'll see:** every set row and calibration row has buttons named "weight up", "weight down", "reps up", "reps down"; `find role button click --name "weight up"` hits the first one on the page (usually a logged chest-press set) and silently changes its saved weight.
**Do:** scope the click: `eval "document.querySelector('[data-testid=set-<ex>-<idx>] [aria-label=\"weight up\"]').click()"` (or `[data-testid=exercise-<ex>] …` for calibration rows), then confirm with `get text '[data-testid=set-weight-<ex>-<idx>]'`.
**Where:** `#/lift/session/<id>`.

### Judge pose animations from polled frames, not fixed-delay screenshots
_Learned 2026-11-17 · costs: several wasted screenshot cycles_
**You'll see:** pose SVGs (`[data-testid=pose-<exercise>]`, ~140px tall) animate continuously, so a fixed-delay screenshot rarely lands on the frame you need, and they are too small to judge.
**Do:** enlarge them with `eval "document.querySelectorAll('svg.pose').forEach(s=>s.style.height='260px')"`. Then poll the near-limb bone coordinates (`line.bone:not(.far)`, index 4 = upper arm) with `eval` until the frame you want appears, and screenshot. Use `set media dark reduced-motion` and reload for the static filmstrip (`data-static="true"`). To screenshot an exact frame, poll inside one async `eval` each rAF, and on a match replace `requestAnimationFrame` with a stub that pushes callbacks to `window.__held`. Screenshot, then restore the original and re-queue the held callbacks so the loop resumes. Inline height is lost on route change, so re-apply it.
**Where:** `#/lift/session/<id>`.

### Date seeded "yesterday" sessions by calendar day, not hours
_Learned 2026-11-17 · costs: one re-import per run_
**You'll see:** a session seeded at `now − 20 h` lands on *today* when the run is late in the day, so every tile turns "warned · already trained today" and the pick reasons change.
**Do:** for "yesterday", use `now − 26 h` or noon of the previous local day. Re-importing the same session id with a later `settings.updatedAt` overwrites its date.
**Where:** `#/` Home statuses / Today's pick.

### Seed lift history via Settings → Import backup
_Learned 2026-11-18 · costs: none if known; otherwise a whole calibration session_
**You'll see:** a fresh profile has no lift history, so every exercise shows a calibration card and progression cannot be tested.
**Do:** after onboarding, upload a backup JSON (shape in `e2e/lifting.spec.ts`) via `Import backup`; set `settings.updatedAt` ahead of now so it wins the merge and `programStart` = today − 28 d (week 5). Wait for status `Imported sessions: …`.
**Where:** `#/settings`.
