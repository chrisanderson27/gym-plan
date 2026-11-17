---
name: orchestrator-setup
version: 1.0.0
description: "Onboard a repository to the prd-orchestrator loop — probe the repo for its build/test commands, app start and ready-probe, plan directory, standards and knowledge surface, settle everything that could not be detected by asking, verify each declared command actually runs, and write .claude/orchestrator.toml plus the e2e profile skeleton. Use when setting up prd-orchestrator on a new repo or team, when preflight or config --check reports a missing or TODO-laden config, or when someone asks to make the orchestrator work on their project."
---

# Orchestrator setup

Make a repository runnable by the `prd-orchestrator` loop. You produce two files:

| File | Holds | Tracked? |
|---|---|---|
| `.claude/orchestrator.toml` | build/test commands, app lifecycle, plan dir, knowledge surface | **yes** — it must survive `git worktree add` |
| `.claude/e2e/profile.md` | how to reach and drive the app; **env-var names**, never values | **yes** |
| `.env` | the actual credential values | **no — gitignored** |

Read [`prd-orchestrator/reference/config.md`](../prd-orchestrator/reference/config.md) for the key
reference and [`repo-pack/README.md`](../prd-orchestrator/reference/repo-pack/README.md) for what a
finished pack looks like.

## 0. Install the skill family — the package deal

The orchestrator invokes `plan-feature`, `execute` and `e2e-test` **by name**, so they must live in
the target repo's `.claude/skills/`. Put the whole family there first:

```bash
python3 <this repo>/.claude/skills/prd-orchestrator/scripts/orchestrator.py install --into <target repo>
```

It copies `prd-orchestrator`, `plan-feature`, `execute`, `e2e-test`, `orchestrator-setup` (and
`create-prd`), stamps versions, and is idempotent — re-running it updates a repo to the current
version and skips what already matches. Run it FROM the canonical copy you maintain (this wiki), not
from a target that may be stale.

**Check the e2e engine while you are here.** The e2e gate drives `agent-browser`:

```bash
agent-browser --version && agent-browser doctor
```

`doctor` confirms Chrome (required for the gate) and ffmpeg + encoders (needed only for the video
recording — screenshots work without it). If `agent-browser` is not installed, tell the user to
`brew install agent-browser`; the gate cannot drive a browser without it. Note the version — below
0.37 the session-id command differs (the `e2e-test` skill handles both).

## 1. Detect what can be proven



```bash
python3 <skill dir>/../prd-orchestrator/scripts/orchestrator.py setup --detect
```

It probes for `*.sln`/`*.csproj`, `package.json` scripts, `pyproject.toml`, `go.mod`, `Cargo.toml`,
`Makefile`, an existing plans directory, a standards directory, `AGENTS.md`/`CLAUDE.md`, a known-issues
file, and whether `.agents/` is gitignored. Everything it cannot prove becomes a `TODO`.

**Do not hand-write the file from scratch.** Let the detector establish the facts, then settle the rest.

## 2. Settle every TODO — by asking, never by guessing

Ask about all of them in **one** `AskUserQuestion` call where you can. The questions that actually
matter:

- **The app.** What starts it, on what URL, and *what proves it is up*? Push back on "it returns 200":
  another process may hold that port (on macOS the AirPlay Receiver binds `*:5000`). Get a marker only
  this app emits — a response header, a title string, a health-endpoint field.
  **If the repo has no runnable app, delete the whole `[app]` section** — every phase's e2e gate then
  records `N/A` automatically instead of stalling.
- **Test commands that never exit.** A bare `npm test`, `vitest`, `jest --watch`, `cargo watch` will
  hang the builder forever. Confirm each test level terminates on its own.
- **Boundary checks.** Ask: *"is there an architectural rule in this repo that the compiler does not
  enforce — a layer that must not import another, a module nothing may depend on?"* If yes, encode it
  as a `cmd` printing a count plus a `baseline`. This is the highest-value optional section and teams
  rarely volunteer it.
- **Surface list (`[surface]`).** Propose a starter from what `setup --detect` found and ask which
  categories matter here: migrations (`*/Migrations/*`, `migrations/`); auth (`*/Auth/*`, `*/auth/*`);
  dependency manifests (`package.json`, `*/package.json`, `*.csproj`, `Directory.Packages.props`,
  `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`); CI (`.github/workflows/`,
  `azure-pipelines*.yml`, `.gitlab-ci.yml`); gate config (`.claude/orchestrator.toml`, `.claude/settings*.json`).
  Every category rates a phase high-risk unless marked `risk = false`, so keep the list short. Omit
  the section to turn the feature off. See [config.md](../prd-orchestrator/reference/config.md).
- **`always_loaded`.** Which files are `@`-imported into every agent session? Those are never
  auto-committed by a run, so getting the list right is a safety property, not bookkeeping.
- **Figma (`[figma]`).** Does this repo have Figma designs its UI must match? If **yes**, set
  `enabled = true` and the Figma **`file_key`** (from any frame URL: `figma.com/design/<file_key>/…`),
  keep `bundle_dir` tracked, and confirm the Figma token is in the repo-root gitignored `.env` under the
  `token_env` name (the `figma-extractor` skill resolves it — never write the value into the config). Then
  every UI phase is gated on a screenshot-vs-Figma comparison. If **no** Figma, **delete the whole
  `[figma]` section** — the fidelity gate then records `N/A` for every phase. The surface→frame mapping is
  **not** asked here; it lives in each PRD's Design contract.

## 3. Verify — do not trust the config, run it

⛔ **A declared command that does not run is worse than a missing one**, because preflight passes and
the failure surfaces mid-run in a worker pane nobody is watching.

```bash
orchestrator.py config --check      # resolves paths, confirms each level's binary is on PATH
```

Then actually execute each `[validation]` level once, and confirm:
- it exits on its own (no watch mode),
- its exit code is 0 on clean code,
- it is the command a human here would really run.

If `[app]` is set, start it, confirm the `ready_probe` matches, and stop it again.

## 4. Write the e2e profile

Copy [`profile-template.md`](../e2e-test/reference/profile-template.md) to
`.claude/e2e/profile.md` and fill it from the app you just started.

⛔ **Never write a credential into it.** The profile names `E2E_USER` / `E2E_PASS` /
`E2E_ACCESS_CODE`; the values live in a gitignored `.env`. A profile containing a literal password is
a bug to fix, not a pattern to copy forward. If the repo you are onboarding already has credentials in
a tracked file, say so plainly — that is a finding, and rotating them is the owner's call.

Leave `## Quirks` empty. It fills itself as runs learn things.

## 5. Confirm the repo is runnable

```bash
orchestrator.py preflight
```

Must exit 0. It checks folder **trust** (the failure that silently kills workers in fresh worktrees —
see [worker-preflight.md](../prd-orchestrator/reference/worker-preflight.md)), that `.agents/` is
gitignored, that no TODO remains, and that the orchestrator and its worker panes resolve the *same*
Claude config dir.

Then hand over: *"`<repo>` is set up. Run `/prd-orchestrator` with a PRD path."*

## What not to do

- **Do not copy another repo's `orchestrator.toml`.** The RBCloud example under `repo-pack/rbcloud/`
  is there to show the *shape* and how much repo knowledge a mature pack holds — not to be inherited.
- **Do not put stack facts back into the skills.** If something will not fit in the config, that is a
  config gap worth reporting, not a reason to hardcode.
- **Do not invent a boundary check** to look thorough. A check nobody agreed to becomes a wall in an
  unattended run.
