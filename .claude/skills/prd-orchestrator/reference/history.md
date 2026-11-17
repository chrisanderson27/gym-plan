# Ablation history

Historical reasons for rules retained in SKILL.md; these incidents do not add current instructions.

## Non-negotiables

- PRD-2 (2026-10-22): lifecycle waits went silent after the worker had finished; artifact-based dispatch/await replaced them.
- The denylist's 332 blocks, zero parked phases and 1.2% precision are documented in [deviation-rubric.md](deviation-rubric.md), rather than repeated here.
- PRD-4 closed with 12 open medium findings; all were real and required another session to fix.

## Step 1 — Plan

PRD-11 (26425): planning consumed 61% of phase 2 and 46% of phase 4 while answering real investigative questions. Phase 1 was mechanical but still got a 361-line plan (17% of its tokens). This motivated the sizing nudge and kickoff gap pass.

## Step 2 — Build

Restating `execute`'s validation rules in SKILL.md once forked them, and the fork silently dropped them.

## Step 4 — E2E gate

PRD-5 (2026-10-19): all phases committed, then E2E paused because the configured app hosted the run itself. No run_end was emitted; the queue never released the next PRD. This motivated explicit skipped-gate reporting followed by close-out.

## Model routing

PRD-10 (2026-10-26): Codex's workspace-write sandbox treated .agents/ as protected, denying verify.json, summary.md and decisions.jsonl writes. Routing now supplies the state directory as a writable root.

## Audit trail

- 2026-09-10: phase_committed/e2e_gate were logged instead of commit/e2e_pass/e2e_fail; telemetry reported zero committed phases despite two commits.
- 2026-09: ccp2 contained 292 unread transcripts; scanning only the default configuration dropped worker tokens.
- 2026-09-10: naive local timestamps compared against UTC dropped nine real worker sessions down to five and admitted unrelated sessions.
