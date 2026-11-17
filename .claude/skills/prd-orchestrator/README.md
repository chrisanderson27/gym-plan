# prd-orchestrator

Drive a PRD from spec to committed code with the human out of the inner loop.

**This is the map. [SKILL.md](SKILL.md) is the loop.** Read this to decide whether to use it and how
much to trust it; read SKILL.md to run it.

Read [kickoff](reference/kickoff.md), [final review](reference/final-review.md) and [close-out](reference/close-out.md) at their stages.

📊 **New to this? Start with the diagram:**
[reference/prd-orchestrator-guide.excalidraw](reference/prd-orchestrator-guide.excalidraw)
(rendered: [prd-orchestrator-guide.png](reference/prd-orchestrator-guide.png)) — the whole system on one
canvas, from first-time setup through close-out, including what to check when a run goes quiet.

## The shape

```
                         ┌─────────────── per phase ───────────────┐
  preflight → kickoff →  │ plan → build → verify → e2e → promote → [arch?] → commit │ → ONE full review → close-out
                         └─────────────────────────────────────────┘
```

⛔ **The full two-axis code review runs exactly ONCE, at the end, over the whole PRD** — never per
phase. The only per-phase review is the *cheap one-axis architecture check*, and it fires on a trigger
rule rather than on every phase.

Each stage is a **fresh agent in its own herdr pane**. The orchestrator never holds a worker's
transcript — it reads artifacts, extracts verdicts, and advances a durable ledger. That is what lets a
run span hours without the orchestrator's own context rotting.

## What it is for

Starting a multi-phase PRD and **walking away** — for hours at a stretch. If you
want to supervise each step, you do not need this; run `plan-feature` and `execute` directly.

## Portability — the thing to understand first

**The skill holds mechanics. The repo holds facts.**

Nothing about your stack lives in this skill. Build commands, the app's start command and ready-probe,
plan directory, standards, knowledge surface and architectural fences all come from
`<repo>/.claude/orchestrator.toml`. That is what lets one copy of this skill drive a .NET monolith, a
Node service and a Go API without edits.

New repo? Run the **`orchestrator-setup`** skill. Its first step installs the whole skill family into
that repo (`orchestrator.py install`), because the loop invokes `plan-feature`, `execute` and
`e2e-test` by name; it then probes what it can prove, asks about the rest, verifies each command runs,
and writes the config. The e2e gate also needs **`agent-browser`** on PATH (plus `ffmpeg` for video).
See
[reference/config.md](reference/config.md) and [reference/repo-pack/](reference/repo-pack/README.md).

## Before your first run

```bash
orchestrator.py preflight        # MUST pass — see below
orchestrator.py config --check
```

⚠️ **Preflight is not a formality.** A worker in an **untrusted folder** — and every fresh git
worktree is one — shows a trust dialog whose default is *"No, exit"*, then exits. herdr still reports
`interactive_ready: true`; `agent prompt --wait` still returns success. You would poll forever for an
artifact nobody will write. `--dangerously-skip-permissions` does not cover this.
[reference/worker-preflight.md](reference/worker-preflight.md) has the verified finding.

## The trust ladder

Do not start at the top.

| Rung | Kickoff answer | What you are checking |
|---|---|---|
| 1 | Q1 option 4 — **dry run** | Did it read your PRD's phases correctly, and are the dependencies right? — questions in [reference/kickoff.md](reference/kickoff.md) |
| 2 | Q1 option 2 — gate every commit | Does a phase actually come out clean? |
| 3 | Q1 option 1 — **commit autonomously** | The walk-away run |

There is **no push rung**. Pushing transmits to a shared system; the orchestrator offers commit
autonomy and never push autonomy.

## What it will not do

- **Commit without your say-so.** `commit` is the default gate. Widening it is an explicit kickoff
  answer, recorded verbatim in RUN.md and emitted as a `run_start` event.
- **Edit the files that instruct agents.** `AGENTS.md`, `.claude/standards/**`, `CLAUDE.md` and
  anything in `[knowledge] always_loaded` are never auto-committed — not even in `autonomous` mode.
  Autonomy covers code, which is gated by build+test+e2e+review. Those files are gated by nothing.
- **Block a phase over a judgment call.** Deviations are recorded and reported at close-out. The old
  denylist gate produced **332 blocks and 0 parked phases across 26 runs**, at 1.2% precision — it is
  gone. [reference/deviation-rubric.md](reference/deviation-rubric.md).
- **Write a PRD, or decide its phases.** A PRD is a *precondition*, and the phase breakdown inside it is
  `create-prd`'s to make — sized at *"the largest coherent slice one agent can carry … roughly 80% of a
  context window"*, fewer and bigger being better. The orchestrator **transcribes** that breakdown and
  derives only the dependency column. It never re-slices your PRD into smaller phases.

## What you get back

- `RUN.md` — live status, one row per phase, plus a seven-line digest as each lands
- `deviations-<prd>.md` — the handful of things that need an engineer's eye, one-way items first
- `review.md` — the [end-of-PRD two-axis review](reference/final-review.md)
- a `herdr notification` per phase, so you can ignore it and still not miss anything

All gitignored. `report` refuses to write anywhere git would track it.

## Post-mortem

```bash
orchestrator.py resume      # where is this run? (also: after a compaction or a limit pause)
orchestrator.py timeline    # every transition, with durations
orchestrator.py learnings   # cross-run tally; flags classes that have earned a standards edit
orchestrator.py drift       # which generated docs this run invalidated
orchestrator.py telemetry   # was it worth it? wall time + tokens + fix-cycles vs your estimate
orchestrator.py e2e-cost    # past fallback-worker e2e cost vs what Nimble runs spent
```

## Requirements

herdr **0.8.0+** (`agent prompt --wait`), `HERDR_ENV=1`, Python **3.11+** (stdlib `tomllib`; no venv,
ever), and a `.claude/orchestrator.toml` in the target repo.

## Ablate again

Every 10 PRDs, or when SKILL.md exceeds 55,000 bytes, ablate again.
Copy the skill first. Ledger every ⛔ line and non-negotiable against that copy.
Mark each `kept`, `moved to <file>`, `enforced by <hook/command>` or `removed — <reason>`; no blank outcomes.
Move narrative to history and mechanics to their owning reference; keep links and intent.
Check orchestrator tests, verbatim phase-table comparison and literal test anchors before accepting the cut.
