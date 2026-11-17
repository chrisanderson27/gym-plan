# Why a worker silently dies in a fresh worktree

**Verified** on Claude Code **2.1.263**, herdr **0.8.0**, by execution — not from memory.
This supersedes the `send-keys 2` workaround that used to sit in the happy path of `SKILL.md`.

## The finding

An **interactive** `claude` session started in an **untrusted folder** shows a folder-trust dialog:

```
 Quick safety check: Is this a project you created or one you trust?

 ❯ No, exit
   Yes, I trust this folder
```

It appears **regardless of `--permission-mode`** (acceptEdits, bypassPermissions, all of them) and
**despite `skipDangerousModePermissionPrompt: true`**. Permission mode governs *tool* prompts; folder
trust is upstream of all of it. The highlighted default is **`No, exit`**.

## Why it is invisible

This is the part that makes it expensive:

| What the orchestrator sees | What is actually true |
|---|---|
| `agent start` → `interactive_ready: true`, `agent_status: idle` | the agent is sitting on a modal dialog |
| `agent prompt --wait` → `{"type":"agent_prompted"}` | the prompt was swallowed by the dialog |
| pane settles, no error anywhere | the agent **exited**; it is gone from `agent list` |
| poll for `summary.md` … forever | nothing will ever write it |

So the failure presents as *"the orchestrator went quiet"* — the same symptom as a dozen benign
things. **herdr's readiness signal is not proof a worker can work.**

A second, near-identical shape: an agent that is not logged in answers with
`Not logged in · Please run /login`, reports done in 0s, and writes nothing. Same silence, different
cause — authenticate once and it is gone.

## Why it hits this loop specifically

Trust is recorded **per folder path** in `~/.claude.json` under
`projects.<abs path>.hasTrustDialogAccepted`, and it is inherited from an accepted **parent**
directory. A per-ticket worktree is a brand-new path every time, under `worktrees/`, which is not a
child of the trusted main checkout — so a fresh worktree starts untrusted even when the main repo is
trusted.

## The fix

`orchestrator.py preflight` refuses to start a run in an untrusted root and prints the remedy.
`orchestrator.py preflight --trust` writes the trust record for the current root. Equivalent manual
fix: open `claude` once in the folder and choose *"Yes, I trust this folder"*.

```bash
orchestrator.py preflight            # assert; exit 1 and explain if not runnable
orchestrator.py preflight --trust    # assert, and grant trust for this root
```

## Consequences for the rest of the design

- **The `Stop` gate cannot catch this class.** A `Stop` hook runs inside a live agent turn. Here the
  agent never gets a turn — it exits at the dialog, or answers without credentials. Hooks make a
  *working* worker honest about finishing; only preflight makes a worker *exist*. Both are needed.
- **`interactive_ready` must never be treated as "can do work."** After the first worker starts, assert
  a positive liveness signal (`hook-heartbeat.log`, or the worker's own first artifact) before trusting
  a long poll.
- **Bypass mode itself is fine.** In a *trusted* folder the agent starts straight into
  `⏵⏵ bypass permissions on` and writes files unattended with no prompt of any kind. Verified.
- **A `-p` (non-interactive) session is not a valid proxy** for this: `claude -p
  --dangerously-skip-permissions` in the same untrusted folder wrote its file with no dialog at all.
  The trust gate is interactive-only, which is exactly why it was never caught in scripted testing.
