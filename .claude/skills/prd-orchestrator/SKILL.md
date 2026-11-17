---
name: prd-orchestrator
version: 2.4.0
description: "Drive a PRD from spec to committed code as a mostly-autonomous herdr loop — for each phase, spawn a fresh planner and builder, verify (build+test) + live-app e2e gate, then commit; run ONE full code-review at the very end spanning all phases, plus a cheap coupling check on any phase a later phase actually depends on. Phases are read from the PRD, never re-split. Stack facts come from the repo's .claude/orchestrator.toml, so the skill is portable across teams and languages. Deviations from the PRD are recorded and reported at close-out, never blocked. Use when the owner wants to orchestrate/run a PRD end-to-end, loop a builder→verify→commit cycle over phases, or run a hands-off PRD build. Requires HERDR_ENV=1."
---

# PRD orchestrator

Turn a confident PRD into committed code with the human out of the inner loop. You are the
**orchestrator**: you never write the feature code yourself. You spawn fresh worker agents in herdr
tabs — **one tab per worker, never a split pane of your own tab** — feed them one artifact at a
time, judge their output, and advance a durable ledger.

This skill assumes the **herdr** skill for all tab/agent mechanics — read it first for
`agent start` / `agent read` syntax, and confirm `HERDR_ENV=1`.

**The skill holds mechanics. The repo holds facts.** Every stack-specific value — build commands, the
app's start command and port, plan directory, standards, e2e profile — comes from
`<root>/.claude/orchestrator.toml`. Never hardcode one. See [reference/config.md](reference/config.md).

## Non-negotiables

- Never block on lifecycle state: `dispatch`, then background `await --artifact …`; no `agent prompt --wait` or `agent wait`.
- Fresh context per worker and phase; full review once at the end. Carry only cited `facts show` output forward.
- One herdr tab per worker, pilot lane and app; no split panes. Close after reading its artifact; sweep at close-out.
- Never hold raw worker transcripts: artifact → compact verdict → ledger.
- Ownership: orchestrator owns commits, app lifecycle and ledger; `execute` owns build/test; `plan-feature` owns plans. [contract.md](reference/contract.md) wins disagreements.
- Assume → verify → report. Builder runs `verify`; do not rerun a green `verify.json` (enforced by `gate` + pre-commit `.gate-pass`). Only missing, ambiguous or red evidence permits your own verify.
- Decisions are recorded, never phase blockers; apply [deviation-rubric.md](reference/deviation-rubric.md).
- Commit is the human gate by default; widened autonomy requires the kickoff answer verbatim in RUN.md.
- Always `acceptEdits`, never `auto` or bypass modes; allowlist exact Bash commands in worker settings when needed.
- Never push autonomously; offer commit autonomy only.
- Never auto-edit `always_loaded`, standards, AGENTS.md or CLAUDE.md; the orchestrator is unfenced. Present a diff.
- Verify every review finding before fixing; fix confirmed critical/high/medium in this run per [final-review.md § R2](reference/final-review.md). Record lows.

## Guardrails — the word, and exactly what it means here

**A guardrail is a validation level declared in the PRD and carried into the plan.** Nothing more
mystical than that: they are the commands that must come back green before a phase is allowed to
commit, and they are written down by a human before any agent runs.

They live in three places and must agree:

| Where | What it holds |
|---|---|
| **the PRD** (§ Implementation phases) | which validation levels gate **this phase**, per `create-prd` |
| **the plan** (`## VALIDATION COMMANDS`) | those levels copied verbatim, with the exact command and pass condition |
| **`.claude/orchestrator.toml`** (`[validation] levels`) | the repo's canonical command for each level |

⛔ **The orchestrator never invents a guardrail, and never drops one.** A level with `paths` that the
phase did not touch is skipped and recorded `skipped (out of scope)` in `verify.json`, never dropped
silently. `verify --full` runs every level once before the final review. If the plan names a level, the
builder runs it and reports it. A level nobody declared is a level nobody runs — that is a PRD/config
gap for a human to close, not something to improvise around mid-run.

