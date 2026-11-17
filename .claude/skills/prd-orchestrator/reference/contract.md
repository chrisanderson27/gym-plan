# The orchestration contract

One owner per concern. When two skills disagree, **this file wins** — that is the whole point of
writing it down. It exists because the orchestrator had silently forked its sub-skills: `grep -rn
'execute' prd-orchestrator/` returned zero hits while the loop inlined a rival builder prompt.

## Ownership

| Concern | Owner | Nobody else may |
|---|---|---|
| **Phase definition and sizing** | **`create-prd`** | ⛔ the orchestrator does not re-slice them — it transcribes |
| Phase *sequencing* and dependencies, the ledger, RUN.md | **orchestrator** | write RUN.md |
| **Commit** and push | **orchestrator** | a worker never commits (enforced by the H3 git fence, including global options and blanket/force adds) |
| **App lifecycle** — start, ready-probe, stop | **orchestrator** | a builder or e2e worker never starts the app; enforced for builder/fix by the git fence |
| **Instruction files** — `AGENTS.md`, `CLAUDE.md`, `.claude/standards/**`, `[knowledge] always_loaded` | **the owner** | workers cannot edit them (`instruction-fence.sh`). A file a later phase or repo adds to `[knowledge]` goes under a key other than `always_loaded` and outside `.claude/standards/` unless meant to be worker-read-only |
| Build/test execution, boundary checks, plan sanity-check | **`execute`** | the orchestrator does not re-run build+test |
| Plan shape, mandatory-reading list, validation levels | **`plan-feature`** | the orchestrator does not invent plan structure |
| Browser driving, app quirks | **`e2e-test`** + the repo's e2e profile | the orchestrator never drives a browser |
| The **gap pass** (`gaps.json`) and the **facts cache** (`facts/`) | **orchestrator** — it writes them via `gaps write` / `ingest` | a worker never edits them directly; it reports `## New facts` and `## Gaps addressed` in the artifact it already writes |
| `PARK-REQUESTED` | Workbench writes it; the orchestrator consumes it | retain it across a new run |
| Stack facts: commands, paths, ports, standards | **`.claude/orchestrator.toml`** | no skill hardcodes them |

Three contradictions this table resolves, all live before it existed:

- The orchestrator's Step 0 used to say "**split** the PRD" and sized a phase at "one commit's worth",
  while `create-prd` sizes one at "the largest coherent slice one agent can carry … roughly 80% of a
  context window" and `plan-feature` says "if the PRD already defines phases, **inherit them; do not
  re-slice them thinner**". The orchestrator is the runtime authority, so its smaller rule silently
  won — turning correct PRDs into more, smaller, more expensive phases. **The PRD owns the split.**
  The orchestrator derives only `depends on`, which the PRD does not record.

- `execute` told the builder to `cd Aspire/… && dotnet run` on port 5000, while the orchestrator
  asserted "the builder cannot exercise the live app" and ran `app-run.sh kill` on that exact port.
  **App lifecycle is the orchestrator's.** In orchestrated mode `execute` must not start the app.
- The planner prompt said "do **NOT** ask me" while `plan-feature` said "if requirements are still
  unclear, **ask** before continuing." A planner obeying its own skill halts an unattended run.
  **See `## Orchestrated mode` in each sub-skill.**

## Stage returns

Every worker returns a **path**, never prose. The orchestrator reads the artifact, extracts a verdict,
and discards the rest — that is what stops its context rotting.

| Stage | Artifact | Reply must be |
|---|---|---|
| planner | a plan file under `<Store>/plans/` (store mode — RUN.md has a `Store:` line); legacy runs only: under `[plans] dir` | the plan's **absolute** path, **or the literal token `NO-PLAN-NEEDED`** |
| builder | `.agents/orchestrator/phase-N/summary.md`, containing `## Acceptance` (shape in PRD-1 §12 / `execute`) | that path |
| e2e | `.agents/orchestrator/phase-N/e2e.md`, `capture.md`, `manual.md`, plus `media/index.md` for pass/fail; `journey.json` expected (missing → `Journey: incomplete`, never blocking) | the `e2e.md` path |
| fix (verify cycle 2) | `.agents/orchestrator/phase-N/verify-fix.md` | that path |
| reviewer | `.agents/orchestrator/review.md` | that path |

**`NO-PLAN-NEEDED` is required.** `plan-feature` has a legitimate low-complexity branch that writes no
file; without a token for it the orchestrator waits forever for a path that is never coming. On
receiving it, the orchestrator builds from the PRD phase text and records `plan: skipped (trivial)`.

`phase-N/handoff.md` is written by the first builder: ≤10 lines, done / stuck / tried.

**Optional sections ride inside the planner's and builder's artifacts**, harvested by
`orchestrator.py ingest --phase N --from <artifact>` the moment the orchestrator reads it:

| Section | Line shape | Becomes |
|---|---|---|
| `## New facts` | `- <domain\|patterns\|tests\|boundaries\|data\|gotchas>: <fact> — <path:line>` | a line in `facts/<partition>.md`, pasted into every later worker prompt. Dropped if no cited path exists in the tree, or if it duplicates one already there |
| `## DECISIONS` | `### Decided for you` Dn / `### For the owner` Qn bullets | `decided.jsonl` |
| `## Noticed, not done` | `- <file:line> — <one line>` | `noticed.jsonl`, cap 3 per phase |
| `## TOUCH SET` | exact paths or directory prefixes | read by `gate`, not harvested |
| `## Gaps addressed` | `- gN: <how it was settled>` | the kickoff finding `gN` marked `resolved by planner` (or `builder`) in `gaps.json` |

