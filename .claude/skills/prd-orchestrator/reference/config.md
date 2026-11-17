# `.claude/orchestrator.toml` — the per-repo config

**The skill holds mechanics. The repo holds facts.** Everything stack-specific lives here, tracked in
the target repo, so the same orchestrator drives a .NET monolith and a Node service without edits.

**Tracked, not gitignored.** It must survive `git worktree add` — a config under `.agents/` would have
to be recreated in every fresh worktree, which is the drift problem this file exists to end.

Validate with `orchestrator.py config --check`. A repo that declares **nothing** still runs: it gets
defaults, and the loop reports its candidates and writes nothing.

## Verify tree exclusions

`[validation] ignore` uses fnmatch on repo-relative POSIX paths: `*` crosses `/`, and a
trailing `/` makes a prefix. The hash always excludes gitignored files, `.agents/`, the
legacy `[plans] dir` / `[testing] dir`, `[scope] exclude` and `[park] allow_dirty`.
Omitting `ignore` applies only those defaults. The hash only decides whether `verify.json`
is current; it never changes which levels run.

## Full example

```toml
[skills]
plan = "plan-feature"        # the repo's plan skill; the orchestrator invokes it by name
exec = "execute"             # the repo's build skill

[validation]
# ignore = ["memory/daily/", "*.log"]  # freshness only; never changes level scoping
# The builder runs these itself and reports the result. The orchestrator does NOT
# re-run them unless the verify tree changed; gate re-runs stale evidence once.
levels = [
  { name = "build", cmd = "dotnet build RBCS.sln -c Release",        expect = "0 errors" },
  { name = "unit",  cmd = "dotnet test RBCS.sln --filter Category=Unit", expect = "all pass" },
  { name = "front", paths = ["src/Web.App/"], cmd = "cd src/Web.App && npm run build && npm run test:coverage", expect = "green" },
]

# Optional: omit this section to disable surface reporting.
[surface]
paths = [{ name = "dependency manifest", globs = ["package.json", "*/package.json"] }]
# risk = false on a category keeps it out of high-risk routing.
# test_globs / skip_patterns omitted: use the defaults below.

[app]
start       = "cd Aspire/Foo.AppHost && dotnet run"
url         = "http://localhost:5000"
# A 200 is NOT proof the app is up: on macOS the AirPlay Receiver also binds *:5000.
# Probe something only this app emits.
ready_probe = "header:Server=Kestrel"
timeout_s   = 300
# OPTIONAL. A dev server can pass the probe long before its first page renders (Vite
# transforms every module on the first request), so the first test load sits blank.
# wait-ready then loads this page once and waits for it to draw.
warmup_url       = "/"
warmup_timeout_s = 120
warmup_required  = false   # true ⇒ wait-ready fails if the page never renders

[plans]                    # legacy runs only -- a store run writes <Store>/plans/
dir = "docs/ai/plans"
phase_pattern = "<feature>/prd-<N>-phase-<M>-<slug>.md"

[e2e]
profile        = ".claude/e2e/profile.md"   # app facts + learned quirks; NEVER credentials
session_prefix = "myapp-e2e"

[figma]
checks = "end"                      # kickoff Q5 overrides: end | per-phase | skip
# The Figma fidelity gate. When enabled, kickoff pulls every frame the PRD's
# Design contract names into an IGNORED local bundle, and the scheduled worker
# compares screenshots on the separately chosen Q5 cadence (reference/figma-gate.md).
# Unset / enabled=false ⇒ the gate is N/A for every phase (portability: a repo
# with no Figma still runs). The surface→frame mapping is NOT here — it comes
# from the PRD's Design contract, so it can never drift from what was designed.
enabled    = true
file_key   = "U47CPIAPgTe28MR78Wx9u6"   # the Figma file key (from any of its frame URLs)
bundle_dir = ".agents/figma"             # IGNORED; never commit images or design data; per-PRD bundles land in <bundle_dir>/<prd-slug>/
token_env  = "FIGMA_TOKEN"               # NAME only — the value lives in the gitignored .env that
                                         # figma-extractor already resolves; never write it here

[testing]
dir     = "docs/ai/testing"   # legacy runs only (store runs: <Store>/testing/) — TRACKED
capture = "on"                # "off" to skip the e2e run recording entirely
scenario_schema = 1           # version of the tracked scenario Markdown contract
retain_raw = false            # raw trace/media stay gitignored; only redacted Markdown is durable

[knowledge]
standards     = ".claude/standards/*.md"
divergence_log = "docs/ai/KNOWN-ISSUES.md"
always_loaded = ["AGENTS.md", ".claude/standards/clean-code.md"]
generated = [
  { paths = "docs/ai/generated/**", regenerate_with = "/map-codebase", freshness = "frontmatter" },
]

[boundary_checks]
# Optional architectural fences. `cmd` prints a count; `baseline` is the allowed maximum.
# ⚠️ Two things that will break this file, both easy to hit:
#   1. an inline table { … } must be on ONE line — TOML does not let it wrap
#   2. use a 'literal string' (single quotes) for anything with a backslash; a
#      "double-quoted" string treats \ as an escape and a grep regex breaks parsing
# `orchestrator.py config --check` reports either as "not valid TOML".
checks = [
  { name = "no new cross-layer refs", cmd = "grep -rl 'using Core' src/Api | wc -l", baseline = 3 },
]
```

