# RBCloud — repo knowledge extracted from the skills

This content used to be hardcoded inside `execute/SKILL.md` and `plan-feature/SKILL.md`,
which made both skills unusable on any other repo. It belongs in RBCloud's own `AGENTS.md`
and `.claude/standards/*.md`; it is preserved here so nothing is lost in the extraction.
The machine-readable half is in `orchestrator.toml` beside this file.

> **Paths and file references below are RBCloud's own** — they resolve inside that repo,
> not in this skill tree. They are recorded verbatim so nothing was lost in the extraction.

## Stack corrections (from execute §1)

with the target before writing anything.

**b. Implement** — follow the task specification exactly.

- Follow the conventions in the standards guide for that layer, **not the neighbouring file**
- The mediator is hand-written, in `RBCS.Shared.Library/Mediator/` — **not MediatR**.
  `IRequestHandler.Handle` takes **one parameter and no `CancellationToken`**. Do not thread one through
- `await`. Never `.Result`, `.Wait()`, `GetAwaiter().GetResult()`, or `async void` outside an event handler
- Throw the specific exception type. Never swallow an exception, and never wrap everything in
  `ApplicationException` — it erases what the caller needs to respond correctly
- Fail loudly on missing required context. **Defaulting a missing tenant to `0` is not error handling**

## Testing conventions (from execute §3)

## 3. Implement the testing strategy

- Create every test file the plan specifies, and implement every case
- ⛔ **Every .NET test needs `[Trait("Category", "Unit")]`.** CI runs
  `dotnet test --filter "Category=Unit"`, and the trait is applied **at class level** — a class that
  omits it takes all its tests with it. 94 tests across 13 files are invisible today for exactly this
  reason. Without it your test compiles, passes locally, and never runs in the pipeline
- Naming: `_Tests.cs` in `RBCS.UnitTests` and `RBCS.Shared.Library.Tests`; `Tests.cs` everywhere else
- Cover the edge cases the plan lists

---


## The boundary level (from execute §4) — now `[boundary_checks]` in orchestrator.toml

### The boundary level — required for any change touching `.csproj` or adding `using` directives

**These count the whole tree and compare to a baseline. They do not read the diff** — a `git diff`
form was used here previously and was unsound: bare `git diff` compares the worktree to the index, so
it goes silent as soon as work is staged or committed, and it never sees a new untracked file at all.
A new DTO is exactly how this violation grows, so the old check could not catch the one case that
matters.

```bash
# 5a — cross-stack ProjectReference. Baseline: 3 (the three documented violations)
grep -rh "ProjectReference" \
  src/RBCS.Api src/RBCS.Api.Application src/RBCS.Api.Infrastructure \
  src/RBCS.AZFunctions src/RBCS.Multitenant --include="*.csproj" \
  | grep -cE "RBCS\.(Core|Application|EntityFrameworkCore|Migrator|Reports|Web\.Core|Web\.Mvc)\.csproj"

# 5b — ABP usings inside non-ABP projects. Baseline: 10 files
grep -rl "using RBCS\.\(Core\|Application\)" \
  src/RBCS.Api src/RBCS.Api.Application src/RBCS.Api.Infrastructure \
  src/RBCS.AZFunctions src/RBCS.Multitenant --include="*.cs" | wc -l
```

**Gate: `3` and `10`.** Any higher number means your change grew a boundary violation — run the `-rl`
form without `wc` to see which file. `RBCS.Api.Application` → `RBCS.Core` has already been extended
nine times by exactly this route, a new Inventory DTO copying `using RBCS.Core.AuditLog;` from the
last one. **Stop and raise it; do not note it and continue.** See
`rbcs-project-references`.

If a baseline number is wrong because the debt legitimately changed, correct it here and in
`plan-feature` and `create-prd` — all three carry
the same numbers.


## Running the app (from execute §4) — now `[app]` in orchestrator.toml

### UI features — end-to-end validation is mandatory

**Visual confirmation alone is insufficient.** You must test the complete user workflow.

Start the app — .NET Aspire is preferred:

```bash
cd Aspire/RBCloud.AppHost && dotnet run    # gateway at http://localhost:5000
```

Without Aspire: MVC `https://localhost:55984`, API `https://localhost:64306` (Swagger at `/swagger`),
React `http://localhost:64824`. Seeded login: `admin` / `123qwe`.

