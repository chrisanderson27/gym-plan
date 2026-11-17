# The Figma fidelity gate

An agent compares app screenshots with a local Figma snapshot using the checklist below.
**Kickoff Q5 owns the schedule**, independently of behavioral E2E (Q2):
`skip`, `per-phase`, or `end` (recommended). Record `Figma checks: <mode>` in RUN.md;
it overrides the repository's `[figma].checks` default. Ask Q5 unless the user has already chosen
for this run, or no Figma configuration exists.

## The local snapshot

At kickoff, when configured and Q5 is not skip, `orchestrator.py figma-pull` reads the PRD's Design
contract table (surface name in the first column; a `node-id` column) and invokes the extractor's
REST wrapper. The orchestrator owns storage and organization:

| File | Content |
|---|---|
| `<surface>.png` | Downloaded frame screenshot at scale 2 |
| `<surface>.tokens.json` | Node JSON: dimensions, fills, strokes, text, styles, spacing |
| `index.md` | Surface → node ID → local files |

Default: `.agents/figma/<prd-slug>/`. **All of this is ignored local data. Never stage or commit the
images or extracted CSS/node/token data, or copy it into tracked documents.** Custom bundle paths
must be inside the working tree and ignored. Preflight, pull and validation reject tracked bundles,
including force-added files. Existing pairs are reused unless `figma-pull --force` refreshes them.
A clean checkout pulls its own snapshot; it is not a live mirror of an evolving Figma file.

The surface mapping is the PRD's, not something invented by the worker. An enabled UI run with no
parseable frame mapping is a PRD gap; report it rather than guessing.

## Schedule and gates

| Q5 choice | Worker timing | Validation |
|---|---|---|
| skip | No pull or comparison | N/A, reported at close-out |
| per-phase | After each phase touching a Figma surface, before its commit | `validate-figma --phase N` |
| end | After all phases, before final review/close-out: each touched phase compared by its own end-of-PRD batch worker (or a visual-only worker per phase, in parallel) | `validate-figma --phase <n> --final` for each touched phase |

An ordinary validation call in end mode reports **deferred**, not completed. Always run the final
command before close-out. When a behavioral E2E worker is due at the same point, fold the comparison
into it and set `ORCH_FIGMA=1`. When schedules differ (including Q2 skip), use the visual-only worker
below. Q2 must not silently disable or change Q5.

## Visual-only worker

The orchestrator starts/stops the app using the app-lifecycle procedure in [e2e-gate.md](e2e-gate.md),
including its teardown on every exit. Start a worker with `ORCH_STAGE=figma`,
`ORCH_PHASE=<n>`, and `ORCH_ARTIFACT=<absolute phase-dir>/figma-compare.md`.
Use the same worker model routing as E2E. Pass only the relevant surfaces (all touched surfaces for
end mode), their local snapshot paths, the app/profile instructions and a unique browser session.

The worker loads the repo's browser/login profile, opens its own session, navigates to the specified
surfaces, captures app screenshots under the ignored phase directory, and applies the checklist below.
It performs only navigation/interactions needed to expose those visual states, not a second behavioral
acceptance walkthrough. It closes its browser on every exit and writes the comparison as its Stop
artifact. If the app cannot be reached, write `RESULT: fail` with the blocker and report the phase as
blocked; never claim visual success without seeing the app. No behavioral capture/manual/trace bundle
is required for this visual-only run. The orchestrator checks the result and stops the app.

## Comparison checklist

For each touched surface, pair the app screenshot with the local PNG and node JSON:

- **Elements:** missing, extra or misplaced controls, fields, icons and tabs.
- **Text:** wording, casing, labels, headings and placeholders.
- **Tokens:** colors, borders, radii, spacing and fonts. Where useful, inspect computed app styles.
- **Layout:** ordering, alignment, grouping and responsive behavior at the tested widths.

This checklist makes the assessment consistent; it is not a deterministic pixel-diff guarantee.

## Findings and artifact

Write ignored `phase-N/figma-compare.md`, starting with `RESULT: pass|fail|na`, then a table:

```markdown
RESULT: fail

| Surface | Figma frame | Check | Finding | Class |
|---|---|---|---|---|
| Settings | 14527:184997 | text | Heading casing differs | regression |
| Roster | 14639:223385 | elements | Agreed extra status chip, decision D1 | confirm |
```

A difference defaults to `regression`. `confirm` requires an agreed decision; `deferred` requires
a tracked follow-up. Mark resolved regressions explicitly as `fixed` or `resolved`.

The validator requires a valid result and zero unresolved regressions when a check is due.
`--committed` is retained for caller compatibility but still requires raw design artifacts to remain
untracked. It never requires a committed Figma bundle.

A failed comparison routes back to the builder, then re-verification and re-comparison, capped at
**two correction cycles**. A still-failing per-phase check blocks that phase; a still-failing final
check blocks final review/close-out. Neither one implies unlimited iteration.

## N/A

No UI/Figma surface → record `RESULT: na` and the reason.
Disabled Figma configuration or Q5 skip → no pull or comparison.
Enabled UI scope with missing frames → report a PRD gap, not a successful N/A.
