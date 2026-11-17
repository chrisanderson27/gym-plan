---
name: execute
version: 2.1.0
description: Implement an existing plan from the PRD store's plans/ dir (wiki .planning/<ctx>/<feature>/plans/; legacy: docs/ai/plans/) task by task, then run every validation level it defines and report each result with real output. Use once a plan has been written and approved.
---

Repo facts come from `[knowledge]` (standards, `scope_notes`, `codebase_docs`) and AGENTS.md; worked example: `prd-orchestrator/reference/repo-pack/rbcloud/repo-knowledge.md`.

# Execute: Implement from Plan

## Plan to execute: $ARGUMENTS

If no path was given, list `<Store>/plans/` — the ticket's store dir,
`~/git/personal/wiki/.planning/<ctx>/<feature>/plans/` (`orchestrator.py store path --context <ctx>
--feature <id>` prints it) — and ask which plan to execute. Do not guess. Legacy: a repo whose PRDs were
never imported to the store keeps its plans in `docs/ai/plans/`; list that too if the store has none.

> ⛔ **CRITICAL: you MUST complete every validation level in the plan's "VALIDATION COMMANDS" section
> before declaring the feature complete. A build that compiles is not completion.** Execute every level
> in order and report the real output for each.

> ⛔ **CRITICAL: never commit.** This skill's job ends at a clean, validated, uncommitted working tree.
> Staging (`git add`), committing, pushing, and opening a PR are all **human decisions** — leave the
> changes for the user to review and commit themselves, even when every validation level passed. This
> holds regardless of how confident the run was or how small the change looked.

---

## 1. Read and understand

- Read the **entire** plan before touching anything
- Read the repo's `AGENTS.md` (or whatever `[knowledge] always_loaded` names) for conventions,
  stack corrections and commands
- Read the standards guide (`[knowledge] standards`) for **every layer the plan touches** — each
  carries a *patterns you will see — do NOT copy* table
- Read every file in the plan's **⛔ Read these files before implementing** list
- State the stack the repo's migration doc names; keep the plan's stack decision in view
- Note the validation commands you will have to run

**Sanity-check the plan before trusting it.** Verify an exemplar is live by grepping for the interface the repo's standards name. Stop and raise a dead or unregistered exemplar before implementing against it.

---

## 2. Execute tasks in order

For each task in **STEP-BY-STEP TASKS**:

**a. Navigate** — identify the target file and the action. Open the pattern reference **side by side**
with the target before writing anything.

**b. Implement** — follow the task specification exactly.

- Follow the conventions in the standards guide for that layer, **not the neighbouring file**
- Stack corrections live in the repo's `AGENTS.md`, not here. Read them: a repo will have
  hand-rolled things that look like a well-known library and are not.
  Follow the repo standard's interface signatures; do not invent parameters.
- `await`. Never `.Result`, `.Wait()`, `GetAwaiter().GetResult()`, or `async void` outside an event handler
- Throw the specific exception type. Never swallow an exception, and never wrap everything in
  `ApplicationException` — it erases what the caller needs to respond correctly
- Fail loudly on missing required context. **Defaulting a missing tenant to `0` is not error handling**
- No hardcoded connection strings, credentials, tokens or tenant identifiers
- Comment *why*, never *what*

**c. Self-check as you go — but do NOT build or test per task.** After each file change, eyeball the
syntax, confirm the imports resolve, and confirm no import crosses the stack boundary. That cheap
read-through is the *whole* per-task check. **Do not run the build, the tests,
or any other compile/test command between tasks.** Implement every task in the phase first — make
confident, optimistic changes — then run the full VALIDATION COMMANDS section once at the end (§4). A
single batched validation is faster than a build-per-task, and it rarely fails; when it does, read the
error, trace it to the task that caused it, and fix it. The per-task `VALIDATE` command in the plan
defines *how that task is checked in the final batch* — it is not an instruction to run it now.

### If reality does not match the plan

Stop and say so **before improvising** — the pattern does not fit, a file moved, the approach does not
work, the plan assumed the wrong stack. Silent deviation is how a reviewed plan stops meaning anything.
Document every deviation and raise it at the time, not in the final summary.

---

## 3. Implement the testing strategy

- Create every test file the plan specifies, and implement every case
- Follow the test-trait/filter rule in the repo's testing standard; verify every new test appears in the configured run.

- Naming and placement follow the repo's own test conventions — see its standards guide.
- Cover the edge cases the plan lists

---

## 4. Run ALL validation levels — mandatory, no skipping

Read the plan's **VALIDATION COMMANDS** section and execute each level in sequence.

**The fix-retry loop:**

1. Run the level exactly as specified
2. If anything fails — **stop**, investigate the *cause*, fix it in code
3. Re-run the level **from the beginning**
4. Repeat until it passes with no errors

