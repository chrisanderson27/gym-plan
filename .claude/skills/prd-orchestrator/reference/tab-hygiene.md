# Tab hygiene and real completion

Cold-path tab mechanics, kept out of SKILL.md so the orchestrator's working set stays small.
Read this when a worker goes quiet or at close-out sweep time.

## One tab per worker — never a split pane

Every worker gets its **own herdr tab**; the orchestrator's own tab holds only the orchestrator.
Splitting panes into it stacked a whole run's planners, builders, reviewers and e2e workers into one
screen. The only way to create a worker's tab is the script, so the label, env and record are never
improvised:

```bash
orchestrator.py tab open --stage builder --phase 3     # → {"label","tab_id","pane_id","ready",…}
herdr agent start builder --kind <kind> --pane <pane_id> -- <agent_args from `routing`>
```

- **Label** `orch:<prd-slug>:p<N>:<stage>` (no `p<N>` for run-wide tabs such as `app` and `reviewer`;
  `--suffix` adds a lane, e.g. `orch:prd-7:e2e:p4:lane2`). The prefix is how `sweep` finds this run's tabs
  — and only this run's.
- **Env**: the stage's routing env (`CLAUDE_CONFIG_DIR` for a ccp2 worker, …) is passed with `--env`. A
  new tab does **not** inherit your environment; without it a Claude worker starts logged out.
- **Ready**: `tab open` waits for the new shell's prompt before returning. Text sent before it (an
  `agent start`, a `pane run`) is silently dropped — about 10 s on herdr 0.9.1 with a zsh profile.
  `"ready": false` → read the tab (`herdr pane read <pane_id>`) before starting anything in it.
- **Record**: `.agents/orchestrator/tabs.json` lists every tab this run opened.
- **Unfocused**: tabs open with `--no-focus`, so a run never steals Chris's screen.

## Detecting real completion — wait on the artifact, not the lifecycle state

**The completion signal is `phase-N/summary.md` existing, not a herdr lifecycle state.** Every worker
prompt ends by telling the worker to write `summary.md` last and reply with only that path, precisely
so there is a durable done-marker to poll. Use it:

- **Never trust a single `agent wait` / `agent prompt --wait` settle as "done."** Under **auto-mode**
  (`⏵⏵`), a worker settles to `idle` for a beat *between* tool batches; the lifecycle wait returns on
  that inter-turn lull and reports a false completion. This is the #1 cause of "the orchestrator went
  quiet / I never got an update."
- **After any settle, gate on the artifact.** If `phase-N/summary.md` is absent but new files exist and
  the worker is `idle`, the worker **stopped mid-plan** (usually the context window filled — watch for a high
  token count or a `/clear to save …k tokens` hint in its tab). That is *incomplete*, not done: read
  the tab tail (`herdr pane read <pane_id>`) for how far it got, then **resume the same worker**
  ("continue the plan from task K; when done write summary.md") rather than moving on.
- **Wait pattern — use the commands, never `agent prompt --wait` / `agent wait`:**
  ```bash
  orchestrator.py dispatch --pane <pane_id> --prompt-file <file>      # sends, stamps the time, returns at once
  orchestrator.py await --pane <pane_id> --artifact "<path|glob>"     # run with run_in_background
  ```
  `await` polls the artifact (non-empty, modified after the dispatch stamp) and exits with a typed code:
  `0` artifact · `3` idle with no artifact for `--idle-grace-s` (stopped mid-task, or `NO-PLAN-NEEDED` —
  read the pane tail) · `4` blocked on input for `--blocked-grace-s` (herdr also says `blocked` while a worker waits on its own sub-agents) · `5` timeout · `6` pane gone · `7` a `GATE-FAILED` marker.
  Add `--settle` for an artifact the worker writes early and amends (a reviewer merging sub-agent findings):
  it then counts only once the worker is also idle.
  Because it exits, the harness re-wakes the orchestrator; there is nothing to remember to poll. In a
  parallel batch, background one `await` per worker.
- **Always surface a status line to Chris when a wait resolves** — "phase N: still building (18 files,
  no summary yet)" or "phase N: complete, reviewing." Silence is a bug; a settle with no report is the
  same silence that started this note.

> Before any of this: a worker in an **untrusted folder** reports `interactive_ready: true`
> and then exits without running at all. See [worker-preflight.md](worker-preflight.md).

## Close every tab you open, the moment its job is done

A run opens many tabs — leaving them open litters Chris's session with dead workers. **When a worker
has delivered its artifact and you've read it, close its tab**: `orchestrator.py tab close --label <label>`
(it also drops the record). Concretely:

- planner → after you've read the plan path and accepted it.
- builder → after the phase is committed (or parked). During the final-review fix-cycle the builder is
  the one tab worth keeping *warm* (resume rather than restart — `tab open` on the same label returns the
  live tab, `--fresh` replaces it); close it only once the PRD's review is clean.
- reviewer / coupling check → immediately after you read its review. A re-review opens a fresh tab anyway.
- e2e worker / pilot lane → immediately after you read its `e2e.md`, and **also close its browser
  session** (`agent-browser --session <name> close`) as the safety net so no headed Chrome-for-Testing
  window is orphaned. A re-run opens a fresh tab anyway.
- app tab → the dedicated tab running `[app].start`. Stop it at the **end of the e2e gate, every exit
  path** — `app-run.sh kill`, then `tab close --label orch:<slug>:app` — so a phase never leaves the app
  running behind it.

Only ever close tabs **you** created for this run. Never touch a pre-existing tab, Chris's own tabs, or
another run's (`orch:<other-slug>:…`). At close-out: `orchestrator.py tab sweep` (every tab in
`tabs.json` plus any tab in this workspace with this run's prefix); `agent-browser session list` and close
any `<[e2e].session_prefix>-*` session left; and `app-run.sh kill` once more so the app never outlives
the run.
