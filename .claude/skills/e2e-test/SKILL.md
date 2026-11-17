---
name: e2e-test
version: 1.0.0
description: >-
  Drive a running web application end-to-end in a real headed browser via the agent-browser CLI, to
  confirm a change actually works for a user. App-specific knowledge — base URL, login flow, gates,
  access codes, screen quirks — is NOT in this skill; it lives in a per-app profile the skill reads at
  the start of every run and appends to whenever a run learns something new. Use whenever a ticket,
  plan, PRD phase, or the user asks for an e2e / live / manual browser test. Assumes the app is already
  running; if it is not, this skill stops and fails loudly rather than starting it.
---

# e2e-test — drive the live app

Generic mechanics live here. **Everything true of one particular application lives in that
application's profile**, which this skill reads first and writes back to as it learns. That split is
the whole design: the skill is portable, the profile is the memory.

## The profile — read it before you touch the browser

Resolve it in this order and stop at the first hit:

1. `$E2E_PROFILE` (absolute path), if set.
2. `<repo root>/.claude/e2e/profile.md` — the default. Tracked in git; it is knowledge, not state.
3. No profile → **you are on an app this skill has never driven.** Do not guess. Run the
   bootstrapping flow at the bottom of this file, which builds the profile *with* the user.

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROFILE="${E2E_PROFILE:-$ROOT/.claude/e2e/profile.md}"
[ -f "$PROFILE" ] && cat "$PROFILE" || echo "NO PROFILE — bootstrap required"
```

Read it in full. It is written to be short enough to read in full; if it has stopped being that,
consolidate it (see *Keeping the profile from rotting*).

**Never put a secret in the profile.** It is a tracked file. Credentials are named there, not stated:
the profile says *"username from `$E2E_USER`, password from `$E2E_PASS`, post-login access code from
`$E2E_ACCESS_CODE`"*, and the values come from the environment or a gitignored `.env`. A profile that
contains a literal password is a bug — fix it, don't copy it forward.

## Rule 0 — the app must already be running. Do not start it.

Confirm before anything else, against the profile's `base_url`:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE_URL" --max-time 5
```

- A response (any HTTP status) → up, continue.
- Refused / timeout → **stop immediately.** Do not `dotnet run`, `npm start`, `docker compose up`, or
  bring it up any other way. Say plainly that the app is not running at `$BASE_URL` and that starting
  it is out of scope, then wait.

If the profile defines a `ready_probe` (some apps answer on the port before they are actually
serving — a reverse proxy, a system service on the same port), use it instead of a bare status check.

## Rule 1 — all browser work goes through agent-browser, and read its own guide first

Every interaction — navigate, click, type, snapshot, screenshot, record — uses the `agent-browser`
CLI, headed, so a watching human can follow.

⛔ **Before your first command, load agent-browser's own core skill:**

```bash
agent-browser skills get core --full
```

It ships WITH the CLI and is always version-matched, so it is the correct reference for whatever
version this machine has — which matters, because the command surface moves between versions. Do not
rely on a memorised or vendored copy; pull it fresh. It covers the snapshot → `@ref` → click loop,
waiting, forms, auth, and parallel sessions.