**First, confirm what you are actually testing.** 46 of 63 React routes are iframe wrappers over the MVC
app — see `frontend-shell.md`. If the route under
test is an iframe, the change lives in MVC and the React shell will look correct whether or not the
change worked.

**Then complete the full action sequence:**

- Fill every form field with valid data, click submit, and **verify the intended outcome occurs** — data
  saved, page navigated, confirmation shown
- Do not stop at verifying elements exist. Actually use them
- Check for errors: error messages in the response, HTTP 4xx/5xx, browser console errors, validation
  failures. **If ANY error occurs, the feature is not complete** — enter the fix-retry loop
- Verify dynamic content renders, not just that it is present in the HTML: counters showing real
  numbers, dropdowns showing options, defaults displayed

Playwright specs live in `test/Automation.Tests` — add or extend one there rather than validating by
hand where a spec is reasonable:

```bash
cd test/Automation.Tests
npm run test:local            # full local suite
npm run test:local:smoke      # @smoke-tagged only
npm run test:local:headed     # watch it run
```

**Do NOT stop after the build succeeds** — continue through every level.

---


## Codebase docs and the stack question (from plan-feature §2a)

⛔ **`docs/ai/` exists so you do not have to grep.** `src/` is large, part-dead and mid-migration. Read
the catalog first and use code reading to *confirm* what it tells you, not to discover it.

### 2a. The stack question — always first

Read `MIGRATION-STATUS.md` and **state in the plan whether
this is ABP or non-ABP work, and which stack owns the writes.** Most write paths are still ABP.

For anything with a screen, read
`frontend-shell.md`. 46 of 63 React routes are
iframe wrappers over the MVC app — "modernise screen X" is usually a port from scratch, not an edit.

Getting this wrong is the single most common way work here gets mis-scoped.

**If the PRD has a §7 Design contract, carry it into the plan** — the frames, their node ids and the
deviations become context under the task that builds each screen. Do not re-pull what the PRD already
resolved.

**If there is no PRD and a Figma link appears** in the request, the ticket or the conversation, invoke
``/figma-design`` before planning any UI task. A plan that specifies a screen
in prose while a frame already answers it will be re-planned once someone finds the frame. ⛔ **Never
write a UI task from a design you did not pull.**

### 2b. The files

`FEATURE-MAP.md` resolves a route or screen name through
component → service → endpoint → handler → repository, and its reverse-lookup table goes the other way.
**Use it instead of grepping blind.**

Check the docs are not stale before relying on them — each carries a `last_verified` SHA and the
`paths` it covers, so `git diff --stat <last_verified>..origin/main -- <paths>` says whether the code
underneath it has moved.

A stale doc is still the best information available — it means confirming its claims about the changed
paths against code. Note in the plan which claims you re-verified.


## Standards routing table (from plan-feature §2c)


The standards guides say which patterns are current — read the one for every layer the work touches:

| Layer touched | Guide |
|---|---|
| Anything | `rbcs-clean-code` |
| API controller, CQRS handler, validator | `rbcs-api` |
| Repository, EF query, DbContext, migration | `rbcs-infra` |
| React component, view, route, API service | `rbcs-frontend` |
| Any test | `rbcs-testing` |
| `.csproj`, solution, cross-project reference | `rbcs-project-references` |
| Terraform, pipelines, environments | `rbcs-terraform` |

Each carries a *patterns you will see — do NOT copy* table. Lift the relevant rows into the plan's
**Traps** section so the executing agent does not have to find them.

### 2d. Naming

Check every business term against `GLOSSARY.md` before using it.
The UI, the code and the database disagree often enough that guessing is unsafe. `Propel` is the
go-to-market name and appears in **no source file** — never use it as a search term.

### 2e. Testing patterns

- xUnit for .NET; Vitest for React; Playwright in `test/Automation.Tests`
- ⛔ **Every .NET test needs `[Trait("Category", "Unit")]`.** CI runs `--filter "Category=Unit"`, and the
  trait is applied **at class level** — a class that omits it takes all its tests with it. 94 tests
  across 13 files are invisible today for exactly this reason.
- Naming: `_Tests.cs` in `RBCS.UnitTests` and `RBCS.Shared.Library.Tests`; `Tests.cs` everywhere else
- Find a real, passing test in the same area to mirror — and verify it actually runs under the filter

### 2f. Integration points and known debt

- Existing files needing updates; new files and where they go
- Endpoint/route registration, DI registration, tenant scoping
- `KNOWN-ISSUES.md` and
  `tech-debt.md` — if the area is listed, the plan must say
  whether this change avoids making it worse or fixes it deliberately

