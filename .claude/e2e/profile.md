# e2e profile — gym-plan

- **App:** offline-first PWA, Vite + Preact. Served for e2e by `vite preview` at
  `http://localhost:4173/gym-plan/` (Vite `base: '/gym-plan/'`).
- **Deployed:** `https://chrisanderson27.github.io/gym-plan/` (GitHub Pages, built from `main` by `.github/workflows/deploy.yml`, ~6 min after a push; `gh run watch <id>`). It opens on the sign-in gate; *Continue as guest* gives a fresh local profile, so it is safe to drive.
- **Auth:** env builds (a `.env` with Supabase vars, which is the `[app] start` build) open on the sign-in gate; tap *Continue as guest* for today's local-only app. Keyless builds have no gate.
- **Live auth runs:** test sign-in against the local Supabase stack, never the hosted project: `node scripts/live-server.mjs` serves a local-stack build at `http://127.0.0.1:4174/gym-plan/`. Confirmation and reset mail lands in Mailpit at `http://127.0.0.1:54324` (`GET /api/v1/search?query=to:<addr>`, then `GET /api/v1/message/<ID>`; the link is in `Text`). Open the link in the same browser session, because the PKCE verifier is in that session's localStorage. To return to the gate, use Settings → Account → Sign out (it clears this device's data and the auth and guest keys), or remove `gym-plan:auth` and `gym-plan:guest` from localStorage. Delete account is disabled offline.
- **First run:** the app opens on Today with seeded default settings; there is no onboarding, no weight/goal/activity question. The pool is asked on the first Swim (PRD 4 P8).
- **Viewport:** design target is an iPhone (one-handed, light theme always; there is no Appearance control since PRD 4 P8). Prefer a ~390×844 viewport.
- **Service worker:** registers with `registerType: 'prompt'`; an update shows a prompt, never reloads.

## Learned quirks

- **Two-device sync runs (PRD 5 P3):** use two named browser sessions as two devices. Trigger a sync with `eval "document.dispatchEvent(new Event('visibilitychange'))"`, and foreground both devices once more before asserting, because the first foreground can pull before the other device's push lands. `set offline on|off` toggles offline. The pending count is the `syncOutbox` store in IndexedDB.
<!-- e2e workers append here -->

### Seed rest-day Today inside the current program week
_Learned 2026-11-20 · costs: one re-import_
**You'll see:** after seeding finished sessions on each of the previous 5 days, Today still shows `hero-state` `data-state=workout`, not `rest`.
**Do:** rest is due when the **program week** (counted from `settings.programStart`, not Mon–Sun) has its training days used. Set `programStart` to today − 5 d so all 5 seeded days fall in the current week, and re-import with a later `settings.updatedAt`.
**Where:** `#/` rest hero.

### Seeded lift sessions need lift blocks for Again
_Learned 2026-11-20 · costs: one dead end and a source lookup_
**You'll see:** **Do this again** on a seeded lift (session `blocks: []`, sets only) opens `#/again/<id>` with the heading "Nothing to run". Real lift sessions store `lift` blocks, so this is a seed artifact, not a bug.
**Do:** to test Again on a lift, finish a real session first (for example Progress → Build a workout → Save → Start → Done ×2 → Finish → Right), then open its card. A seeded legacy `interval` Burn repeats fine.
**Where:** `#/history/<id>` → `#/again/<id>`.

### Centre Builder Save/Start before clicking
_Obsolete since PRD 4 P8: `#/builder` redirects to `#/workouts` or `#/mine/<id>`._
_Learned 2026-11-20 · costs: one silent missed Save and a DB check_
**You'll see:** on `#/builder` with one block, `find testid builder-save click` prints Done but nothing saves (no navigation, `templates` store empty): the button sits at the viewport bottom under the fixed tab bar.
**Do:** `eval "document.querySelector('[data-testid=builder-save]').scrollIntoView({block:'center'})"`, re-snapshot, click by ref; expect URL `#/progress` with the template under `my-workouts`.
**Where:** `#/builder`, `#/builder/<id>`.

### Count taps with one listener per page load
_Learned 2026-11-19 · costs: one recount of the 2-tap check_
**You'll see:** a `document.addEventListener('click', …)` tap counter reads 6 after 2 taps, because `open` of a `#/` hash URL does not reload the SPA, so counters from earlier checks keep firing.
**Do:** `reload` on `#/` before adding the counter (or guard it with a `window.__tapc` flag), then click `getByTestId('start')` and **Warm-up done**.
**Where:** `#/` → `#/lift/session/<id>` 2-tap check.

