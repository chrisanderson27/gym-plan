# Ledger schema

Everything under `<root>/.agents/orchestrator/`. **Gitignored, always** — `preflight` and `report`
both refuse to run if it is not.

```
RUN.md            phase status ledger      (agent-owned, rewritten each pass)
decisions.jsonl   one object per DEVIATION (append-only, machine truth)
events.jsonl      append-only audit log    (write-only during a run)
learnings.jsonl   cross-run tally of review findings
gaps.json         the kickoff gap pass over the PRD's phases (machine truth; `gaps write`)
gaps.md           its rendered review surface (regenerated on every change, never committed)
baseline-dirty/   kickoff files.txt (porcelain), untracked.txt, preexisting.patch; park ignores these paths
known-failures/  per-level <name>.txt baselines; state seeds override configured paths
PARK-REQUESTED    boundary park request, consumed and deleted by lifecycle commands
facts/<p>.md      per-run facts cache — domain, patterns, tests, boundaries, data, gotchas
phase-N/          summary.md, e2e.md, capture.md, manual.md, journey.json, media/, quirks.md, surface.json, risk.json
review.md         the ONE end-of-PRD code review
deviations-*.md   generated report         (never committed)
telemetry.md      run rollup: wall time, tokens, counts (never committed)
```

## RUN.md — status, not history

Keep it under ~40 lines. Detail lives in `phase-N/` artifacts. Rewrite it each pass; never append-grow.

```markdown
# Orchestration run

PRD: <wiki>/.planning/rbcloud/26425/prds/prd-4-bulk-actions.md
Root: <worktrees>/ADO-26668
Store: <wiki>/.planning/rbcloud/26425   # store mode; absent = legacy (docs in the repo)
Started: 2026-09-07
Run id: 3f9a1c0b7d2e
Base commit: a1b2c3d          # HEAD before phase 1 — the final review's fixed point
Human estimate: low 12h · likely 20h · high 32h · basis: implementation and validation · stamped 2026-10-08T12:00:00Z (kickoff)
Autonomy gate: commit         # verbatim from the kickoff; also emitted as run_start
Figma checks: end             # Q5: end | per-phase | skip; independent of E2E cadence

## Phases

| # | phase          | depends on | status    | commit  | artifact / note        |
|---|----------------|------------|-----------|---------|------------------------|
| 1 | data model     | -          | committed | a1b2c3d | phase-1/summary.md     |
| 2 | token refresh  | 1          | committed | e4f5g6h | arch check: clean      |
| 3 | session store  | 2          | held      | -       | d2 one-way (schema)    |
| 4 | logout flow    | -          | pending   | -       | independent of 3       |

## Phase digests
<!-- six lines per phase as it lands -->

## Current
current: phase 4, attempt 1
```

Park appends a block without rewriting earlier bytes; unpark appends a top-level `Resumed:` line.
Repeated parks append repeated blocks; parsers use the last block unless reconstructing the first park.

```markdown
## Parked
- Parked: 2026-10-19T13:58:00Z
- Parked HEAD: <sha>
- Reason: <text>
Resumed: <parkedHEAD> → <HEAD> (2026-10-20)
```

Status values: `pending | building | review | held | committed | failed`.

- **`held`** — an `autonomous`-mode one-way deviation held *this phase's* commit. The work stays in
  the tree and the run continues to the next independent phase. Nothing is held in `commit` mode,
  where the human is already the gate.
- **`depends on`** is a real column because the quarantine logic reads it. It used to live in
  free-text prose, which no script could act on.

## decisions.jsonl — one object per deviation

**Append only.** Nothing rewrites this file — the old in-place rewrite existed only to persist
blocking downgrades, and is what made the state monotonic and un-correctable.

Admissibility is decided by [deviation-rubric.md](deviation-rubric.md). **Most decisions never land
here**; expect 2–5 rows per PRD.

```json
{"id":"d3","phase":2,"kind":"contradicts","prd_ref":"§9",
 "prd_says":"Phase 4 reserves the only migration in this PRD; earlier phases add no persisted columns.",
 "built":"EmpReportSettings reached via a new non-ABP mirror model + EF configuration, added in Phase 2.",
 "why":"RBCSApiDbContext owns no migrations, so the ABP entity could not be read through the API context.",
 "where":["src/RBCS.EntityFrameworkCore/Migrations/20260824223150_AddEmpReportSettings.cs:1"],
 "evidence":["src/RBCS.Api.Infrastructure/Repositories/TransactionsRepository.cs:212-240"],
 "blast":"schema","one_way":true,
 "verify":"git log --oneline -- src/RBCS.EntityFrameworkCore/Migrations/ | head -3"}
```

