# Final review — ONE full review at the end, spanning the whole PRD

Read this before the final review starts. § R2 also governs the step-5 coupling check and every per-phase or midpoint review.

**This section describes Q3 options 1 and 2 (the default and today's behaviour).** If the owner chose
option 3, run this same two-axis review after every phase's commit, with the fixed point set to that
phase's base rather than the PRD's (for a resumed phase, its own first commit's parent) — and skip the step-5 coupling check, which it subsumes. If he
chose option 4, run it at the phase whose index is ⌈N/2⌉ and again at the end. Both are more expensive
and neither is the default; the reasoning is below.

⛔ **By default the full two-axis review runs exactly once**, after the last phase is built,
e2e-validated and committed — never per phase. Reviewing each phase separately re-reads overlapping files and re-flags
churn a later phase resolves. **This holds whether the PRD is one phase or five.** The cheap one-axis
coupling check in step 5 follows [risk-routing.md](risk-routing.md).

**Resumed review scope.** If RUN.md has a `Resumed:` line, run
`orchestrator.py review-range --json`. Give the reviewer the `own` SHAs as its scope and name the
`foreign` SHAs as commits to ignore. This overrides R1's base range. Without a `Resumed:` line,
use `<base commit>..HEAD` as below. For Q3 option 3, a resumed phase's fixed point is its own
first commit's parent; review its own SHAs and ignore foreign ones.

First run `orchestrator.py verify --phase <last> --full --keep-going`. On Q3 option 3, run it before the
last phase's review. If red, use the SKILL.md step 3 fix path.

**R1.** Start ONE fresh reviewer running the **`code-review` skill** (two axes, Standards + Spec, as
parallel sub-agents). ⛔ Not `validate-consensus`. Fixed point = the **base commit** in RUN.md, so the
diff spans every phase together.

> Subagents: only the review skill's fixed set.
> Invoke the `code-review` skill against the diff from `<base commit>` to `HEAD` — this spans ALL
> phases of this PRD. Run both axes as parallel sub-agents. **Rate every finding critical/high/medium/
> low.** Report only actionable findings, each with severity and a `file:line`. Write them to
> `.agents/orchestrator/review.md` and reply with only that path.

Read `review.md`, extract severities, close the reviewer's tab (`orchestrator.py tab close --label …`).
**Security axis.** `risk --summary` lists high-risk phases; if any, spawn the one sonnet/medium subagent in [risk-routing.md](risk-routing.md) on their commits; `review-security.md` findings join R2.

**R2. Verify before fix, then fix — critical, high and medium.** (Applies to every review the run
does: the end-of-PRD review, each per-phase review on Q3 option 3, the midpoint review on option 4, and
the coupling check.) No critical/high/medium → proceed. Otherwise:

1. **Verify.** Start a fresh fixer (`tab open --stage fix`, builder routing). Its **first** job is to
   check each critical/high/medium finding against the *current* code and classify it — before
   touching anything:
   - `CONFIRMED` — the defect is real at the cited `file:line` (or its true location) and this run's
     diff caused or widened it. Fix it.
   - `REJECTED` — false premise: the code does not do what the finding says, it is already handled,
     or it contradicts a deviation recorded in `decisions.jsonl` on purpose. Cite the evidence.
   - `OUT-OF-SCOPE` — real, but pre-existing and untouched by this run's diff. Record, do not fix.
   A finding may also be `CONFIRMED` with a **different fix** than the reviewer proposed (e.g. a
   cross-boundary "share this map" that the repo's own validation levels forbid) — say so.
2. **Fix** **only** `CONFIRMED` findings with focused tests; re-run `orchestrator.py verify`; land
   as its own commit (never amend a phase commit). Then `surface --phase N --sha <fix>`; never `log --event commit` a fix.
3. **Re-review** the fix commit only (`<fix base>..HEAD`): confirm each fixed finding resolved and
   flag anything the fix introduced. Cap at **2** verify→fix→re-review cycles.
4. **Read the verdicts, not the transcript.** The fixer writes `phase-N/fix-summary.md` (or
   `review-fix.md` at end of PRD) with one line per finding — `- <id> [sev]: CONFIRMED|REJECTED|OUT-OF-SCOPE
   — <evidence file:line> — <fix or reason>` — then the validation result. **Spot-check every `REJECTED`
   critical/high yourself** against the code before accepting it; a rejected medium is accepted on
   its cited evidence.

Lows are recorded for the PR, not fixed (unless the fixer is already in that exact line for a
confirmed finding). Cap hit with a confirmed critical/high/medium still open → surface it in the end
report. Fixer prompt:

> Subagents: none (the hook denies Agent/Task).
> You are fixing review findings on committed work. Read `<review file>`. **First verify** each
> critical/high/medium finding against the current code and classify it CONFIRMED / REJECTED /
> OUT-OF-SCOPE (definitions: prd-orchestrator reference/final-review.md § R2) — do not trust the reviewer's premise, line numbers or
> proposed fix. Fix only CONFIRMED findings, each with a focused test; keep other contexts' behaviour
> unchanged. Run `orchestrator.py verify --phase <n>`. Never commit, push, reset or revert pre-existing
> changes. Write the per-finding verdict lines and the verify result to `<fix-summary path>` and reply
> with only that path.
