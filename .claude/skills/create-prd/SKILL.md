---
name: create-prd
version: 2.1.0
description: Take an Azure DevOps work item or Jira issue key/URL — or the conversation so far — resolve every unknown against docs/ai, grill the user on what only they can decide, and only then write a Product Requirements Document to the Workbench PRD store in the wiki (.planning/<ctx>/<feature>/prds/), never into a team repo. Use when scoping what a piece of work should achieve, before it is planned or built. Never writes to ADO or Jira.
---

Repo facts come from `[knowledge]` (standards, `scope_notes`, `codebase_docs`) and AGENTS.md; worked example: `prd-orchestrator/reference/repo-pack/rbcloud/repo-knowledge.md`.

# Create PRD

Turn a work item or a conversation into a Product Requirements Document. A PRD states **intent** — what
the work should achieve, agreed before it is planned.

**Output:** `~/git/personal/wiki/.planning/<ctx>/<feature>/prds/prd-<N>-<kebab-case-name>.md` — the
Workbench PRD store, grouped by the parent **Feature id**, with `<N>` the PRD's order within that Feature (a
Feature with a single PRD is `prd-1-…`). A PRD with no Feature parent uses its own work-item id as
`<feature>`. The PRD is never written into a team repo. **Nothing is ever written back to Azure DevOps** — the
link runs one way, from the PRD's frontmatter to the ticket. To improve the ticket itself, that is
[`/refine-devops-ticket`](../refine-devops-ticket/SKILL.md), which is the product person's tool and
writes to ADO after approval.

### Where the PRD is saved — the workbench store

Chris manages every PRD from the **workbench app**, and every PRD lives in one place: the **store**, the
wiki's `.planning/`, versioned in the wiki. PRDs, plans and testing docs are never committed to a team repo.

| Work | Save to | The workbench shows it |
|---|---|---|
| **A ticket** in any repo (RBCloud/ADO, Lubesoft/Jira ISI-…, …) | `~/git/personal/wiki/.planning/<ctx>/<feature>/prds/prd-<N>-<slug>.md` — `<ctx>` is the workbench context (`rbcloud`, `isi`), `<feature>` the parent **Feature id**, else the ticket key | On the PRDs page and the ticket's row (`server/modules/prds/scan.mjs`, matched on `work_item` / `stories` / `feature`) |
| **A branch with no ticket** | `.planning/<ctx>/<branch-slug>/prds/prd-<N>-<slug>.md` | On the PRDs page and the branch's row |
| **The wiki or workbench itself** | `.planning/<feature>/prds/prd-<N>-<slug>.md` in this repo (unchanged) | On the single *Workbench (wiki · branch)* row (`scanPlanning`) |

- ⛔ **File by where the changes land, not by what the PRD is about — and make sure My Work can list it.** The
  PRDs page shows every store PRD, but Orchestrate launches only from a **My Work row**, and a PRD reaches a row
  only through one of three anchors. A PRD with none of them is a dead end: visible, never runnable. (2026-10-13:
  two LSE PRDs were filed in `.planning/isi/` with no ticket; one changed only the wiki, the other named a branch
  whose worktree Workbench hadn't scanned yet, so neither could be orchestrated.)

  | The PRD's changes land in | File it in | The row that lists it |
  |---|---|---|
  | The wiki or Workbench, even when the *subject* is a team repo (that repo read-only) | `.planning/<feature>/prds/` | The Workbench row |
  | A team repo, for a ticket | `.planning/<ctx>/<feature>/prds/` with `work_item:` (and `stories:`) | That ticket's row, while it is in your open tickets |
  | A team repo, with no ticket | `.planning/<ctx>/<branch-slug>/prds/` with `branch:` | The branch's worktree row — so **create the worktree** (`thBase` + `branchTemplate`) and rescan |

  After creating a worktree outside Workbench, rescan so its row appears now rather than at the hourly scan:
  `curl -s -X POST -H 'X-Workbench: 1' "http://localhost:<context port>/api/worktrees/rescan?force=1"`.
  `store-commit` prints a WARNING for a context-store PRD with no ticket and no branch, and a NOTE for a branch PRD.
  **Do not hand over a PRD while either is unresolved** — check the PRDs page shows no "Not on My Work" note for it.
- **Get the directory from the store, never by hand:**

  ```bash
  python3 ~/git/personal/wiki/.claude/skills/prd-orchestrator/scripts/orchestrator.py \
    store path --context <ctx> --feature <feature id or ticket key>
  ```

  It creates and prints the `prds/`, `plans/` and `testing/` dirs. Pick `<N>` as the next unused number in
  `prds/`. **Launched from the workbench's Create PRD action?** The prompt names the exact path (the server
  picked `<N>`) — write to that path and nowhere else.