**Session:** use agent-browser's own per-worktree id — the core skill documents this exact form:

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix "${E2E_SESSION_PREFIX:-e2e}")"
agent-browser --headed open "$BASE_URL"
agent-browser set viewport 1920 1000
```

With `AGENT_BROWSER_SESSION` exported, every later command uses it — no need to repeat `--session`.
The default (unnamed) session is shared across every agent on the machine and persists across
conversations, so a named session is not optional. **When the orchestrator hands you a session name,
export that verbatim and skip `session id`.**

> Version note: on agent-browser **0.14.0**, `session id --scope worktree` did not exist and silently
> printed `default`. It works from later versions (verified on 0.37.0). If `agent-browser --version`
> shows 0.14.x, derive the name yourself instead:
> `AGENT_BROWSER_SESSION="${E2E_SESSION_PREFIX:-e2e}-$(basename "$(git rev-parse --show-toplevel)")"`.

## Rule 2 — self-heal by asking, don't guess

This skill plus the profile cover the known paths. **The moment the app doesn't match — an unexpected
modal, a button that won't respond, a screen you don't recognise, a flow that dead-ends — stop, say
what you see and where you're stuck, and ask.** A wrong guess on a live app can mutate real shared
data. "I'm on X, I expected Y, here's the snapshot" always beats improvising past it. Screenshot and
describe when you pause.

**Exception — unattended runs.** When a caller states there is no human (the prd-orchestrator's e2e
gate does), do not ask: write `RESULT: blocked` with the observed-vs-expected and stop. Blocking
loudly is the unattended form of asking.

## Rule 3 — validate the outcome, never the element

"The button exists" is not a pass. Drive the whole user workflow: fill forms with valid data, submit,
and confirm **the intended outcome actually occurred** — data saved, page navigated, confirmation
shown, value rendered, list row appeared. Watch for error banners, HTTP 4xx/5xx, console errors and
validation failures; any of those is a fail.

Judge strictly against the acceptance criteria you were given. Capture at least one screenshot per
criterion and note the paths.

## Rule 4 — close the browser on every exit path

```bash
agent-browser --session "$SESSION" close
```

Mandatory on pass, fail, blocked, and error. The headed browser window does not close itself; skipped
closes pile up into orphaned windows across runs. If the profile has a *Cleanup* section (a license or
machine you grabbed, a record you created), do that too — leave the environment as you'd want to find
it.

## Rule 5 — record the run, always

⛔ **Drive every browser command through `journey ab`.** It is the only way to drive: the shim passes
each command to agent-browser unchanged and records what it did into `journey.json` — the input for a
real Playwright test later. A run that bypasses it is recorded `journey: incomplete`.

```bash
J="python3 <this skill dir>/scripts/journey.py"   # the caller gives you its absolute path
export JOURNEY_DIR="<phase dir or evidence dir>"   # the caller names it; never guess
mkdir -p "$JOURNEY_DIR/media"
$J start --app <app> --source prd-phase|pr-evidence|test-plan|adhoc --ref prd=<slug>,phase=<n> \
   --story "<one line>" --criteria "<criterion 1>" --criteria "<criterion 2>" --base-url <url>
