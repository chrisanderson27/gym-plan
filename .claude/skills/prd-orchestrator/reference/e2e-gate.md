# The e2e validation gate

The orchestrator's step 4 — a **live-app** walkthrough scheduled by kickoff Q2: end-only (default),
per-phase, selected checkpoints, or skipped. It runs after build/unit verification; end-only runs
before final review rather than before each phase commit. It exists to catch the class of failure the build+test+review gates cannot: code that
compiles, passes unit tests, reviews cleanly, and still does the wrong thing (or nothing) when a human
drives the actual screen.

This gate is the **[`e2e-test-orchestrator`](../../e2e-test-orchestrator/SKILL.md) discipline applied to
a build's own phases.** That sibling skill exists to run many independent test items *at once* across a
roster of machines; the same fan-out is the point here too — an **end-only run validates every UI phase,
and validating them one worker at a time is the slowest part of a build.** So the end-only run **dispatches
one worker per UI phase in parallel**, each on its own machine + browser session, exactly as the sibling
does (§[Parallel dispatch](#parallel-dispatch--end-only-run)). What this gate keeps that the sibling does
not: it owns the app lifecycle, the Figma coupling, and the promote/validate/commit pipeline — so it
imports the sibling's *isolation rules and machine roster*, not its plan-file contract.

**There is no e2e plan file.** This gate validates **the selected acceptance criteria** — pulled
from the PRD and builders' summaries: one phase for per-phase runs, all phases for the end-only run. Worker
discipline (fresh context, session isolation, browser teardown, artifact-gated completion) is the same
as every other stage; see [contract.md](contract.md).

## Who owns what

Kickoff Q5 separately asks whether Figma checks should run per relevant phase, once at the end, or
not at all. When its timing matches Q2, share this worker; otherwise use the
[visual-only worker](figma-gate.md#visual-only-worker). Never commit Figma images or extracted design
data. Local snapshots live under ignored `.agents/figma/`; comparisons remain ignored too.
Visual correction attempts are capped at two. This does not postpone unit tests until human UI review.

| Concern | Owner | Why |
|---|---|---|
| App lifecycle — kill / start per `[app]` / stop | **orchestrator** | `e2e-test` Rule 0 forbids a worker from starting the app; the orchestrator starts it so the worker's Rule-0 check passes |
| Browser — navigate / click / snapshot / judge | **e2e worker** | the worker's entire job; the orchestrator never drives a browser |
| Its own browser session close | **worker** (contract step 7), **orchestrator** as safety net | no orphaned Chrome-for-Testing windows |

When `[app]` would be the instance hosting the run, point it at a scratch instance instead:
its own port, its own data directory, and background loops off.
Skipping because the live instance hosts the run is the fallback only.

> **Enforced in code.** `log --event e2e_na` rejects a reason about a license, machine, sign-in, credentials or an
> unavailable app: those are roster/environment problems, so take a machine from `machines.md` and run the gate.
> `log --event run_end --detail completed` is refused while any committed phase has neither `e2e_pass` nor a valid
> `e2e_na`, and `preflight` fails when the roster cannot be resolved. Builders and fixers never probe the live app.

## Is this phase e2e-testable? — the N/A rubric

The gate is **required by default**, but a phase with no user-facing behavior is marked **`N/A` with an
explicit reason** in the ledger (mirrors `execute`'s "N/A explicitly and say why"). Never *silently* skip.

- **Run the gate** when the phase changed anything a user sees or drives: a screen, a view, a form, a
  navigation, a button, a rendered value, an endpoint that a UI flow exercises end-to-end.
- **Mark N/A (with reason)** when the phase is purely non-UI: an internal refactor, a migration, a
  handler with no reachable screen yet, a build/tooling change, a doc-only phase. Record *why* — e.g.
  `e2e: N/A — phase 3 adds the AuditLog repository only; no screen reaches it until phase 5`.

When unsure, run it — a worker that boots the app and confirms the relevant screen still loads is cheap
insurance; a wrongly-skipped UI regression is not.

## Orchestrator sequence (step 5 in the loop)

Run this after step 4 (verify) is green. There is no per-phase full review to wait for.

1. **Decide scope.** Apply the N/A rubric. N/A → record the reason in the ledger, emit `e2e_na`, go to
   step 6. Otherwise continue.
2. **Kill any running instance.** Announce it first (this terminates a manually-running dev app too — see
   the caution below), then:
   ```bash
   app-run.sh kill        # from this skill's scripts/ — it reads [app] from the repo config
   ```
3. **Start the app in its own herdr tab** (backgrounded so it persists and streams — do NOT run it
   in your own turn, and never in a split of your own tab):
   ```bash
   orchestrator.py tab open --stage app        # → pane_id of the tab orch:<slug>:app
   herdr pane run <app pane_id> "<[app].start from .claude/orchestrator.toml>"
   app-run.sh wait-ready <[app].timeout_s>
   ```
   `wait-ready` exit 1 (timeout) is a typed failure — read the app tab's tail for the compile/startup
   error, feed it back to the builder (a phase that won't boot is not shippable), re-verify, retry once,
   then quarantine. Emit `app_start`.
4. **Pick the engine, then spawn the e2e worker(s).** `orchestrator.py routing --stage e2e --phase <n>`
   reports `engine` (`nimble` by default, `claude` when routing.json says so) — see
   [§ Engines](#engines--nimble-first-claude-as-fallback). A Claude worker starts from that same output — its
   `agent_args` (model, effort, and for Claude the permission mode + Stop-gate `--settings`) and `env` are
   the whole launch; never hand-assemble the flags (SKILL.md § Model routing). Each worker gets the [worker contract](#the-e2e-worker-contract)
   below, its acceptance criteria copied in verbatim, a **unique browser session name**, and — always in
   an end-only run, and whenever more than one worker is live — its **own assigned machine** from the
   roster. How many workers:
   - **Per-phase / checkpoint run → one worker for this phase.** (One phase is usually one coherent
     screen; keep it a single worker. Do not split a phase's criteria across workers — they would collide
     writing the same `phase-N/` bundle.)
   - **End-only run → one worker per UI phase, dispatched in parallel**, one distinct machine + session
     each, capped by the machine count, with mutating-flow phases held serial. This is the time win the
     sibling skill is built around; follow §[Parallel dispatch](#parallel-dispatch--end-only-run) for the
     roster, isolation and batch mechanics. Each worker still writes its own `phase-N/` artifacts, so the
     promote/validate/commit path in steps 8–9 is unchanged — it just runs per phase after the batch.

   Each worker gets its **own tab**: `orchestrator.py tab open --stage e2e --phase <n>` (routing env
   applied, shell ready), then `herdr agent start … --pane <its pane_id> -- <agent_args>`.

   **Only if kickoff Q5 schedules a Figma comparison at this same point**, also (a) start the worker
   with `ORCH_FIGMA=1` in its env (`orchestrator.py tab open --stage e2e --phase <n> --env ORCH_FIGMA=1`)
   so its Stop gate requires `figma-compare.md`, and (b) pass the phase's Figma
   surfaces (`<surface>` → node-id → bundle PNG + `tokens.json`, from the PRD Design contract + the
   bundle `index.md`) into the contract. The comparison is **folded into this same worker** — no separate
   tab. See [figma-gate.md](figma-gate.md).
5. **Wait on the artifact bundle, not the settle.** Poll for each worker's
   `.agents/orchestrator/phase-N/e2e.md`; also break on herdr `blocked`. The Stop hook requires
   `capture.md` and `manual.md` too, plus `media/index.md` for `pass` or `fail` (`journey.json` is
   expected but never blocking — missing, the scenario says `Journey: incomplete`). First
   marker line is `RESULT: pass|fail|blocked`. In a **parallel** end-only batch, poll **every** dispatched
   worker's marker (each phase writes to its own `phase-N/`, so they never collide), tear each worker down
   as its marker lands, and only proceed to step 8 once the whole batch has resolved.
6. **Stop the app — always, every exit path.** Emit `app_stop`, then:
   ```bash
   app-run.sh kill        # from this skill's scripts/ — it reads [app] from the repo config
   orchestrator.py tab close --label orch:<slug>:app
   ```
7. **Tear down every worker:** `orchestrator.py tab close --label <its label>` and, as the safety net,
   `agent-browser --session <SESSION> close` (idempotent — the worker closes its own too), for **each**
   worker in the batch. At batch close-out sweep `agent-browser session list` and close any
   `<[e2e].session_prefix>-*` session still standing — one left open is an orphaned Chrome window.
8. **Promote before any halt, retry, budget check or commit decision.** For every non-`N/A` result:
   ```bash
   orchestrator.py promote-e2e --phase <n>
   orchestrator.py validate-e2e --phase <n>
   orchestrator.py validate-figma --phase <n>   # only when Q5 schedules it here; add --final for end-only
   ```
   All must exit 0. `validate-figma` fails on any unresolved `regression` row in `figma-compare.md`;
   route that back to the builder exactly like an e2e `fail` (see [figma-gate.md](figma-gate.md)).
   `promote-e2e` writes the canonical redacted scenario under
   `<[testing].dir>/scenarios/<prd>/phase-<n>-scenario.md`. The raw `journey.json` and media remain
   gitignored; every journey is also copied to the wiki catalog `.claude/e2e/journeys/`.
   The scenario's evidence SHA-256 must match the current raw bundle, preventing a prior retry's
   scenario from passing this gate. Validation regenerates the canonical document and compares it
   exactly, so edits made outside promotion also fail.
   A promotion failure is a gate failure; do not advance and do not discard the phase evidence.
   A passing scenario joins the phase commit. A failed/blocked scenario gets a docs-only commit in
   autonomous mode or becomes a required human commit; only the explicit kickoff choice to commit
   nothing may leave it uncommitted. Include any tracked `[e2e].profile` learning made by the worker
   in that phase/docs commit. After any such commit, run `validate-e2e --phase <n> --committed`.
9. **Feed the gate result to step 6.** `pass` or `N/A` → the phase can be *clean*. `fail` → treat exactly
   like a high/critical review finding: feed the observed-vs-expected back to the builder, fix,
   re-verify, re-review, re-run this gate (cap the cycles, e.g. 2). `blocked` (app down for everyone, a
   prerequisite missing) → quarantine the phase, do not commit. Emit `e2e_pass` / `e2e_fail`.

## Engines — Nimble first, Claude as fallback

The e2e evidence bundle is the same whichever engine fills it, and steps 5–9 never ask which one ran.

**1. Nimble (the default).** The e2e-test-orchestrator skill's local decision-model runner in bundle
mode: Nimble 9B picks each element, Sonnet compiles the phase once, Haiku rescues a doubtful step. It
costs a fraction of a Claude worker. Use it for a phase **unless**:
- a Figma comparison is due at this same point (kickoff Q5). Nimble can't compare screenshots to
  Figma, so use Claude from the start for that phase;
- `orchestrator.py preflight` warned that Nimble is unavailable. Then use Claude for the whole batch,
  and emit `e2e_fallback` once with the reason.

Dispatch, per phase, with the same isolation as a worker (its own `<SESSION>` and `<MACHINE>`):
1. Write `<phase dir>/e2e-item.md` in the plan-item format the pilot reads:
   ```markdown
   ## Items

   ### <n> — <phase title>
   - **Impl.:** Done
   - **Status:** Not Started
   - **Steps:**
     1. <acceptance criterion, verbatim>
     2. <…>
   - **Depth:** <depth> (default `normal`); neighbouring screens: <neighbouring screens or none>
   - **Expected:** <what a passing phase shows, from the PRD phase + summary.md>
   - **Before:** <one line: how it behaved before this phase>
   ```
   Depth is filled as for the Claude worker below (`scope.json` `blast`, else the plan's `## BLAST RADIUS`,
   else `normal`). `light`: keep only the step that loads the touched screen and the changed criterion.
   `normal`: all criteria. `deep`: after the criteria, append one extra step per neighbouring screen
   ("Open <screen>; confirm it still loads and shows no error"), numbered after the criteria.
2. Run the pilot in its **own tab** (no `herdr agent start`; it is a plain process):
   ```bash
   orchestrator.py tab open --stage pilot --phase <n>      # → pane_id
   herdr pane run <pane_id> "cd <root> && <pilot_cmd_prefix> python3 <pilot> --plan <phase dir>/e2e-item.md \
     --item <n> --bundle <phase dir> --session <SESSION> --machine <MACHINE> \
     --journey-ref prd=<prd slug>,phase=<n>"
   ```
   `<pilot>` and `<pilot_cmd_prefix>` both come from `orchestrator.py routing --stage e2e`. The prefix is
   the e2e stage's routing env as shell assignments (e.g. `CLAUDE_CONFIG_DIR=…`; the orchestrator's own
   config dir when the route sets none). **Never drop it**: a pane shell has no config dir, so the
   pilot's compile call runs logged out and the phase blocks with `compile: claude -p failed`. The
   alternative is to create the pane with that env already set — one `--env KEY=VALUE` per `pilot_env`
   entry on `herdr pane split` / `tab create` — and then run the command without the prefix.
   `python3 <pilot> --health` (with the same prefix) checks both the decision model and that compile
   call. If a compile still fails, the pilot writes a `RESULT: blocked` bundle with the reason
   `compile: …`, so the wait in step 3 always ends.
   In the end-of-PRD batch, open one pilot tab per UI phase and start them **all before waiting on any**
   — that is what makes the batch parallel.
   The first run compiles the phase (about a minute, one Sonnet call) and caches it as
   `<phase dir>/nimble-script.json`. A fix → re-e2e cycle reuses it, recompiling only if the criteria
   changed.
3. Wait on `<phase dir>/e2e.md` exactly as for a worker (step 5). The pilot writes the bundle, closes
   its browser, and writes `e2e.md` last.

**2. Claude worker (the fallback).** When the Nimble marker reads `RESULT: blocked`:
1. Move the attempt aside: `mv <phase dir> → <phase dir>/nimble-attempt/` for every bundle file
   (`e2e.md`, `capture.md`, `manual.md`, `journey.json`, `media/`, `evidence/`, `pr-evidence.md`, `nimble-usage.json`). That way the Claude
   bundle is the one promoted, and the attempt stays for diagnosis. The attempt's journey is already
   cataloged under its own id (the pilot's `finish` ran), so the phase dir holds only the final attempt's journey.
2. Emit `orchestrator.py log --event e2e_fallback --phase <n> --detail "<the blocked reason>"`.
3. Dispatch the [Claude worker](#the-e2e-worker-contract) for that phase, once, from the routing output.

**What every Nimble run teaches, automatically, whatever the verdict.** The pilot writes all of this to
the shared flow library (`e2e-test-orchestrator/library/<app>/`) before its marker:
- Flows the compile proposed are adopted once their **own** steps pass, even if the phase then fails
  or is blocked further on. A flow with the same steps as an existing one folds into it instead of
  adding a near-duplicate.
- Each target's anchor gains a confirmation when Nimble's pick works, or when Haiku agrees with it.
  After two confirmations, Nimble's same pick skips the Haiku check, and one miss resets that.
- Every decision joins a log pooled across worktrees and PRDs. Once it holds 100 labelled
  decisions, the gate floor re-calibrates itself (`calibration.json`, bounded 0.60–0.95).
- A step Nimble can't complete is **step-fixed**: an LLM finishes just that step, a few actions
  checked by code, and the steps that worked are saved into the script or flow. Nimble then
  continues. The phase only falls back to a Claude worker if step-fix fails too.
- `SCOREBOARD.md` records what Nimble carried, run over run.
- `SCREENS.md`, the screen phrasebook, is rebuilt from all of the above. Per screen it lists the
  controls, the wording Nimble answers confidently, wording that misled it plus Haiku's fix, and the
  flows passing through. **The next compile, of any phase in any PRD, writes its questions from it.**
- A blocked run saves its page tree (`media/blocked-tree.txt`) and adds an entry to `BLOCKS.md`,
  grouped by route and step. The entry clears itself when that item next passes.

Later phases and later PRDs compile against that library and run with fewer rescues. Close-out step 7
(`library-sync`) commits it. **A Claude fallback teaches the library nothing**, so a recurring
`BLOCKS.md` entry is worth a code fix in `pilot/apps/`: it is what keeps the next PRD on Nimble.

**What every run costs, and what it saved.** The pilot's paid calls leave no transcript, so each run
meters itself instead. Whatever the verdict, including a preflight or compile block, it writes:
- `<phase dir>/nimble-usage.json`, before `e2e.md`. It holds the result, steps, Nimble-only steps,
  rescues, local decisions with their tokens and seconds, and every paid call by kind (compile, rescue,
  judge) and by model, with the cost the CLI reported. It also records wall seconds and whether the
  compile was cached. Health checks are counted under their own key, apart from the run's calls.
  `e2e.md` carries the same as one line: `cost: $0.12 paid (2 calls) · 31 local decisions (48k local tokens)`.
- the same record as one line in `e2e-test-orchestrator/library/<app>/usage.jsonl`, a ledger pooled across
  worktrees and PRDs (gitignored, like `decisions.jsonl`).

`orchestrator.py e2e-cost [--json] [--since YYYY-MM-DD]` sets that ledger beside the baseline. The
baseline is every past fallback-worker e2e session in the transcripts: a session whose first prompt is
this gate's worker contract, or the test-plan worker's. It prints a row per session (date, kind,
minutes, turns, tokens, model, $) and n / median / mean / p90 / total per kind, then the Nimble runs:
pass/fail/blocked counts, median paid $ per run, and the total. The scan is cached per transcript by
mtime in `library/<app>/e2e-cost-cache.json`. Prices come from the `[pricing]` rate table at read
time, so a rate change re-prices the whole history.

At close-out, `telemetry` adds an **E2E engine cost** section to `telemetry.md`. For each phase it
shows Nimble's actual spend (`nimble-usage.json`, `nimble-attempt/nimble-usage.json`, and any earlier
re-run the ledger kept) and any fallback worker's actual cost (this root's sessions for that phase,
since the run started). It sets both against the counterfactual: the median past e2e-phase worker,
with its n and date range. A phase that fell back saves nothing, and the line says what the Nimble
attempt wasted. The headline `Nimble saved ≈ $X` is labelled an estimate, because the counterfactual
is a typical past worker, not this phase run by one.

A Nimble `RESULT: fail` is **not** a fallback case. Code checks found the product wrong, which is a real
gate result: route it to the builder like any `fail` (step 9).

## Parallel dispatch — end-only run

The end-only run validates every UI phase at once. Running them one worker at a time is the slowest leg
of a build, so dispatch **one worker per UI phase in parallel**, each fully isolated. This is the
[`e2e-test-orchestrator`](../../e2e-test-orchestrator/SKILL.md)'s fan-out; the isolation rules below are
imported from it verbatim in spirit — read that skill's *Going parallel* section for the worked detail.
The orchestrator still owns the single app instance (started once at step 3, stopped once at step 6) and
the per-phase promote/validate/commit at steps 8–9; parallelism changes only how the workers are spawned
and polled.

**Isolation is mandatory — all three, and all the orchestrator's job to set up, not the worker's:**

1. **One browser session per worker.** Allocate a distinct `<SESSION>` per worker (e.g.
   `<[e2e].session_prefix>-phase-<n>`) and pass it in the prompt. A worker opens *that* session literally
   and never runs `agent-browser session id --scope worktree` — that id is per-worktree, so every worker
   would compute the same name and silently share one browser.
2. **One assigned machine per worker.** Hold a **machine roster** before dispatching. You cannot
   enumerate machines yourself; the roster is the e2e-orchestrator's gitignored
   `machines.md`, resolved **current tree → main clone via
   `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` → live-table/ask** (the exact
   order in [`e2e-test-orchestrator`](../../e2e-test-orchestrator/SKILL.md), so a worktree with no local
   copy still finds it). Hand each worker **one distinct** `<MACHINE>`; it selects only that machine and
   may unassign only that machine — never another worker's. A worker that cannot get its machine returns
   `RESULT: blocked` rather than grabbing a different one. **Concurrency is capped by the machine count**
   — fewer machines than UI phases → run in waves at that width.
3. **Serialise data-collision phases.** Phases whose criteria **mutate shared records** (create / void /
   convert / finalize) can collide even with separate sessions and machines. Run those serially, or give
   each a distinct fixture; read-only phases (view switches, filters, opening a record) parallelise
   cleanly. Keep concurrency low enough that Chris can still watch the headed browsers.

**Batch mechanics.** Open one tab per worker (`orchestrator.py tab open --stage e2e|pilot --phase <n>`)
and start **every** worker of the wave before polling any of them — dispatching one, waiting, then the
next is exactly the serial run this section replaces. Start each fresh from
`orchestrator.py routing --stage e2e --phase <n>` (step 4), fill the [worker contract](#the-e2e-worker-contract) with that worker's
phase criteria, `<SESSION>` and `<MACHINE>`. Poll **every** marker (step 5), tear each down as it lands
(step 7). Then promote/validate each phase (step 8) exactly as a serial run would — the artifact model is
per-phase and unchanged, so nothing downstream needs to know the runs were concurrent.

## The e2e worker contract

Fill in `<n>`, `<title>`, the phase's **acceptance criteria copied verbatim** (from the PRD phase +
`phase-N/summary.md`), the absolute paths, a unique `<SESSION>` name (`<[e2e].session_prefix>-phase-<n>`),
and — whenever more than one worker is live (always in a parallel end-only batch) — the worker's own
`<MACHINE>` from the roster. In a single-worker run the machine line is moot; give it the one available
machine. Fill `<depth>` (`light | normal | deep`) from `phase-N/scope.json`'s `blast`,
falling back to the plan's `## BLAST RADIUS` if scope.json is absent. An absent BLAST RADIUS means
`normal`. Fill `<neighbouring screens>` from that plan section for `deep`; otherwise use `none`.
Pass both values into the prompt below:

> Subagents: none.
> You are validating **one** phase of this feature against the **live app**. Do only this.
>
> 1. **Load the `e2e-test` skill** and follow it for launching the browser (headed) and getting in.
>    Every app fact — base URL, the login sequence, gates, quirks — is in the repo's e2e profile
>    (`[e2e].profile`); read it, do not improvise. **First run `agent-browser skills get core --full`**
>    — it ships with the CLI, is version-matched, and is the correct command reference for this machine. The app is **already running** (the orchestrator
>    started it) — if it is not, stop and write `RESULT: blocked`; do NOT start it yourself.
>    - **Your browser session name is `<SESSION>` — open it with `agent-browser --session "<SESSION>"
>      --headed open …`.** Do not run `agent-browser session id --scope worktree` — it returns the same id
>      for every parallel worker and would make you share one browser with another tester.
>    - **Your assigned machine is `<MACHINE>` — select exactly that machine at the gate, nothing else.**
>      If it is free in the dropdown, pick it and Save & Continue. If a stale session still holds it, you
>      may unassign **`<MACHINE>` only** and re-select it. **Never unassign any other machine** — another
>      worker may be mid-test on it. If `<MACHINE>` cannot be obtained, write `RESULT: blocked` (do not
>      grab a different machine). *(Single-worker run: use the one machine you were given.)*
> 2. **Depth: `<depth>` (default `normal`). Neighbouring screens: `<neighbouring screens>`.**
>    `light`: check the touched screen loads and the changed criterion.
>    `normal`: walk all phase criteria. `deep`: also walk the neighbouring screens above.
>    **The phase's acceptance criteria:**
>    <acceptance criteria copied verbatim from the PRD phase + summary.md>
> 3. At the assigned depth, drive the app through the full user workflow for each selected criterion — fill forms with valid data,
>    submit, and **verify the intended outcome actually occurs** (data saved, page navigated,
>    confirmation shown, value rendered). Do not stop at "the element exists". Watch for error banners,
>    HTTP 4xx/5xx, console errors, validation failures — any of those is a fail.
>    - If the profile records a quirk about this screen (a wrapper, an iframe, a legacy shell),
>      honour it — confirm you are exercising the real behaviour, not an outer shell.
> 4. Judge **pass/fail strictly against the acceptance criteria at the assigned depth.** Capture at least
>    one screenshot per exercised criterion and neighbouring screen as evidence; note the paths. Mark
>    criteria outside `light` depth as not exercised, never as passed.
>    - **For each exercised criterion, also capture one screenshot that would make sense to a PR reviewer who has
>      seen nothing else, and save it into a dedicated `<phase dir>/evidence/` folder** (create it) with
>      a descriptive filename (e.g. `evidence/roster-skill-chips.png`) — **not** into `media/`. `media/`
>      is the full journey (login, clicks, every step); `evidence/` is *only* the proof of the built
>      thing, set aside so the orchestrator can attach it to the PR without sifting the journey. Frame it
>      as proof, not a process log: a bug-fix criterion's shot shows the **previously-broken thing now
>      working** (the rendered PDF, the saved record, the control that no longer errors) — not a mid-flow
>      step like "modal open" or "field filled". A new-page/new-field/new-button criterion's shot shows
>      the **new element in its real page context** (visible alongside its surrounding UI, not cropped so
>      tight the reviewer can't tell where it lives). If a criterion is neither (an internal behavior
>      change with no visual surface), it has no `evidence/` shot — say so rather than forcing one.
> 4b. **Figma fidelity comparison — only when you were given Figma surfaces for this phase.** For each
>    surface, pair your app screenshot with the bundle's `<surface>.png` + `<surface>.tokens.json` and
>    fill the checklist in `reference/figma-gate.md` — **elements** (missing/extra/mispositioned),
>    **text** (wording + **casing**), **tokens** (colour/border/radius/spacing/font vs the tokens.json;
>    spot-check a value with `agent-browser --session "<SESSION>" eval 'getComputedStyle(...)'`), and
>    **layout/responsive**. Classify every difference `regression` / `confirm` / `deferred` — a
>    difference is a **`regression` by default**; `confirm`/`deferred` must name why. Write
>    `<phase dir>/figma-compare.md` starting with `RESULT: pass|fail|na` (`fail` = ≥1 unresolved
>    regression). A fidelity regression makes the **whole run** `RESULT: fail` even if behaviour passed.
> 5. **Record the run — start this BEFORE step 3 and stop it here.** Per `e2e-test` Rule 5:
>    drive **only** through `<JOURNEY> ab --session "<SESSION>" …` with `JOURNEY_DIR=<abs phase dir>`;
>    run `<JOURNEY> start --app <APP> --source prd-phase --ref prd=<prd slug>,phase=<n> --story … --criteria …`
>    before step 3 and `<JOURNEY> finish --result <verdict>` before step 7. `<JOURNEY>` is the wiki copy,
>    `<wiki root>/.claude/skills/e2e-test/scripts/journey.py` (absolute path, resolved at dispatch);
>    record the data you used or created with `<JOURNEY> fixture <entity> <id> [--name …] [--created]`,
>    and at least one `<JOURNEY> assert` per criterion.
>    `<APP>` is the pilot app key (`PILOT_APP`, default `rbcloud`). Snapshot before acting and prefer
>    `@ref` over CSS selectors — a ref records as a portable `getByRole(...)` locator.
>    Save the full-journey screenshots (≥1 per criterion) and a `run.webm` video into `<phase dir>/media/`
>    — both are agent-browser built-ins; skip the video only if `agent-browser doctor` reports ffmpeg
>    missing. Write `<phase dir>/media/index.md`, listing each captured file and the acceptance criterion
>    it proves. A pass/fail cannot stop without this manifest. The **curated PR-proof shots go in
>    `<phase dir>/evidence/`** (step 4) — a separate folder, not listed in `media/index.md`.
>    Then write three more files into the same phase directory:
>    - **`capture.md`** — copy the exact required structure from the `e2e-test` skill's
>      `reference/scenario-capture-template.md`. It records intent, acceptance criteria,
>      prerequisites, explicitly safe literals, ordered actions with exact Playwright locators,
>      wait/trigger conditions, assertions, cleanup and stability notes. Record role + accessible
>      name, **never the ref number** — refs die on navigation.
>    - **`manual.md`** — `**Before:** … **Now:** …` then numbered click-by-click steps from login,
>      ending in **You should see:**. Written for someone who has never seen the feature.
>    - **`pr-evidence.md`** — the manifest for the `evidence/` folder, one line per shot:
>      `- evidence/<filename>.png — <one-sentence caption a PR reviewer could read with no other
>      context>`. Every line points at a file in `evidence/` (not `media/`), and every file in
>      `evidence/` gets a line — this file is what the orchestrator later attaches to the PR, so a
>      caption-free or process-log entry here becomes a confusing image on the actual pull request. Omit
>      both `pr-evidence.md` and the `evidence/` folder entirely (not empty ones) if this phase truly has
>      no criterion with a visual surface.
>    These are the input for generating a Playwright spec later, the tester-facing walkthrough, and the
>    PR's visual evidence. Write `capture.md`/`manual.md` even when `RESULT: fail` — a failed run still
>    records how the feature is reached. Skip `pr-evidence.md` for a failing criterion — evidence of a
>    failure does not belong on the PR that's supposed to prove it fixed.
>    Never write a credential or other runtime secret into Markdown. Use `${ENV_VAR}` references.
>    Declare a journey input or observed value under `## Safe literals` only when it is deliberately
>    non-sensitive fixture/assertion data worth preserving; every undeclared journey value is redacted in the repo copy.
>
> 6. **Close your browser — always, on every exit path (pass, fail, or blocked):**
>    `agent-browser --session "<SESSION>" close`. Do this before writing the marker.
> 7. Write a ≤15-line marker to `.agents/orchestrator/phase-<n>/e2e.md`: first line
>    `RESULT: pass|fail|blocked`, then a one-line summary, the observed-vs-expected for any failure, and
>    the screenshot paths. **Reply with only that marker path.**
>
> Do not commit or promote anything; the orchestrator owns both. Do not test other phases. Do not
> start or stop the app.

## Cautions

- **Killing the app's port is destructive to a manually-running dev instance.** That is intended for a
  hands-off run (kill-then-run), but announce it before step 2 so Chris isn't surprised to find his own
  app gone. The orchestrator stops the app again at step 6, so it never leaves one running behind it.
- **Per-phase restart is intentional, not wasteful.** Each phase commits new code and the app builds fresh on start, so the app must restart to include the phase under test — you cannot reuse an instance
  started before the phase's code existed. The only safe optimization is keeping the app **warm across a
  within-phase fix → re-e2e cycle** (the code changed but the app is already up on this phase's tree);
  restart between *different* phases regardless.
- **A `fail` is a successful gate run, not a worker error.** The worker correctly found the phase
  misbehaving. Route it back to the builder as a finding — do not retry it as if the tester erred.

### Depth from blast radius
An absent `## BLAST RADIUS` defaults to `normal`.
`phase-N/scope.json` `blast: light`: touched screen loads plus changed criterion.
`normal`: all phase criteria.
`deep`: also walk the neighbouring screens named in the plan.

## Q2 scheduling

**When this step actually runs is Q2's answer, not a fixed point in the loop:**

- **Q2 option 1 (default, deferred-to-end):** skip this step for every phase. A phase's commit gate
  (step 6) needs verify green only. After the **last** phase commits, run this step **once for the
  whole PRD as a parallel batch** — ⛔ **not one combined worker walking every phase in turn.** That
  serial walk was the old wording, and it made the end-of-PRD gate take as long as every phase's e2e
  back to back:
  1. Boot the app **once** (it serves the whole batch) and stop it once, after the last worker.
  2. Apply the N/A rubric per phase. Every remaining **UI phase gets its own worker** — its own
     `<SESSION>`, its own `<MACHINE>` from the roster, its own tab, its own `phase-N/` bundle, its own
     acceptance criteria (that phase's PRD text + `phase-N/summary.md`).
  3. Dispatch them **all at once**, up to the roster's machine count; more UI phases than machines →
     waves of that width. A phase whose criteria **mutate shared records** waits for the read-only wave
     and runs alone. Exact mechanics: [e2e-gate.md § Parallel dispatch](e2e-gate.md#parallel-dispatch--end-only-run).
  4. Poll every bundle; each worker's `fail` routes into step 6's fix-cycle logic **against its own
     phase** — the bundle already says which phase owns the broken behaviour, even though the *test* ran
     at the end. Promote/validate each phase's bundle exactly as a per-phase run would.
  5. Only with **one** machine in the roster (or one UI phase) does this collapse to a single worker —
     and even then it writes one `phase-N/` bundle per phase, item after item, so failures still route
     to the owning phase.

  Do the coupling check (step 5) and the final review (below) only after **every** bundle in the batch
  reads `pass` (or `N/A` with a reason). If Q5 is also end-only, each worker compares its own phase's
  Figma surfaces, and the orchestrator runs `validate-figma --phase <n> --final` for **each** UI phase.
- **Q2 option 2 (per-phase):** run as written above, once per phase, before that phase's commit —
  this is the original, still-fully-supported behavior.
- **Q2 option 3 (checkpoint-only):** run only for a phase whose own PRD text or plan names a live
  check as part of its acceptance criteria; every other phase treats e2e as `N/A` — *"Q2 option 3 —
  not flagged for a live check"* is the reason, recorded like any other N/A.
- **Q2 option 4 (skip):** never run this step. Every phase's e2e reads `N/A — Q2 option 4 (skipped for
  this run)`. Say this plainly in the close-out summary so "no e2e" reads as a deliberate choice, not
  an omission. Q5 still independently determines whether a visual-only Figma worker runs.