### Recorder can freeze minutes into a run; kill only your own daemon and re-seed
_Learned 2026-11-18 · costs: a killed session and a re-onboard + re-import_
**You'll see:** `run.webm` stops growing a few minutes in (it stays at about 3 MB) while commands keep working. Later, `record stop` fails with os error 35, and every command (even `get url`) hangs.
**Do:** check that `run.webm` is still growing during long sweeps. Better, record only short clips (`record start … --fps 10`, then stop within about a minute). If the session hangs, `kill -KILL` the daemon that is the parent of *your* ffmpeg, its Chrome and that ffmpeg. The browser profile is lost, so reopen, onboard and re-import the seed. Also note there is no `find … select`; use `select @<ref> "Dark"` after `snapshot -i`.
**Where:** any recorded visual sweep; `#/settings` Appearance.

### Centre a lift card button before clicking; the sticky header covers it
_Learned 2026-11-18 · costs: one refused click_
**You'll see:** `click @<Swap ref>` fails with "Element is covered by <h1 inside div#app>", because `scrollintoview` puts the button at the top, under the sticky session header.
**Do:** `eval "[...document.querySelectorAll('[data-testid=exercise-<ex>] button')].find(b=>b.textContent.trim()==='Swap').scrollIntoView({block:'center'})"`, then re-snapshot and click. Note that `pose-<ex>` testids use the exercise id (`romanian-deadlift`), not the poseId (`hinge`).
**Where:** `#/lift/session/<id>`.

### Wrap journey.py in a script; zsh won't word-split `$J`
_Learned 2026-11-18 · costs: one failed batch of commands_
**You'll see:** `J="python3 …/journey.py"; $J start …` fails with `no such file or directory: python3 …/journey.py` (the Bash tool's shell is zsh). macOS also has no `timeout`.
**Do:** write a tiny executable wrapper in the scratchpad that exports `JOURNEY_DIR` and `exec python3 …/journey.py "$@"` (inject `--session <name>` for `ab`), and call that. For a "fresh session" in the same browser, delete the DB from the manifest URL (see below) and re-onboard; prove restore with a re-export diff.
**Where:** any orchestrated run.

### Wrap journey.py in a script; zsh won't word-split `$J`
_Learned 2026-11-18 · costs: one failed batch of commands_
**You'll see:** `J="python3 …/journey.py"; $J start …` fails with "no such file or directory: python3 …/journey.py" (the Bash tool runs zsh).
**Do:** write a tiny executable wrapper in the scratchpad that exports `JOURNEY_DIR` and execs `python3 journey.py "$@"` (with a `b` shortcut for `ab --session <name>`), and call it by path. macOS has no `timeout`; give `record stop` its own Bash call with a long tool timeout.
**Where:** every orchestrated run.

### Lift Equipment/Swap sheets render at the page bottom; find hidden sideways scroll by bisecting
_Learned 2026-11-18 · costs: two blank screenshots and a hunt for an overflow no element rect showed_
**You'll see:** after clicking Equipment ▾ or Swap on a lift card, nothing changes in the viewport, because the `.sheet` is static, after the last exercise. Separately, `documentElement.scrollWidth` > `clientWidth` while no element's `getBoundingClientRect().right` exceeds the viewport.
**Do:** (sheet part superseded on 05ad43b — lift sheets are now fixed overlays, see below.) For overflow, hide `main section > *` / `.card > *` one by one (`style.display='none'`) and re-read scrollWidth. Long unbreakable text, such as the Settings feedback row's ULID/route, is the usual cause.
**Where:** `#/lift/session/<id>`, `#/settings`.

### Import errors are role=alert below the fold; prove restore by re-export diff
_Learned 2026-11-17 · costs: a 25 s wait timeout and a re-shot screenshot_
**You'll see:** `wait --text "Settings"` after onboarding times out (Home's Settings link is an icon-only ⚙). A rejected import's message is `<p role="alert" data-testid="backup-message">`, not `role=status`, and sits below the fold at 390×844.
**Do:** wait on `getByTestId('tile-pick')` or snapshot instead. Scroll `[data-testid=backup-message]` into view before the screenshot. For "identical data" after import, download a re-export with `download @<Download backup ref> <path>` (launch with `--download-path`) and diff `stores` against the original, ignoring `settings.backupAt`/`updatedAt`.
**Where:** `#/`, `#/settings`.

### Name a Builder session before Start
_Learned 2026-11-17 · costs: one dead click and a source lookup_
**You'll see:** on `#/builder` with blocks added, **Start** and **Save** stay greyed out and clicking does nothing; no hint is shown.
**Do:** fill `[data-testid=builder-name]` first (`ok` = name non-empty and ≥1 block), then click `builder-start`; it navigates to `#/lift/session/<id>`.
**Where:** `#/builder`.

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
**Do:** Burn **Start** and Run **Start timer** open a "Ready" screen first (updated 2026-11-19); tap its **Start**, then loop `find testid timer-skip click` until the text `Session complete` appears (~27 skips for a 30 min Burn, ~13 for Run intervals). Run's Save stays disabled until an RPE is picked. Read the phase from `[data-testid=timer]` `data-role` (warmup/cooldown blue, work red, rest green, transition grey). Confirm saved rows by reading IndexedDB `gym-plan` stores `sessions`, `runs`, `swims`, `tests` with `eval`.
**Where:** `#/burn`, `#/run` timer; `#/swim`.

