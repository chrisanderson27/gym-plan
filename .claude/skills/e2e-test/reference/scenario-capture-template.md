# E2E scenario capture contract

Copy this structure into the phase's `capture.md`. Every heading is required. Use one row per browser
action or assertion; repeat the acceptance criterion beside the steps that prove it when a phase has
more than one criterion.

```markdown
# <Scenario title>

## Intent

<The user goal and why this journey matters.>

## Acceptance criteria

- <Criterion copied verbatim from the phase.>

## Prerequisites

- Starting screen / URL: `<path>`
- Authentication: <signed out, signed in, or named reusable state>
- Role / permissions: <role names>
- Credential references: `${E2E_USER}`, `${E2E_PASS}`
- Feature flags / configuration: <names and required states, or none>
- Fixtures / seed data: <stable identifiers and required state>
- Setup: <actions required before step 1>
- Shared-environment safety: <records that may be changed>

## Safe literals

- `Test Customer 4092`
- `Order confirmed`
- `Sign in`

Omit the list items when no literal may safely survive. Never list passwords, access codes, tokens,
cookies, authorization headers or payment-card data. Unlisted trace values are redacted.
Single-token values, standalone numeric codes and compact mixed letter/number strings are rejected as
secret-shaped; write safe fixtures with meaningful context, such as `Order 4092`.
Include stable UI labels used by locators when they are safe to retain; dynamic accessible names are
redacted unless explicitly classified here.

## Steps

| # | screen / url | action | locator | input | wait / trigger | assertion | evidence |
|---|---|---|---|---|---|---|---|
| 1 | `/login` | fill | `getByLabel('Username')` | `${E2E_USER}` | textbox enabled | — | `media/01-login.png` |
| 2 | `/login` | click | `getByRole('button', { name: 'Sign in' })` | — | URL becomes `/home` | signed-in navigation appears | `media/02-home.png` |

Use the exact Playwright locator recorded by the trace. Prefer role, label and test-ID locators. Record
CSS or XPath only when it was actually necessary. Never record snapshot-local `@ref` values.

## Outcome

- Result observed: <user-visible or persisted outcome>
- Observed versus expected: <match, or concrete difference>
- Records created / changed: <identifiers>

## Cleanup

- <Reset or deletion steps>
- Cleanup completed: <yes/no and reason>

## Stability

- Waits / timing: <observable conditions, never arbitrary sleep>
- Fragile locators: <locator and stabilization recommendation>
- Accessibility gaps: <unlabelled or ambiguous controls>
- Reusable profile learning: <profile edit made, or none>
```

`manual.md` remains the separate human walkthrough with `Before`, `Now`, numbered steps beginning at
login, and `You should see`. Do not duplicate secrets there.
