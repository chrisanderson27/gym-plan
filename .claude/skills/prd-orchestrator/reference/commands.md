# Orchestrator commands

| command | does |
|---|---|
| `preflight [--trust]` | **run this first.** Asserts a worker can actually start here |
| `dispatch --pane P --prompt-file F` / `await --pane P --artifact G` | ⛔ **the only way to wait on a worker.** `dispatch` sends the prompt without blocking; `await` (always `run_in_background`) exits the moment the artifact exists, or with a typed reason it never will — [tab-hygiene.md](tab-hygiene.md#detecting-real-completion--wait-on-the-artifact-not-the-lifecycle-state) |
| `routing --stage S [--phase N]` | the exact `herdr agent start` args for a stage's worker (routing.json, else defaults); `--phase N` applies the phase's risk to the default builder |
| `config --check` | validates the repo's `orchestrator.toml`, resolves every path it names |
| `init --prd <path>` | scaffolds the state dir + RUN.md, records the base commit; an **absolute store PRD** path also writes `Store:` |
| `store path --context C --feature F` | creates + prints the store's `prds/`, `plans/`, `testing/` dirs for a ticket |
| `store-commit [--phase N] [--reason R] [--path P …]` | commits store paths (default: the run's `Store:`) in the wiki — only under `.planning/`, `--only`, never pushed |
| `store import --repo R [--ref REF] --context C` / `--from DIR --context C --feature F` `[--dry-run]` | one-off migration: copies a repo's committed `docs/ai/{prds,plans,testing}` (or a loose dir) into the store, one wiki commit |
| `guard install` / `guard status` | puts `docs/ai/{prds,plans,testing}/` and `.workbench/` in the repo's `info/exclude`, sets `workbench.docsFence`, installs the hooks / reports what is missing |
| `estimate --low H --likely H --high H --basis "…"` | stamps the kickoff human-effort estimate (RUN.md + `human_estimate`) |
| `risk --phase N [--plan P]` / `risk --summary` | rates a phase high/normal (gap pass + plan touch set vs `[surface]`), writes `phase-N/risk.json` + RUN.md note token, emits `phase_risk`; `--summary` lists high-risk phases and commits; never holds |
| `surface --phase N [--sha S]` / `surface --final` | lists high-stakes paths, deleted/skipped tests and changed validation levels from a phase's own commits; prints new hits; exit 3 when `[surface]` is absent; never holds |
| `report [--prd <path>]` | validates the deviation ledger, writes `deviations-<slug>.md` |
| `log` / `timeline` / `status` | audit trail |
| `promote-e2e --phase N` / `validate-e2e --phase N` | redact, persist and gate a phase's browser journey |
| `figma-pull [--prd P]` / `validate-figma --phase N [--final]` | pull ignored local Figma snapshots / validate the selected per-phase or end-of-run comparison |
| `gaps write|show|resolve` | the kickoff **gap pass** over the PRD's phases — [reference/gap-pass.md](gap-pass.md) |
| `facts add|show` | the per-run **facts cache** workers read before they re-explore |
| `ingest --phase N --from <artifact>` | after reading any plan or summary: harvest its `## New facts` and `## Gaps addressed` in one call |
| `testdocs` | build PRD rollups |
