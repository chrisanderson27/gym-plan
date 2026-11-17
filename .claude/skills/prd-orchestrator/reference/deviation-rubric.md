# What counts as a deviation

Replaces the old denylist. **Nothing here blocks a phase.** This rubric decides what is worth an
engineer's two minutes at the end of a run — nothing more.

## Why the denylist is gone

Measured across **681 decisions in 26 real runs**:

| Metric | Value |
|---|---|
| Decisions marked BLOCKED | 332 (48.8%) |
| …auto-blocked by substring match, not judgment | 317 (95.5%) |
| …shaped as an actual question for a human | 12 (3.6%) |
| Phases actually parked as a result | **0** |
| Precision against real one-way doors | **1.2%** (258 blocks, 3 true) |
| Recall over real one-way doors | 20% (missed 12 of 15) |

It was a bare substring match in a point-of-sale codebase: `payment` matched `Payment.cs` **122
times**; `token` matched `CancellationToken` **52 times**; `ddl` matched `ErrorHandlingMiddleware`.
Fifteen records were blocked on a word their own text *negates* ("**no** migration"). Meanwhile the
genuinely irreversible *"HTTP shape for the three new lifecycle transitions — POST not DELETE"* sailed
through unflagged.

**332 blocks produced zero control-flow changes.** The orchestrator overrode the gate every time,
which was the right call, and is exactly why the gate should not exist.

## The three gates

A record is admissible only if it passes **A or B**, and survives **C**.

### Gate A — Contradiction (primary)

Does this **contradict, extend, or reinterpret** a specific, quotable PRD statement?

To pass you must fill **all three**:
- `prd_ref` — a section anchor that resolves to a real heading
- `prd_says` — a **verbatim** quote from the PRD, ≤240 characters
- `built` — what was built instead, one sentence

**Failing Gate A is the norm.** "The PRD didn't mention it and nothing in the PRD needs to change" is
implementation, not deviation. The quote requirement is self-enforcing: an ordinary code-discovery
call has no quote to produce.

### Gate B — Blast radius (an independent way in)

Does it change something code *outside this PRD's diff* depends on, or that *outlives a `git revert`*?
A **closed enum** — if it is not on this list it is not a blast radius:

| `blast` | Test |
|---|---|
| `schema` | does a migration file change? |
| `api-contract` | would an existing consumer break? |
| `auth` | does a permission check move, widen, or get invented? |
| `money` | does a stored monetary value differ? |
| `data` | does existing production data change meaning? |

`ui`, `internal`, `naming`, `test`, `perf` are **not** blast radii. Absorbed.

### Gate C — Absorption (the negative gate)

Would a competent engineer reading only this diff reach the same conclusion in under two minutes?
If yes, **absorb it silently** even if Gate A felt marginal.

This is what removes ~90% of today's ledger: *"mirrors the existing HttpClient retry setup"*,
*"placed next to CustomerGrid.tsx like the other 15 components"*.

**Gate C cannot veto Gate B.** An executed migration is reportable however obvious it felt.

## `one_way`

`one_way: true` means a `git revert` does not undo it: a migration that ran, a backfill that rewrote
rows, money that reached the books, an `auth` widening that was live for a window. It therefore
requires `blast ∈ {schema, money, data, auth}` — the validator enforces this.

A pre-release API contract is deliberately **not** one-way. It is the largest category and genuinely
revertible before release; the end-of-PRD `code-review` is its catcher, not this layer.

What `one_way` does:
1. **Always sorts to position 1** in the report, in both autonomy modes.
2. **Prints one line the moment it is recorded**, in both modes — an end-of-run report is inherently
   read after the fact.
3. In **`autonomous` mode only**, holds *that one phase's* commit. Work stays in the tree, the run
   continues to the next phase. In `commit` mode nothing is held: the human is already the gate.

## Expected volume

**2–5 records per PRD**, versus 26 today.

If a run produces 20, the rubric is not being applied — most of those will fail the verbatim-quote
check and be dropped as malformed, which is the signal to look at the planner prompt.

## What the validator checks

`orchestrator.py report` mechanically verifies every record, and **drops** (never blocks) the ones
that fail, listing them so the filter is visible rather than silent:

- `prd_says` is a verbatim substring of the PRD file, and ≤240 chars
- `prd_ref` resolves to a real heading in the PRD
- `kind` ∈ {contradicts, extends, reinterprets, architecture}
- `blast` is in the closed enum
- `one_way ⇒ blast ∈ {schema, money, data, auth}`
- every `where` path exists; every `evidence` cite resolves (ranges and multi-file cites are fine)
- `built`, `why`, `verify` are non-empty

## Honest limits

A verbatim quote makes a **bad** record detectable. **Nothing makes a missing record detectable** —
the filter is still the agent's own judgment. The denylist did not solve that either (it missed 12 of
15 real one-way doors), so this is not a regression; but it must not be sold as a guarantee.


**Scripted backstop.** When `[surface]` is configured, `orchestrator.py surface` lists, at the
top of the report, every touched path in a named category, every deleted or newly skipped test
and every removed or changed validation level. It does this from each phase's own commits,
whether or not a worker recorded anything. It catches the path, not the judgment: a one-way
decision in an unlisted file is still only as visible as its worker made it.