### Clarify ambiguities


## Validation levels (from plan-feature) — now `[validation]` in orchestrator.toml

## VALIDATION COMMANDS

**The executing agent MUST complete every level below, in order, before declaring the feature
complete. A build that compiles is not completion.**

| Level | Command | Gate |
|---|---|---|
| 1 — Build | `dotnet build RBCS.sln --configuration Release` | 0 errors |
| 2 — Unit tests | `dotnet test RBCS.sln --filter "Category=Unit"` | all pass, and the new tests appear in the run |
| 3 — Frontend | `cd src/RBCS.Web.App && npm run build && npm run test:coverage` | build clean, Vitest green |
| 4 — E2E | `cd test/Automation.Tests && npm run test:local` | Playwright green (UI features) |
| 5 — Boundary | see below | counts unchanged: `3` and `10` |
| 6 — Manual | <feature-specific steps> | acceptance criteria met |

**Level 1 note:** do NOT run formatting commands (`dotnet format`, `prettier`) — formatting is optional
here and causes unrelated churn and build failures.

**Level 2 note:** confirm the new tests actually ran. A test without `[Trait("Category", "Unit")]` at
class level passes locally and is silently skipped by the filter.

**Level 5 — the boundary check.** Required for any change touching `.csproj` files or adding `using`
directives. **Whole-tree counts against a baseline, not a diff** — bare `git diff` compares the
worktree to the index, so it goes silent once work is staged or committed and never sees a new
untracked file, which is precisely how this violation grows:

```bash
# 5a — cross-stack ProjectReference. Baseline: 3
grep -rh "ProjectReference" \
  src/RBCS.Api src/RBCS.Api.Application src/RBCS.Api.Infrastructure \
  src/RBCS.AZFunctions src/RBCS.Multitenant --include="*.csproj" \
  | grep -cE "RBCS\.(Core|Application|EntityFrameworkCore|Migrator|Reports|Web\.Core|Web\.Mvc)\.csproj"

# 5b — ABP usings inside non-ABP projects. Baseline: 10 files
grep -rl "using RBCS\.\(Core\|Application\)" \
  src/RBCS.Api src/RBCS.Api.Application src/RBCS.Api.Infrastructure \
  src/RBCS.AZFunctions src/RBCS.Multitenant --include="*.cs" | wc -l
```

A number above `3` or `10` means the change grew a known boundary violation — the
`RBCS.Api.Application` → `RBCS.Core` violation has already been extended nine times by exactly this
route. **Stop and raise it.**

**Running the app**, for manual or E2E validation — .NET Aspire is preferred:

```bash
cd Aspire/RBCloud.AppHost && dotnet run    # gateway at http://localhost:5000
```

Without Aspire: MVC `https://localhost:55984`, API `https://localhost:64306` (Swagger at `/swagger`),
React `http://localhost:64824`. Seeded login: `admin` / `123qwe`.

`npm run lint` exists but **does not run in CI** — say so if the plan includes it.

---

## Moved from execute §1 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

- Note the plan's stack decision — ABP or non-ABP — and keep it in view for the whole run

## Moved from execute §1 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

**Sanity-check the plan before trusting it.** Confirm the pattern references still exist and are live:

```bash
grep -c "IRequestHandler" <cited-exemplar>    # a handler exemplar must implement IRequestHandler<,>
```

Nine handler files in `Commands/` implement no interface and are never invoked. If the plan cites one,
**stop and raise it** — implementing against it produces code that compiles, reviews cleanly, and never
runs.

## Moved from execute §2 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

`IRequestHandler.Handle` takes **one parameter and no `CancellationToken`**. Do not thread one through

## Moved from execute §3 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

- ⛔ **Every .NET test needs `[Trait("Category", "Unit")]`.** CI runs
  a filtered subset, and the marker is applied **at class level** — a class that
  omits it takes all its tests with it. 94 tests across 13 files are invisible today for exactly this
  reason. Without it your test compiles, passes locally, and never runs in the pipeline

## Moved from execute §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

- ✅ New tests carry `[Trait("Category", "Unit")]` and the right file naming

## Moved from execute §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

- ✅ No new hardcoded URL, secret, or `TenantId ?? 0`

## Moved from execute §Output report (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

**confirmation the new tests ran under
`--filter "Category=Unit"`**

## Moved from plan-feature §2c (phase 4, 2026-11)

Target standard: `AGENTS.md`.