- ⛔ **Never write a PRD into a team repo's `docs/ai/`** (or anywhere in its working tree). The repo's
  pre-commit docs fence (`orchestrator.py guard install`) refuses any commit that stages
  `docs/ai/{prds,plans,testing}/`, so a PRD written there can only ever be an untracked stray.
- **A ticket worktree is still used — for code only.** If the ticket has none yet, create one off
  `origin/main` using the context's `worktrees.thBase` and `tickets.branchTemplate`
  (`workbench/contexts/<ctx>.json`). For ISI that is `~/git/ISI/worktrees/<id>-<slug>` on branch
  `chris/<id>-<slug>`. Read the code there; the PRD itself still goes to the store.
- **Frontmatter:** add `context: <ctx>` (and `repo: <repo name>` when it helps) alongside the usual fields.
- **A non-ADO tracker** (Jira): `work_item` is the key (`ISI-3056`), and `feature` is the parent *Feature*
  key, or the PRD's own key when the parent is an Epic or absent. Add `branch:` too. Skip the ADO-only
  steps (fetch, `children`, `<!-- rbcs-refined -->`), and never write to the tracker.
- **Finish by committing it to the wiki** (path-whitelisted to `.planning/`, never pushed, leaves Chris's
  other wiki changes alone):

  ```bash
  python3 ~/git/personal/wiki/.claude/skills/prd-orchestrator/scripts/orchestrator.py store-commit --path <the PRD file>
  ```
- **Check the context has PRDs switched on:** `features.prd` in `workbench/contexts/<ctx>.json`. If it is
  `false`, tell Chris the PRD will not show on the board until it is flipped. Do not flip it silently.


⛔ **Do not write the PRD until the readiness gate in step 4 is green.** The whole point of this skill
is that the document is written *after* understanding is complete, not as a way of discovering what is
missing.

Read [AGENTS.md](../../../AGENTS.md) for stack and conventions, and
[docs/ai/index.md](../../../docs/ai/index.md) for how the knowledge catalog is organised, before writing.

---

## Before you write

### 0. Intake — what did you just get handed?

Disambiguate `$ARGUMENTS`:

| Argument looks like | Treat it as |
|---|---|
| Bare number, `?workitem=<id>`, or `/_workitems/edit/<id>` | An **ADO work item** — fetch it |
| A `figma.com/…` URL | A **design**, with no ticket. Run step 0.5, then source the requirements from the conversation |
| A Jira key `[A-Z][A-Z0-9]+-\d+` (e.g. `ISI-4096`) or a `…atlassian.net/browse/<KEY>` URL | A **Jira issue** — fetch it read-only |
| Anything else | The **output filename**; source the requirements from the conversation |
| Nothing | Source the requirements from the conversation |

**For an ADO work item:**

```bash
S=.claude/skills/azure-devops/scripts/ado.mjs
node $S fetch <url|id> > "$SCRATCH/wi-<id>.json"
```

Read **the whole thing, not just the description.** Comments frequently hold the actual requirement
that never made it into the body, and `relations` names the parent Feature and sibling stories that
belong in scope and dependencies.

If the token is not set up, point the user at [.claude/README.md](../../README.md) rather than
re-explaining it. Setup is in [azure-devops](../azure-devops/SKILL.md).

**For a Jira issue:**

```bash
bash <wiki>/.claude/skills/jira-connector/scripts/jira-api.sh get <KEY>
bash <wiki>/.claude/skills/jira-connector/scripts/jira-api.sh search "issue in linkedIssues(<KEY>)"
bash <wiki>/.claude/skills/jira-connector/scripts/jira-api.sh search "parent = <KEY>"
```