| field | required | meaning |
|---|---|---|
| `id` | yes | short unique id (`d1`, `d2`, …) |
| `phase` | yes | the phase this deviation belongs to |
| `kind` | yes | `contradicts` \| `extends` \| `reinterprets` \| `architecture` |
| `prd_ref` | yes | section anchor; must resolve to a real PRD heading |
| `prd_says` | yes | **verbatim** PRD quote, ≤240 chars — Gate A |
| `built` | yes | what was built instead, one sentence |
| `why` | yes | the justification |
| `where` | yes | `file:line` list — where the deviation **lives** |
| `evidence` | yes | `file:line` list — what **justified** the call (ranges + multi-file OK) |
| `blast` | yes | `schema` \| `api-contract` \| `auth` \| `money` \| `data` — Gate B |
| `one_way` | yes | `true` ⇒ `blast ∈ {schema, money, data, auth}` |
| `verify` | yes | how a human confirms this in 30 seconds |

`where` and `evidence` are deliberately **separate fields**. Overloading them into one is part of why
cites stopped resolving in the old schema.

**Removed from the old schema**, all of which existed only to serve blocking: `classification`,
`confidence`, `repairable`, `enforced_reason`, `options`, `recommended_default`. `topic` is gone too —
it was empty on 34 of 332 records and produced fifty consecutive blank bullets in the old `flags.md`.
`revisit_if` folds into `verify`.

## events.jsonl — the audit log

Append-only, **write-only during a run**. Never read it back into the loop's context, so it can grow
without rotting anything. `orchestrator.py log --event … [--duration-s N]` appends; `timeline` renders.

`log` accepts exactly `VALID_EVENTS` (argparse-enforced): `app_start`, `app_stop`, `arch_check`, `awaiting_human`, `budget_exceeded`, `commit`, `docs_fence_block`, `e2e_fail`, `e2e_fallback`, `e2e_na`, `e2e_pass`, `e2e_promoted`, `facts_ingest`, `failed`, `figma_fail`, `figma_na`, `figma_pass`, `figma_pull`, `fix_cycle`, `gap_pass`, `gap_resolved`, `gate_block_commit`, `gate_fail`, `gate_pass`, `held`, `human_estimate`, `library_sync`, `noticed_ingest`, `one_way_recorded`, `phase_risk`, `plan_done`, `plan_skipped`, `quarantined`, `resumed`, `review_done`, `run_end`, `run_resumed`, `run_start`, `scope_flag`, `stage_skipped`, `store_commit`, `store_commit_deferred`, `surface_hit`, `usage`, `verify_fail`, `verify_pass`, `verify_stale`, `verify_unbound`, `worker_session`, `worker_start`.

`human_estimate` is emitted by `estimate`, with `run_id`, `low`, `likely`, `high` (hours), `basis`, and `source: kickoff|revised`. It writes the structured RUN.md line once at kickoff.
The first kickoff event wins; revisions never rewrite the line. Workbench parses kickoff event → structured line → legacy free text.

`verify_stale` (from `gate`: changed paths capped at 20, levels re-run, result) and
`verify_unbound` (from `gate`: no HEAD / not git, decided on the recorded result).

**Hook-written events** (all carry `"source":"hook"`):

- `acceptance_missing`: `stop-gate.sh`, builder summary still has no `## Acceptance` table after 3 refusals; released, not failed.
- `verify_red_at_stop`: `stop-gate.sh`, builder/fix verify still red or stale after 3 refusals; released, never `GATE-FAILED`.
- `build_done`: `stop-gate.sh`, builder artifact complete.
- `stage_done`: `stop-gate.sh`, other stage artifact complete.
- `e2e_done`: `stop-gate.sh`, E2E artifact bundle complete.
- `gate_block`: `stop-gate.sh`, required artifact missing within retry allowance.
- `gate_failed`: `stop-gate.sh`, artifact still missing after retries.
- `git_fence`: `git-fence.sh`, denied git mutation.
- `subagent_denied`: `subagent-fence.sh`, builder/fix Agent or Task call denied.
- `worker_session`: `session-start.sh`, Claude session linked to phase/stage.

