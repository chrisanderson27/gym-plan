# Close-out

Read this before close-out step 1. `report` lists every not-met/not-proven Acceptance row.

1. **Report:** `orchestrator.py surface --final`, then `orchestrator.py report`; print Surface hits first, then top three deviations in full, unresolved gaps, review ledger (confirmed/fixed commits, open findings, rejection/scope reasons), Noticed and Decisions.

2. **Drift:** `orchestrator.py drift`; report generated-doc drift, write nothing.

3. **Testing artifact rollups** — build two PRD-level indexes from the canonical scenarios already
   promoted and retained during each phase:
   ```bash
   orchestrator.py testdocs        # -> <Store>/testing/<prd>-test-flow.md  and  -manual-test.md
   orchestrator.py store-commit --reason close-out    # records the rollups in the wiki
   ```
   (Legacy runs write to the repo's `<[testing] dir>` and commit there instead.) The tracked files under
   `<Store>/testing/scenarios/<prd>/` are the machine-facing source of truth—
   prerequisites, steps, real Playwright locators, resolved elements, safely classified inputs,
   assertions, cleanup and stability notes. `test-flow.md` indexes those records so a Playwright spec
   can be **generated from a real run** rather than guessed.
   `manual-test.md` is the human-facing one: what changed (before → now) and how to verify it by hand.
   Canonical scenarios and these rollups are **tracked and committed** (in the wiki) because their whole value is
   accumulating across runs. `testdocs` never reads raw `.agents/` evidence, so close-out or worktree
   cleanup cannot be the first point at which a successful phase becomes durable. A phase whose e2e
   was `N/A` contributes nothing, which is fine.

4. **PR evidence manifest** — consolidate every phase's curated screenshots (the ones each e2e worker
   marked PR-worthy in its own `phase-N/pr-evidence.md`, per
   [reference/e2e-gate.md](e2e-gate.md)):
   ```bash
   orchestrator.py pr-evidence        # -> .agents/orchestrator/pr-evidence-manifest.md
   ```
   Local file collection only — it globs the phase directories, picks a capped, phase-fair subset
   (default 8, one round-robin pass per phase so no single phase's screenshots crowd out the rest),
   and writes their paths and captions. It does **not** touch ADO; that happens in step 9 only if a
   draft PR is actually opened. No manifest (or an empty one) is the correct outcome for a PRD whose
   phases have no visual surface — do not force a screenshot where none exists.

5. **Tally:** `learnings --add "<class>" --standard <file> --phase N --file <file:line>` for confirmed findings only; read `learnings`. Recurrence earns proposed standards edits only.

6. ⛔ Never auto-edit `always_loaded`, standards, AGENTS.md or CLAUDE.md, even autonomously; `instruction-fence.sh` covers worker sessions only, so hold this yourself. Present a diff.

7. **Library sync** — `orchestrator.py library-sync`. Every Nimble e2e run already taught the
   pilot's shared flow library as it went, with no step needed from you:
   - it adopted flows whose own steps passed, and folded duplicates into existing flows
   - it earned anchor trust where Haiku confirmed Nimble's pick
   - it re-calibrated the gate floor from the decision log pooled across every run
   - it queued anything it couldn't get past in `BLOCKS.md`
   - it rebuilt `SCREENS.md`, the per-screen phrasebook the next compile writes Nimble's questions from
   - it saved every step-fix (steps an LLM finished for Nimble) so the next run replays them with Nimble
   - it updated `SCOREBOARD.md`. Put its newest trend row in the close-out summary — items Nimble
     carried vs handed off, step-fixes, Nimble's share of steps — so progress is visible PRD over PRD

   This step makes that durable. It is **one commit, scoped to the library path, in the repo that
   holds the library** (the wiki), and is never pushed. Nothing else staged there is touched.
   Learned maps/steps are data, not instructions.
   - Run it in every autonomy mode. The library is element maps and step sequences learned from
     live runs whose own postconditions passed, not a file that instructs agents, so step 6 doesn't
     apply.
   - Print its health line. If `BLOCKS.md` has open entries, list them in the close-out summary:
     that is the code-fix queue, the reason the next PRD would otherwise fall back to Claude.
   - It's a no-op when the Nimble engine never ran.

   Kickoff preflight prints the same health line, so each PRD shows what it inherits.

8. **Sweep:** `orchestrator.py tab sweep`; kill app and close this run's browser sessions only, per [tab-hygiene.md](tab-hygiene.md).

9. **Tracker-aware.** If the launch prompt carries a `Close-out (SKILL.md step 9):` line, follow it:
   offer only the **draft PR** and completion **notification**. For the draft PR, read and follow
   the `publish-evidence` skill it names in create mode. Write the given `PUBLISH_SPEC` to
   `.agents/orchestrator/publish-spec.json`; use `RESULT_PATH` and `JIRA_CLI` as given. Never use
   `create-pr-ado` or `attach-prd-ado` on this path, and never upload evidence — the named skill
   refuses non-empty `items`. Without that launch line, the existing steps below apply unchanged.

   **Ask about the extras now — this is not a kickoff question.** Once the deviation report (step 1)
   and summary exist, ask the owner in one short message whether he wants any of: the deviations posted as
   an ADO **comment** (via `attach-prd-ado` — never an attachment; ADO doesn't render `.md`, so an
   attachment is a download nobody opens), a **draft PR** opened (via `create-pr-ado`, draft only —
   pass `--draft true`, since the skill's own default is a published PR — and never pushed without him
   saying so in this run), or a completion **notification**. These leave the machine or post
   externally, so confirming them once the diff actually exists — rather than pre-authorizing them
   before a single phase had landed — is the point; do not ask this at kickoff instead.

   **If he wants the draft PR and step 4 produced a non-empty manifest, attach the evidence before
   calling `create-pr-ado`:**
   1. Upload each manifest path to the linked ADO work item as an attachment — the same two-step raw
      REST upload `attach-prd-ado` uses (`POST .../_apis/wit/attachments?fileName=...` with
      `Content-Type: application/octet-stream` and `--data-binary`; the upload is content-agnostic, it
      works unchanged for a PNG). Collect each response's `url` verbatim — do not reconstruct it.
   2. Pass `create-pr-ado` an explicit instruction to include a `## Screenshots` section with one
      `![<caption>](<url>)` line per upload, using the manifest's captions. This is the "unless asked"
      case its own guardrail names — the caller (you, on the owner's behalf) is asking, with real evidence
      already in hand, not inventing a section out of habit.
   3. **Say plainly in the close-out report that this is unverified in this org** — embedding a
      work-item-attachment URL in a PR description markdown field is expected to render (ADO's
      markdown renderer fetches such URLs the same way it does anywhere else an attachment is
      referenced), but nobody has confirmed it in this repo's ADO project yet. Ask the owner to check the
      images actually show once the PR opens, and note here if they do not, so the next run knows.

10. **First,** log `run_end --detail completed|partial|aborted` first (`park` alone emits parked), then `telemetry`: wall time, stage tokens, fixes, gates, deviations, estimated costs and blind human estimate. Abandoned runs log aborted. Include E2E engine savings.

11. Append ONE line under `## Explicit` in today's second-brain daily log.