$J ab --session "$SESSION" record start "$JOURNEY_DIR/media/run.webm"   # video (needs ffmpeg)
$J ab --session "$SESSION" snapshot -i
$J ab --session "$SESSION" click @e12
$J ab --session "$SESSION" fill @e4 "KING"
$J fixture customer 4092 --name "Test Customer 4092"
$J fixture work-order 1834 --created
$J assert "Completed tab lists only claims with DateCompleted" --ok
$J ab --session "$SESSION" screenshot "$JOURNEY_DIR/media/02-toolbar-enabled.png"
$J ab --session "$SESSION" record stop
$J finish --result pass|fail|blocked
```

`--app` and `--story` are required; `start` refuses without them.

**Snapshot before acting** so each `@ref` resolves to role + accessible name. `note` / `assert` /
`wait` / `shot` add the intent a browser log cannot carry. Credentials are substituted with
`${E2E_*}` automatically (and `finish` refuses a journey that still holds one) — but still never type a
literal secret into Markdown. `finish` copies the journey into the wiki catalog
`.claude/e2e/journeys/`.

Record every customer, order or work order the run **used or created** with `fixture`; it becomes
the spec’s test-data header. Every journey needs at least one `assert`: one with none is cataloged
`journey: incomplete` (`no-assertion`) whatever its result.
`journey.py export-playwright <catalog>/journey.json` writes a draft `spec.ts` next to it.

**Capture the visuals too — they cost almost nothing and make the run reviewable.** Both are supported
by agent-browser out of the box:
- **Screenshots**, at least one per acceptance criterion (Rule 3 already requires the evidence): save
  them into `<phase dir>/media/` with a name that says what they show —
  `agent-browser screenshot "<phase dir>/media/02-toolbar-enabled.png"`. Use `--full` for a whole-page
  shot; `--annotate` overlays the `@ref` labels when you want to show *what was clickable*.
- **Video** of the whole phase run — `record start … .webm` / `record stop`, shown above. It needs
  `ffmpeg` on PATH; if `agent-browser doctor` reports ffmpeg missing, **skip the record commands and
  keep the screenshots** — do not fail the run over a missing recorder.

Everything under `<phase dir>/media/` is **gitignored** — it is temporary evidence for the current
run, never committed. Write a one-line `media/index.md` listing each file and the criterion it belongs
to, so the folder is browsable without opening every image. For a pass or fail this manifest is
required even when video is unavailable. The orchestrator promotes only a redacted, structured
scenario document into Git.

**Prefer `@ref` over a CSS selector when you act.** A ref resolves to a role+name locator, so a
ref-driven run records as `getByRole(…)` — portable and readable. A CSS-driven run records as
`locator('#u')`, which is tied to markup that will change. Same effort, better output.

**Then write two files** into the phase directory the caller names. Use the exact `capture.md` contract
in [reference/scenario-capture-template.md](reference/scenario-capture-template.md); promotion rejects
an unstructured capture.

**`capture.md`** records intent, acceptance criteria, prerequisites, safe literals, ordered steps,
outcome, cleanup and stability. Each step includes screen/URL, action, exact Playwright locator, input
classification, wait/trigger, assertion and evidence. Record the **role and accessible name**, not the
ref number — refs are per-snapshot and die on navigation, so `@e12` means nothing tomorrow. Note
anything that fought you: an element with no accessible name, a control that ignored a synthetic
click, a wait you needed.

⛔ **Never put a runtime secret in either Markdown file.** Use the environment-variable reference,
for example `${E2E_PASS}`, not its value. Trace-derived inputs and observations are redacted by default;
put a non-sensitive value under `## Safe literals` only when preserving the exact fixture or expected
text is useful for replay. Passwords, access codes, tokens, cookies and payment-card fields are never
safe literals. Single-token values, standalone numeric codes and compact mixed letter/number strings
are also rejected as secret-shaped; give a safe fixture meaningful context instead (for example
`Order 4092`). Static UI
labels needed in durable locators should be declared safe; unclassified accessible names are redacted.

**`manual.md`** — how a human verifies this by hand. Two parts, both required:

```markdown
**Before:** <the behaviour that existed prior to this change — say "new screen" if there was none>
**Now:** <what it does instead>

1. <click-by-click, starting from login; name the screen and how to reach it>
2. …
**You should see:** <the observable outcome, not the internal state>
```

Write it for someone who has never seen this feature. If the change altered existing behaviour, the
**Before** line is the most valuable line in the file — it is what a tester needs in order to notice a
regression, and it is the thing nobody can reconstruct later.

The worker writes raw evidence only and never commits. Immediately after the worker settles, the
caller must run `orchestrator.py promote-e2e --phase <n>` and then
`orchestrator.py validate-e2e --phase <n>`. That creates the tracked, redacted scenario under
`<[testing].dir>/scenarios/<prd>/`; the raw journey and media remain gitignored. The promoted scenario is
bound to this run's evidence checksum—including the media manifest—and validated against regenerated
output, so it must be promoted again after every retry and must not be hand-edited. If this run also
improved the tracked profile, the caller includes that profile edit in the same phase/docs commit.

## Growing the profile — the learning loop

**This is the part that makes the skill worth more on run 20 than on run 1.** When a run hits
something the profile did not tell you, the fix is not just to work around it; it is to write it down
so the next run doesn't pay again.

**The bar — append only if all three hold:**