`gate_fail` (from `gate`) and `gate_failed` (from the stop-gate) are different events;
both count as fix cycles.

**Script-only events** (written by `_emit`, not via `log`): `journey_incomplete`
(`promote-e2e`). `worker_start` is written by `tab open`.

`phase_risk` (from `risk`: `risk`, `source`, `categories`, `applied`, `detail` = the RUN.md token).

`surface_hit` (from `surface`: `hits` = new hits this run, `categories`, `detail` = first three lines; phase null for `--final`).

**Store and guard events** (written by `_emit`; also in `VALID_EVENTS` so the vocabulary has one home):

- `store_commit`: `store-commit` committed store paths in the wiki — `phase` (int or absent), `sha` (the
  wiki commit), `detail` (the commit message, `planning(<ctx>/<feature>): phase N`).
- `store_commit_deferred`: `store-commit` found the wiki mid-merge/rebase/cherry-pick and committed
  nothing (exit 3) — `phase`, `detail: wiki mid-<op>`. Re-run `store-commit` once the wiki is clean.
- `docs_fence_block`: the pre-commit docs fence refused a commit that staged a guarded path
  (`docs/ai/{prds,plans,testing}/`, `.workbench/`) — `phase` (the active phase, if any), `detail` (the
  first 20 paths). Emitted only when the repo has a run (`RUN.md`); the fence itself runs regardless.

`store import` is a one-off migration with no run, so it emits nothing; its one wiki commit
(`planning(<ctx>): import from <repo>@<ref>`) is the record.

### Telemetry event contract

`telemetry` joins `worker_session.session_id` to `<projects>/<enc>/<session_id>/subagents/*.jsonl` for the per-stage subagent figure, and unjoined sessions report as `unattributed`.

| Event | Fields (beyond `ts` UTC `Z`, `event`) | Emitted by |
|---|---|---|
| `run_start` | `run_id: str(12 hex)`, `detail` (kickoff summary) | orchestrator (`log`) |
| `run_end` | `run_id`, `detail: completed\|partial\|aborted\|parked` | close-out; `parked` only by `park` |
| `run_resumed` | `run_id`, `detail: <parkedHEAD>..<HEAD>` | `unpark` |
| `worker_start` | `phase: int\|null`, `stage: Stage`, `kind: claude\|codex\|copilot\|cursor\|agy\|…`, `model: str\|null`, `effort: str\|null`, `config_dir: str\|null`, `pane_id: str` | `tab open` |
| `worker_session` | `phase`, `stage`, `session_id: str` | worker `SessionStart` hook (Claude only) |
| `stage_skipped` | `phase: int\|null`, `stage: Stage`, `detail: reason` | orchestrator |

**Pairing.** For a Claude worker, `worker_session` is matched to the nearest earlier `worker_start` with the
same `(phase, stage)`. A `worker_start` with no session is shown as a stage with `cost: 'unmeasured'`,
`attribution: 'unattributed'` and the reason "worker never started a session".

**`Stage`** is a closed list, matching `tab open`'s stages plus two pseudo-stages: `planner`, `builder`,
`fix`, `reviewer`, `coupling`, `e2e`, `figma`, `pilot`, `app`, `verify`, `orchestrator`, `unattributed`.
`verify` has no worker; its time is the window from `build_done` to `verify_pass`/`verify_fail`.

**Done-event → stage.** `plan_done`/`plan_skipped` → planner. `build_done` → builder (`fix` when the detail
names `fix-summary`). `stage_done` → the event's own `stage` field (`reviewer` or `coupling`). `e2e_done`,
`e2e_pass`, `e2e_fail`, `e2e_na` → e2e. `figma_pass`, `figma_fail`, `figma_na` → figma. `review_done` →
reviewer.

`phase_committed` is never emitted; telemetry counts `commit`.

`init` writes `Run id:` into RUN.md; `log` stamps it on `run_start`;
`run_end` takes the latest `run_start`'s id, or derives
`sha1(realpath(root) + ts)[:12]` for runs started before run ids existed.

`report` reads it for `quarantined` / `failed` / `e2e_fail` / `verify_fail` to build the report's
**"Phases that did not land clean"** section.

### Rule enforcement events

