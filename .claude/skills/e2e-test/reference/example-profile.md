# e2e profile — RBCloud (worked example)

_A filled-in profile, condensed from the `e2e-test` + `rbcloud-manual-testing` skill pair it replaces.
Copy this shape, not its content. **Credentials are named, never stated** — the originals had
`username: <literal>` / `password: <literal>` / access code `<literal>` written into a git-tracked skill
file and a git-tracked shell script; that is the one thing this format fixes on day one._

## App

- **base_url:** `http://localhost:5000`
- **ready_probe:** `curl -sI http://localhost:5000 | grep -q 'Server: Kestrel'`
  — **required here.** On macOS the AirPlay Receiver also binds `*:5000`, so *any HTTP response* is
  not proof the app is up. The gateway serves `Server: Kestrel`; nothing else on that port does.
- **session prefix:** `rbcloud-e2e`
- **What it is:** a multi-tenant point-of-sale / field-service web app behind an Aspire AppHost.
- **Stacks in play:** the React app is mostly a shell — **46 of 63 routes are iframes over an older
  in-repo ASP.NET MVC app**, proxied behind the same gateway at `/app/*`. A change may live in either
  stack; confirm which one you are exercising before calling a pass.

## Credentials

**Names only. Values live in a gitignored `.env`.**

| Purpose | Env var | Where it is asked for |
|---|---|---|
| login username | `E2E_USER` | the login form |
| login password | `E2E_PASS` | the login form, and nowhere else |
| authorized access code | `E2E_ACCESS_CODE` | **every** prompt *after* login |

⚠️ **Any password/code prompt after login is NOT the login password.** It is the short authorized
access code — unassigning a machine, opening a gated module, first visit to an MVC screen. Re-entering
the login password at these prompts is the most common wasted cycle on this app.

## Getting in

1. `open $BASE_URL` → login page. Snapshot, fill username/password by `@ref`, submit.
2. **Machine-selection gate** — appears *usually, not always*. You cannot skip it; the app blocks until
   the account has a machine.
   - Open the machine dropdown. A selectable option → pick it, **Save & Continue**. Done.
   - None available → the same modal lists in-use machines each with **UNASSIGN**. Unassign one
     belonging to your own user, then select it and **Save & Continue**.
   - Unassigning prompts for `$E2E_ACCESS_CODE`.
   - Once assigned, the machine stays selectable for the whole session — this is a once-per-login gate,
     not a per-screen one.
3. You are now on a usable landing screen.

## Flows

### Reach an MVC screen directly (faster than clicking through the React shell)

```
$BASE_URL/app/<Controller>/<Action>/<routeParam>?<query>=<value>
```
Confirmed: `/app/Customer/CustomerCommonIndex`, `/app/Customer/EditCustomer/{custId}`,
`/app/Inventory/EditInventory?Id={inventoryId}`. Expect the access-code prompt on first visit per
session.

**Do not confuse `/inventory-items` (React) with `/app/Inventory/EditInventory` (MVC).** Item-level
features can exist in both, as different code paths with the same name. Verify which one the ticket
means.

## Quirks

### Prefer element refs — `find text` is unreliable here
_Learned 2026-08 · costs: several failed clicks per run_
**You'll see:** `find text "UNASSIGN" click` fails with "No element found by text" on a button that is
visibly present and listed in the snapshot with that exact string. Also seen on `CANCEL`,
`SAVE & CONTINUE`.
**Do:** take a fresh `snapshot -i`, read the `@ref`, `click @ref`. Make this the default for this
app's buttons rather than a fallback. (Likely MUI rendering visually-uppercase text via CSS
`text-transform` while the accessible name differs — unconfirmed.)
**Where:** everywhere, MUI buttons especially.

### MVC buttons wired through inline `onclick` ignore synthetic clicks
_Learned 2026-08 · costs: one silent no-op per occurrence_
**You'll see:** the click reports success, nothing happens, no network request fires.
**Do:** read the element's `onclick` attribute, confirm `typeof window.<fn> === "function"`, then call
it directly with `agent-browser eval 'window.<fn>()'`.
**Where:** legacy MVC screens under `/app/*`.

### Re-snapshot after every state change — stale refs resolve to the *wrong* element
_Learned 2026-08 · costs: an action that appears to do something unrelated_
**You'll see:** the result looks unconnected to what you clicked — e.g. a customer-detach fires where
you expected "remove item".
**Do:** a stale ref here does not always fail loudly; it can silently resolve to a different live
element occupying the old DOM position. Re-snapshot immediately before any click that follows a
network request, a modal open/close, or a list re-render.
**Where:** everywhere; worst in the cash register cart.

### Set the viewport before you start clicking
_Learned 2026-08 · costs: clicks that land nowhere, and wrong layout verdicts_
**You'll see:** a dialog's action buttons render below the fold and a `click` on the ref reports
success while landing nowhere; or a supposedly side-by-side layout appears stacked.
**Do:** `set viewport 1920 1000` once per session, before the first click. Re-screenshot before
trusting that a dialog has only the buttons you can see.
**Where:** warning/acknowledge modals; the cash-register cart Actions column.

### Sessions expire in ~15 minutes
_Learned 2026-08 · costs: a mid-task redirect that looks like a bug_
**You'll see:** a sudden redirect to `/login` mid-task.
**Do:** the JWT expired — it is not a failure of the thing under test. Log back in; expect the machine
gate again if your machine was reassigned meanwhile.
**Where:** any long run.

### A hung `agent-browser` needs a process kill, not patience
_Learned 2026-08 · costs: an indefinite stall_
**You'll see:** the CLI hangs well past normal, and `ps aux | grep renderer` shows the Chrome renderer
pegged near 100% CPU with no change. Triggers include `wait --load networkidle` after an access-code
submit, and `close` on a bad panel state.
**Do:** bound your patience to a few checks seconds apart, then
`pkill -f agent-browser-chrome-<id>` (suffix from `ps aux | grep agent-browser-chrome`). The next
command prints `relaunched browser`. **Do not rely on `close` as the escape hatch — it is one of the
commands that hangs.** After a relaunch all page state is gone; log in again.
**Where:** anywhere.

## Cleanup

- [ ] `agent-browser --session "$SESSION" close`
- [ ] Any machine you checked out is unassigned again — **this may need a second, fresh session**,
      because your current one now holds a machine.