1. **It cost you something.** A retry, a wrong turn, a stall, a wasted screenshot cycle. A thing you
   sailed through is not a quirk.
2. **It will recur.** It is a property of the app, not of this ticket's half-built feature. A bug you
   are testing for is a *finding*; a permanent modal you must clear to reach any screen is a *quirk*.
3. **You can state the trigger and the fix.** "What you'll see" and "what to do" — both concrete. If
   you can only describe the symptom, you have not learned it yet; say so in your report instead.

Anything failing the bar goes in your run report, not the profile. This bar exists because an
append-only knowledge file that nobody prunes is how context rots — the profile earns its place only
while it stays readable in one sitting.

**Format — one entry, appended under `## Quirks`:**

```markdown
### <Short imperative title>
_Learned 2026-09-06 · costs: one retry per run_
**You'll see:** the Checkout button responds to a click and nothing happens; no network request fires.
**Do:** these are MVC `onclick` handlers, not real buttons — call the handler directly with
`agent-browser eval 'window.submitOrder()'` after confirming `typeof window.submitOrder === "function"`.
**Where:** any screen under `/Sales/*`.
```

Also correct what is already there. A profile line that is now **wrong** is worse than a missing one —
if the login flow changed, edit it in place and note the date. Silent staleness is the failure mode
this file exists to prevent.

### Keeping the profile from rotting

- **Cap it at ~200 lines.** When it exceeds that, consolidate: merge near-duplicate quirks, delete any
  entry whose screen no longer exists, and promote anything that turns out to be a *flow* (a sequence
  you repeat every run) out of `## Quirks` into `## Flows`, where it belongs.
- **A quirk that is really a bug should graduate out.** If a workaround has been in the profile for
  months, it is a defect nobody filed. Say so when you report; don't let the profile quietly make a
  bug permanent.
- Keep the profile's own sections in the order of the template so a reader can jump.

## Profile contents

See [reference/profile-template.md](reference/profile-template.md) for the skeleton to copy, and
[reference/example-profile.md](reference/example-profile.md) for a filled-in one from a real
multi-gate line-of-business app. In short:

| Section | Holds |
|---|---|
| `## App` | `base_url`, optional `ready_probe`, session prefix, what the app *is* in one line |
| `## Credentials` | **names of env vars only**, never values; which one applies where |
| `## Getting in` | login, and every gate between login and a usable screen, in order |
| `## Flows` | sequences you repeat — the ones worth not re-deriving |
| `## Quirks` | the learned-the-hard-way list, newest first |
| `## Cleanup` | anything a run must release so the next run can start |

## Bootstrapping a profile for a new app

No profile means this skill has never driven this application. **Do not improvise a login.** Instead:

1. Confirm Rule 0 against a base URL — ask the user for it if you cannot infer it from the repo
   (a compose file, a launch profile, a README).
2. Copy `reference/profile-template.md` to `$ROOT/.claude/e2e/profile.md`.
3. Open the app headed and walk the front door **with the user watching**, filling the profile as you
   go: what the login page wants, which env vars hold it, what gate appears next, what a usable
   landing screen looks like. Ask rather than guess at every fork — this is the one run where asking
   is cheap and guessing is expensive.
4. Name the env vars in the profile and tell the user to put the values in a gitignored `.env`; never
   write them into the file yourself.
5. Commit the profile. From then on, every run reads it and every run may improve it.

## Reporting

When a caller gave you acceptance criteria and an artifact path (the prd-orchestrator's e2e gate
does), write a ≤15-line marker to that path: first line `RESULT: pass|fail|blocked`, then a one-line
summary, the observed-vs-expected for any failure, and the screenshot paths. Reply with only that
path. Do not commit anything. Do not test anything you were not asked to.

When there is no caller contract, report to the user directly: what you drove, what you saw, pass or
fail per criterion, and **anything you appended to the profile**, so the growth is visible rather than
silent.
