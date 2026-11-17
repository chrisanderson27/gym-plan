# The gap pass — find the questions before a planner pays to discover them

One subagent call at kickoff, over the PRD's own phase list, before the first planner runs.

## Why it exists

Measured on PRD-11 (26425): planning was **61% of phase 2's tokens and 46% of phase 4's**, because
each phase's PRD text posed a question ("establish why", "verify", an open item in §18) that the
planner legitimately had to answer before a line of code could be right. Nothing in the family looked
*across* phases before that planner started: `create-prd` grills on decisions, `plan-feature` plans
one phase cold, and the coupling check (loop step 5) runs after a phase is built. So every
inter-phase question was discovered by the most expensive worker, mid-plan, one phase at a time.

The gap pass asks those questions once, up front, for the whole PRD — and hands each phase's planner
the answer-shaped version ("known gap g3: P1 returns a nullable id, P2 reads it as required;
recommended: make it non-null in P1") instead of leaving it to find the question.

Adapted from the Gap Analyst in lubesoft's `do-task` skill (PR 8273), re-pointed at PRD phases
instead of task-local WHATs, and made deterministic at the edges: findings are validated
mechanically, malformed ones are dropped and listed, and **nothing here blocks a phase** — same
posture as the deviation ledger.

## When it runs

- **`prd-orchestrator` step 0e** — after the phase table is transcribed into RUN.md (0c) and before
  any planner. One `sonnet`/medium subagent; retry once at `sonnet`/high if it returns empty on a PRD
  with 4+ phases (an empty result on a large PRD is suspicious, not reassuring).
- **`create-prd` "After writing" step 1** — the PRD author runs the same prompt over §15 before
  handing the PRD over. A finding there is cheapest of all: it becomes a phase fix or a §18 Open
  Question, and never reaches a run.

"Empty" for the retry means zero findings, whatever the risk array holds.

## Inputs

The PRD's **§15 Implementation phases** section verbatim (goal, deliverables, validation levels,
acceptance criteria, `Depends on:` per phase), plus the §7 design contract and §12 API spec where
they exist — those are where inter-phase contracts are actually written down.

## The prompt

Spawn a `general-purpose` subagent (no herdr tab needed — it reads the PRD, not the tree):

```
Pre-implementation gap analysis over a PRD's phases. Find every issue in ONE pass, not just the
surface ones. Nothing has been built yet.

PRD phases (§15, verbatim):
{phases}

Design contract (§7) and API spec (§12), where present:
{contracts}

Standards the planners will read anyway (treat their rules as already resolved — do not raise them):
{standards list from [knowledge] standards}

Prior findings (do not re-raise):
{existing gaps.json findings, if any}

Filters — apply before every finding:
0. Scope filter: a planner for each phase will read the standards above and the repo's docs. Do not
   flag what those already settle. Focus on inter-phase data contracts, ordering not captured in
   `Depends on`, and codebase-specific facts a standards file cannot know.
0b. Implementation-status filter: this is a PRE-build review of a plan. "The code described in phase
   N does not exist yet" is never a finding. Flag only logical problems with the plan itself: a
   contradictory contract, an impossible ordering, an ambiguous choice a reasonable implementor would
   resolve differently.

Checks:
1. Dependency edges — for each `Depends on` (P_A → P_B) AND for each pair of phases that plainly
   share a type, table, endpoint or screen even if no dependency is declared:
   Q1: Does P_A's deliverable shape match what P_B consumes? (types, nullability, cardinality, naming)
   Q2: Does P_A's ordering satisfy P_B's assumptions? (sequencing, shared-state mutation, migrations)
   Q2b: Is there a real dependency the PRD left out of `Depends on` — or one it declared that is
   only adjacency?
2. Per phase — answer only where you have a nameable issue:
   Q3: What happens on empty input, zero rows, or a failed external call?
   Q4: Does this phase mutate state (table, event, DI registration, shared component) another
   phase reads?
   Q5: Is there a step where two reasonable implementors would make different choices?
   Q6: For UI phases: a state the acceptance criteria are silent on (empty, loading, error,
   permission-denied)?
   Q7: Do the validation levels named for this phase actually exercise its deliverable? (A UI
   phase gated only by `dotnet build` is a gap.)
3. Flag only items with a specific, nameable issue. Do not write "no issues" per question.
4. For each finding, answer "does the recommended resolution create a new gap?" and include those
   downstream gaps in THIS response under `introduces`.

Return JSON only, no prose:
{
  "conflicts":   [{"phases": [1,3], "description": "...", "resolution": "...", "introduces": ["..."]}],
  "gaps":        [{"phases": [2],   "step": "<deliverable or criterion, optional>", "description": "...", "resolution": "...", "introduces": []}],
  "ambiguities": [{"phases": [1],   "description": "...", "resolution": "...", "introduces": []}],
  "risk": [{"phase": 3, "risk": "high", "why": "..."}]
}
Rate `high` only for schema/migration, auth or permissions, money, data deletion, dependency manifest,
CI, or orchestrator gate/hook changes; otherwise `normal` or omit.
Empty arrays when nothing is found. `phases` are the PRD's own phase numbers.
```

## What the orchestrator does with the result

```bash
orchestrator.py gaps write --from analyst.json      # validates, assigns g1…, writes gaps.json + gaps.md, emits gap_pass
orchestrator.py gaps show                           # the table; `--open` for unresolved only
orchestrator.py gaps show --phase N                 # the block pasted into phase N's planner prompt
orchestrator.py ingest --phase N --from <plan>      # marks `## Gaps addressed` lines (- gN: how) resolved
orchestrator.py gaps resolve --id g3 --how "…" --by human   # a human settled it; `--absorb` = not worth a planner's time
```

**Validation on `write`** (a failing record is dropped and listed, never blocks):

- `kind` ∈ {conflict, gap, ambiguity} — set from which array it came
- `phases` non-empty and every number present in RUN.md's phase table (so the pass cannot run
  before 0c has transcribed the PRD)
- `description` and `resolution` non-empty

**Expected volume: 0–6 per PRD.** Zero on a two-phase PRD of unrelated screens is the correct
result. Twelve means the filters were not applied; look at the prompt, not the PRD.

Risk entries require exactly one known phase, `risk` in {high, normal}, and `why` for high.
Malformed entries are dropped and listed. A write carrying `risk` replaces stored risk wholesale;
one without it leaves stored risk untouched; `--replace` clears it. Duplicate phases keep high.
See [risk-routing.md](risk-routing.md) for rating, routing and review effects.

## How a gap gets closed

- The **planner** for an affected phase receives the gap in its prompt, resolves it by reading the
  code, and records the resolution under `## Gaps addressed` in the plan. `ingest` marks it
  `resolved by planner`. If resolving it contradicts the PRD, the planner *also* records a deviation —
  the two ledgers are independent.
- A **human** can settle one at any time with `gaps resolve`. In `commit` autonomy that is the normal
  path for a gap the dry run surfaced.
- `--absorb` is for a finding that is real but trivial — recorded so the report can say the filter
  ran, not handed to a planner.
- A gap **still open at close-out** appears in `deviations-<slug>.md` under *Gap pass*. It means no
  planner claimed it: either the builder resolved it silently (check the phase) or it is still open.

## Honest limits

The analyst reads the PRD, not the tree, so it finds what the PRD *says* inconsistently — not what the
code will make inconsistent. That is deliberate: it is a one-call pre-read, and the planner (which
does read the tree) is the stage that catches the rest. A PRD whose phases are genuinely independent
should produce nothing, and that costs one cheap call to learn.