When launched from Workbench, use the absolute path in the prompt's `Fetch it first:` line.
`get` shows only the **last 5 comments**; the full thread is in Jira. Ask Chris if earlier comments
matter. Read linked issues and sub-tasks as scope evidence. Route by `issuetype` through the table
below: Story/Task/Bug → User Story / Bug; Epic → Epic.

**Read-only:** use only `get`, `search`, `transitions` — never `comment`, `transition`, `update`,
`assign`, `label` or `create`; never write to Jira.

**Route by `System.WorkItemType`:**

| Type | Do this |
|---|---|
| **Feature** | Proceed. Also run `node $S children <id>` — the existing breakdown is scope evidence, and children that are `Removed`/`Closed` are dead. Never carry a `Removed` child into scope as if it were planned |
| **Epic** | Proceed, but say plainly if it spans several Features — that is usually too broad for one PRD, and splitting it is the better call |
| **User Story / Bug** | ⚠️ **Warn before proceeding.** A story or bug is normally already scoped; a PRD is a scoping artefact. Say so, and offer [`/plan-feature`](../plan-feature/SKILL.md) as the lighter path. **Proceed if the user still wants one** — the call is theirs |
| Anything else | Report the type and confirm the shape before continuing |

If the ticket carries the `<!-- rbcs-refined -->` sentinel it has already been through
`/refine-devops-ticket`, and much of step 2 will already be answered in the body. Use it; do not redo it.

### 0.5 Design intake — scan for a Figma link before anything else

⛔ **Always run this scan.** It costs one `grep` and it changes the shape of the whole PRD when it hits.

Scan the fetched work item — description, `ReproSteps`, `AcceptanceCriteria`, **its comments**, and its
`relations` (a design is often a `rel: "Hyperlink"`, not inline text) — plus the conversation so far:

```bash
grep -oE 'figma\.com/(file|design|proto|board|slides|deck|make)/[A-Za-z0-9]+[^"<> )]*' \
  "$SCRATCH/wi-<id>.json" | sort -u
```

Remember ADO rich-text fields are HTML, so `&node-id=` arrives as `&amp;node-id=` — un-escape before
parsing or you lose the frame.

| Result | Do this |
|---|---|
| **A link is found** | **Invoke [`figma-extractor`](../figma-extractor/SKILL.md) and follow it.** It pulls the frames, reconciles them against the route inventory, and returns the design contract that becomes §7 |
| **No link, and the work has a screen** | ⚠️ **Not a silent pass.** Ask the user whether a design exists. If none does, say so in §7 in one line, so a later reader knows the UI was specified in prose deliberately |
| **No link, and the work has no UI** | Nothing to do. Omit §7 |

⛔ **When a design is found, it is the primary source of truth for *what to build* — the screens, the
states, the behaviour, the use cases — and it outranks the ticket's prose wherever the two disagree.**
The ticket records what someone *wanted*; the design is what was actually drawn and reviewed. So
**analyse the frames first and in depth, before you lean on the description or acceptance criteria**,
and let that analysis drive the rest of the PRD: the functionality in §5, the user stories and use
cases in §6, and — above all — **the grilling questions in step 4**. A frame that is silent on a state,
or shows two conflicting variants, is not a detail to smooth over in prose; it is the most valuable
grilling question you have. Where the ticket and the design conflict, **the design wins and you record
the conflict as an Open Question for the owner to reconcile** — never silently follow the ticket.

**Why this is a gate and not a nicety:** a PRD that specifies a screen in prose while a Figma frame
already answers it produces two competing specifications, and the implementer will find the frame
after the plan is written. Resolving it here costs one question; resolving it later costs a re-plan.

⛔ **Never write UI requirements from a design you did not pull.** If the link is unreachable — no MCP
approval, a `403`, a FigJam board — record it and route every design question to Open Questions with an
owner. `figma-extractor` has the degradation ladder. An imagined frame reads exactly like a real one.

### 1. Answer the stack question — this is load-bearing