⛔ **Do not infer patterns from neighbouring code.** Much of this codebase predates current conventions
and parts of it are dead. **Nine handler files in `Commands/` implement no interface, are never
registered by Scrutor, and are never invoked.** A plan that cites one is a plan defect: the resulting
code compiles, reviews cleanly, and never runs.

**Every pattern reference in the plan must be verified live before you write it down:**

```bash
grep -c "IRequestHandler" <candidate-file>     # a handler exemplar must implement IRequestHandler<,>
```

`Queries/Inventory/GetBarcodeLabelFormatsHandler.cs` is a clean minimal exemplar.

## Moved from plan-feature §2d (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

The UI, the code and the database disagree often enough that guessing is unsafe. `Propel` is the
go-to-market name and appears in **no source file** — never use it as a search term.

## Moved from plan-feature §2e (phase 4, 2026-11)

Target standard: `AGENTS.md`.

- xUnit for .NET; Vitest for React; Playwright in `test/Automation.Tests`
- ⛔ **Every .NET test needs `[Trait("Category", "Unit")]`.** CI runs `--filter "Category=Unit"`, and the
  trait is applied **at class level** — a class that omits it takes all its tests with it. 94 tests
  across 13 files are invisible today for exactly this reason.

## Moved from plan-feature §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

| Frontend | React / MVC / MVC-behind-iframe — cited to frontend-shell.md |

## Moved from plan-feature §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

(**verified**: implements `IRequestHandler<,>`)

## Moved from plan-feature §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

- The mediator is hand-written — `Handle` takes one parameter, **no `CancellationToken`**
- FluentValidation is inert; validators in `Validators/` do not run

## Moved from plan-feature §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

Which test project, which naming convention, and ⛔ the `[Trait("Category", "Unit")]` requirement on
every .NET test.

## Moved from plan-feature §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

- [ ] New .NET tests carry `[Trait("Category", "Unit")]` and appear in the filtered run

## Moved from plan-feature §5 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

- [ ] Tenant scoping correct; no `TenantId ?? 0`

## Moved from create-prd §Where the PRD is saved (phase 4, 2026-11)

Target standard: `AGENTS.md`.

- **The stack, catalog and validation sections in this skill are RBCloud-specific** (ABP, MIGRATION-STATUS, the
  boundary counts). For another repo, use that repo's own AGENTS.md, skills and `package.json` scripts
  instead, and say so in §4.

## Moved from create-prd §1–2 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

**A PRD in this repo that does not name its stack is incomplete.** Read
[MIGRATION-STATUS.md](../../../docs/ai/rbcloud/MIGRATION-STATUS.md) and state whether this is ABP or
non-ABP work and **which stack owns the writes**. Most write paths are still ABP.

For anything with a screen, check
[frontend-shell.md](../../../docs/ai/rbcloud/systems/frontend-shell.md): 46 of 63 React routes are
iframes over MVC, so "modernise screen X" is usually a port from scratch, not an edit. Scoping it as an
edit is the most expensive mistake available here.

### 2. Ground the requirements in the catalog, not in `src/`

⛔ **Every fact you resolve here is a question you do not get to ask the user.** Work in this order and
stop as soon as the answer is found:

1. [GLOSSARY.md](../../../docs/ai/rbcloud/GLOSSARY.md) — the ticket's business terms → code symbols.
   Do this **first**: a ticket saying "revenue center" needs the symbol before anything else is
   searchable. The UI, code and database names differ
2. [MIGRATION-STATUS.md](../../../docs/ai/rbcloud/MIGRATION-STATUS.md) — `## Per-domain status` and
   `## Traps`. Which stack owns the **write** path
3. **The matching domain doc** — each of the eleven carries `## Where to change what`
4. [frontend-shell.md](../../../docs/ai/rbcloud/systems/frontend-shell.md) `### Route inventory` — for
   any UI work, whether the screen is real React, an MVC iframe, or a seed-data prototype.
   **Do not infer from the presence of a `views/*.tsx` file**
5. [FEATURE-MAP.md](../../../docs/ai/rbcloud/FEATURE-MAP.md) — which files the area actually spans
6. [KNOWN-ISSUES.md](../../../docs/ai/KNOWN-ISSUES.md) — the `rbcloud/` bundle is generated, so a
   correction found since the last refresh lives here rather than in the doc it corrects
7. [tech-debt.md](../../../docs/ai/product/specs/tech-debt.md) — whether this area is already listed