### Stop the recording in its own command before finish/close
_Learned 2026-11-17 · costs: a 2-min hung command, a failed `record stop`_
**You'll see:** after a ~10 min session, `record stop` chained with `finish` and `close` hits the 120 s Bash timeout, then fails with "Resource temporarily unavailable (os error 35) … daemon may be busy".
**Do:** run `record stop` alone with `run_in_background` (or a long timeout), wait for it to exit, then `finish` and `close`. Pick a pose-less exercise for text cues with Swap → `Assisted dip` on chest press.
**Where:** the end of any recorded run.

### Wait for the value before ticking a row you just adjusted
_Learned 2026-11-18 · costs: one silent missed tick and a retry_
**You'll see:** a `+`/`−` click (scoped `eval`), then straight away `find testid set-done-<ex>-<idx> click`, prints Done but the row never gets class `done`.
**Do:** after an adjust, `get text '[data-testid=set-weight-<ex>-<idx>]'` until it shows the new value, then tick. Confirm the tick with `get attr '[data-testid=set-<ex>-<idx>]' class`, and retry via a fresh `snapshot -i -s` ref if needed.
**Where:** `#/lift/session/<id>`.

### Swap and Equipment sheets are fixed bottom sheets (since 05ad43b)
_Updated 2026-11-18 · was: inline at page bottom (pre-05ad43b)_
**You'll see:** tapping Swap or the equipment `▾` opens a `[role=dialog]` `.sheet.overlay` (position fixed) over a dimmed page; a viewport screenshot captures it directly. The equipment link is named `<Exercise> — <Equipment> ▾` once an exercise has its own equipment, plain `<Equipment> ▾` otherwise.
**Do:** read options with `snapshot -i -s '[role=dialog]'`; no scrolling needed. After a ref-click, the button under the pointer keeps a grey hover fill in later screenshots — that is the lingering hover state, not a selected state.
**Where:** `#/lift/session/<id>`.

### Wrap journey.py in a script; zsh won't word-split `$J`
_Learned 2026-11-18 · costs: one failed command batch_
**You'll see:** `J="python3 …/journey.py"; $J start …` fails with `no such file or directory: python3 …/journey.py` (zsh does not split unquoted variables).
**Do:** write a tiny bash wrapper in the scratchpad (`exec python3 …/journey.py "$@"`, with `JOURNEY_DIR` exported, `ab` adding `--session <name>`), `chmod +x` it and call it.
**Where:** any run from the zsh Bash tool.

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

### Freeze a pose frame by tapping the SVG; element screenshots of poses are offset
_Learned 2026-11-17 · costs: two blank screenshot cycles_
**You'll see:** `screenshot "[data-testid=pose-<ex>]"` saves the wrong region (blank or the header), and two fixed-delay viewport shots often land on the same phase.
**Do:** a click on the pose SVG toggles pause. In one async `eval`, sample the last near bone's `x2`/`y2` each rAF for ~3.5 s, wait until it is back at the min/max, then `dispatchEvent(new MouseEvent('click',{bubbles:true}))`. Take a viewport screenshot after `scrollIntoView({block:'center'})`, then click again to resume. Use the y axis for pulldown, RDL and squat, and x for press and row.
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

### Use `#/lift/start/<variant>` for lift + blocks; spy Wake Lock with an init script
_Learned 2026-11-19 · costs: one source lookup and a misread "no blocks" session_
**You'll see:** the bare `#/lift` picker Start builds straight sets only (no circuit blocks), and Wake Lock calls leave no visible trace.
**Do:** to get a "lift + blocks" session, use Today's Start or open `#/lift/start/<variant>` (for example `lower-b`). An open lift within 12 h is resumed instead. A stale one (>12 h) is not "open", so it is shown only on Today as "Unfinished lift from …". For Wake Lock, launch with `--init-script <file>` that wraps `navigator.wakeLock.request` and pushes `acquired`/`released` into `window.__wl`, then `eval "JSON.stringify(window.__wl)"`. Call the journey wrapper by its absolute path, not through a shell variable; each expansion triggers a permission prompt.
**Where:** `#/`, `#/lift`, `#/lift/session/<id>`.

### Give `screenshot` an absolute path
_Learned 2026-11-25 · costs: ~30 screenshots lost and re-taken_
**You'll see:** `screenshot .agents/…/media/x.png >/dev/null` prints nothing and no file appears; the daemon resolves relative paths against its own cwd.
**Do:** always pass an absolute path and keep the success line (don't redirect it), then `ls` the media dir after the first shot.
**Where:** any recorded run.