[pricing]
# OPTIONAL. Estimated $ cost in the telemetry rollup. Built-in first-party rates
# (per MTok, verified 2026-09-08) cover opus / sonnet / haiku / fable; override or add
# a model here when rates move or for a partner platform (Bedrock/Vertex bill
# differently). Inline table must be ONE line. Keys prefix-match the model id.
as_of = "2026-09-08"
"claude-sonnet-5" = { input = 2.0, output = 10.0, cache_write = 2.5, cache_read = 0.2 }

[worker]
# Permission mode every spawned worker starts in. Default acceptEdits auto-accepts
# file writes so a worker never stalls on creating a file (Bash still runs). Use
# acceptEdits is the mode to rely on. bypassPermissions is disabled by policy in
# many orgs and not reliably honored even when passed — don't treat it as a
# fallback. If a bash-heavy worker blocks under acceptEdits, allowlist those exact
# commands in a worker settings file (permissions.allow), not bypass.
permission_mode = "acceptEdits"   # acceptEdits | plan | manual. `auto` and bypassPermissions are coerced to acceptEdits
# Bash command prefixes every worker may run without a prompt, written into its --settings as
# permissions.allow. orchestrator.py itself and read-only basics (git diff/status/log, grep, cat,
# ls, sed -n, …) are built in; list the stack's build/test commands here. Never sed -i, rm, git writes.
allow = ["npm test", "npm run build", "node --test"]

[budget]
# OPTIONAL hard $ ceiling for one PRD run. `orchestrator.py usage` (called after every
# phase settles) checks the running total against this and, if exceeded, emits
# `budget_exceeded` and returns exit 2 — SKILL.md treats that exactly like a one_way
# deviation: halt before the next phase, surface it, wait for a human. Unset (default)
# = no gate, matching the old behavior of only reporting cost at close-out.
max_cost_usd = 50.0

## [surface] — the close-out surface list

Optional `paths` is a list of `{ name, globs, risk }` tables; `name` and non-empty `globs`
are required per category. `risk` defaults to `true` and is read by risk routing.
Missing `paths` means `[]`. Globs match repo-relative paths with `fnmatchcase`: `*` crosses
`/`, a trailing `/` matches a prefix. Absolute paths and `..` segments are invalid.

Default `test_globs`: `tests/`, `test/`, `*/tests/*`, `*/test/*`, `*/__tests__/*`,
`test_*.py`, `*/test_*.py`, `*_test.py`, `*_test.go`, `*.test.*`, `*.spec.*`,
`*Tests.cs`, `*Test.cs`, `*.Tests/*`.
Default `skip_patterns`: `.skip(`, `it.skip`, `xit(`, `@pytest.mark.skip`,
`@unittest.skip`, `[Fact(Skip`, `[Ignore`. These are literal substrings on added
lines of test files, never regular expressions. Providing either list replaces its defaults.

`surface --phase N [--sha S]` scans that phase's own commits (including explicit fixes),
excluding store commits and unrelated commits. Run it after the phase commit is logged.
RUN.md anchors and explicit commit events establish ownership; hook-only events must touch the
phase plan's touch set. With no touch set and no anchor/explicit event, only the newest
non-store hook commit for the phase is admitted.
`surface --final` applies the same attribution to remaining recorded run commits, including on
non-resumed runs; unrecorded commits in `Base..HEAD` are excluded.
Each commit is compared with its first parent; root commits compare with an empty tree.
Renamed tests and tests re-added before the newest phase commit are not deletions.
Hits merge on reruns; only new hits print and emit `surface_hit`.

Level-change detection runs only when `[surface]` is present. Removed levels and changed
`cmd` values count; added levels and changed `paths` scopes do not. Hits appear first in
`report`, with scan notes and failed or missing scans listed. With no section and no recorded hits, report output
is byte-identical to the previous output. Hits never change a gate or commit decision.
`surface` exits 3 when disabled or without run state, otherwise 0 even with hits.