`product/` and `legacy/` may inform intent, but **label anything carried from them in the PRD text** —
`[spec]`, `[observed]` or `[legacy]` plus the source doc. An unlabeled claim gets implemented as a
requirement months later by someone with no way to know where it came from.

## Moved from create-prd §3 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

MIGRATION-STATUS.md + frontend-shell.md.

## Moved from create-prd §3 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

FEATURE-MAP.md + the domain doc.

## Moved from create-prd §3 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

The domain doc + `rbcs-infra`.

## Moved from create-prd §9–11 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

**9. Data & tenancy** (where data changes)
- Which `DbContext` — remember `RBCSApiDbContext` owns no migrations and maps 102 existing tables;
  new-stack schema changes still go through the ABP context
- Migration needed? Tenant filtering? Query shape and indexes?

**10. Technology stack** — .NET 8 pinned to `8.0.311`; the specific projects touched; React
+ Vite + TypeScript for `RBCS.Web.App`; xUnit, Vitest, Playwright. Name versions where they matter.

**11. Security & configuration** — authentication and authorisation, config source (Azure App
Configuration at startup, `dotnet user-secrets` locally), and what is explicitly out of security scope.
⛔ No hardcoded connection strings, credentials, tokens or tenant identifiers — the non-ABP projects
are currently clean of these.

## Moved from create-prd §14 (phase 4, 2026-11)

Target standard: `rbcs-project-references.md`.

| Level | Command | Gate |
|---|---|---|
| 1 — Build | `dotnet build RBCS.sln --configuration Release` | 0 errors |
| 2 — Unit tests | `dotnet test RBCS.sln --filter "Category=Unit"` | all pass; new tests carry `[Trait("Category", "Unit")]` |
| 3 — Frontend | `cd src/RBCS.Web.App && npm run build && npm run test:coverage` | build clean, Vitest green |
| 4 — E2E | `cd test/Automation.Tests && npm run test:local` | Playwright green (UI features) |
| 5 — Boundary | see below | counts unchanged: `3` and `10` |
| 6 — Manual | <feature-specific steps> | stated acceptance met |

**Level 5 — the boundary check.** Whole-tree counts against a baseline, matching
[plan-feature](../plan-feature/SKILL.md) and [execute](../execute/SKILL.md):

```bash
# 5a — cross-stack ProjectReference. Baseline: 3
grep -rh "ProjectReference" \
  src/RBCS.Api src/RBCS.Api.Application src/RBCS.Api.Infrastructure \
  src/RBCS.AZFunctions src/RBCS.Multitenant --include="*.csproj" \
  | grep -cE "RBCS\.(Core|Application|EntityFrameworkCore|Migrator|Reports|Web\.Core|Web\.Mvc)\.csproj"

# 5b — ABP usings inside non-ABP projects. Baseline: 10 files
grep -rl "using RBCS\.\(Core\|Application\)" \
  src/RBCS.Api src/RBCS.Api.Application src/RBCS.Api.Infrastructure \
  src/RBCS.AZFunctions src/RBCS.Multitenant --include="*.cs" | wc -l
```

`npm run lint` exists but **does not run in CI** — say so if you include it. In `RBCS.Web.App`,
`npm run test` is bare `vitest` — **watch mode, which never exits**. Always cite `test:coverage`.

## Moved from create-prd §The traps a PRD must not walk into (phase 4, 2026-11)

Target standard: `AGENTS.md`.

⛔ **Do not cite a pattern you have not verified is live.** Nine handler files in `Commands/` implement
no interface, are never registered by Scrutor, and are never invoked. A PRD that points at one sends the
plan and the implementation after dead code. `grep -c "IRequestHandler" <file>` settles it.

⛔ **The mediator is hand-written**, in `RBCS.Shared.Library/Mediator/` — not MediatR.
`IRequestHandler.Handle` takes **one parameter and no `CancellationToken`**. Do not spec one.

⛔ **FluentValidation is present but inert.** `ValidationBehavior` is registered; no `IValidator<T>` is.
A PRD requiring validation must say how it will actually run.

⛔ **`Propel` is the go-to-market name and appears in no source file.** Use it in user-facing prose;
never as a search term or a code identifier.

⛔ **A polished Figma frame is not evidence the screen is editable React.** The design says nothing
about which stack renders it, and 46 of 63 routes are iframes over MVC. Check `### Route inventory`
before writing a single target-state sentence in §7.

---

## Moved from create-prd §17 (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

