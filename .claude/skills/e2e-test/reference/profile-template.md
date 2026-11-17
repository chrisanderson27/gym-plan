# e2e profile — <APP NAME>

_The `e2e-test` skill reads this before every run and appends to it when a run learns something.
Keep it under ~200 lines and readable in one sitting. **Never put a secret in this file** — it is
tracked in git. Name the env var; put the value in a gitignored `.env`._

## App

- **base_url:** `http://localhost:PORT`
- **ready_probe:** _(optional — use when something else may answer on this port, e.g. a system
  service or a proxy. A command that exits 0 only when the real app is serving.)_
  `curl -sI $BASE_URL | grep -q 'Server: <expected>'`
- **session prefix:** `<app>-e2e`
- **What it is:** one sentence, so a cold agent knows what it is looking at.
- **Stacks in play:** _(only if it matters — e.g. "half the routes are an iframe over an older app;
  a change may live in either")_

## Credentials

**Names only. No values.**

| Purpose | Env var | Where it is asked for |
|---|---|---|
| login username | `E2E_USER` | the login form |
| login password | `E2E_PASS` | the login form |
| post-login access code | `E2E_ACCESS_CODE` | _(if the app has a second factor / permission code)_ |

If a value is missing from the environment, **stop and say which one** — do not try to find it in the
repo.

## Getting in

Every step between a cold browser and a usable screen, in order. Include the ones that only *usually*
appear, and say so.

1. `open $BASE_URL` → …
2. …

## Flows

Sequences worth not re-deriving. One per heading, numbered steps, name the screen each step lands on.

### <Flow name>
1. …

## Quirks

Learned the hard way. Newest first. Each entry: title, date, what you'll see, what to do, where it
applies.

### <Short imperative title>
_Learned YYYY-MM-DD · costs: <what it cost when it was unknown>_
**You'll see:** …
**Do:** …
**Where:** …

## Cleanup

Anything a run must release so the next run can start clean — a license, a lock, a seat, a record.
State whether it needs a fresh session to do it.

- …
