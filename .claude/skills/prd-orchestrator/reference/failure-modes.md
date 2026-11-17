# Failure modes to respect

Referenced from SKILL.md. Typed failures and what each actually means.

Failures are typed. None of them silently kill the loop, and none of them retry forever — every
retry is capped, and RUN.md is durable so even a hard halt is resumable.

⛔ **Fix cycles are the loop's largest *variable* cost — each one re-runs a whole worker. Feed a fix
cycle only the failing signal, never a transcript.** Verify → the failing test output / compiler error
only. Review → the specific finding + its `file:line`, not the whole `review.md`. E2E → the worker's
observed-vs-expected lines only. A tight failure payload keeps the retry cheap and focuses the fix.

**1. A worker cannot start at all — check this FIRST on any silent stall.**
An untrusted folder, or an unauthenticated pane, makes a worker report ready and then do nothing.
`orchestrator.py preflight` catches both before the run spends anything. See
[worker-preflight.md](worker-preflight.md). This replaces the old decision-gate failure case —
**nothing blocks a phase any more**; deviations are reported at close-out, never enforced.

**2. Verify fails (build/test red).** Feed the failure output to the *builder* to fix, re-verify.
Cap at 2 fix cycles. Still red → mark phase `failed`, quarantine, continue with independent phases.

**3. Review fails (a critical/high/medium finding).** End-of-PRD by default; per phase on Q3 option 3.
A fresh fixer first **verifies** each finding against the code (CONFIRMED / REJECTED / OUT-OF-SCOPE,
[final-review.md § R2](final-review.md)), fixes only the confirmed ones, re-verifies; then re-review the fix. Cap at 2 cycles.
Still failing → land what is clean, and surface the open confirmed finding in the end report rather
than looping forever. A REJECTED critical/high is spot-checked by the orchestrator before it is accepted.

**3b. E2E gate fails.** Typed like review. `RESULT: fail` → feed the worker's observed-vs-expected to the
builder, fix, re-verify, re-review, re-run the gate (cap the cycles, e.g. 2). Still failing →
quarantine as `failed`, do not commit. `RESULT: blocked` (prerequisite missing) or the app won't
reach `wait-ready` after one retry → quarantine, do not commit; if the app is down for *every* remaining
UI phase, halt. A `fail` is the gate working, not a worker error — never retry it as an infra stall.
**Always stop the app** (`app-run.sh kill` + `orchestrator.py tab close --label orch:<slug>:app`) on every one of these exits, so a failed
phase never leaves the app running behind it.

**4. A worker stalls (`agent_prompt_stalled`, or settles without its artifact).** First rule out the
silent-start failures in case 1 (untrusted folder, not logged in) — those look identical to a stall.
If the worker did start, it is a genuine infra problem: retry the *stage* once (re-split, re-start the
worker). If it stalls again, **halt the run** and tell Chris exactly where — RUN.md holds the last
good phase + status, so it resumes once the environment is fixed. Never thrash the same broken tab.

Backing out completely only happens on twice-stalled infra, or when a failed phase sits on the
critical path of every remaining phase. Everything else quarantines and keeps going.

**5. Park or resume needs attention.** A park refused for an in-flight phase, dirty paths or an
uncommitted-phase GATE-FAILED marker leaves PARK-REQUESTED pending for the next eligible boundary.
A stale request cannot affect a later run: park, archive, unpark and init delete it (see contract).
A red resume verify becomes a normal gate failure on the next phase. Foreign commits in a review
mean its scope is wrong: use `review-range --json` and pass only the own SHAs.

## Quarantine, don't halt

A `failed` phase, or (in `autonomous` mode) a phase `held` by a one-way deviation, parks **that phase
only** — it never stops the run. Keep building every phase whose `depends on` column does not name it.
Halt the whole run only when nothing remaining is buildable.

## herdr / worker specifics

- `done`/`idle` means the agent stopped, not that it succeeded — always read and judge output, and
  confirm `summary.md` exists (see the completion note above) before treating a phase as built.
- `blocked` (herdr state) means the worker hit an approval/question UI — handle it, don't wait forever.
- **A fresh worker tab may be untrusted or unauthenticated — and both look like success.**
  In an untrusted folder the agent shows a folder-trust dialog (default: *No, exit*), then exits;
  unauthenticated, it answers `Not logged in · Please run /login` and reports done in 0s. In **both**
  cases herdr reports `interactive_ready: true` / `idle` and `agent prompt --wait` returns success.
  Neither is caught by any `--permission-mode`. Run `orchestrator.py preflight` before the
  run; if it happens mid-run, read its tab, fix trust/auth, and re-open it (`tab open --fresh`; the agent name is dead).
  Full finding: [worker-preflight.md](worker-preflight.md).
- If `agent read` can't recover a full response (alternate-screen agents), fall back to asking the
  worker to write the response to a file and read the file (see herdr skill).
- herdr 0.7.1 lacks `agent prompt`/`--wait`; this loop needs **0.8.0** (`herdr update`).
