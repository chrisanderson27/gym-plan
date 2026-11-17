---
name: plan-feature
version: 2.1.0
description: Turn a feature request, PRD or ticket into a context-rich implementation plan in the PRD's store plans/ dir (wiki .planning/<ctx>/<feature>/plans/) — the files to read first, the verified pattern each new file mirrors, the gotchas, and runnable validation commands. Writes no code. Use before implementing anything Medium or High complexity.
---

Repo facts come from `[knowledge]` (standards, `scope_notes`, `codebase_docs`) and AGENTS.md; worked example: `prd-orchestrator/reference/repo-pack/rbcloud/repo-knowledge.md`.

# Plan a Feature

## Feature: $ARGUMENTS

## Mission

Transform a feature request into a **comprehensive implementation plan** through catalog research,
targeted code reading and strategic thinking.

**Core principle: we write no code in this phase.** The goal is a plan rich enough that the executing
agent succeeds on the first attempt.

**Key philosophy: context is king.** The plan must carry everything needed — patterns, mandatory
reading, gotchas, validation commands — because the agent executing it starts cold.

**Output:** `<Store>/plans/prd-<N>-phase-<M>-<kebab-case-name>.md` — `<Store>` is the PRD's store dir
(`~/git/personal/wiki/.planning/<ctx>/<feature>/`, the parent of the PRD's `prds/`), naming the PRD (`<N>`)
and phase (`<M>`) this plan implements. A plan not tied to a PRD phase (a one-off or tooling plan) is
`<Store>/plans/<kebab-case-name>.md`. Plans are never written into a team repo (see *Output* below).

---

## Phase 1 — Feature understanding

- Extract the core problem being solved, and the user value
- Feature type: New Capability / Enhancement / Refactor / Bug Fix
- Complexity: **Low / Medium / High**
- Map affected systems and components

> **Right-size the ceremony.** For a genuinely **Low** complexity change, a written plan costs more than
> it saves. Say so, state the approach in three sentences, and hand back — let the user go straight to
> implementing. This skill produces a file for **Medium and High** only.

Write or refine the user story:

```
As a <type of user>
I want to <action/goal>
So that <benefit/value>
```

---

## Phase 2 — Codebase intelligence

⛔ **`docs/ai/` exists so you do not have to grep.** `src/` is large, part-dead and mid-migration. Read
the catalog first and use code reading to *confirm* what it tells you, not to discover it.

### 2a. The stack question — always first

⛔ **Read the repo's own docs before you grep.** A mature repo keeps a codebase-intelligence bundle
(`[knowledge] codebase_docs` / `standards` in `.claude/orchestrator.toml`, plus `AGENTS.md`). Source
trees are large, often part-dead and mid-migration; the docs exist so you do not have to reconstruct
the truth from files.

For any repo, answer these **before** planning, and **state the answers in the plan**:

- **Which stack does this area actually use?** Many repos are mid-migration and the same screen exists
  twice. Say which one this feature touches, and cite the doc or file that proves it.
- **Is this area listed as migrated, in-flight, or legacy?** If the repo tracks migration status, read
  it and quote it.
- **Does a generated bundle describe this area?** If so it is the fastest route in — but never
  hand-edit it; those files are regenerated and hand-edits are discarded.
- **Is this area named in the repo's known-issues or tech-debt list?** If yes, the plan must say how it
  interacts with the known problem.

If the repo declares a design source for UI work (e.g. Figma via the `figma-extractor` skill), the
design is the source of truth for layout and copy — plan from it, not from a guess.

### 2b. The files

Name the exact files to read, and why each one matters. A plan that says "look at the API layer" has
done no work. A plan that says "read `X` for the handler shape and `Y` for the repository pattern"
has.

### 2c. Pattern recognition — and the verification rule

⛔ Verify an exemplar is live by grepping for the interface the repo's standards name and confirming registration/callers. Do not infer current patterns from neighbouring code.

The standards guides say which patterns are current — read the one for every layer the work touches:

| Layer touched | Guide |
|---|---|
Read the standards guide for **every layer the plan touches** — the set is declared in
`[knowledge] standards` in `.claude/orchestrator.toml`. List in the plan exactly which ones apply and
the specific rules from each that bite here. "Follow the standards" is not a plan; "the API standard
forbids X, so this handler does Y" is.

Each carries a *patterns you will see — do NOT copy* table. Lift the relevant rows into the plan's
**Traps** section so the executing agent does not have to find them.

### 2d. Naming

Check every business term against the repo's glossary (if it keeps one) before using it. Domain
words are rarely what an outsider assumes.
The UI, code and database can use different names; verify the mapping before searching.

### 2e. Testing patterns

- Follow the test-trait/filter rule in the repo's testing standard and state the configured test frameworks.

- Naming and placement: follow the repo's existing test conventions — find them, state them in the plan
- Find a real, passing test in the same area to mirror — and verify it actually runs under the filter

### 2f. Integration points and known debt

- Existing files needing updates; new files and where they go
- Endpoint/route registration, DI registration, tenant scoping
- the repo's known-issues log (`[knowledge] divergence_log`) and
  its tech-debt list — if the area is listed, the plan must say
  whether this change avoids making it worse or fixes it deliberately

### Clarify ambiguities

If requirements are still unclear, **ask before continuing** — one question at a time. **If a fact can
be found by reading the repo, look it up; do not ask.** The decisions are the user's; the facts are
yours. Resolve architectural decisions before writing the plan, not during implementation.

---

## Phase 3 — External research

Only where the codebase cannot answer the question — a library's API, a framework behaviour, a
breaking change. Prefer primary sources, cite with section anchors, and say *why* each link is needed:

```markdown
- [EF Core — Global Query Filters](https://learn.microsoft.com/ef/core/querying/filters)
  - Section: interaction with `IgnoreQueryFilters`
  - Why: tenant filter must not be bypassed by the new repository method
```

Do not research what AGENTS.md and the standards guides already settle.

---

## Phase 4 — Think it through

Explicitly, before writing:

- Does this fit the architecture or fight it?
- Critical dependencies and the right order of operations
- What could go wrong — edge cases, race conditions, blast radius if it fails
- Which seam gets tested, and how
- Does it add an N+1 or an unbounded query?
- Auth, permissions and **tenant scoping** — defaulting a missing tenant to `0` is not error handling
- What the next person needs to know

Choose between alternatives with stated rationale rather than presenting a survey.

---

## Phase 5 — Write the plan

````markdown
---
type: Architecture Note
title: <Feature> — Implementation Plan
description: >-
  <One sentence, written to be read out of context>
status: draft
feature: 12300          # ⛔ parent Feature id — same value as the PRD's `feature`
prd: 1                  # ⛔ which PRD in that Feature this plan implements
phase: 1                # ⛔ which phase of that PRD this plan implements
work_item: 12345        # optional — the story this phase delivers
---

# <Feature> — Implementation Plan

The plan below should be complete, but **validate the documentation, the patterns and each task's
sanity before implementing.** Pay attention to the names of existing types, utils and models, and
import from the right files.

## Feature description

<What it is, its purpose, and its value>

## User story

As a <type of user> / I want to <action> / So that <benefit>

## Problem statement

## Solution statement

## Metadata

| | |
|---|---|
| Type | New Capability / Enhancement / Refactor / Bug Fix |
| Complexity | Medium / High |
| **Stack** | which stack this area actually uses — **cited to a doc or file** |
| Frontend | Actual rendering stack, cited to the repo's architecture or migration doc |
| Primary projects affected | |
| Work item / PRD | |

---

## CONTEXT REFERENCES

### ⛔ Read these files before implementing

- `src/path/to/file.cs:15-45` — Why: <the pattern this establishes>
- `src/path/to/repository.cs:100-120` — Why: <query shape and tenant filter to follow>

### Files to create

- `src/path/to/New.cs` — mirrors `src/path/to/Exemplar.cs` (**verified**: implements the repo standard's interface)
- `test/path/to/NewTests.cs` — mirrors `<real passing test>`

### Standards that apply

- `.claude/standards/<file>` — <the specific rules that bite here>

### Traps in this area

- <rows lifted from the do-NOT-copy tables>
- <entries from KNOWN-ISSUES.md / tech-debt.md>
- <repo-specific registration and execution traps, cited to standards>

### Relevant documentation

- [Link](https://example.com/doc#section) — Section: X — Why: needed for Y

---

## IMPLEMENTATION PLAN

⛔ **Phases are sized by session, not by this list.** A phase is the largest coherent slice one agent
can carry from the first edit to a green validation run without a handoff — roughly **80% of a context
window, never planned past it**. There is no minimum: a small change is **one phase**. If the PRD
already defines phases, inherit them; do not re-slice them thinner.

The headings below are a **menu of shapes, not a required sequence.** Take the ones the work actually
has and merge them until each phase fills a session. Most changes need one or two phases, not four.

- **Foundation** — base structures, contracts, DI registration
- **Core implementation** — business logic, handlers, repository methods, endpoints
- **Integration** — route/endpoint registration, frontend wiring, configuration
- **Testing & validation** — unit tests, integration tests, edge cases

⛔ **Testing is never its own phase.** Every phase ends with the build green and its own validation
levels passing, so the tests for a slice ship inside that slice. A phase that ends red, or defers its
validation to the next phase, is a task — not a phase.

Two tests before committing to a split:

- **The merge test.** If two adjacent phases would be worked in the same sitting, and the first has no
  independent reason to be reviewed, they are **one** phase.
- **The green test.** Every phase ends on a green run of its own gates.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently testable.

⛔ **Validation is batched, not per-task.** Implement the whole phase's code changes first, then run the
VALIDATION COMMANDS section **once**, at the end. Each task carries a `VALIDATE` line so the executing
agent knows how that task will be checked — but the build and test suites run after **all** tasks land,
not between them. Confident changes across every task followed by a single batched validation is faster
than a build-per-task, and the batch rarely fails; when it does, trace the error back to the task that
caused it and fix it. Per-task, the executing agent only self-checks syntax, imports, and the stack
boundary — it does not compile or run tests.

Keywords: **CREATE** · **UPDATE** · **ADD** · **REMOVE** · **REFACTOR** · **MIRROR**

### {ACTION} {target_file}

- **IMPLEMENT:** <specific change>
- **PATTERN:** `<file:line>` — verified live
- **IMPORTS:** <required usings/imports — must not cross the stack boundary>
- **GOTCHA:** <known constraint>
- **VALIDATE:** `<runnable command>` — how this task is checked in the final batched run, **not** after this task

<continue in dependency order…>

---

## TESTING STRATEGY

Which test project and naming convention; follow the test-trait/filter rule in the repo's testing standard.

### Unit tests
### Integration tests
### Edge cases

---

## VALIDATION COMMANDS

Copy the levels from `[validation] levels` in `.claude/orchestrator.toml` **verbatim**, in the order
declared, with each level's `expect`. The builder runs exactly these and reports each result — so a
level you omit is a level nobody runs.

| # | Level | Command | Pass condition |
|---|-------|---------|----------------|
| 1 | <name from config> | `<cmd from config>` | <expect from config> |

If the repo declares `[boundary_checks]`, add each as a level too, naming its `baseline` and stating
that **over baseline means fix the code, not the baseline**.

Never invent a command that is not in the config. If a level the plan genuinely needs is missing from
the config, say so in the plan's NOTES — that is a config gap for a human to close, not something to
paper over with a guess.

## EVIDENCE PLAN

| Acceptance criterion | Evidence | Produced by |
|---|---|---|
| AC1 <text from the PRD phase> | <command and expected output, screenshot name, or curl> | verify / e2e / builder |

`ACn` is the n-th bullet of the PRD phase's *Acceptance criteria*, with the criterion text quoted
beside its id. Include one row per criterion, none skipped.

## DECISIONS

### Decided for you
- D1: <choice>. Reason: <why>. Overrule by: <how>.

### For the owner
- Q1: <question>. Recommended: <answer>. Blocks: nothing.

## TOUCH SET
- <exact/repo-relative/path> (modify)
- <directory/prefix/> (create)

## BLAST RADIUS
normal — <one sentence naming the callers>.

- "Decided for you" holds anything a second planner could reasonably have chosen differently, never a copied pattern.
- "For the owner" holds a phase only for a one-way decision; record it through `decisions.jsonl` (`one_way: true`, per the deviation rubric). Otherwise `Blocks: nothing`.
- TOUCH SET accepts exact repo-relative paths or directory prefixes ending in `/`, no globs. Renames list both paths; mirrored test files need not be listed.
- BLAST RADIUS is `light | normal | deep` plus one sentence naming callers; `deep` names neighbouring screens for e2e.

## ACCEPTANCE CRITERIA

- [ ] Feature implements all specified functionality
- [ ] All validation levels pass with zero errors
- [ ] New tests follow required markers/filters and appear in the configured run
- [ ] Code follows the standards guides for every layer touched
- [ ] Every `[boundary_checks]` check the repo declares is at or under its baseline
- [ ] No new `.Result`, `.Wait()`, or `GetAwaiter().GetResult()`
- [ ] No hardcoded connection string, credential, token or tenant identifier
- [ ] Required scope is validated; no silent fallback on missing context
- [ ] No regressions in existing functionality
- [ ] Documentation updated if applicable

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order, then validated in one batched run at the end
- [ ] Full test suite passes
- [ ] Manual testing confirms the feature works
- [ ] Acceptance criteria all met
- [ ] Deviations from this plan documented and raised at the time

---

## NOTES

<Design decisions, trade-offs, anything deliberately left out>

## Confidence

**N/10** that execution succeeds first-pass. **Below 7 means something is still missing — say what.**
````

---

## Output

**Filename:** `<Store>/plans/prd-<N>-phase-<M>-<kebab-case-descriptive-name>.md` — e.g.
`~/git/personal/wiki/.planning/rbcloud/26425/plans/prd-2-phase-1-detail-read-and-lookups.md`. A plan not
tied to a PRD phase (a one-off or a tooling plan) is `<Store>/plans/<kebab-case-descriptive-name>.md` and
omits the `feature`/`prd`/`phase` frontmatter.

**Where `<Store>` comes from.** The PRD lives at `<Store>/prds/prd-<N>-….md`; `<Store>/plans/` is its
sibling. With no PRD (a one-off for a ticket), get it from
`python3 ~/git/personal/wiki/.claude/skills/prd-orchestrator/scripts/orchestrator.py store path --context
<ctx> --feature <feature id or ticket key>`, which creates and prints the dirs. In an orchestrated run the
caller passes the plans dir explicitly — use it.

⛔ **Never write a plan into a team repo's `docs/ai/plans/`.** The repo's pre-commit docs fence refuses
any commit that stages it. The one exception is a **legacy PRD** that still lives in a repo's
`docs/ai/prds/` (not yet imported to the store): its plans go to the repo's configured `[plans] dir`
(default `docs/ai/plans/<feature>/`). Prefer importing it first
(`orchestrator.py store import --from <dir> --context <ctx> --feature <id>`) so the plan lands in the store.

⛔ **`feature`, `prd` and `phase` are load-bearing.** They are how the PRD tracker attaches this plan to
its phase and flips that phase from red (unplanned) to green (planned) — the match is on these three
frontmatter values, not on the filename. Copy `feature` and `prd` verbatim from the PRD you are planning
against, and set `phase` to the PRD phase this plan implements. A wrong value here silently mislabels the
PRD's progress.

Then:

1. **Cross-link it from the PRD.** In the store PRD's phase block (§ Implementation phases), add or
   update a `**Plan:** [<basename>](../plans/<basename>)` line for the phase this plan implements, so a
   reader of the PRD can reach the plan directly. This is a convenience link; the `feature`/`prd`/`phase`
   frontmatter above is the authoritative link.
2. **Standalone only — commit both to the wiki** (path-whitelisted to `.planning/`, never pushed):
   `python3 ~/git/personal/wiki/.claude/skills/prd-orchestrator/scripts/orchestrator.py store-commit
   --path <plan file> --path <PRD file>`. In orchestrated mode skip this — the orchestrator runs
   `store-commit` after the phase.

**Lifecycle:** `status: draft` while being agreed → `stable` once approved → **`deprecated` once
executed and merged.** An executed plan is the best record of why the code looks the way it does.

---

## Quality criteria

**Context completeness** — every pattern identified and **verified live** · external docs linked with
anchors · integration points mapped · gotchas captured · every task has an executable validation command

**Implementation ready** — someone unfamiliar with this codebase could execute it from the plan alone ·
tasks ordered by dependency · each atomic and independently testable · pattern references cite
`file:line`

**Pattern consistency** — tasks follow the standards guides, not the neighbouring file · no reinvention
of existing utils · testing approach matches the repo's

**Information density** — no generic references · URLs carry section anchors · validation commands are
non-interactive and real. **Do not invent scripts that do not exist.**

---

## Report

After writing the plan:

- Summary of the feature and the approach chosen
- **The stack decision**, stated plainly
- Full path to the plan file
- Complexity assessment
- Key implementation risks
- Confidence score for one-pass success, with what is missing if below 7

Then present the plan and take feedback before anyone runs `/execute` against it.

---

## Related

- `/prime` — load context and confirm the phase before planning
- `/create-prd` — agree the intent first, for anything larger than a single feature
- `/execute` — implement this plan and run every validation level

## Orchestrated mode

If the prompt names a scope-notes file, read it before writing DECISIONS; it says which decision shapes are the owner's in this repo.

Every plan carries `## EVIDENCE PLAN`; the builder's `## Acceptance` table reuses its ids.

When the caller says **the run is orchestrated** (the `prd-orchestrator` skill drives you), these
rules override the defaults above — including any instruction elsewhere in this file to ask the user
before continuing. The full artifact contract is `prd-orchestrator/reference/contract.md`.

1. **Never ask — this is the rule that would otherwise halt the run.** Where this skill says "if
   requirements are still unclear, ask before continuing", in orchestrated mode you instead resolve it
   by reading the code, and record the resolution if it contradicts the PRD.
2. **Always reply with a path, and only a path.** Either the **absolute** path of the plan file you
   wrote (in the plans dir the prompt names — `<Store>/plans/` for a store run), or the literal token
   `NO-PLAN-NEEDED` if the phase is genuinely too small to warrant a plan file. Never reply with prose
   — the orchestrator parses your reply as a path and has no branch for anything else.
3. **Scope to the named phase only.** Not the whole PRD, not the next phase.
4. **Record deviations, not decisions.** Append to `.agents/orchestrator/decisions.jsonl` only when you
   can quote the PRD verbatim; see `prd-orchestrator/reference/deviation-rubric.md`. Ordinary
   code-discovery calls are absorbed silently — 2–5 records per PRD is normal.
5. **Start from what the run already knows, and leave more behind.** The prompt may carry two
   blocks: *facts already discovered this run* (cited; do not re-look them up) and *known gaps for this
   phase* (found by the kickoff gap pass — `prd-orchestrator/reference/gap-pass.md`). Resolve each
   known gap by reading the code and record how in the plan under `## Gaps addressed` as
   `- gN: <how>`. End the plan with `## New facts`: one line per reusable codebase truth you found
   that the prompt did not already state, as
   `- <domain|patterns|tests|boundaries|data|gotchas>: <fact> — <path:line>`. A fact that cites no
   existing path is dropped, so cite one. The orchestrator harvests both sections; you never write
   to `.agents/orchestrator/facts/` or `gaps.json` yourself.

You write **no code** in either mode. You never commit code; the only commit you ever make is the
standalone `store-commit` of the plan and PRD in the wiki.
