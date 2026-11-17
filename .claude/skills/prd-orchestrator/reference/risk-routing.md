# Risk routing — upward only

## What rates a phase

A phase is `high` when its gap-pass entry is high, or its plan's `## TOUCH SET` matches a
`risk = true` category in `[surface] paths`. Otherwise it is `normal`. Only the touch set is used;
mandatory reading paths are references. Matching follows [config.md](config.md): `fnmatchcase`,
`*` crosses `/`, trailing `/` means prefix. A directory entry also matches globs whose literal
prefix lies under it, or when the directory itself (without `/`) or a child placeholder (`<directory>/x`)
matches a non-prefix glob. This includes `src/migrations/` against `**/migrations/**` and `src/auth/`
against `*/auth/*`; a suffix-only glob such as `*.sql` does not rate every directory high.
Directory entries also match possible descendants by comparing their segments with the glob's
directory segments using `fnmatchcase` (`**` accepts zero or more segments); trailing glob segments
may remain below the entry. Thus `db/migrations/` matches `**/migrations/*.sql`, `src/auth/` matches
`*/auth/*.py`, and `src/` matches `**/auth/**`. Existing matches are preserved.
A leading `./` is ignored. Hits are deduplicated and capped at 20.

`test_globs` and `skip_patterns` never rate risk. A test path only rates if it independently matches
a risk category. No plan or no touch set means gap pass only. No gap result and no `[surface]` means
normal. Unreadable inputs are noted; unexpected rating errors preserve a readable gap-pass high,
otherwise record normal. The failure is recorded in notes and printed. Nothing here holds a run.

## When it runs

Step 1: after `ingest`, before `routing --stage builder --phase N`, run
`orchestrator.py risk --phase N [--plan P]`. Without `--plan`, the last plan event supplies the path.
`NO-PLAN-NEEDED` still runs risk using the gap pass. Re-run after any plan revision: the record and
RUN.md token are replaced. Gap-pass writes carrying `risk` replace stored risk wholesale; omit the
key to preserve it, or use `--replace` to clear it along with findings.

## Effects

A high phase raises only the default Claude builder effort to at least `medium`, never changes a
model and never lowers effort. Its fix workers inherit this through `tab open --stage fix --phase N`
and `routing --stage builder --phase N`. The end-of-PRD fixer has no phase and keeps the default.
An explicit `routing.json` builder entry is untouched at any effort; non-Claude defaults are also
untouched. RUN.md records `effort not raised` and the reason in either case.

High risk requires architecture review even without a coupling signal; review timing is below.
It adds a security axis to final review only when
`risk --summary` reports at least one high-risk phase. No gate, verify or commit decision changes.

## Review timing

- **Q3 option 1:** step 5 runs on any coupling trigger or high risk. Normal phases with no trigger
  retain the existing skip behavior.
- **Q3 option 2:** high phases still run the step-5 architecture check after verify and before commit,
  even with no coupling signal. Normal phases skip step 5 regardless of coupling signals; record
  `review: skipped (Q3 option 2)` and a per-phase `stage_skipped --stage coupling` with that reason.
  Never emit a run-wide coupling skip for option 2: a later plan may rate high.
- **Q3 option 3:** the full per-phase two-axis review subsumes the architecture check for high and
  normal phases. Do not dispatch a separate step-5 worker; retain the run-wide coupling skip with
  the Q3 answer as its reason.
- **Q3 option 4:** high phases still run the step-5 architecture check after verify and before commit,
  even with no coupling signal. Retain the existing midpoint and final full reviews.
  Normal phases have no separate step-5 worker.

For high phases under options 1, 2, 3 and 4, record `review: forced (high risk)` in RUN.md. On option 3 append
`architecture covered by full per-phase review`, and ensure its Standards axis covers architecture
and shared contracts. On options 1, 2 and 4 use the existing step-5 worker and R2 triage.
On option 3 the token records intent; the per-phase review entry is the evidence.

## Security axis prompt

Beside the existing code-review worker, the orchestrator spawns one `sonnet`/`medium` security
subagent only when a phase is high. Scope it to the commits listed by `risk --summary`, deduplicated
across those phases; no other commits. Feed `review-security.md` findings into existing R2
verify-before-fix triage, using the same CONFIRMED / REJECTED / OUT-OF-SCOPE classification before
fixing critical, high or medium findings. Low findings follow the existing review policy.

> Subagents: none. Security review only. Read the diffs of these commits: `<shas from risk --summary>`
> (`git show <sha>` each); no repo-wide reading. Look for auth/permission bypass, secret or
> credential exposure, injection (shell, SQL, path), unsafe deserialisation, widened file/network
> access, and weakened gates or hooks. **Rate every finding critical/high/medium/low** with a
> `file:line`. Write them to `.agents/orchestrator/review-security.md` and reply with only that path.

## Records

`phase-N/risk.json` is source of truth: phase, risk, source (`gap pass`, `surface`, or both), gap,
surface hits, plan, notes, route (applied and reason) and ts. RUN.md's existing artifact / note cell
gets a replaceable `risk: …` token. `phase_risk` emits risk, source, categories, applied and detail
(the token). Telemetry shows `high-risk phases: N` using the last event per phase in its run window.

`risk --summary` lists only high phases in numeric order and their commits from
`phase-N/surface.json`, falling back to the RUN.md commit cell. It ends `high-risk phases: N`.

## Honest limits

The touch set is the planner's claim. Out-of-plan edits are caught by `scope.json` and `surface`,
not by this pre-build rating. A later agent rewrite can drop a RUN.md token; risk.json remains truth.
Workbench seeds an explicit builder entry, so high phases there record effort not raised while
still receiving the architecture check and final security axis.
