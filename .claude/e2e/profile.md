# e2e profile — gym-plan

- **App:** offline-first PWA, Vite + Preact. Served for e2e by `vite preview` at
  `http://localhost:4173/gym-plan/` (Vite `base: '/gym-plan/'`).
- **Auth:** none. Single user, all data in IndexedDB on the device.
- **First run:** onboarding asks bodyweight, goal weight, pool unit and length. A fresh browser
  profile always lands there; clear site data to reset.
- **Viewport:** design target is an iPhone (one-handed, dark mode default). Prefer a ~390×844 viewport.
- **Service worker:** registers with `registerType: 'prompt'`; an update shows a prompt, never reloads.

## Learned quirks
<!-- e2e workers append here -->

### Drive cardio timers with Skip and read phase from data-role
_Learned 2026-11-17 · costs: a source lookup per run; real-time Burn is 30–60 min_
**You'll see:** Burn/Run timers run in real time; phase colour is only a background colour.
**Do:** loop `find testid timer-skip click` until the text `Session complete` appears (~27 skips for a 30 min Burn). Read the phase from `[data-testid=timer]` `data-role` (warmup/cooldown blue, work orange, rest green, transition grey). Confirm saved rows by reading IndexedDB `gym-plan` stores `sessions`, `runs`, `swims`, `tests` with `eval`.
**Where:** `#/burn`, `#/run` timer; `#/swim`.

### Re-snapshot after ticking a set row
_Learned 2026-11-18 · costs: one verification eval per run_
**You'll see:** after the first ✓ on a lift set row, a "pain" button appears in that row and every later `@ref` on the session screen shifts.
**Do:** re-snapshot between ticks, or verify with `[data-testid=set-<exercise>-<idx>]` (class `done`). Never reuse refs from before the first tick.
**Where:** `#/lift/session/<id>`.

### Seed lift history via Settings → Import backup
_Learned 2026-11-18 · costs: none if known; otherwise a whole calibration session_
**You'll see:** a fresh profile has no lift history, so every exercise shows a calibration card and progression cannot be tested.
**Do:** after onboarding, upload a backup JSON (shape in `e2e/lifting.spec.ts`) via `Import backup`; set `settings.updatedAt` ahead of now so it wins the merge and `programStart` = today − 28 d (week 5). Wait for status `Imported sessions: …`.
**Where:** `#/settings`.