Both are **report-back, not write-access**: the worker never touches `gaps.json` or `facts/`. That keeps
the two files the orchestrator's, and keeps a worker's wrong fact from silently poisoning the next
prompt — `ingest` validates, drops, and lists.

## Completion is the artifact, never the lifecycle state

A herdr `idle` is not "done" — under auto-mode a worker settles to `idle` between tool batches. Poll
for the artifact. With the H1 `Stop` gate installed, a worker that reaches `idle` **without** its
artifact is a *hard* failure rather than an ambiguous one.

For E2E, completion means the whole evidence bundle. The orchestrator then owns the second boundary:
`promote-e2e --phase N` must create a redacted scenario in `<Store>/testing/` (legacy runs: `[testing].dir`), and
`validate-e2e --phase N` must pass before the phase can advance. Workers never promote or commit;
the orchestrator records store files with `store-commit`.

And before any of that: a worker in an untrusted folder reports `interactive_ready: true` and then
exits without running at all. See [worker-preflight.md](worker-preflight.md).

## Deviation records

Workers append to `.agents/orchestrator/decisions.jsonl`. The admissibility rubric and the full field
list live in [deviation-rubric.md](deviation-rubric.md); the schema is in
[ledger-schema.md](ledger-schema.md). Two rules bind every worker:

- **Most decisions are absorbed, not recorded.** If you cannot quote the PRD, you are implementing.
- **Report how many you absorbed.** Write the count to `.agents/orchestrator/phase-N/absorbed` (a bare
  integer). `report` sums these. It is what tells a reader the filter *ran* — without it, "no
  deviations" is indistinguishable from "nobody recorded anything".
- **Never rewrite the file.** Append only. Nothing downgrades or re-classifies a record after the fact.

## What a worker must never do

- commit, push, or `git reset --hard` (structurally denied by the H3 hook)
- start or stop the application
- edit `RUN.md`, `events.jsonl`, or another phase's artifacts
- edit the files that instruct agents — `AGENTS.md`, `.claude/standards/**`, `CLAUDE.md`. Autonomy
  covers code, which is gated by build+test+e2e+review. It does not cover the files that instruct the
  agents, which are gated by nothing.

## Subagent policy

| Stage | Subagents | Enforced by |
|---|---|---|
| builder, fix | none | `subagent-fence.sh` (PreToolUse `Agent\|Task`, exit 2, `subagent_denied`) |
| planner | at most two read-only search subagents, only when the phase spans more than one area | prose + telemetry |
| reviewer | the review skill's fixed set only: code-review's two axes inherit the reviewer's routed model; Workbench review's two axes + one scrutinizer use the launch prompt's `SUBAGENT_MODEL`, default `opus` | prose + telemetry |
| e2e | none | prose + telemetry |

The orchestrator's own subagents (gap pass, coupling check) report as `unattributed`; see `orchestrator.py telemetry` → `## Subagents`.

## Park and resume

Contracts consumed by the next phase:

- **Liveness:** a run is live when RUN.md exists and no `run_end` follows the last `run_start` or
  `run_resumed` in `events.jsonl`. `run_resumed` is `{event, ts, run_id, detail: "<parkedHEAD>..<HEAD>"}`.
  The latest of `run_end` and `run_resumed` decides `end`.
- **The `## Parked` block** has exactly these lines: `- Parked: <ISO date>`, `- Parked HEAD: <sha>`,
  `- Reason: <text>`. Free-form bullets may follow. A missing `run_end parked` event is tolerated.
- **Pane ids:** `park` prints the run's pane ids from `tabs.json` (JSON on stdout) **before** it moves
  the state dir.

`park` exit 0 prints exactly two JSON lines: `{"panes": [...]}` then
`{"parked": "<slug>", "dest": "<root-relative destination>"}`. Exit 1 prints a refusal on stderr.
`--force` lifts only the in-flight phase-status guard; dirty-tree, ended-run, slug-collision and
uncommitted-phase GATE-FAILED guards remain.

`unpark --slug S` exits 0 on success or 1 on refusal. It refuses a live destination run;
`--force` archives that run first, for an orphan confirmed by the caller. A finished run is archived
without force. Unarchived unexpected state is never deleted. Cross-run learnings are carried forward.

Workbench writes `PARK-REQUESTED` with optional JSON `{"reason": "…", "at": "…"}` or plain text.
The request waits for a phase boundary or the point before a human/budget wait. Sweep tabs before
parking. `park`, `_archive_run`, `unpark` and `init` delete the request so it cannot affect a new run.
The parked layout `.agents/orchestrator-parked/<slug>/` holds the whole state dir.

Resume preserves kickoff answers, routing, base, estimate and run identity. Verify once in phase 0
on the new HEAD before continuing WIP; red levels are normal next-phase failures. Final review and
drift use `review-range`'s own commits and explicitly ignore foreign commits.

## Legacy failed-phase scenario commits

*Legacy mode only (no `Store:` line):* `validate-e2e --committed` checks the scenario is tracked at the
team repo's `HEAD`, so the scenario rides in the phase commit; for a failed or blocked phase, autonomous
mode makes a docs-only commit scoped to that scenario, and a human-commit mode stops and lists it as
required. **That docs-only commit is the one sanctioned commit without a `.gate-pass`** — write
`.agents/orchestrator/.gate-override` with a one-line reason first (the pre-commit hook honours it and
logs a `gate_block_commit`-free pass), then remove it after. Store runs never do this. The explicit
"commit nothing" kickoff option remains the only other exception.