State the stack the repo's migration doc names, which stack owns writes, and the actual rendering layer for any screen; cite the repo's architecture/migration documentation.

### 2. Ground requirements in the repo catalog

Resolve facts before asking the user. Read the glossary, migration status, matching domain doc, rendering/route inventory, feature map, known-issues and tech-debt docs named by `[knowledge]` and AGENTS.md. Stop when the answer is found; verify docs against changed code where stale.
Label historical/product claims `[spec]`, `[observed]` or `[legacy]` with a source; never silently treat them as current requirements.

### 3. Build the readiness checklist

List what is still unresolved, split by **who can answer it**. This is the whole design of the skill:
facts are yours to find, decisions are the user's to make.

| PRD section | Who answers |
|---|---|
| §4 Stack decision | ⛔ **You.** Repo migration and rendering docs. Never ask |
| §7 Design contract — what each frame shows, and target vs today | ⛔ **You**, from the *pulled* design + `### Route inventory`. Never ask the user to describe a frame |
| §8 Patterns, affected projects | ⛔ **You.** Repo feature map + domain doc. Never ask |
| §9 Data, DbContext, migrations | ⛔ **You.** Domain doc + data-layer standard. Never ask |
| Terminology | ⛔ **You.** GLOSSARY.md. Never ask |
| §5 Scope — what is in | **User** |
| §5 Scope — what is out, and why deferred | **User** |
| §7 Which frames are in scope — when the link carries no `node-id` | **User** |
| §7 A state the design is silent on — empty, loading, error, permission-denied | **User** |
| §7 Which frame is current, where the canvas holds conflicting variants | **User** |
| §13 Success criteria — what "done" means | **User** |
| §3 Who this is for, and their priority | **User** |
| §15 Phasing, if more than one phase | **User** |
| §17 Risk appetite where a trade-off exists | **User** |
| Behaviour at an edge case the ticket left silent | **User** |

Anything a file read or a doc would answer, **look it up.** Asking the user a question the repo already
answers wastes their time and teaches them the skill is not paying attention.

### 4. Grill — the gate

**If any *user* row above is unresolved, invoke the [`grilling`](../grilling/SKILL.md) skill and follow
it.** One question at a time, each with your recommended answer, waiting for the reply before the next.
Asking several at once is bewildering and produces rubber-stamped answers.

If analysis resolved everything, **say so and skip straight to writing.** Grilling for its own sake is
as much a failure as skipping it.

**For UI work, mine the pulled design for your questions before anything else.** The frames are the
source of truth (step 0.5), so the questions worth asking are the ones the design *leaves open* —
a silent state (empty, loading, error, permission-denied), two conflicting variants on the canvas, an
interaction the frames imply but do not fully specify, or a place the ticket's prose contradicts what
was drawn. Ask those first; a question the frames already answer should never reach the user.

**The gate — every row must be one of:**

- ✅ **Resolved** from the docs or the code, with the source noted
- ✅ **Answered** by the user during grilling
- ✅ **Recorded** as an explicit **Open Question** in the PRD

⛔ **Never convert a deferral into a silent assumption.** If the user defers or cannot answer, it goes
into the PRD's Open Questions section under their name — it does not become a quiet `[ASSUMPTION]` in a
requirement, and it never becomes an unmarked sentence that reads like agreed scope.

⛔ **The design sub-gate, for anything with a screen.** The gate is not green until one of these is
true, and the PRD says which:

- ✅ A design was **pulled**, and §7 names the frames with their node ids
- ✅ A link exists but was **unreachable** — recorded, with the reason, and every design question in
  Open Questions
- ✅ **No design exists**, stated as a deliberate choice in §7

"There is a Figma link in the ticket and I described the screen in prose" is **not** one of them.

When the gate is green, **state that it is**, summarise the decisions captured, and then write. If the
user has not confirmed you have reached shared understanding, you have not — grilling's own rule is
*"do not act on it until I confirm."*

---

## PRD structure

Adapt depth to what the work warrants. A PRD for a small change does not need nineteen sections;
**1, 4, 5, 10, 11, 12, 13 and 18** are the ones that always earn their place, plus **7** for anything
with a screen.

