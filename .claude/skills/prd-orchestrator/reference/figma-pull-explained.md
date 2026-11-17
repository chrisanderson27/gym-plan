# How Figma snapshots and checks work

## Kickoff decides whether and when to compare

The orchestrator asks **Q5: Should we compare the UI with Figma, and how often?**

- **Once at the end** (recommended): compare all touched Figma surfaces against the finished UI.
- **After each relevant phase**: earlier feedback, with more browser and model work.
- **Skip**: no snapshot download or comparison for this run.

The answer is recorded as `Figma checks: end|per-phase|skip` in RUN.md, independently of Q2's
behavioral E2E cadence. Build and unit tests still run; this choice does not defer them until a human
reviews the UI. A human approval checkpoint is not part of this change.

When both checks are due together, one browser worker handles them. Otherwise a visual-only worker
captures and compares the selected surfaces without repeating the behavioral E2E walkthrough.
See [figma-gate.md](figma-gate.md#visual-only-worker).

## What downloads the images, and where do they go?

The **orchestrator**, not the extractor, owns the snapshot's location and lifetime.
At kickoff, if checks are enabled and not skipped, `orchestrator.py figma-pull`:

1. Reads the PRD's Design contract table for surface names and Figma node IDs.
2. Calls the extractor's REST wrapper to download each frame PNG and read its node JSON.
3. Organizes the files and writes a local index.

```text
.agents/figma/<prd-slug>/           ignored local snapshot
  <surface>.png                   downloaded Figma frame
  <surface>.tokens.json           node data: dimensions, styles, colors, text
  index.md                        surface → node ID → local files
```

**Never stage or commit Figma images or extracted CSS/node/token data.** Do not embed that raw data in
tracked docs either. The default directory is gitignored. Custom bundle directories must also be
ignored; pull, preflight and validation reject tracked bundles (including force-added files).
The former `docs/ai/figma/` location is also ignored for compatibility.

This is a snapshot of the design when work begins, not a live mirror. Existing PNG/JSON pairs are reused;
`--force` explicitly refreshes them. A later Figma edit does not silently change the comparison baseline.
The token remains in the ignored environment configuration. A clean checkout can pull its own snapshot.

## What is compared, and can it loop forever?

The worker compares app screenshots against the local frame and node data: elements, text/casing,
colors/spacing/fonts, and layout. It records findings in ignored `figma-compare.md` with
`RESULT: pass|fail|na`. This is an agent assessment using a fixed checklist, not a pixel-perfect guarantee.

Unresolved regressions fail the selected check. The builder can fix and re-check, capped at **two
correction cycles**; a still-failing check is reported as failed. Agreed deviations and tracked
follow-ups are recorded explicitly. This automates visual review but does not guarantee a token cost.

- Per-phase: `validate-figma --phase N` gates that relevant phase.
- End-only: `validate-figma --phase <n> --final` for each touched phase gates final review/close-out.
  Earlier phase validation reports deferred, not a completed comparison.
- Skip: no worker or snapshot pull. Close-out reports that Figma was skipped.

## Hooks and retained evidence

The worker Stop hook requires its artifact before allowing it to stop. A combined E2E/Figma worker
uses `ORCH_FIGMA=1` only when the comparison is due and must include `figma-compare.md` in its E2E
bundle. A visual-only worker uses `ORCH_STAGE=figma` and points `ORCH_ARTIFACT` at its comparison.
The orchestrator validates the result; the Stop hook checks presence, not visual correctness.
Neither a hook nor `--committed` authorizes committing raw design data.

Figma snapshots, app screenshots, traces and comparison reports remain ignored. Behavioral E2E
scenario documentation may be promoted separately under its existing contract; it must not contain
raw Figma images or extracted design data.