## Key reference

| Key | Meaning | Default |
|---|---|---|
| `skills.plan` / `skills.exec` | skill names the orchestrator invokes by name | `plan-feature` / `execute` |
| `validation.levels[]` | **the guardrails** — `name`, `cmd`, `expect`. What the builder runs and reports; the PRD decides which of them gate each phase | none (a run warns) |
| `validation.levels[].known_failures` | root-relative baseline path; state `known-failures/<level>.txt` wins | unset |
| `validation.levels[].failure_pattern` | multiline regex with exactly one capture group for a failure name; use a TOML 'literal string' for backslashes | unset ⇒ stream normally |
| `validation.levels[].paths` | repo-relative prefixes; runs when the phase touched one or `.claude/orchestrator.toml`; absent ⇒ always runs; `--full` and phase 0 run all | unset |
| `scope.exclude` | prefixes excluded from phase touch detection | `[]` |
| `knowledge.scope_notes` | repo decision boundaries, read by planner and builder; file must exist | unset |
| `park.allow_dirty` | dirty-path prefixes ignored in addition to the kickoff baseline | `[]` |
| `app.start` / `url` / `ready_probe` / `timeout_s` | the e2e gate's app lifecycle | unset ⇒ e2e is `N/A` for every phase |
| `app.warmup_url` / `warmup_timeout_s` / `warmup_required` | after the probe passes, `app-run.sh wait-ready` opens this path (relative to `url`) in a throwaway `<e2e.session_prefix>-warmup` browser session and waits up to `warmup_timeout_s` for any interactive element, then closes it and prints how long it took. Without `agent-browser` on PATH it only fetches the page, `/@vite/client` and the page's module scripts (no render check). A page that never renders fails `wait-ready` only when `warmup_required = true` | unset ⇒ no warm-up · `120` · `false` |

**`ready_probe` forms** — a 200 on the base URL is *not* proof your app is up (another process can hold the port), so the probe must match something only your app emits:

| Form | Meaning | Use when |
|---|---|---|
| `path:/health` | 2xx on that path under `url` | the app has a health/readiness endpoint (best) |
| `header:Server=Kestrel` | a response header on `url` matches | no health path, but a distinctive header |
| `text:<marker>` | the body of `url` contains `<marker>` | a stable string on the landing page |
| `cmd:<shell>` | an arbitrary command exits 0 | readiness needs logic the others can't express |
| (unset) | any response — **weak**, warns | last resort only |
| `plans.dir` | **legacy runs only** (no `Store:` in RUN.md): where plans are written. A store run always writes `<Store>/plans/` and ignores this key | `docs/ai/plans` |
| `e2e.profile` | the app's e2e profile; credentials are **env-var names**, values in a gitignored `.env` | unset ⇒ e2e worker bootstraps with a human |
| `e2e.session_prefix` | browser session naming, so sessions are sweepable | `e2e` |
| `testing.dir` | **legacy runs only**: where per-phase scenarios are promoted and `testdocs` writes PRD rollups, inside the repo. A store run uses `<Store>/testing/` in the wiki. `guard install` also fences this path. **Tracked** — the point is that they accumulate | `docs/ai/testing` |
| `worker.permission_mode` | mode each worker pane starts in; `acceptEdits` (default) clears file-write blocks and is honored everywhere. `bypassPermissions` is org-disabled/unreliable — not a real fallback | `acceptEdits` |
| `worker.allow` | Bash prefixes (`npm test`) or rules (`Bash(npm test:*)`) every worker runs without a prompt; added to the built-in orchestrator.py + read-only list | built-ins only |
| `pricing.*` | optional $ rate overrides for the telemetry cost estimate (per-MTok inline tables, prefix-matched to model id); built-ins cover the common models | built-in rates, verified 2026-09-08 |
| `budget.max_cost_usd` | hard $ ceiling for one run; `usage` halts the run (like a one_way deviation) if the running total crosses it | unset ⇒ no gate |
| `figma.checks` | default Q5 cadence; RUN.md `Figma checks:` overrides it: end, per-phase, skip | `end` |
| `figma.enabled` | turns on the Figma fidelity gate; `false`/unset ⇒ the gate is N/A everywhere | `false` |
| `figma.file_key` | the Figma file key `figma-pull` reads frames from (surface→node-id comes from the PRD, not here) | unset ⇒ gate N/A |
| `figma.bundle_dir` | where per-PRD frame bundles (PNG + tokens.json + index.md) are written — **ignored local snapshots; never commit images or extracted data** | `.agents/figma` |
| `figma.token_env` | **name** of the env var holding the Figma token; the value lives in the gitignored `.env` figma-extractor resolves | `FIGMA_TOKEN` |
| `testing.capture` | `off` skips the e2e trace + media recording. Turn it off only if you never intend to generate tests or review the runs | `on` |
| `testing.scenario_schema` | version written into canonical scenario documents | `1` |
| `testing.retain_raw` | whether raw trace/media belong in Git; only `false` is supported | `false` |
| `knowledge.always_loaded[]` | `@`-imported into every session — **never auto-committed** | `[]` |
| `knowledge.generated[]` | regenerated bundles; hand-edits are discarded. Drives the drift scan | `[]` |
| `knowledge.divergence_log` | where code-vs-doc conflicts are recorded | unset |
| `boundary_checks.checks[]` | `name`, `cmd`, `baseline` — architectural fences `execute` enforces | `[]` |

