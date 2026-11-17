# Kickoff — steps 0b to 0e

Read this before kickoff starts (SKILL.md § Step 0, after 0a). A resumed run skips 0b, 0d and 0e.

**0b. Kickoff — ask the five questions below (split into calls if the tool limits question count).**
Every choice has a suggested default. Ask Q5 explicitly unless the user has already specified the
Figma cadence for this run; a generic "run it, defaults" does not answer whether to spend on Figma.
Anything already stated in the run prompt suppresses its corresponding question.

> **Q1. How far should this run go on its own?** *(single)*
> 1. **Commit each clean phase, keep going** ← default
> 2. Build and gate everything, but stop and show me before each commit
> 3. Build everything, commit nothing — present the whole thing at the end
> 4. Dry run — show me the phase table, the dependencies and what each phase will gate on, then stop
>
> **Q2. How often should the live-app e2e gate run?** *(single)*
> 1. **Once, at the very end of the whole PRD** ← default — phases commit on build+test alone; then
>    one app boot serves an **end-of-PRD batch: one e2e worker per UI phase, dispatched in parallel**
>    (as many at once as the `machines.md` roster allows, mutating phases held serial), each walking its
>    own phase's acceptance criteria against the fully-built app, before the final review. Cheapest —
>    it is the one gate that reboots the whole app, so paying that cost once instead of once per phase
>    is the default for a reason, not a shortcut
> 2. After every phase, before that phase's commit
> 3. Only at phases whose PRD text or plan explicitly calls for a live check — skip the rest
> 4. Skip entirely — build+test+review only
>
> **Q3. Code review — when?** *(single)*
> 1. **Cheap coupling check on phases other phases depend on + one full review at the end** ← default
> 2. One full two-axis review at the end only
> 3. Full two-axis review after every phase
> 4. Full review at the midpoint and at the end
>
> **Q4. What should stop and wait for you mid-run?** *(multi — none is valid)*
> 1. **Nothing — notify me per phase and keep going** ← default
> 2. A phase that changes a DB schema or a public API contract
> 3. A phase whose e2e gate is marked N/A *(only reachable on Q2 options 2–3)*
> 4. The first phase only (smoke-test the loop, then run free)

> **Q5. Should we compare the UI with Figma, and how often?** *(single, independent of Q2)*
> 1. **Once at the end of the whole PRD** ← recommended — one comparison of all touched Figma surfaces
> 2. After each phase that touches a Figma surface — earlier feedback, more browser/model work
> 3. Skip Figma checks for this run — no snapshot pull or visual comparison
>
> Figma images and extracted CSS/node/token data always stay in ignored local storage. They are
> never staged, committed, or copied into tracked documentation. Checks use a kickoff snapshot;
> correction attempts are capped at two. Unit/build checks still run before UI verification.
> If the repo has no Figma configuration, record `skip` with the reason instead of asking Q5.