**NO SKIPPING.** Do not mark a level complete while errors exist. Do not move to the next level with
unresolved errors. Do not report a level as passed because it "should" pass — run it and read the output.

Real commands only. **Do not invent scripts.**

```bash
# Exactly the commands in [validation].levels of .claude/orchestrator.toml,
# in the order declared. Never invent one; never skip one.
```

⛔ **Run the level's `cmd` exactly as declared.** Repos commonly have a near-identical script that
never exits (a watch mode) — that is precisely why the exact command is declared in config. Example:
**watch mode**, which never exits and will hang the run. `test:coverage` is `vitest run` and is what CI
executes.

**Do NOT run formatting commands** unless a validation level declares one — formatting is often
optional and
causes unrelated churn and build failures.

**On the unit test level:** confirm the new tests actually appeared in the run. A green suite that
silently skipped your new class is a failed level, not a passed one.

### The boundary level — architectural fences the repo declares

If `.claude/orchestrator.toml` declares `[boundary_checks]`, run **every** check after the build and
test levels, for any change that touches project/module manifests or adds imports across module
boundaries. Each check prints a **count**; compare it to its `baseline`.

```bash
# for each entry in [boundary_checks].checks
<cmd>        # must be <= baseline
```

**Over baseline means you introduced a new violation — fix it, do not update the baseline.** Run the
check's `cmd` without the final count step to see which file did it.

These exist because architectural erosion is invisible to a compiler: the code builds, the tests pass,
and the boundary is one import weaker than yesterday. A repo that declares no checks skips this level.

### UI features — end-to-end validation

If the plan's validation levels include a UI/e2e level, run it. **Do not start the application
yourself** unless the plan explicitly tells you to and you are running standalone — the app's start
command, URL and ready-probe live in `[app]` in `.claude/orchestrator.toml`.

⛔ **In orchestrated mode you must never start or stop the app.** The orchestrator owns its lifecycle
and will kill whatever holds the port; a builder that starts it races the e2e gate. See
`## Orchestrated mode` at the end of this file.

## 5. Final verification

- ✅ Every task from the plan completed
- ✅ Every test created and passing, and appearing in the filtered run
- ✅ Level 1: Build — PASSED
- ✅ Level 2: Unit tests — PASSED
- ✅ Level 3: Frontend build + Vitest — PASSED
- ✅ Level 4: E2E / browser — PASSED (UI features)
- ✅ Level 5: Boundary check — PASSED
- ✅ Level 6: Docs validation — PASSED (if docs changed)
- ✅ Level 7: Manual — PASSED
- ✅ New tests follow the repo testing standard's markers, filters and file naming
- ✅ No new `.Result` / `.Wait()` / `GetAwaiter().GetResult()`
- ✅ Every `[boundary_checks]` check is at or under its baseline
- ✅ No new hardcoded URL, secret, or missing-scope fallback
- ✅ Code follows the standards guides
- ✅ Documentation updated where the plan called for it

**If any item is unchecked, the work is not complete. Say so plainly rather than reporting partial
success as success.**

---

## 6. Cleanup

Stop everything you started, so the next run does not hit a port conflict:

- Stop anything you started. ⛔ In orchestrated mode you started nothing — leave the app alone.
- Close any Playwright browser instances
- Verify the ports are released

---

## Output report

### Completed tasks
Tasks completed · files created (with paths) · files modified (with paths)

### Tests added
Test files created · cases implemented · results · **confirmation the new tests appeared in the configured filtered run**

### Validation results

One block per level in the plan, with the **real** output:

```
Level [N]: [name from the plan]
- Status: PASS / FAIL / N/A
- Commands executed: <exact commands>
- Output: <real output — the summary line at minimum>
- Issues found: <None / list>
```

Example:

```
Level 2: Unit tests
- Status: PASS
- Command: <the declared validation level's cmd>
- Output: Passed! - Failed: 0, Passed: 412, Skipped: 0
- New tests confirmed in run: InventoryBarcodeExportHandlerTests (6 cases)
- Issues found: None
```

If a level does not apply, mark it **N/A explicitly** and say why.

### Deviations
Every place the implementation departed from the plan, and why. If there were none, say so.

### Ready for human review
- ✅ All validation levels completed and passed
- ✅ All services stopped and ports released
- ✅ Anything worked around that belongs on
  the repo's tech-debt list has been added there
- ✅ Working tree left **uncommitted** — nothing staged, committed, pushed, or opened as a PR

Suggest the user run `/code-review` against the merge-base (`git merge-base main HEAD`) before they
commit. Set the plan's frontmatter to `status: deprecated` once the work ships — but leave that edit,
like everything else, for the user to commit. **⛔ Do not run `git commit`, `git push`, or open a PR —
that is always the user's call, not this skill's.**