## Screenshots and video

The e2e gate records a screenshot per acceptance criterion and a `run.webm` of each phase into
`.agents/orchestrator/phase-N/media/` — **gitignored, never committed** (it lives under `.agents/`,
which the state dir already excludes). It is a look-back reference for a human, not a durable artifact.
Video needs `ffmpeg` on PATH; without it the gate keeps the screenshots and skips the recording.
The durable, tracked outputs are the redacted per-phase scenario documents and the two derived
`testdocs` rollups — not the media or trace.

## Store mode — where plans and testing docs live now

PRDs, plans and testing docs live in the **workbench store**, the wiki's `.planning/`, never in a team
repo: `.planning/<ctx>/<feature>/{prds,plans,testing}/`. A run is in store mode when RUN.md carries a
`Store: <dir>` line, which `init --prd <absolute store PRD>` (or `--store DIR`) writes. The store is
deliberately **not** an `orchestrator.toml` key — RBCloud commits that file, and the store is a path on
Chris's machine. In store mode `plans.dir` and `testing.dir` are ignored; the scenarios are tracked in
the wiki and recorded by `store-commit`, and `validate-e2e --committed` checks the wiki, not the repo.
`guard install` keeps the old paths out of the repo (`info/exclude` + the pre-commit docs fence).
A run with no `Store:` line is **legacy mode** and uses the two keys exactly as before. Move a repo's
existing docs with `store import` rather than running legacy.

## Why `testing.dir` is tracked when everything else the run writes is not

The deviation report is a review artifact — read once, then irrelevant, and deliberately gitignored.
The testing docs are the opposite: their entire value is **accumulating across runs**, so a future
agent can generate a Playwright suite from real recorded runs instead of guessing at the source.
`promote-e2e` converts each ignored phase capture into a redacted canonical scenario immediately;
`testdocs` only builds rollups from those tracked scenarios. A gitignored capture that was never
promoted dies with the worktree and teaches nobody.

`validate-e2e --phase N` checks the worktree artifact before commit;
`validate-e2e --phase N --committed` additionally proves it is tracked and unchanged at `HEAD` before
the run advances — the wiki's `HEAD` in store mode (after `store-commit`), the repo's in legacy mode.
(The reasoning below applies to both; only the repo that tracks the docs changed.)

## The two safety rules encoded here

1. **`always_loaded` is never auto-committed, even in `autonomous` mode.** Those files are
   `@`-imported into every agent session in the repo. A wrong edit is a compounding error with no
   downstream gate: no build catches it, no test catches it, no review catches it, and every future
   worker obeys it.
2. **`generated` paths are never hand-edited.** A learning that contradicts them queues a
   regeneration instead. Hand-edits to a generated bundle are discarded by the generator anyway.

## Getting one

```bash
orchestrator.py setup --detect     # probe the repo, write a draft with TODO markers
# then run the `orchestrator-setup` skill to fill the TODOs and verify each command
orchestrator.py config --check     # must exit 0 before a run
```

`preflight` refuses to start a run while any `TODO` marker remains.

Known-failures capture applies only when both a pattern and an existing baseline resolve. A non-zero
exit passes only with at least one matched failure and no new names. Matches are deduplicated;
baseline lines may be raw matching output or plain names (blank/comment lines are ignored).
The level records `baseline: N known, M new`, the baseline path and up to 50 new failures when red,
while preserving the real return code. A clean exit adds no baseline note. Invalid patterns fail;
`config --check` checks the one-group rule and warns about missing configured baseline paths.
Keep inline level tables on one line.