Do **not** ask about: worktree-vs-branch (detect it — preflight already warns), model/effort spend
(the routing table in [SKILL.md § Model routing](../SKILL.md#model-routing) is the default; the owner can say "plan on opus"), or whether a *given* phase gets
an e2e pass at all (the N/A rubric still decides that per phase — Q2 controls *when* the gate runs,
not whether an individual phase is UI-shaped enough to need one).

Write the five answers **verbatim** into RUN.md and emit `run_start` with them.
`log --event run_start` stamps the run's `run_id` from RUN.md's `Run id:` line (written by `init`);
keep that line whenever you rewrite RUN.md. Preserve every `## Parked` block and every `Resumed:` line
verbatim on every rewrite; review scope and the pre-park fallback depend on them.
Then log one `stage_skipped` (no `--phase`) for each
stage the answers switch off for the whole run: Q2 option 4 → `--stage e2e`; Q3 option 3 →
`--stage coupling`; Q5 skip → `--stage figma`; `--detail` = the answer (e.g. `"Q5 skip — no [figma]"`).
Also write the machine
field `Figma checks: end|per-phase|skip` matching Q5; it overrides `[figma].checks` for this run.
Persist these answers in the scaffold after step 0c's `init`, before pulling or validating Figma.
That record is the
explicit approval SOUL requires for any autonomy above `commit`. **Close-out extras — ADO comment,
draft PR, a completion notification — are asked at close-out, not here.** They leave the machine or
post externally, so confirming them once the diff actually exists beats pre-authorizing them before a
single phase has landed; see [close-out.md](close-out.md) step 9.

**0c. Scaffold and TRANSCRIBE the PRD's phases.** `orchestrator.py init --prd <absolute store PRD path>`
(e.g. `~/git/personal/wiki/.planning/rbcloud/26425/prds/prd-2-….md`). It records the base commit — the
final review's fixed point — and, because the PRD lives in the store, a `Store: <wiki>/.planning/<ctx>/<feature>`
line in RUN.md. **That line is store mode:** plans go to `<Store>/plans/`, promoted scenarios and rollups
to `<Store>/testing/`, and `store-commit` records them in the wiki. Hand workers absolute store paths, never
worktree-relative ones (their settings already allow the store via `additionalDirectories`). A PRD still inside the repo's
`docs/ai/prds/` gets no `Store:` line — **legacy mode**, where everything behaves as it did before the
store (preflight warns); import it first (`store import --from …`) rather than run legacy. If the state dir already holds a run (a reused checkout,
e.g. the wiki on `main`), `init` copies it whole to `.agents/orchestrator-archive/<prd-slug>/` and clears
its per-run files. `events.jsonl`, `learnings.jsonl` and a `routing.json` newer than the old RUN.md are
kept. It **refuses (exit 1) while that run is still active**. Do not reach for `--force` unless the owner says
the old run is abandoned.

⛔ **You do not decide the phases. The PRD already did.** `create-prd` sizes a phase as *"the largest
coherent slice one agent can carry from the first edit to a green validation run without a handoff —
roughly 80% of a context window"*, and says plainly that **fewer, bigger phases win**. Every extra
phase costs a planner, a builder, an e2e gate and a context reload. Re-slicing a correct PRD into
smaller pieces is the most expensive mistake available to you here.

So: read the PRD's **Implementation phases** section and **copy it into the RUN.md table verbatim** —
same order, same numbering, same titles. Then derive exactly **one** thing the PRD does not record:

- **`depends on`** — which earlier phase must land first, if any. The quarantine logic reads this
  column. **Most phases depend on nothing.** A PRD's phases are often genuinely independent — a UI
  phase, then a backend phase, then a migration, possibly in different stacks or different areas of the
  app. Do not invent a dependency chain out of adjacency; only record one where a phase literally
  cannot build until another has landed.

**Sanity-check, but do not rewrite.** If a phase looks mis-sized (it obviously exceeds one session, or
two adjacent phases are plainly the same sitting), **say so in one line and ask** — that is a PRD bug
to fix in the PRD, not something to route around by re-splitting here. If the PRD has **no** phase
section at all, stop and say so: the PRD is not ready to orchestrate.

A run may seed `<state dir>/known-failures/<level>.txt`; it travels with a park, and only failures
outside it fail a level that sets `failure_pattern`.

**0c′. Human-effort estimate, blind.** Read the PRD and estimate it as if built by
**one senior engineer without AI**, in **focused engineering hours** (reading, design,
coding, testing and review; not meetings). After `init`, `run_start` and phase transcription,
run `orchestrator.py estimate --low … --likely … --high … --basis "<phases, main pieces>"` once.
Do this before any phase runs, so the result cannot bias the estimate. Never re-run it to
overwrite. A later re-estimate uses the same command, records `source: revised`, and
Telemetry keeps the kickoff figure. `estimate` refuses until `run_start` is logged.

**0d. Pull a local Figma snapshot.** When configured and Q5 is not skip, run `orchestrator.py figma-pull` once before phases and record its bundle path in RUN.md.
Exit 0: ready; exit 3: disabled/skipped. Enabled UI with no Design-contract frames is a PRD gap: stop and report.
Snapshots and extracted design data stay ignored, never staged or copied into tracked docs. [figma-gate.md](figma-gate.md) owns the contract.

**0e. Gap pass — before the first planner.** Follow the one-subagent prompt in [gap-pass.md](gap-pass.md); write via `gaps write --from <analyst-json>`, read `gaps show` once.
Empty result on 4+ phases: retry once at sonnet/high. Findings never block; paste open gaps into their phase's planner prompt.
On Q1 option 4 print gaps with the phase table and stop. Human resolutions: `gaps resolve --id gN --how "…" --by human`.