The loop adds **two more gates** that are not validation levels and are owned by the orchestrator
rather than the PRD:

- the **e2e gate** (step 4) — the live app, because build and tests cannot tell you a screen is wrong;
  and the separately scheduled **Figma fidelity gate** (`validate-figma`), because a screen can
  behave correctly and still not match the design — casing, borders, missing fields, wrong layout;
- the **coupling check** (step 5) and the **end-of-PRD review** — code quality, not correctness.

So "did the guardrails pass?" means *the PRD's own declared validation levels came back green*. It
does not mean the e2e gate or the review, which are separate and reported separately.

## State — local to the working tree, never global

Resolve root with `git rev-parse --show-toplevel`; state is `.agents/orchestrator/` per working tree.
[ledger-schema.md](reference/ledger-schema.md) owns the fields; [commands.md](reference/commands.md) owns the full command table.
Run `preflight` first, `routing --stage S` for exact flags, `init --prd <path>` to scaffold, `ingest --phase N --from <artifact>` after each plan/summary, and `gate --phase N` before commit.
⛔ Dispatch with `dispatch --pane P --prompt-file F`; wait only with background `await --pane P --artifact G`.
`scripts/app-run.sh kill|wait-ready|start-cmd` reads `[app]`; exit 3 means no app, hence an explicit e2e N/A.

## Prerequisites — the package deal

- Target repo's skill family: `plan-feature`, `execute`, `e2e-test`, this skill; install via `install --into <repo>`.
- `agent-browser` for runnable `[app]`; optional ffmpeg for video.
- `.claude/orchestrator.toml`; missing config → `orchestrator-setup`.
- `install-hooks`: post-commit records commit + usage; pre-commit requires `.gate-pass`. Internal errors fail open.
- `guard install`: docs fence prevents team-repo `docs/ai/{prds,plans,testing}/` and `.workbench/` commits; store preflight requires it. Never set `WORKBENCH_ALLOW_DOCS` as an agent.
- herdr 0.9+, `HERDR_ENV=1`, Python 3.11+.

`preflight` names missing prerequisites; see [worker-preflight.md](reference/worker-preflight.md).

## Step 0 — Preflight, kickoff, phases

**0a. Can a worker even run here?** Run `orchestrator.py preflight` and `orchestrator.py config --check`; nonzero requires fixing the named prerequisite first. Folder trust precedes permission mode; [worker-preflight.md](reference/worker-preflight.md) owns trust/login diagnosis.

**Resume path.** If RUN.md has a `Resumed:` line written for this launch (the resume prompt
says so), skip 0b/0d/0e: kickoff answers, routing, base and estimate already exist. Do not run
`init` or replace them. Run `orchestrator.py resume`, `orchestrator.py preflight`, then
`orchestrator.py verify --phase 0 --keep-going` once on the new HEAD. Feed any red level to the
next phase's builder as a normal verify failure. Reseed `known-failures/<level>.txt` if the PRD
or kickoff specifies it. Continue from the first non-`committed` row.

A phase with WIP `commit` events whose row is not `committed` is continued. Add to its planner
prompt: "WIP commits for this phase: <shas> — read `git show` and continue from them; do not restart".

**0b–0e. Kickoff — read [reference/kickoff.md](reference/kickoff.md) before asking anything.** It
holds the five kickoff questions (0b), scaffold and phase transcription (0c), the blind estimate
(0c′), the Figma pull (0d) and the gap pass (0e), in that order. Q1 option 4 (dry run) stops after
0e. ⛔ Phases are transcribed from the PRD verbatim, never re-split.

---

For each phase `N` in order (skip any phase whose `depends on` names a `failed` or `held` phase):

**1. Plan.** Open a tab (`orchestrator.py tab open --stage planner --phase N`), start a fresh planner
in it, and run the config's `[skills] plan` scoped to this
phase.

