# Repo packs — how a team makes this theirs

A **repo pack** is the set of files a target repo owns so the orchestration skills can stay generic.
The skills hold *mechanics*; the pack holds *facts*. Nothing in `prd-orchestrator`, `plan-feature` or
`execute` may hardcode a stack fact — if you find one, it belongs here.

```
<target repo>/
  .claude/orchestrator.toml     the machine-readable config (see ../config.md)
  .claude/e2e/profile.md        app facts + learned quirks for the e2e gate
  AGENTS.md                     conventions, stack corrections, commands   (repo's own)
  .claude/standards/*.md        per-layer rules the builder must follow    (repo's own)
```

`template/` is what a new repo starts from. `rbcloud/` is a **worked example** carrying the real
content that used to be welded into the skills — read it to see how much repo-specific knowledge a
mature pack holds, and how none of it needs to live in a skill.

## Getting one

```bash
orchestrator.py setup --detect     # probes the repo, writes a draft with TODO markers
```

Then run the **`orchestrator-setup`** skill, which fills the TODOs by asking, verifies each declared
command actually runs, and writes the e2e profile skeleton. `orchestrator.py preflight` refuses to
start a run while any TODO remains.

## The two rules that are not negotiable

1. **No credentials in the pack.** The e2e profile names **environment variables**
   (`E2E_USER`, `E2E_PASS`); the values live in a gitignored `.env`. A profile containing a literal
   password is a bug to fix, not a pattern to copy.
2. **`always_loaded` files are never auto-committed** — not even in `autonomous` mode. They are
   `@`-imported into every agent session in the repo, so a wrong edit is a compounding error with no
   downstream gate.