wrong stack assumption, an iframe screen scoped as an edit, a pattern copied from dead code,

## Moved from create-prd §remaining references (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

MVC iframe

## Moved from create-prd §remaining references (phase 4, 2026-11)

Target standard: `rbcs-clean-code.md`.

editable React

## Moved from prime §1–2 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

1. [AGENTS.md](../../../AGENTS.md) — the stack corrections, the naming traps, the standards table, the commands
2. [docs/ai/index.md](../../../docs/ai/index.md) — what the three knowledge bundles are and which one to trust
3. [docs/ai/KNOWN-ISSUES.md](../../../docs/ai/KNOWN-ISSUES.md) — verified defects and places two docs disagree

Then, to see what else exists without opening files:

```bash
grep -A2 '^description:' docs/ai/*/*.md docs/ai/*/*/*.md
```

**Cost discipline: the index plus one or two docs.** Not a whole bundle, and not "to be safe" — the
point is to replace exploration, not add to it.

### 2. Fix the four things that get mis-scoped

State each of these back explicitly in your summary. Getting them wrong costs more than everything else
in this skill combined:

| Question | Where the answer lives |
|---|---|
| **Which stack owns the writes here — ABP or non-ABP?** | [MIGRATION-STATUS.md](../../../docs/ai/rbcloud/MIGRATION-STATUS.md) |
| **Is this screen React or an iframe over MVC?** | [frontend-shell.md](../../../docs/ai/rbcloud/systems/frontend-shell.md) — 46 of 63 routes are iframes |
| **Which files does this area actually touch?** | [FEATURE-MAP.md](../../../docs/ai/rbcloud/FEATURE-MAP.md) — route → component → endpoint → handler → repository |
| **What does this business term mean in code?** | [GLOSSARY.md](../../../docs/ai/rbcloud/GLOSSARY.md) — the UI, the code and the database disagree often enough that guessing is unsafe |

Carry the corrections from AGENTS.md into your reading rather than re-deriving them: the mediator is
hand-written (not MediatR) and `Handle` takes one parameter and no `CancellationToken`; FluentValidation
is registered but inert; `RBCS.Core` is ABP despite the name; `RBCSApiDbContext` owns no migrations;
`Propel` appears in no source file; `MVC` means current in-repo screens, not legacy.

## Moved from prime §4 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

Key files worth knowing: `RBCS.sln`, `global.json` (pins .NET `8.0.311`), `Aspire/RBCloud.AppHost/`,
`src/RBCS.Web.App/package.json`, `azure-pipelines.yml`, `.claude/standards/`.

## Moved from prime §Output Report (phase 4, 2026-11)

Target standard: `AGENTS.md`.

### Project Overview
- What RBCloud/RBCS is and who uses it
- Current branch, and what the recent commits are working on

### The Two Stacks
- **Which stack this area belongs to, and which one owns the writes** — cited to MIGRATION-STATUS.md
- Any boundary violation already present in the area (see
  [rbcs-project-references](../../standards/rbcs-project-references.md))

### Architecture
- Relevant projects and what each is for
- Whether the affected screens are React or MVC iframes
- Integration points the work would touch

### Tech Stack
- .NET 8 (`8.0.311`), the ABP and non-ABP project sets, EF Core contexts
- React + Vite + TypeScript in `RBCS.Web.App`
- xUnit for .NET tests; Vitest for React; Playwright in `test/Automation.Tests`

### Standards That Apply
- Which `.claude/standards/*.md` files govern this work, and the rules in them that bite
- ⛔ `[Trait("Category", "Unit")]` on every .NET test — CI filters on it, and it is applied at class level

## Moved from prime §Confirm Target Phase §2 (phase 4, 2026-11)

Target standard: `AGENTS.md`.

⛔ **Do not infer patterns from neighbouring code.** Nine handler files in `Commands/` implement no
interface and are never invoked — copying one produces code that compiles, reviews cleanly, and never
runs. If you cite an exemplar, verify it is live: `grep -c "IRequestHandler" <file>`.

## Moved from create-prd §4 (phase 4, 2026-11)

Target standard: `rbcs-project-references.md`.

- ABP / non-ABP / both, **cited to MIGRATION-STATUS.md**
- Which stack owns the writes for the affected data
- For screens: React, MVC, or MVC-behind-an-iframe today, and what it should be after
- Any boundary risk — does this tempt a new ABP ↔ non-ABP reference? See
  [rbcs-project-references](../../standards/rbcs-project-references.md)