**Plan ahead of the builder when phases are independent.** Planning only reads the tree and writes a plan
file into the store, so it never collides with a builder. Whenever a phase's `depends on` column is `-`
(the usual case), do not wait for the previous phase to commit: start its planner in its own tab as soon
as the *previous* phase's planner has finished — while that phase is still building, verifying or in
review. Run the planner for every such phase straight through, then build them in PRD order. Rules:
- Only plan a phase ahead if it depends on nothing still unbuilt. A phase with a real `depends on` waits,
  because its plan must read what the earlier phase actually produced.
- The planner is told which files are being edited concurrently by earlier phases' builders, so their
  dirty paths are this run's own work and not a dirty-tree block. Planners never edit source.
- Run `ingest` on each plan as it lands; the facts cache then reaches later planners sooner. Later
  builders still start only after the previous phase has committed — this is about planning, not building.
- If a builder's work invalidates an already-written plan (a shared file or contract moved under it), have
  that phase's planner revise the plan before its builder starts; do not build from a stale plan.

**First, size the phase from its own PRD text.** Grep its paragraph for investigative language ("establish why", "verify", "confirm", "resolve", open questions). If absent, add the mechanical-phase nudge below; otherwise prompt normally. The planner still judges whether a real decision needs a plan.

> Subagents: at most two read-only search subagents, only if the phase spans more than one area.
> Using the `<plan skill>` skill in **orchestrated mode**, plan ONLY phase N of `<PRD>`.
> [if [knowledge] scope_notes is set: Read <path> first.] The plan carries `## DECISIONS`,
> `## TOUCH SET`, `## BLAST RADIUS`. Where the
> spec is ambiguous, resolve it by reading the code — do NOT ask me. Record a deviation ONLY if you
> can quote the PRD: append one object to `.agents/orchestrator/decisions.jsonl` per
> `reference/deviation-rubric.md` (all of `kind`, `prd_ref`, verbatim `prd_says`, `built`, `why`,
> `where`, `evidence`, `blast`, `one_way`, `verify`). **Most decisions are absorbed, not recorded —
> 2–5 per PRD is normal.** [if mechanical, per the sizing check above: This phase reads as mechanical/
> unambiguous — lean toward `NO-PLAN-NEEDED` unless you find a real decision to make.]
> [paste `orchestrator.py facts show` — omit the line when it prints "(no facts recorded yet)"]
> [paste `orchestrator.py gaps show --phase N` — omit when "(no open gaps for phase N)"] Resolve each
> known gap by reading the code and record how under `## Gaps addressed` in the plan (`- gN: <how>`).
> End the plan with `## New facts` — one line per reusable thing you learned about this codebase,
> as `- <domain|patterns|tests|boundaries|data|gotchas>: <fact> — <path:line>`; a fact with no path is
> dropped. Write the plan into `<Store>/plans/` (absolute; legacy runs: the repo's `[plans] dir`), named
> `prd-<N>-phase-<M>-<slug>.md`, and add its `**Plan:** [<file>](../plans/<file>)` line to the store PRD's
> phase block. Never write into the repo's `docs/ai/`. Reply with only the plan file's **absolute** path,
> or the literal token `NO-PLAN-NEEDED` if this phase is too small to warrant a plan file.

Wait on the artifact. `NO-PLAN-NEEDED` → record `plan: skipped (trivial)`, emit `plan_skipped` and `stage_skipped --phase N --stage planner --detail NO-PLAN-NEEDED`, and
build from the PRD phase text; paste its *Acceptance criteria* bullets into the builder prompt,
numbered `AC1…`. Every gate below still applies unchanged. A plan path → **harvest it
before you spawn the builder**:

```bash
orchestrator.py ingest --phase N --from <plan path>   # facts → facts/, decisions → decided.jsonl, `- gN:` lines → gaps resolved
orchestrator.py risk --phase N                         # after ingest, before routing --stage builder --phase N; re-run after a plan revision
```

That one call is what makes the next planner cheaper and makes `report` able to say which gaps were
actually claimed. Duplicates and un-cited facts are dropped, so running it twice is harmless.

**2. Build.** Start a fresh builder that runs the config's `[skills] exec` against the plan:

> Subagents: none (the hook denies Agent/Task).
> Using the `<exec skill>` skill in **orchestrated mode**, implement the plan at `<plan path>` exactly.
> [if [knowledge] scope_notes is set: Read <path> first.]
> Five deltas from your normal behaviour: (a) the planner already did the codebase dive — do NOT
> re-explore; read only what the plan's mandatory-reading list names; (b) **do NOT start or stop the
> application** — the orchestrator owns its lifecycle; (c) if you discover a deviation the plan didn't
> cover, append it per `reference/deviation-rubric.md` rather than guessing silently; (d) write a
> ≤15-line summary to `.agents/orchestrator/phase-N/summary.md` stating the validation you ran and its
> result, followed by `## Acceptance` (one row per criterion, ids from the plan's EVIDENCE PLAN)
> and optionally `## Noticed, not done` (≤3 items),
> after the devil's-advocate pass in `execute` § Orchestrated mode, then `## New facts`; reply
> with only that path; (e) **run your build+test through
> `orchestrator.py verify --phase <n>`** — it runs the repo's configured `[validation].levels` once and
> records a machine-checkable `phase-N/verify.json` the commit gate reads, so a green build is a fact,
> not a claim. (You may still run any extra plan-specific levels the normal way; `verify` is the
> build+test of record.) (f) [paste `orchestrator.py facts show` when non-empty] — and end your
> summary with `## New facts`, one line per reusable codebase truth you hit that the plan did not
> already state, as `- <domain|patterns|tests|boundaries|data|gotchas>: <fact> — <path:line>`.

Await builders with `await --settle`; the Stop hook holds a builder (and fix worker) until `verify --check` is current and green — 3 tries, then `verify_red_at_stop` and release.

`execute` owns the plan sanity-check, the repo's test conventions, the boundary checks and the
validation levels. Do not restate them here.

**3. Verify — read the recorded result; do NOT re-run it.** The builder ran build+test through
`orchestrator.py verify` (step 2 delta e), so the truth is in `phase-N/verify.json` (`"result"`), not
prose. When you read `summary.md`, harvest it the same way as the plan —
`orchestrator.py ingest --phase N --from .agents/orchestrator/phase-N/summary.md` — so what the
builder hit on the way in reaches the next phase's planner.
verify.json carries `tree`; `verify --check --phase N` (0 current+green · 2 red · 3 missing/stale) answers "is it still true" without re-running.
- verify.json **green** (and summary agrees) → verify passed, go to step 4.
- verify.json **red** → `orchestrator.py fix-plan --phase N`. Cycle 1 sends the failing signal to the same
  builder. Still red: ask it for `phase-N/handoff.md` (≤10 lines: done, stuck, tried), close its tab, run
  `fix-plan` again. Cycle 2 opens a fresh worker (`tab open --stage fix --phase N --fresh`,
  `worker-settings --stage fix --phase N --artifact <artifact>`) on the printed `prompt_file`.
  Cap: 2 cycles; a third call means `failed`. Ingest `verify-fix.md` too.
- verify.json **missing/ambiguous/silent** → then, and only then, run `orchestrator.py verify --phase <n>`
  yourself once to establish the truth (this is the single re-run the cost rule permits).

**4. E2E gate — live app.** Follow [e2e-gate.md](reference/e2e-gate.md) for worker prompts, Q2 options 1–4, parallel roster dispatch and app lifecycle; [figma-gate.md](reference/figma-gate.md) owns independent Q5 scheduling and visual-only workers.
Depth follows `phase-N/scope.json` blast: light = touched screen + changed criterion; normal = all phase criteria; deep = named neighbouring screens too.
Apply the reference's N/A rubric first. Log `e2e_na` and `stage_skipped --phase N --stage e2e --detail "<reason>"`; per-phase Figma N/A also logs `stage_skipped --stage figma`.
You own app lifecycle and stop it on every exit; workers own browser sessions, journey.json, screenshots/video and curated PR proof.
Q2 end-only: one app boot, one worker and bundle per UI phase in parallel up to roster width; shared-record mutators run serially. Never one combined serial walkthrough. Per-phase/checkpoint-only run before the applicable commit; skip is explicit N/A. Q5 remains independent.

For every non-N/A result, promote before retrying, halting, budget or commit decisions:
```bash
orchestrator.py promote-e2e --phase N
orchestrator.py validate-e2e --phase N
orchestrator.py validate-figma --phase N   # when Q5 schedules comparison here
```
All due validators must exit 0. Final Q5 end checks use `validate-figma --phase <n> --final` for each touched phase. Deferred is not completed.
Every fail or unresolved Figma regression returns to its owning builder: fix → verify → rerun failed criterion/compare, capped at two cycles. Deferred timing never lowers the bar.
A gate that cannot run must never leave the run open. With Q4 nothing-stops, missing prerequisites/roster or an app that hosts this run with no scratch instance means explicit N/A + skipped events per UI phase, report it and continue to close-out + `run_end`; never kill the host or wait indefinitely.

**5. Coupling check — cheap, Standards axis only.** Q3 eligibility: [risk-routing.md](reference/risk-routing.md). Q3 option 2: high-risk only (trigger 4). After verify, before commit, independent of Q2. Fire only if:
1. A later plan names a file created here (grep basenames in `<Store>/plans/`, legacy `[plans].dir`).
2. A new type/interface/base class occurs in ≥2 files of this phase's own diff.
3. This phase touches ≥3 files outside one feature folder.
4. `phase-N/risk.json` is high (forced: RUN.md `review: forced (high risk)`).
No trigger: RUN.md `review: skipped (no coupling signal)`, emit `arch_check` and `stage_skipped --phase N --stage coupling --detail "no coupling signal"`.
Triggered: one sonnet subagent on `git diff <phase-base>..HEAD` and downstream plans, no repo-wide reading, ≤10 lines. Advisory except shared-contract critical/high/medium, verified and fixed per [final-review.md § R2](reference/final-review.md).

**6. Gate → commit.** A phase is **clean** when verify is green AND — **on Q2 options 2–3 only** — its
e2e gate is `pass` (or `N/A` with a reason) AND `validate-e2e --phase N` passes for every non-`N/A`
result. **On Q2 option 1 (default) or option 4, verify green is the whole gate**; the phase commits
without waiting on any e2e result, because none has run yet (or ever will, on option 4). Independently,
Q5 `per-phase` requires a passing `validate-figma --phase N` for a touched Figma surface before that
phase commits; Q2 end/skip and Q5 end/skip defer or omit their respective checks, so only checks actually
due now gate the phase, and Q5 end still requires `--final` before close-out. In store mode the
promoted scenario lives in `<Store>/testing/` and is recorded by `store-commit`, never by the phase
commit (legacy mode: it is part of the phase's files). Figma snapshots and raw design data never are
committed anywhere. If the worker improved the tracked `[e2e].profile`, that edit is part of the same
phase commit; profile knowledge is not allowed to remain only in a worker report.

If the tree changed since verify, `gate` re-runs verify once (`verify_stale`) — run it with a 600 s timeout or in the background. A red re-run returns to step 3's fix cycle under the same 2-cycle cap.
**Seal the gate deterministically, then commit.** Right before committing, run
`orchestrator.py gate --phase N`. It re-checks the machine artifacts — `verify.json` green, the e2e
durability gate (only when e2e actually ran for this phase), and the Figma gate (self-N/A unless a
comparison was due) — and writes `phase-N/.gate-pass` only if all hold. **The installed `pre-commit`
hook refuses the commit unless that token exists**, so a red build, an unpromoted e2e, or an unresolved
Figma regression cannot be committed even if this loop's bookkeeping slips. Then act on the run's
`Autonomy gate:` field:
- `commit` (default) → **stop and present** the clean phase for the owner to commit himself (the hook guards
  his commit too).
- `autonomous` → commit it yourself (conventional message + the Co-Authored-By trailer) and advance
  without pausing.

⛔ Commit scope is by-name phase paths only: `git add -- <path>` per file; never `git add -A`, `git add .` or commit-all (nothing fences the orchestrator; `git-fence.sh` only restricts worker sessions). Pre-commit docs fence denies team-repo docs. A refusal is a scoping bug, never permission to bypass. Present the same path list for human commits.

**Every autonomy mode, record the store:**

```bash
orchestrator.py store-commit --phase N                    # plans + scenarios for this phase -> one wiki commit
orchestrator.py validate-e2e --phase N --committed        # proves the scenario is tracked + clean in the WIKI
```

`store-commit` runs **after every phase, including `failed` and `held` ones** (`--reason failed` /
`--reason held`), before budget halts or cleanup: preserves scenarios. Only wiki
`.planning/` paths are committed (`--only`); never pushes. Wiki mid-merge/rebase → exit 3
(`store_commit_deferred`): report and retry once clean.
`validate-e2e --committed` runs only for a phase whose e2e actually ran.

Legacy failed/blocked scenario commits follow [contract.md § Legacy failed-phase scenario commits](reference/contract.md#legacy-failed-phase-scenario-commits); store runs never use that exception.

**Even in `autonomous` mode these stop a phase commit** — autonomy speeds the happy path, it does not
lower the bar:
- red verify that won't go green within the retry cap → `failed`, quarantine, keep going;
- (Q2 options 2–3 only) an e2e gate that stays `fail` within the cap, or `blocked` → same. A UI phase
  never commits on an unresolved or un-run e2e gate **when its e2e was due now** — on option 1 it is
  due at the end instead, so this does not apply per-phase;
- (Q5 per-phase) a Figma fidelity gate (`validate-figma`) that stays failing within the cap —
  an **unresolved `regression`** — → same. A UI phase never commits while it still doesn't match the
  design, on the same "when it was due now" condition as the e2e gate above;
- a **`one_way: true`** deviation on this phase → mark it `held`, leave the work in the tree, and
  continue to the next independent phase. Nothing else is affected.

**On Q2 option 1, the deferred end-of-PRD e2e batch (step 4) can still fail after every phase has already
committed.** Treat a failing criterion there exactly like a late-discovered high/critical review
finding: identify which phase's acceptance criterion actually broke, send a fresh builder a fix scoped
to that phase's files, re-verify, land the fix as **its own new commit** (never amend a phase's
original commit), then re-run that phase's failing criterion (not the whole batch) before
continuing to the coupling check and final review.

**Whenever a `one_way` deviation is recorded, print one line immediately**, in both modes — an
end-of-run report is inherently read after the fact. Emit `one_way_recorded`.

**7. Advance.** Rewrite RUN.md with the new status, commit SHA, and the phase's `touched` set (step 5
trigger 2 needs it).

```bash
orchestrator.py log --event commit --phase N --sha <sha>
orchestrator.py surface --phase N
```

Q3 option 3: after each phase commit (fixed point = phase base), or Q3 option 4: at phase ceil(N/2) (N = total phases), read [reference/final-review.md](reference/final-review.md) and run its two-axis review now, before advancing.

`log` flips row N to `committed <sha>`;
the table is the only thing Workbench and the post-commit hook read for phase progress, so never
record a landed phase only in `## Current`. Append a nine-line digest to RUN.md's **Phase digests**, and — unless Q4 said
otherwise — fire the same nine lines as a `herdr notification show`:

```
Phase 2/5 — <title>            committed <sha>
Files:  7 changed (+241 / -38)
Verify: build clean, 84 tests green
E2E:    pass (3 criteria) | N/A — <reason> | deferred to end-of-PRD (Q2 option 1)
Decided: 2 (D1 <short>, D2 <short>)
Scope:   in plan | <n> out-of-plan file(s) (<paths>) | no touch set
Flags:  1 deviation (d7: <one line>) | 0 one-way
Review: 3 confirmed → fixed <sha> | 1 rejected | 0 open   (or: deferred to end-of-PRD)
Next:   phase 3 — <title>
```

Get `Decided:` and `Scope:` from `orchestrator.py digest --phase N`. Written from artifacts you already hold, so it costs nothing. A notification is *an interrupt the owner
can ignore* — he keeps the early-exit option without the run needing him present.

**Q4 stop conditions.** If the owner chose any, honour them *here*, after the phase is clean and before
advancing. First write RUN.md as in step 7 with the phase `committed`, its commit SHA, `touched` set,
and digest, preserving the park/resume metadata. Then check `test -e .agents/orchestrator/PARK-REQUESTED`
and follow the park check in step 7 if present. Otherwise emit `awaiting_human`,
print the phase digest, and **wait**.
- *schema/API phase* → stop if any of this phase's deviations carries `blast` in
  `{schema, api-contract}`, or its diff touches a migration.
- *e2e marked N/A* → stop. Only reachable on Q2 options 2–3 (option 1 has no per-phase e2e result to
  be N/A about; option 4 never runs it, so this condition is moot there too). This is otherwise the
  loop's only unverified exit, and the reason was written by the same agent that wanted to move on.
- *first phase only* → stop after phase 1, then run free.

**Park check.** After rewriting RUN.md and its digest, check
`test -e .agents/orchestrator/PARK-REQUESTED`. If present, run `orchestrator.py tab sweep`
**first** (it needs tabs.json before the move), then `orchestrator.py park`. On success, print
its last JSON line and end without another `run_end`: park already logged `run_end parked`.
Use `park`, never a bare `log --event run_end --detail parked`. A refusal leaves the request
pending; report the refusal and keep it for the next eligible boundary. Never park mid-phase;
a mid-phase request waits for the boundary.

**Between passes, keep RUN.md small.** Preserve every `## Parked` block and every `Resumed:` line
verbatim whenever rewriting it, along with the `Run id:` line. Trim other history as needed.

**Usage is captured deterministically by post-commit**, across config dirs; manual `usage --phase N --stage build` is optional, and exit 3 means E2E durability is still pending.
Before a budget wait, check `PARK-REQUESTED` and follow step 7's sweep-then-park path.
⛔ `orchestrator.py preflight` enforces `BUDGET-EXCEEDED`; show the banner, do not start the next phase or clear the sentinel without owner approval.

## Final review

⛔ By default the full two-axis review runs exactly once, after the last phase. Read
[reference/final-review.md](reference/final-review.md) before any final, per-phase or midpoint review starts. Its § R2 (verify before fix)
also governs step 5 and per-phase reviews.

## Close-out

Read [reference/close-out.md](reference/close-out.md) before
step 1. It holds steps 1–11. A launch `Close-out (SKILL.md step 9):` line refers to its step 9.

## Model routing

`routing.json` sets tool/model/effort. Workbench seeds planner/reviewer `claude-opus-5-5` high, builder `claude-sonnet-5-5` low, e2e `claude-sonnet-5-5` medium.
Defaults: `DEFAULT_ROUTING` (`routing --stage S` prints it). High risk raises the default Claude builder and its fix workers to `--effort medium`; explicit entries never change — [risk-routing.md](reference/risk-routing.md).
Nimble defaults when installed; e2e routing is the Claude fallback.
Use `routing`'s `agent_args`/env: `tab open --stage S --phase N` and `herdr agent start <name> --kind <kind> --pane <pane_id> -- <agent_args…>`.
Use Codex `agent_args`, never `argv`: it includes state-dir `sandbox_workspace_write.writable_roots`. Fix routing on write denial.
Non-Claude: record `hooks: none (<kind>)`; await artifacts, verify changes, check git log for unauthorized builder commits.
⛔ Claude requires model, `acceptEdits` and generated settings. Resolve stalls with exact Bash allowlists, never bypass modes. Generate: `worker-settings --stage S --phase N`; fix workers require `--artifact`.
`tab create --env KEY=VALUE` accepts env; `agent start` does not. Tabs never inherit env. Lifecycle: [tab-hygiene.md](reference/tab-hygiene.md).

## Worker hooks — what makes a worker honest

`orchestrator.py worker-settings --stage <s> --phase <n>` writes a per-worker `--settings` file.
Never put these in a settings file on disk that other sessions would load. Hook entries **merge**
rather than replace, so `--settings` can *add* a hook but never remove one the repo defines.

| hook | does | verified |
|---|---|---|
| **Stop** | a worker cannot end its turn without its artifact; for a builder, the summary must also contain `## Acceptance` with a `| ACn |` row | missing artifacts write `GATE-FAILED` after 3 refusals; acceptance-only refusals release after 3 with `acceptance_missing` (never `GATE-FAILED`); builder/fix need `verify --check` current+green (3 tries, then `verify_red_at_stop`, never `GATE-FAILED`) |
| **PreToolUse**(Bash) | denies git history writes through global options, blanket/force adds, and builder/fix app start/stop | subprocess tests; bypass mode does **not** bypass hooks |
| **PreToolUse**(`Write|Edit|MultiEdit`) | instruction-fence protects instruction filenames, standards and `always_loaded` | subprocess tests; all worker stages |
| **PreToolUse**(`Agent|Task`) | builder and fix only: subagent-fence denies subagents, emits `subagent_denied` | subprocess tests |
| **SessionStart** | emits `worker_session` with the Claude `session_id`, `phase` and the tab's stage (`ORCH_TAB_STAGE`, set by `tab open`), so telemetry ties each transcript to its stage exactly; prints nothing (SessionStart stdout would enter the worker's context) | unit-tested with a sample stdin |

The wiki’s `.claude/settings.json` runs `soul_guard.py` in every session; `hook-pre-commit` scans secrets (override: `WORKBENCH_ALLOW_SECRETS=1`).

The planner gets no Stop gate (it writes no gated artifact).

⛔ **Hooks cannot catch a worker that never starts.** The trust and login failures in step 0a happen
before any turn exists, so no `Stop` ever fires. Preflight covers those; hooks cover a *running*
worker. Both are required.

## Failure modes

Typed, capped, and resumable — see [reference/failure-modes.md](reference/failure-modes.md).
On **any** silent stall, check folder trust first
([worker-preflight.md](reference/worker-preflight.md)), and only then treat it as infra.

## Audit trail

Log every transition with `log --event <name> --phase N [--stage S] [--detail D] [--sha X]`.
⛔ argparse `choices=` enforces VALID_EVENTS; use its vocabulary. RUN.md is the snapshot; events.jsonl is write-only during the run; use `timeline` afterwards.
`tab open` emits worker_start; SessionStart emits worker_session. You log run_start, stage_skipped and run_end. Post-commit emits commit + usage; pre-commit enforces gate and docs fence. Store commits emit store_commit/store_commit_deferred. [ledger-schema.md](reference/ledger-schema.md) owns fields, collection and hooks.
Abandoning a run: log `run_end --detail aborted` (close-out step 10).
⛔ `_emit()` uses UTC with Z; never replace with naive local time. See [history.md](reference/history.md) for incidents.
A configured budget ceiling emits budget_exceeded/exit 2; halt before next phase. Exit 3 collects usage but leaves E2E durability pending: promote/validate (including --committed autonomously) before terminal budget handling.