```markdown
---
type: PRD
title: <Feature> — PRD
description: >-
  <One sentence, written to be read out of context — this is what agents grep>
status: draft
work_item: 12345                                    # omit if there is no ticket
work_item_url: https://dev.azure.com/rbcontrolsystems/Product/_workitems/edit/12345
work_item_type: Feature
feature: 12300                                       # ⛔ the parent Feature id — the grouping key
prd: 1                                               # ⛔ this PRD's order within the Feature
stories: [12345, 12346]                              # the story ids this PRD covers (optional)
---
```

The `work_item*` fields are the **only** link between the PRD and the ticket, and it points one way.
Nothing is written back to ADO. They are optional and unenforced by the validator — include them
whenever a ticket exists, so a later reader can get from the PRD to the source.

⛔ **`feature` and `prd` are load-bearing metadata, not decoration.** They are the machine-readable
grouping the PRD tracker reads: `feature` folds every PRD of one Feature together, and `prd` is the
ordinal a plan cites to attach itself to this PRD's phases. Set `feature` to the parent Feature id
(or, for a standalone PRD with no Feature, to the PRD's own work-item id), and `prd` to its position
in the Feature's PRD sequence — the order the grouping investigation lays out. Match the filename:
`<ctx>/<feature>/prds/prd-<prd>-<slug>.md` in the store.

**1. Executive summary** — 2–3 paragraphs. Value proposition. MVP goal statement.

**2. Mission** — the outcome this serves, and 3–5 principles constraining how.

**3. Target users** — personas, technical comfort, needs and pain points. Name the project role or
permission where one applies.

**4. Stack decision** ⛔ **Required.**
- State the stack the repo's migration doc names, cited to that doc
- Identify which layer owns writes and the actual rendering stack before/after
- Name any project-reference risk against the repo's boundary standard

**5. Scope**
- **In scope:** ✅ checkboxes, grouped (core functionality, data, integration, deployment)
- **Out of scope:** ❌ checkboxes, with a word on why deferred

**6. User stories** — 5–8, as "As a [user], I want to [action], so that [benefit]", each with a
concrete example. Add technical stories where they carry real requirements.

**7. Design contract** ⛔ **Required for anything with a screen.**

Produced by [`figma-extractor`](../figma-extractor/SKILL.md) in step 0.5 — paste its block here. It carries
the source link and file key, the pull date, coverage, and this table:

| Frame | node-id | Screen / route | Today | Target | States in the design |
|---|---|---|---|---|---|
| Cash Register — PO entry | `412:1180` | `/cash-register` | alternate rendering layer | React port | default, validation error, disabled |

Plus **Tokens**, **Deviations** (where the design cannot be built as drawn, and what ships instead) and
**Not answered by the design** — each of the last routed to §18 with an owner.

⛔ **Every design claim cites a node id.** "The design shows a disabled state" is unverifiable;
`412:1180 shows a disabled state` can be checked by the next reader.

**Where there is no design**, this section is one honest line — *"No Figma design exists; the screen is
specified in prose in §6, agreed with \<name\> on \<date\>"* — not an omission. Where the link was
unreachable, say so and point at §18.

**8. Architecture & patterns**
- Which projects change, and the layering each must respect
- The exemplar each new component mirrors — **verified live**, not assumed (see the warning below)
- Tenant scoping, auth and permissions

**9. Data & tenancy** (where data changes)
- Identify the schema/migration owner, scope filters, query shape and indexes from repo documentation.

**10. Technology stack** — actual projects and versions from repo manifests and migration docs.

**11. Security & configuration** — auth, permissions, config sources and explicit exclusions.
No hardcoded connection strings, credentials, tokens or scope identifiers.

**12. API specification** (if applicable) — endpoints, request/response shapes, auth requirements,
example payloads.

**13. Success criteria** — MVP definition, functional requirements as ✅ checkboxes, quality
indicators. Measurable, not aspirational. For UI work, tie these to the §7 frames rather than to prose
— "matches `412:1180` including the disabled state" is checkable; "looks like the design" is not.

**14. Validation plan** — real, runnable commands only. Do not invent scripts.

Copy `[validation].levels` from `.claude/orchestrator.toml` verbatim, in declared order with each `expect`.
Add each `[boundary_checks]` command and baseline. Over baseline means fix code, never inflate the baseline.
If a needed level is missing, record the config gap for the owner; do not invent a command.
Use the repo testing standard's trait/filter rule and confirm new tests appear in the run.

### Writing a validation command that actually works

⛔ **Run every command you put in the table, before the PRD is written, and record what it printed.**
A gate you have not executed is a guess. This is the single rule that prevents the rest.

**A gate must not depend on git staging state.** Bare `git diff` compares the worktree to the *index*,
so it prints nothing once work is staged or committed, and it never sees a new untracked file at all.
A gate written that way passes silently at exactly the moment it is asked to do its job — and "new
file" is the case that usually matters. Prefer a **whole-tree scan compared to a baseline count**
recorded in the PRD. If a diff genuinely is the right tool, scope it to committed work:
`git diff origin/main...HEAD -- <paths>`.

**State an expected value, never "no hits".** `grep` exits `0` when it *finds* something and `1` when
it does not, so "no hits" is a failing exit code that will abort any `set -e` script. Use `grep -c` or
`wc -l` and compare against a number.

**Baseline counts beat prohibitions** for "do not make it worse" rules. A number is checkable today,
tells the reader what the debt currently is, and cannot silently pass.

**Write for zsh** — it is the shell in this environment. Quote every glob (`--include="*.cs"`, not
`--include=*.cs`, which zsh fails to expand and errors on), and never rely on word-splitting an
unquoted variable, which zsh does not do. Pass paths explicitly.

**Cite only scripts you have confirmed exist** — check `package.json` rather than assuming a
conventional name.

**A gate must be able to fail.** If you cannot say what a failure looks like, it is not a gate.

**15. Implementation phases** — sized by **session**, not by count. Each carries a goal, deliverables
(✅), the validation levels that gate it, acceptance criteria, and **`Depends on:` — the earlier phase
that must land first, or `none`.**

⛔ **Most phases depend on nothing, and say so.** Phases in one PRD are often genuinely independent —
a UI phase, a backend phase, a migration, sometimes in different areas or different stacks of the same
app. Adjacency is not dependency. Record one only where a phase literally cannot be built until another
has landed. An orchestrated run reads this field to decide what it can keep building when a phase
fails, so a fabricated chain needlessly stalls work that was never blocked.

**For UI work, every phase names the §7 frames it delivers.** A phase that delivers part of a frame is
not a phase — the frame is the reviewable unit, because "is this done?" is answered by comparing the
screen to the design. ⛔ **A design with nine frames is not nine phases.** Group frames that share a
component or a data path into one session-sized phase, and apply the merge and green tests below
exactly as for any other work.

⛔ **The unit of a phase is one working session.** A phase is the largest coherent slice one agent can
carry from the first edit to a green validation run without a handoff — roughly **80% of a context
window, and never planned past it** — the ceiling exists so the agent never has to **compact** mid-phase,
because a compaction mid-build is exactly where context (and correctness) is lost. Under that ceiling, bigger wins: every extra phase costs a review
gate, a re-orientation and a context reload, and a phase that buys none of those back is pure overhead.

⛔ **There is no minimum, so never slice to hit a number.** A small change is **one phase** — say so and
move on. Padding a one-sitting change into three phases is the most common way this section goes wrong,
and it makes the PRD worse than having no phases at all: the implementer pays the ceremony and gets
nothing back. [`/plan-feature`](../plan-feature/SKILL.md) and [`/execute`](../execute/SKILL.md) inherit
these boundaries directly, so a bad split here is re-paid at every downstream step.

Nobody can count tokens in advance, so size on the proxies you can actually see. **Heuristics, not
thresholds** — one dense file can be a session, and ten trivial ones may not be:

| Signal | Too small — merge it | About right | Too big — split it |
|---|---|---|---|
| Files changed | 1–2 | ~3–10 | 15+ |
| Deliverables | a single one | 3–6 | can't list them in six bullets |
| Validation | nothing meaningful to run yet | ends on a green run of its own gates | needs a "we validate this next phase" |
| Standing alone | builds, but demonstrates nothing | a slice someone could review and merge | too large to review in one sitting |

Two tests before committing to a split:

- **The merge test.** If two adjacent phases would be worked in the same sitting, and the first has no
  independent reason to be reviewed, they are **one** phase.
- **The green test.** Every phase ends with the build green and its own validation levels passing. A
  phase that ends red, or defers its validation, is a task *inside* a phase — not a phase.

**16. Future considerations** — post-MVP enhancements and integration opportunities.

**17. Risks & mitigations** — 3–5, specific. In this repo the recurring ones are worth checking
against: wrong stack assumption, a screen scoped against the wrong rendering layer, a pattern copied from dead code,
a test that never runs in CI, and a design that moved after §7 was pulled.

**18. Open questions** ⛔ **Required whenever the readiness gate produced one.**

Everything the user deferred or could not answer, one line each, with **who owns it** and **what it
blocks**. This section is the reason the gate can be honest — an unresolved decision has somewhere to
go that is not a silent assumption buried in a requirement.

```markdown
- **Should partial refunds reopen the original order?** — Owner: <name>. Blocks §5 scope and the
  §15 phase 2 boundary. Deferred 2026-08-04 pending finance sign-off.
- **What does the PO-entry field show while the lookup is in flight?** — Owner: <designer>. Frame
  `412:1180` shows no loading state. Blocks §7 and the §15 phase 1 acceptance.
```

Delete the section only if it is genuinely empty. An empty Open Questions section on a large PRD is
usually a sign the grilling stopped early.

**19. Appendix** (if applicable) — related docs, dependencies, source work item and its parent. Include
the Figma file key and frame list where §7 exists, so the design is findable after the link rots.

---

## The traps a PRD must not walk into

⛔ Verify an exemplar is live by grepping for the interface the repo's standards name, then confirming its registration/call path.
Follow documented interface signatures and verify validation actually runs.
Map business names through the glossary; confirm the rendering stack from route/migration docs before scoping a UI edit.

---

## Quality checks

- ✅ Stack decision present and cited
- ✅ **Step 0.5 was run** — the ticket and conversation were scanned for a Figma link
- ✅ **§7 present for any screen**, with node ids, coverage, deviations — or an explicit "no design exists"
- ✅ Every validation command is real and runnable
- ✅ Terms checked against GLOSSARY.md
- ✅ Every pattern reference verified live
- ✅ User stories have clear benefits; scope is realistic
- ✅ Phases are session-sized — each ends green, and none exists only to fill the template
- ✅ Phases are actionable; success criteria are measurable
- ✅ **The gap pass ran over §15** (multi-phase PRDs) and every finding was fixed, routed to §18, or
  consciously absorbed
- ✅ Assumptions flagged as assumptions
- ✅ Readiness gate was green before writing started
- ✅ Every deferral is an Open Question with an owner — none became a silent assumption
- ✅ `work_item*` frontmatter present if the PRD came from a ticket
- ✅ Nothing was written to Azure DevOps

## Red flags

- A ticket PRD saved anywhere but the store's `.planning/<ctx>/<feature>/prds/` — above all, into a team
  repo's `docs/ai/` (see *Where the PRD is saved*)
- A PRD that **no My Work row can list**: in a context store with no `work_item:`/`stories:` and no `branch:`, a
  branch PRD whose worktree doesn't exist yet, or wiki-only work filed under `.planning/<ctx>/` — it shows on the
  PRDs page and can never be orchestrated

- Writing the PRD before the readiness gate is green
- Grilling the user on the stack, the affected files, or a term GLOSSARY.md defines
- A deferred decision that appears in the body as settled scope
- Scope carried from a `Removed` child of a Feature
- Calling a screen editable target stack without checking `### Route inventory`
- **A Figma link in the ticket that the PRD never mentions** — the whole point of step 0.5
- **UI requirements written in prose while a design existed**, producing two competing specifications
- **Following the ticket's prose where it conflicts with a pulled design** — the design is the source
  of truth; the conflict is an Open Question for the owner, not the ticket's win by default
- **Grilling questions that ignore the design** — for UI work they should come first from what the
  frames leave open, not from the ticket's prose (step 4)
- **Describing a frame that was never pulled** — from the ticket's prose, the file name, or a prototype
- Asking the user what a frame shows, when it was pulled and you can read it
- An unlabeled `product/` or `legacy/` claim presented as current behaviour
- Slicing a one-sitting change into three phases because the template seemed to ask for three
- A phase whose only deliverable is one file, or whose validation is deferred to the phase after it
- Any `ado.mjs update` call — this skill never writes to ADO

---

## After writing

1. **Stress the phases — the gap pass.** With §15 written, spawn one `general-purpose` subagent
   (`sonnet`, medium) with the Gap Analyst prompt from
   [`prd-orchestrator/reference/gap-pass.md`](../prd-orchestrator/reference/gap-pass.md), feeding it §15
   verbatim plus §7 and §12 where they exist. It checks what grilling cannot: does phase 1's deliverable
   shape match what phase 3 consumes, is a dependency missing from `Depends on:` (or declared where
   there is only adjacency), where would two reasonable implementors choose differently, what happens
   on empty input, does each phase's validation level actually exercise its deliverable. Then, for each
   finding, do one of three things — and say which in the PRD:
   - **fix the phase** (tighten the deliverable, add the state, correct `Depends on:`);
   - **route it to §18** as an Open Question with an owner, when it is a decision only a human can make;
   - **absorb it**, when a planner reading the code will settle it in under two minutes — then it is
     not worth a line.

   **0–6 findings is the normal range; zero on a PRD of unrelated phases is a correct result.** This
   is the cheapest place to catch an inter-phase question: here it costs a sentence; in an orchestrated
   run the same question costs a planner most of a phase's tokens (measured 61% on PRD-11) to discover
   on its own. Skip the pass only for a single-phase PRD — there is nothing to check across.
2. Commit it to the wiki with `store-commit --path <file>` (see *Where the PRD is saved*). **Act on any
   WARNING or NOTE it prints**, then confirm the PRD is on My Work: `curl -s http://localhost:<port>/api/prds`
   shows a non-null `itemKey` for it (and no `unattached`). A PRD that isn't on a row cannot be orchestrated.
3. Confirm the file path, summarise the contents, and **call out every assumption made to fill a gap**
4. Restate the **Open Questions** and who owns each — they are the reason the PRD is honest, and they
   are easy to lose between the file and the conversation
5. Suggest next step — usually `/plan-feature` against this PRD

**Lifecycle:** `status: draft` while being agreed → `stable` once accepted → **`deprecated` once the
work ships.** Deprecate rather than delete: the reasoning stays available and the file stops looking
like pending work.

---

## Related

- `figma-extractor` — invoked by step 0.5 whenever a Figma link is found; pulls the frames and returns §7
- `/grilling` — the interview this skill's gate invokes; one question at a time, no acting until confirmed
- `/prime` — load context and confirm the phase before writing a PRD
- `/plan-feature` — turn this PRD into an ordered implementation plan
- `/execute` — implement the approved plan and run every validation level

**Versus [`/refine-devops-ticket`](../refine-devops-ticket/SKILL.md).** Both start from a work item and
both grill. They differ in who they serve and what they leave behind:

| | `/refine-devops-ticket` | `/create-prd` |
|---|---|---|
| For | The product person | Engineering |
| Produces | A better **ticket** | A **PRD** in the wiki store (`.planning/<ctx>/<feature>/prds/`) |
| Writes to ADO | **Yes**, after approval | **Never** |
| Bar | A fresh agent can name the files to change | The work's scope, stack and success criteria are agreed |

They overlap deliberately — the intake steps are similar and that duplication is accepted, so each can
change without breaking the other. Running refine first is not required, but a ticket carrying
`<!-- rbcs-refined -->` makes this skill's step 2 much cheaper.

**If this conversation already settled what to build** and the only thing missing is a ticket to track
it — not a scoping document — that's [`/create-devops-ticket`](../create-devops-ticket/SKILL.md)
instead. It writes straight to ADO and skips the readiness gate above, because the gate's job (agreeing
scope) is the precondition for calling it, not something it does itself.