---

## Completion checklist

Before your final message, verify you have:

1. ✅ Completed every implementation task from the plan
2. ✅ Completed every test creation task from the plan
3. ✅ Executed **every** validation level in the plan's VALIDATION COMMANDS section
4. ✅ All levels PASS (or N/A with a reason)
5. ✅ Reported status **and real output** for each level
6. ✅ Fixed every issue found during validation
7. ✅ Documented and raised every deviation at the time it happened
8. ✅ **Stopped all services** and verified ports are released
9. ✅ **Left the working tree uncommitted** — no `git commit`, `git push`, or PR opened

**If any item above is not checked, the work is NOT complete.**

---

## Related

- `/plan-feature` — produce the plan this skill executes
- `/code-review` — two-axis review of the resulting diff, suggested before the user commits

## Orchestrated mode

When the caller says **the run is orchestrated** (the `prd-orchestrator` skill drives you), eight rules
override the defaults above. The full artifact contract is
`prd-orchestrator/reference/contract.md` — when it and this file disagree, that file wins.

1. **Never ask.** Nobody is there. Resolve ambiguity by reading the code. If a choice genuinely
   contradicts the PRD, record it as a deviation (below) and proceed with the best-evidenced option.
2. **Do NOT start or stop the application.** The orchestrator owns the app lifecycle and will kill
   anything holding the port. Ignore any instruction in this file to run the app yourself.
3. **Do NOT re-explore.** The planner already did the codebase dive. Read only what the plan's
   mandatory-reading list names; re-discovery is the loop's biggest silent token cost.
4. **Always produce the artifact.** Write a ≤15-line summary to the path the caller names, stating
   the validation you ran and its result, and reply with **only that path**. A `Stop` hook will
   refuse to let your turn end until that file exists and contains `## Acceptance` with at least
   one `| ACn |` row. The ≤15-line cap excludes the table and `## New facts` section. Use
   `| AC | Result | Proof |`, one row per criterion from the plan's `## EVIDENCE PLAN`, or the
   prompt's PRD phase *Acceptance criteria* for `NO-PLAN-NEEDED`. Result is exactly `met`,
   `not met` or `not proven`; Proof names a verify.json level and summary line, test name, file,
   or "needs the e2e gate". On a fix cycle, update the existing `## Acceptance` rows in the same
   summary.md rather than writing a new summary without them.
5. **Read the run's facts first; report new ones last.** The prompt may carry *facts already
   discovered this run* — cited codebase truths from earlier planners and builders. Trust them over
   re-exploration. End the summary with `## New facts`, one line per reusable thing you hit that
   neither the plan nor those facts stated, as
   `- <domain|patterns|tests|boundaries|data|gotchas>: <fact> — <path:line>` (the ≤15-line cap is
   for the summary proper; this section may follow it). A fact with no existing cited path is
   dropped. The orchestrator harvests it; you never write to `.agents/orchestrator/facts/`.

6. **Before writing the table**, ask yourself "what would make this not actually work?" and
   "what are the gaps between what the phase asked for and what I built?" Fix what you can;
   record the rest in each affected criterion's existing row: set Result to `not proven` and
   describe the gap in Proof (at most 3 gaps). Keep one row per criterion; never append a second
   row for the same AC or invent a `Gap1` ID. For example: `| AC2 | not proven | gap: needs browser evidence |`.
   Keep `## New facts` after the table.

7. **Scope.** Change only what the plan's tasks name. No unrequested refactor, rename, abstraction or extra file.
   A necessary out-of-plan file is allowed; list `Out of plan: <path> — <reason>` in the summary.
   `gate` compares the diff with TOUCH SET and reports extras. A named scope-notes file defines "focused" here.
8. **Park tangents.** Add `## Noticed, not done` with at most 3 `- <file:line> — <one line>` items met during
   the work. Do not go looking or fix them. The orchestrator harvests these and drops anything beyond 3.

**Recording a deviation.** Append one object to `.agents/orchestrator/decisions.jsonl` — but only if
you can **quote the PRD**. Required fields: `id`, `phase`, `kind`, `prd_ref`, `prd_says` (verbatim,
≤240 chars), `built`, `why`, `where`, `evidence`, `blast`, `one_way`, `verify`. Most decisions are
**absorbed, not recorded** — 2–5 per PRD is normal. See
`prd-orchestrator/reference/deviation-rubric.md`.

**You may not commit, push, or rewrite history.** A `PreToolUse` hook denies it; the orchestrator
commits. Nor may you edit `AGENTS.md`, `.claude/standards/**`, or `CLAUDE.md` — those instruct every
future agent and are gated by nothing.