| Event | Fields | Producer |
|---|---|---|
| `subagent_denied` | `phase`, `stage`, `detail` (`denied: Agent\|Task`) | worker subagent-fence hook (builder, fix) |
| `instruction_fence` | `phase`, `stage`, `detail` (denied path) | worker instruction-fence hook; also accepted by `log` |
| `secret_fence_block` | `phase`, `detail` (file and line only) | pre-commit secret fence; never includes credential values |

## gaps.json — the kickoff gap pass

`risk` is an optional per-phase map: `{"3": {"risk": "high", "why": "auth", "source": "analyst"}}`.
It is independent of the findings count; only high entries add a Risk section to gaps.md.

Written by `orchestrator.py gaps write` from the Gap Analyst's JSON ([gap-pass.md](gap-pass.md)),
validated like the deviation ledger: malformed findings are **dropped and listed**, never blocked.

```json
{"ts": "2026-10-06T14:02:11Z",
 "findings": [
  {"id": "g1", "kind": "conflict", "phases": [1, 2],
   "description": "P1 returns a nullable id; P2 reads it as required",
   "resolution": "Make the id non-null in P1", "introduces": ["P1 needs a default for legacy rows"],
   "status": "resolved", "resolved_by": "planner", "resolved_phase": 1,
   "how": "id made non-null; legacy rows default to 0 in the migration", "source": "analyst"}
 ]}
```

| field | meaning |
|---|---|
| `kind` | `conflict` (two phases disagree) \| `gap` (a phase is silent on something it must decide) \| `ambiguity` (two reasonable builders would differ) |
| `phases` | the PRD's own phase numbers; every one must exist in RUN.md's table |
| `status` | `open` → `resolved` (a worker claimed it in `## Gaps addressed`, or a human via `gaps resolve`) or `absorbed` (real but not worth a planner's time) |
| `introduces` | downstream gaps the recommended resolution creates — recorded, not separate findings |

`gaps show --phase N` renders the open findings touching phase N as the block the planner prompt
carries. `report` ends with the still-open ones.

## facts/ — the per-run facts cache

One file per partition, one `- ` line per fact, each tagged `_(pN stage)_` with where it came from.
A fact must cite at least one path that exists in the tree or `facts add` / `ingest` drops it, and
exact duplicates are dropped. `facts show` is the block pasted into the next planner's and builder's
prompt. This is what carries a discovery forward under the fresh-context-per-worker rule without
carrying a transcript.

## learnings.jsonl — the cross-run tally

One line per code-review finding: `{class, standard_file, phase, file, prd}`. Gitignored,
machine-only, aggregated across runs. Cheap unbounded accumulation; promotion is a separate, gated
step — the same shape as the second brain's own `reflect.py`.

## Scope and fix state

`phase-N/risk.json` records phase, risk, source, gap, surface, plan, notes, route and ts.

`phase-N/surface.json` / `surface-final.json` record phase, ts, commits (the scanned set), hits and notes.
`extra_commits` preserves explicit `surface --phase N --sha S` attribution across reruns; prior
hook-only commits are checked against the phase plan again. Report renders notes and identifies
failed scans even when a surface record exists.

`scope_flag` reports out-of-plan paths; `noticed_ingest` counts harvested and dropped tangents;
`fix_cycle` records the cycle number and worker kind. These add no hold.
`phase-N/scope.json` records phase, base, plan, planned, touched, out_of_plan, blast and ts (or error).
`noticed.jsonl` and `decided.jsonl` hold deduplicated harvests, archived per run.
`phase-N/handoff.md` carries ≤10 lines from the first builder; `phase-N/fix-cycles` counts fixes;
`phase-N/verify-fix.md` is the second fix worker's artifact (`fix-2.prompt.md` is its prompt).
`verify.json` carries `tree` (working-content git tree id, or null when unverifiable); levels can record `skipped (out of scope)`; `full`, `base`, `touched` record scope provenance.

## Telemetry collection

Token usage is harvested from `$CLAUDE_CONFIG_DIR` plus every `~/.claude*/projects` (deduped), using exact per-message counts and UTC. Claude sessions only; other runtimes have no comparable local counts. Post-commit emits phase usage automatically; `usage --since <ts> --phase N` is the manual path. No pane scraping or `/context` parsing. Exit 3 records usage but leaves E2E durability pending; promote/validate before treating it as a terminal budget check.
