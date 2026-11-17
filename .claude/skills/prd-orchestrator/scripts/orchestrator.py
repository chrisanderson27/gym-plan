#!/usr/bin/env python3
"""prd-orchestrator state helper. Stdlib only. No third-party imports, ever.

The orchestrating AGENT drives herdr and makes judgments. This script is the
DETERMINISTIC layer around those judgments: it reads the per-repo config, checks
that a worker can actually start, validates the deviation ledger against a
mechanically-checkable rubric, and renders the human-facing report.

Rules live here, not in the model's head. Nothing in this file blocks a phase:
the report is a review surface, never a gate. (Blocking was removed 2026-09 --
332 auto-blocks across 26 runs produced zero parked phases at 1.2% precision.)

The skill holds mechanics; the REPO holds facts. Facts come from
<root>/.claude/orchestrator.toml -- see `config --check` and reference/config.md.

State lives LOCAL to the working tree (repo or worktree), never in the skill:

    <root>/.agents/orchestrator/
        RUN.md            phase status ledger   (agent-owned, rewritten each pass)
        decisions.jsonl   one JSON object per deviation (machine source of truth)
        deviations-*.md   generated review surface (gitignored, never committed)
        events.jsonl      append-only audit log
        learnings.jsonl   cross-run tally of review findings
        gaps.json         the pre-build gap pass over the PRD's phases (machine truth)
        gaps.md           its rendered review surface (gitignored, never committed)
        facts/<p>.md      per-run facts cache, partitioned; flows planner -> planner -> builder

Subcommands:
    init      scaffold .agents/orchestrator/ for a PRD
    config    --check the repo's orchestrator.toml and resolve every path it names
    preflight assert a worker can actually start here (trust, herdr, worktree)
    report    validate the deviation ledger and write deviations-<slug>.md
    status    one-line-per-phase summary
    log / timeline / resume / drift / learnings / promote-e2e / validate-e2e
    verify    run [validation].levels, record phase-N/verify.json (build+test result)
    gate      verify + any e2e/figma that ran -> write phase-N/.gate-pass for the commit hook
    testdocs
    library-sync  close-out: commit what the e2e runs taught the Nimble pilot's flow library
    e2e-cost  past Claude e2e workers' cost (from transcripts) beside Nimble runs' spend (usage.jsonl)
    gaps      write|show|resolve|ingest -- the pre-build gap pass over the PRD's phases
    facts     add|show|ingest -- the per-run facts cache workers read before they re-explore
    ingest    --phase N --from <artifact>: harvest `## New facts` + `## Gaps addressed` in one call
    tab       open|close|sweep|list the run's worker tabs (one herdr tab per worker, never a pane)
    store     path --context C --feature F: create + print the wiki store dirs for a ticket
              import --repo R [--ref REF] --context C | --from DIR --context C --feature F [--dry-run]:
              copy a team repo's committed docs/ai docs (or a loose dir) into the store, one commit
    store-commit  commit store paths in the wiki (only under .planning/, --only, never pushed)
    guard     install|status: info/exclude + pre-commit docs fence keeping PRDs/plans/testing out of a team repo
    install / install-hooks / setup / worker-settings / hook-commit / hook-pre-commit
"""
import argparse, json, os, re, subprocess, sys, datetime, glob, fnmatch, shlex, shutil, tempfile
import hashlib, math, time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

try:
    import tomllib                       # py3.11+; stdlib, keeps the no-venv boundary
except ModuleNotFoundError:              # pragma: no cover
    tomllib = None


# ---- event vocabulary -------------------------------------------------------
# `cmd_log --event <name>` used to accept ANY string, and cmd_telemetry counts
# activity by matching a handful of these names literally. A single typo (e.g.
# `phase_committed` instead of `commit`, or `e2e_gate` instead of `e2e_pass` /
# `e2e_fail`) used to fail SILENTLY: telemetry just reported "0 phases committed"
# with no error, for a run that genuinely committed two phases (found 2026-09-10).
# Every name any part of this skill or its reference docs emits, in one place —
# `cmd_log` now rejects anything not in this set rather than accepting free text.
VALID_EVENTS = {
    "run_start", "run_resumed", "plan_done", "plan_skipped", "human_estimate",
    "verify_pass", "verify_fail", "verify_stale", "verify_unbound", "scope_flag", "noticed_ingest", "fix_cycle",
    "e2e_pass", "e2e_fail", "e2e_na", "e2e_promoted",
    "figma_pull", "figma_pass", "figma_fail", "figma_na",
    "arch_check", "phase_risk", "review_done",
    "gate_pass", "gate_fail", "gate_block_commit",
    "commit", "held", "quarantined", "failed",
    "one_way_recorded", "awaiting_human", "resumed",
    "e2e_fallback", "library_sync",
    "gap_pass", "gap_resolved", "facts_ingest",
    "usage", "budget_exceeded",
    "app_start", "app_stop",
    "run_end", "stage_skipped", "worker_start", "worker_session",
    "store_commit", "surface_hit", "store_commit_deferred", "docs_fence_block", "instruction_fence", "secret_fence_block",
}

# Written by the worker hooks in scripts/hooks/*.sh, never by `log`. Listed so the
# ledger schema and the Workbench parser have one place to check against.
HOOK_EVENTS = {"build_done", "stage_done", "e2e_done", "gate_block", "gate_failed",
               "git_fence", "instruction_fence", "worker_session", "acceptance_missing", "subagent_denied",
               "verify_red_at_stop"}

# The closed Stage list from the PRD-1 telemetry event contract (worker_start /
# worker_session / stage_skipped). `tab open`'s stages plus verify, orchestrator and
# unattributed, which only the Workbench harvester produces.
TELEMETRY_STAGES = ("planner", "builder", "fix", "reviewer", "coupling", "e2e", "figma",
                    "pilot", "app", "verify", "orchestrator", "unattributed")
RUN_END_STATUSES = ("completed", "partial", "aborted", "parked")
RUN_ID_RE = re.compile(r"^[0-9a-f]{12}$")


def repo_root(explicit):
    if explicit:
        return os.path.abspath(explicit)
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], stderr=subprocess.DEVNULL)
        return out.decode().strip()
    except Exception:
        return os.getcwd()


def state_dir(root):
    return os.path.join(root, ".agents", "orchestrator")


def load_decisions(root, sd=None):
    path = os.path.join(sd if sd is not None else state_dir(root), "decisions.jsonl")
    out = []
    if not os.path.exists(path):
        return out
    with open(path) as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.stderr.write(f"decisions.jsonl:{i}: bad JSON: {e}\n")
                sys.exit(2)
    return out


def write_decisions(root, decisions):
    path = os.path.join(state_dir(root), "decisions.jsonl")
    with open(path, "w") as f:
        for d in decisions:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")


def _utc_now_iso():
    """UTC, 'Z'-suffixed, to the second — the SAME format and timezone Claude Code's
    own transcripts use for `timestamp`. Do not switch this back to naive local time:
    cmd_telemetry / transcript_usage compare this against transcript timestamps, and a
    naive-local vs UTC mismatch silently drops real worker sessions from the token/cost
    total (found 2026-09-10 — session count was undercounted by ~40% because of it).
    Parsing back out of this format is `_parse_iso_utc`'s job."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds") \
        .replace("+00:00", "Z")


def _emit(root, event, nulls=False, ts=None, **fields):
    """Append one timestamped event to the append-only audit log. Write-only during a
    run; never read back into the loop's context, so it can grow without rotting anything.
    `nulls=True` keeps None-valued fields as JSON null, for events whose contract
    types a field as `|null`."""
    sd = state_dir(root)
    if not os.path.isdir(sd):
        return
    rec = {"ts": ts or _utc_now_iso(), "event": event}
    rec.update({k: v for k, v in fields.items() if v is not None or nulls})
    with open(os.path.join(sd, "events.jsonl"), "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def evidence_resolves(d, root):
    """Does every evidence cite point at a real file (and a real line, if given)?

    Returns (ok, reason). This is a VALIDITY CHECK ON THE REPORT, never a gate --
    a record failing it is dropped from the report with a note, not blocked.

    Relaxed 2026-09 to accept the two forms that caused ~67 of the old 332 false
    blocks: line RANGES (`File.cs:12-40`) and MULTI-FILE cites (a JSON list, or a
    comma/semicolon separated string).
    """
    ev = d.get("evidence") or []
    if isinstance(ev, str):
        ev = [c for c in re.split(r"[,;]\s*", ev.strip()) if c]
    if not ev:
        return False, "no-evidence"
    for cite in ev:
        cite = str(cite).strip().strip("`")
        if not cite:
            continue
        path, line = cite, None
        if ":" in cite:
            head, tail = cite.rsplit(":", 1)
            tail = tail.split("-", 1)[0]          # `12-40` -> `12`
            if tail.isdigit():
                path, line = head, int(tail)
        full = path if os.path.isabs(path) else os.path.join(root, path)
        if not os.path.exists(full):
            return False, f"evidence-unresolved ({path})"
        if line is not None:
            try:
                with open(full, "rb") as f:
                    n = sum(1 for _ in f)
                if line > n:
                    return False, f"evidence-line-out-of-range ({line}>{n})"
            except OSError:
                return False, "evidence-unreadable"
    return True, ""


# ---- per-repo config --------------------------------------------------------
# The skill holds mechanics; the repo holds facts. Everything stack-specific
# lives in <root>/.claude/orchestrator.toml. A repo that declares nothing gets
# the safe default: the loop reports its candidates and writes nothing.

CONFIG_REL = os.path.join(".claude", "orchestrator.toml")

DEFAULT_CONFIG = {
    "skills":     {"plan": "plan-feature", "exec": "execute"},
    "validation": {"levels": []},
    "app":        {},
    "plans":      {"dir": "docs/ai/plans"},
    "knowledge":  {"generated": [], "always_loaded": [], "scope_notes": None},
    "scope":      {"exclude": []},
    "e2e":        {"session_prefix": "e2e"},
    "testing":    {"dir": "docs/ai/testing", "capture": "on",
                   "scenario_schema": 1, "retain_raw": False},
    "worker":     {"permission_mode": "acceptEdits"},
    "boundary_checks": {"checks": []},
    "budget":     {"max_cost_usd": None},
    "figma":      {"enabled": False, "checks": "end", "bundle_dir": ".agents/figma",
                   "token_env": "FIGMA_TOKEN"},
}


def _deep_default(cfg):
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_CONFIG.items()}
    for k, v in (cfg or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def config_path(root):
    return os.path.join(root, CONFIG_REL)


def load_config(root):
    """Read <root>/.claude/orchestrator.toml. Returns (config, problems).

    Never raises on a missing file -- a repo with no config still runs, it just
    gets defaults and a loud warning from `config --check` / `preflight`.
    """
    path, problems = config_path(root), []
    if tomllib is None:
        problems.append("python <3.11: tomllib unavailable, cannot read orchestrator.toml")
        return _deep_default({}), problems
    if not os.path.exists(path):
        problems.append(f"no {CONFIG_REL} -- running on defaults; "
                        f"run `orchestrator.py setup --detect` to create one")
        return _deep_default({}), problems
    try:
        with open(path, "rb") as f:
            raw = tomllib.load(f)
    except Exception as e:
        problems.append(f"{CONFIG_REL} is not valid TOML: {e}")
        return _deep_default({}), problems
    return _deep_default(raw), problems


def _todo_markers(root):
    """Unfilled TODO markers left by `setup --detect`. Preflight refuses on these."""
    path = config_path(root)
    if not os.path.exists(path):
        return []
    out = []
    for i, line in enumerate(open(path, errors="replace"), 1):
        # only real unfilled VALUES count -- not the header comments that explain them
        if "TODO" in line and not line.lstrip().startswith("#"):
            out.append(f"{CONFIG_REL}:{i}: {line.strip()}")
    return out


# ---- worker preflight -------------------------------------------------------
# Verified 2026-09-07 on Claude Code 2.1.263 / herdr 0.8.0. See
# reference/worker-preflight.md for the full finding and the transcript.
#
# An INTERACTIVE claude session in an UNTRUSTED folder shows a folder-trust
# dialog whose default option is "No, exit" -- and it does so despite BOTH
# --dangerously-skip-permissions and skipDangerousModePermissionPrompt:true.
# herdr still reports interactive_ready:true / agent_status:idle, and
# `agent prompt --wait` still returns success. The prompt is swallowed, the
# agent exits, and the orchestrator polls forever for an artifact nobody will
# write. Every fresh worktree is a fresh untrusted folder.

def config_json_path():
    """The single default Claude config file, where per-project trust records live."""
    return os.path.expanduser("~/.claude.json")


def trust_state(root):
    """Is `root` trusted? Returns (trusted: bool, detail: str).
    Trust is inherited from an accepted parent directory."""
    cj = config_json_path()
    if not os.path.exists(cj):
        return False, f"no trust store yet ({cj})"
    try:
        with open(cj) as f:
            projects = json.load(f).get("projects", {})
    except Exception as e:
        return False, f"unreadable {cj}: {e}"
    probe = os.path.abspath(root)
    while True:
        rec = projects.get(probe)
        if rec and rec.get("hasTrustDialogAccepted") is True:
            hint = "" if probe == os.path.abspath(root) else f" (inherited from {probe})"
            return True, f"trusted{hint}"
        parent = os.path.dirname(probe)
        if parent == probe:
            return False, f"{root} is not trusted"
        probe = parent


def grant_trust(root):
    """Write hasTrustDialogAccepted for `root`. Returns (ok, message)."""
    cj = config_json_path()
    try:
        data = json.load(open(cj)) if os.path.exists(cj) else {}
        data.setdefault("projects", {}).setdefault(os.path.abspath(root), {}).update(
            {"hasTrustDialogAccepted": True})
        tmp = cj + ".orchtmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, cj)
        return True, f"granted in {cj}"
    except Exception as e:
        return False, f"could not write {cj}: {e}"


# ---- the workbench store ----------------------------------------------------
# PRDs, plans and testing docs live in the WIKI's .planning/ -- versioned in the wiki,
# never in a team repo:
#     <store_root>/<feature>/{prds,plans,testing}/          wiki/workbench PRDs
#     <store_root>/<ctx>/<feature>/{prds,plans,testing}/    ticket PRDs (ctx = rbcloud | isi)
# A run opts in through a `Store: <dir>` line in RUN.md (written by `init` from an absolute
# store PRD, or `--store`). No Store line = LEGACY mode: every code path behaves exactly as it
# did before the store existed (plans/testing under the worktree's configured dirs). The store
# is deliberately NOT an orchestrator.toml key -- RBCloud commits that file.

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _wiki_dir():
    """The wiki checkout this script lives in: <wiki>/.claude/skills/prd-orchestrator/scripts/."""
    here = os.path.abspath(__file__)
    for _ in range(5):
        here = os.path.dirname(here)
    return here


def _store_root():
    """<wiki>/.planning, or $WORKBENCH_STORE_ROOT (tests point it at a temp wiki)."""
    env = os.environ.get("WORKBENCH_STORE_ROOT")
    if env:
        return os.path.abspath(os.path.expanduser(env))
    return os.path.join(_wiki_dir(), ".planning")


def _store(root):
    """The run's store dir (absolute) from RUN.md's `Store:` line, or None = legacy mode."""
    val = _run_field(root, "Store")
    if not val:
        return None
    return os.path.abspath(os.path.join(root, os.path.expanduser(val)))


def _store_repo(store):
    """The git toplevel holding `store` (realpath), walking up to the nearest existing
    ancestor so a not-yet-created store dir still resolves. None when not in a git repo."""
    if not store:
        return None
    probe = os.path.abspath(store)
    while not os.path.isdir(probe):
        parent = os.path.dirname(probe)
        if parent == probe:
            return None
        probe = parent
    out = subprocess.run(["git", "-C", probe, "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    top = out.stdout.strip()
    return os.path.realpath(top) if out.returncode == 0 and top else None


def _under(path, base):
    """Is `path` inside (or equal to) `base`? realpath on both (macOS /var -> /private/var)."""
    p, b = os.path.realpath(path), os.path.realpath(base)
    try:
        return os.path.commonpath([p, b]) == b
    except ValueError:
        return False


def _resolve_prd(root, prd):
    """A PRD path as written in RUN.md / --prd, made absolute: as-is if absolute, else under root.
    Never depends on the caller's cwd."""
    if not prd:
        return None
    return prd if os.path.isabs(prd) else os.path.join(root, prd)


def _store_from_prd(prd_abs):
    """Derive the store dir from an absolute PRD path under the store root, or None.
    Accepts exactly <store_root>/<feature>/prds/*.md and <store_root>/<ctx>/<feature>/prds/*.md."""
    if not prd_abs or not prd_abs.endswith(".md"):
        return None
    sr = _store_root()
    if not _under(prd_abs, sr):
        return None
    parts = os.path.relpath(os.path.realpath(prd_abs), os.path.realpath(sr)).split(os.sep)
    if len(parts) not in (3, 4) or parts[-2] != "prds" or not all(_SEGMENT.match(s) for s in parts[:-2]):
        return None
    return os.path.join(sr, *parts[:-2])


def _disp(path, root):
    """A path for humans: root-relative inside the worktree, `.planning/...` inside the store,
    else absolute -- never a ../../.. climb out of the worktree."""
    if path is None:
        return ""
    if _under(path, root):
        return os.path.relpath(os.path.realpath(path), os.path.realpath(root))
    sr = _store_root()
    if _under(path, sr):
        rel = os.path.relpath(os.path.realpath(path), os.path.realpath(sr))
        return os.path.join(os.path.basename(sr), rel) if rel != "." else os.path.basename(sr)
    return os.path.abspath(path)


def _plans_dir(root, cfg):
    """Where plans live: <Store>/plans in store mode, else [plans].dir under the worktree."""
    store = _store(root)
    if store:
        return os.path.join(store, "plans")
    configured = (cfg.get("plans") or {}).get("dir") or "docs/ai/plans"
    return configured if os.path.isabs(configured) else os.path.join(root, configured)


def _testing_repo(root):
    """The repo that owns the testing dir: the store's (wiki) repo in store mode, else root."""
    store = _store(root)
    return (_store_repo(store) or store) if store else root


# ---- subcommands ------------------------------------------------------------

def cmd_init(args):
    root = repo_root(args.root)
    sd = state_dir(root)
    os.makedirs(sd, exist_ok=True)
    run = os.path.join(sd, "RUN.md")
    if os.path.exists(run):
        # A checkout reuses one state dir (the wiki runs on main). Archive the previous run whole and clear its
        # per-run files, so a stale phase-N/verify.json or .gate-pass can never pass a new run's gate.
        live = _run_is_live(sd)
        if live and not args.force:
            print(f"refusing: the run in {sd} is still active ({live}) -- let it finish, or pass --force to "
                  f"archive it anyway", file=sys.stderr)
            sys.exit(1)
        dest = _archive_run(sd)
        print(f"archived the previous run to {os.path.relpath(dest, root)}")
    request = os.path.join(sd, PARK_REQUEST)
    if os.path.exists(request):
        os.remove(request)
    try:
        commands = (("files.txt", ["git", "status", "--porcelain"]),
                    ("untracked.txt", ["git", "ls-files", "--others", "--exclude-standard"]),
                    ("preexisting.patch", ["git", "diff", "HEAD"]))
        snapshots = [(name, subprocess.run(cmd, cwd=root, capture_output=True))
                     for name, cmd in commands]
        if all(rec.returncode == 0 for _, rec in snapshots):
            baseline = os.path.join(sd, "baseline-dirty")
            os.makedirs(baseline, exist_ok=True)
            for name, rec in snapshots:
                with open(os.path.join(baseline, name), "wb") as stream:
                    stream.write(rec.stdout)
            count = len(snapshots[0][1].stdout.splitlines())
            print(f"  baseline-dirty   -> {count} dirty path(s) recorded (never staged; park ignores them)")
    except Exception as error:
        print(f"  note: could not snapshot the dirty baseline ({error})")
    dj = os.path.join(sd, "decisions.jsonl")
    if not os.path.exists(dj):
        open(dj, "w").close()
    prd = args.prd or "<PRD path>"
    # Store mode: an explicit --store wins; else derive it from a PRD that lives in the store.
    # A legacy PRD (team repo docs/ai/prds/...) gets no Store line and the run is unchanged.
    store = None
    if getattr(args, "store", None):
        store = os.path.abspath(os.path.expanduser(args.store))
    elif args.prd:                       # relative = root-relative, like every other PRD reader
        store = _store_from_prd(_resolve_prd(root, os.path.expanduser(args.prd)))
    store_line = f"Store: {store}   # PRDs/plans/testing live here (wiki); commit with `store-commit`\n" \
        if store else ""
    today = datetime.date.today().isoformat()
    run_id = os.urandom(6).hex()
    _b = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root,
                        capture_output=True, text=True)
    base = _b.stdout.strip()
    # an empty repo prints the literal "HEAD" and exits non-zero
    if _b.returncode != 0 or not base or base == "HEAD":
        base = "(unknown)"
    with open(run, "w") as f:
        f.write(f"""# Orchestration run

PRD: {prd}
Root: {root}
{store_line}Started: {today}
Run id: {run_id}   # stamped on run_start/run_end; keep this line when rewriting RUN.md
Autonomy gate: {args.gate}   # build+review autonomous; this step needs a human
Base commit: {base}   # HEAD before phase 1 — the final review's fixed point
Human estimate:    # written by `orchestrator.py estimate` at kickoff

## Phases
<!-- The agent fills this table after reading the PRD. One row per phase.
     status: pending | building | review | held | committed | failed
     `held` = an autonomous-mode one-way deviation held this phase's commit. -->

| # | phase | depends on | status  | commit | artifact / note |
|---|-------|------------|---------|--------|-----------------|
| 1 | TODO  | -          | pending | -      | -               |

## Phase digests
<!-- One six-line digest per phase as it lands, so a human who slept through
     every notification gets the same information in one scroll. -->

## Current
current: (not started)
""")
    print(f"scaffolded {sd}")
    print(f"  run id          -> {run_id}")
    if store:
        print(f"  store           -> {store}  (plans + testing docs go here, never into the team repo)")
    print(f"  RUN.md          -> fill the Phases table from {prd}")
    print(f"  decisions.jsonl -> empty; append one object per DEVIATION "
          f"(see reference/deviation-rubric.md — most decisions are absorbed)")

    # Best-effort: a run should never fail to start over a hook install problem --
    # preflight surfaces it as a warning if this silently didn't happen.
    try:
        hook_path = _hook_script_path(root)
        if hook_path and not os.path.exists(hook_path):
            cmd_install_hooks(argparse.Namespace(root=args.root))
    except Exception as e:
        print(f"  note: could not auto-install the post-commit hook ({e}) -- "
              f"run `orchestrator.py install-hooks` by hand.")

    print(f"  next: `orchestrator.py preflight` before spawning any worker")


# ---- store subcommands ------------------------------------------------------
# `store path` is the skills' single path authority for the store (the Workbench's is
# server/modules/prds/store.mjs). `store-commit` is the only way anything here writes to git
# in the wiki: path-whitelisted to <wiki>/.planning/, `--only` so Chris's other staged and
# unstaged wiki work is never swept in, never pushed.

def _safe_segment(seg):
    return bool(seg) and bool(_SEGMENT.match(seg)) and ".." not in seg


def _check_segments(cmd, pairs):
    """Print a refusal and return False if any (label, value) is not a safe path segment."""
    for label, seg in pairs:
        if not _safe_segment(seg):
            print(f"{cmd}: {label} {seg!r} is not a safe path segment "
                  f"(letters, digits, . _ -; no '/' or '..')", file=sys.stderr)
            return False
    return True


def cmd_store(args):
    if args.action == "import":
        return cmd_store_import(args)
    if not args.feature:
        print("store path: --feature is required", file=sys.stderr)
        return 2
    if not _check_segments("store path", (("--context", args.context), ("--feature", args.feature))):
        return 2
    base = os.path.join(_store_root(), args.context, args.feature)
    dirs = {k: os.path.join(base, k) for k in ("prds", "plans", "testing")}
    for d in dirs.values():
        os.makedirs(d, exist_ok=True)
    if args.json:
        print(json.dumps({"store": base, **dirs}))
    else:
        print(f"store:   {base}")
        for k, d in dirs.items():
            print(f"{k + ':':<8} {d}")
    return 0


STORE_COMMIT_TRIES = 5
STORE_COMMIT_BACKOFF_S = 0.25        # doubled per retry: .25 .5 1 2 -> under 4s worst case


def _git_retry(repo, argv):
    """Run `git -C repo <argv>`, retrying while another process holds the index.lock
    (Chris's editor, a concurrent session). Returns the last CompletedProcess."""
    for attempt in range(STORE_COMMIT_TRIES):
        res = subprocess.run(["git", "-C", repo] + argv, capture_output=True, text=True)
        if res.returncode == 0 or "index.lock" not in (res.stderr + res.stdout):
            return res
        if attempt < STORE_COMMIT_TRIES - 1:
            time.sleep(STORE_COMMIT_BACKOFF_S * (2 ** attempt))
    return res


def _mid_operation(repo):
    """'merge' / 'rebase' / 'cherry-pick' when the repo is mid-operation, else None."""
    for marker, label in (("MERGE_HEAD", "merge"), ("rebase-merge", "rebase"),
                          ("rebase-apply", "rebase"), ("CHERRY_PICK_HEAD", "cherry-pick")):
        p = subprocess.run(["git", "-C", repo, "rev-parse", "--git-path", marker],
                           capture_output=True, text=True).stdout.strip()
        if p and os.path.exists(p if os.path.isabs(p) else os.path.join(repo, p)):
            return label
    return None


def cmd_store_commit(args):
    """Commit store paths (default: this run's Store dir) in the wiki, and only them.
    Exit 0 = committed or nothing to commit; 2 = refused (path outside .planning, no store);
    3 = deferred (wiki mid-merge/rebase -- retry later); 1 = git failed."""
    root = repo_root(args.root)
    run_store = _store(root)
    paths = [os.path.abspath(os.path.expanduser(p)) for p in (args.path or [])]
    # An explicit --path is named for itself: the live run's Store must not lend it a scope
    # (2026-11-16: a workbench-feedback PRD was committed as `planning(picasso-deep-dive)`).
    store = (os.path.abspath(os.path.expanduser(args.store)) if args.store
             else None if paths else run_store)
    paths = paths or ([store] if store else [])
    if not paths:
        print("store-commit: no Store in RUN.md and no --store/--path given -- nothing to commit "
              "(legacy runs commit docs with the phase)", file=sys.stderr)
        return 2
    # Log to this worktree's run only when every path is that run's own store.
    ours = bool(run_store) and all(_under(os.path.realpath(p), os.path.realpath(run_store)) for p in paths)
    return _commit_store_paths(paths, store=store, phase=args.phase, reason=args.reason,
                               emit_root=root if ours else None)


_TRACKER_KEY = re.compile(r"^(?:[A-Z][A-Z0-9]+-\d+|\d+)$")


def _prd_anchor_warnings(wiki, rels):
    """Warnings for context-store PRDs that Workbench's My Work cannot list (2026-10-13: two PRDs reached the
    PRDs page but never My Work, so they could not be orchestrated). A PRD reaches a My Work row only via a wiki
    PRD (.planning/<feature>/prds/ -> the Workbench row), a ticket (work_item / stories / a tracker-key feature),
    or `branch:` (that branch's worktree row). Advisory: the commit still happens."""
    out = []
    for rel in rels:
        parts = rel.split(os.sep)
        files = []
        full = os.path.join(wiki, rel)
        if os.path.isdir(full):
            for d, _, names in os.walk(full):
                files += [os.path.join(d, n) for n in names if n.endswith(".md")]
        else:
            files = [full]
        for f in files:
            fp = os.path.relpath(f, wiki).split(os.sep)
            # .planning/<ctx>/<feature>/prds/<file>.md -- a context-store PRD; wiki PRDs are one level shallower.
            if len(fp) != 5 or fp[0] != ".planning" or fp[3] != "prds" or not fp[4].endswith(".md"):
                continue
            fm = _frontmatter(f)
            if str(fm.get("type") or "").upper() != "PRD":
                continue
            stories = fm.get("stories") or []        # _frontmatter (below) parses inline/dash lists
            if isinstance(stories, str):
                stories = [x for x in stories.strip("[] ").split(",") if x.strip()]
            feature = fm.get("feature") if isinstance(fm.get("feature"), str) else ""
            ticket = fm.get("work_item") or stories or (feature if _TRACKER_KEY.match(feature) else "")
            name = "/".join(fp)
            if ticket:
                continue
            if isinstance(fm.get("branch"), str) and fm.get("branch"):
                out.append(f"store-commit: NOTE {name} is a branch PRD ({fm['branch']}): it appears on My Work only once "
                           f"Workbench knows that branch's worktree -- create it, then Rescan worktrees (or wait for the "
                           f"hourly rescan)")
            else:
                out.append(f"store-commit: WARNING {name} names no ticket (work_item/stories) and no branch, so no My Work "
                           f"row can list it and it cannot be orchestrated. Add work_item: or branch:, or -- if its "
                           f"changes land in the wiki -- move it to .planning/<feature>/prds/")
    return out


def _commit_store_paths(paths, store=None, phase=None, reason=None, message=None, emit_root=None):
    """The body of store-commit: whitelist to <wiki>/.planning/, refuse mid-operation, then
    `git add` + `git commit --only --no-verify` exactly `paths`. `message` overrides the default
    `planning(<scope>): <what>`; `emit_root` (a worktree with a run) gets the store_commit events."""
    wiki = _store_repo(store or paths[0])
    if not wiki:
        print(f"store-commit: {store or paths[0]} is not inside a git repo", file=sys.stderr)
        return 2
    planning = os.path.join(wiki, ".planning")
    rels = []
    for p in paths:
        rp = os.path.realpath(p)
        if not _under(rp, planning) or rp == os.path.realpath(planning):
            print(f"store-commit: REFUSING {p} -- only paths under {planning}/ may be committed "
                  f"this way", file=sys.stderr)
            return 2
        rels.append(os.path.relpath(rp, wiki))
    op = _mid_operation(wiki)
    if op:
        print(f"store-commit: deferred -- {wiki} is mid-{op}; finish it, then re-run", file=sys.stderr)
        if emit_root:
            _emit(emit_root, "store_commit_deferred", phase=phase, detail=f"wiki mid-{op}")
        return 3

    if message:
        msg = message
    else:
        scope_src = os.path.realpath(store) if store and _under(store, planning) else os.path.realpath(paths[0])
        scope = os.path.relpath(scope_src, os.path.realpath(planning)).split(os.sep)
        scope = "/".join(scope[:2] if len(scope) > 1 and scope[1] not in ("prds", "plans", "testing")
                         else scope[:1])
        what = " ".join(x for x in (f"phase {phase}" if phase is not None else None,
                                    reason) if x) or "update"
        msg = f"planning({scope}): {what}"

    res = _git_retry(wiki, ["add", "--"] + rels)
    if res.returncode != 0:
        print(f"store-commit: git add failed: {(res.stderr or res.stdout).strip()}", file=sys.stderr)
        return 1
    shown = ", ".join(rels) if len(rels) <= 5 else f"{', '.join(rels[:5])} (+{len(rels) - 5} more)"
    if subprocess.run(["git", "-C", wiki, "diff", "--cached", "--quiet", "--"] + rels).returncode == 0:
        print(f"store-commit: nothing to commit under {shown}")
        return 0
    res = _git_retry(wiki, ["commit", "--only", "--no-verify", "-q", "-m", msg, "--"] + rels)
    if res.returncode != 0:
        out = (res.stderr + res.stdout).strip()
        if "nothing to commit" in out or "no changes added" in out:
            print(f"store-commit: nothing to commit under {shown}")
            return 0
        print(f"store-commit: git commit failed: {out}", file=sys.stderr)
        return 1
    sha = subprocess.run(["git", "-C", wiki, "rev-parse", "HEAD"],
                         capture_output=True, text=True).stdout.strip()
    if emit_root:
        _emit(emit_root, "store_commit", phase=phase, sha=sha, detail=msg)
    print(f"store-commit: {sha[:9]} {msg}  ({wiki}; not pushed)")
    for w in _prd_anchor_warnings(wiki, rels):
        print(w, file=sys.stderr)
    return 0


# ---- store import -------------------------------------------------------------
# Copies a team repo's committed docs/ai/{prds,plans,testing} (read with `git show REF:path`, so
# no working tree is touched) or a loose directory into the store, then makes ONE store commit.
# Copy-only: the source is never modified. Never guesses: a testing doc whose PRD slug matches
# no imported PRD, or PRDs in more than one feature, lands in _unfiled/ and is reported.

IMPORT_KINDS = ("prds", "plans", "testing")
UNFILED = "_unfiled"
_FLAT_TESTING_SUFFIX = re.compile(r"-(test-flow|manual-test|test-plan)$")


def _split_frontmatter(text):
    """(newline, start_of_closing_line, block) for a leading `---` YAML block, else None.
    `block` is the text between the fences; start_of_closing_line indexes `text`."""
    for nl in ("\r\n", "\n"):
        if text.startswith("---" + nl):
            i = len("---" + nl)
            m = re.compile(r"^---[ \t]*(\r?\n|$)", re.M).search(text, i)
            if not m:
                return None
            return nl, m.start(), text[i:m.start()]
    return None


def _fm_value(block, key):
    m = re.search(rf"^{re.escape(key)}[ \t]*:[ \t]*(.*?)[ \t]*$", block, re.M)
    if not m:
        return None
    val = m.group(1).strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
        val = val[1:-1].strip()
    return val or None


def _stamp_prd(data, fields):
    """Add `fields` (ordered key -> value) to a PRD's frontmatter, keys already present are left
    alone. Everything after the frontmatter is byte-identical. No frontmatter -> one is prepended."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    fm = _split_frontmatter(text)
    if fm is None:
        head = "".join(f"{k}: {v}\n" for k, v in fields.items())
        return ("---\n" + head + "---\n" + text).encode("utf-8")
    nl, close, block = fm
    add = [f"{k}: {v}" for k, v in fields.items() if not re.search(rf"^{re.escape(k)}[ \t]*:", block, re.M)]
    if not add:
        return data
    prefix = text[:close]
    if not prefix.endswith(nl) and not prefix.endswith("\n"):
        prefix += nl
    return (prefix + "".join(a + nl for a in add) + text[close:]).encode("utf-8")


def _frontmatter_feature(data):
    try:
        fm = _split_frontmatter(data.decode("utf-8"))
    except UnicodeDecodeError:
        return None
    return _fm_value(fm[2], "feature") if fm else None


def _repo_name(path):
    """The repository's name for a checkout or worktree: the main clone's directory name."""
    res = subprocess.run(["git", "-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                         capture_output=True, text=True)
    common = res.stdout.strip()
    if res.returncode != 0 or not common:
        return None
    common = os.path.realpath(common)
    return os.path.basename(os.path.dirname(common)) if os.path.basename(common) == ".git" \
        else os.path.basename(common).removesuffix(".git")


def _import_plan_repo(repo, ref, ctx, prefix="docs/ai"):
    """Read every file under <prefix>/{prds,plans,testing} at `ref` and decide its store path.
    Returns (items, report) -- items: [{src, kind, dest_rel, data, prd}], dest_rel relative to the
    store root."""
    report = {"ambiguous": [], "unmatched": [], "unsafe_feature": []}
    res = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "-z", "--name-only", ref, "--"]
                         + [f"{prefix}/{k}" for k in IMPORT_KINDS], capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"git ls-tree {ref} failed: {res.stderr.decode(errors='replace').strip()}")
    names = [n for n in res.stdout.decode("utf-8", "surrogateescape").split("\0") if n]

    def show(path):
        r = subprocess.run(["git", "-C", repo, "show", f"{ref}:{path}"], capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(f"git show {ref}:{path} failed: {r.stderr.decode(errors='replace').strip()}")
        return r.stdout

    items, testing = [], []
    for src in sorted(names):
        rel = src[len(prefix) + 1:]
        kind, _, rest = rel.partition("/")
        if os.path.basename(rest) == ".DS_Store":
            continue
        data = show(src)
        if kind == "testing":
            testing.append((src, rest, data))
            continue
        parts = rest.split("/")
        dir_feature = parts[0] if len(parts) > 1 else None
        inner = "/".join(parts[1:]) if len(parts) > 1 else rest
        fm_feature = _frontmatter_feature(data) if src.endswith(".md") else None
        feature = None
        if fm_feature:
            if _safe_segment(fm_feature):
                feature = fm_feature
            else:
                report["unsafe_feature"].append(f"{src} (feature: {fm_feature!r})")
        if not feature and dir_feature and _safe_segment(dir_feature):
            feature = dir_feature
        if feature:
            dest = f"{ctx}/{feature}/{kind}/{inner}"
        else:
            dest = f"{ctx}/{UNFILED}/{kind}/{rest}"
            feature = UNFILED
        items.append({"src": src, "kind": kind, "dest_rel": dest, "data": data,
                      "feature": feature, "prd": kind == "prds" and src.endswith(".md")})

    # PRD slug (basename without .md) -> the features that hold a PRD of that name
    slugs = {}
    for it in items:
        if it["prd"] and it["feature"] != UNFILED:
            slugs.setdefault(os.path.basename(it["src"])[:-3], set()).add(it["feature"])
    for src, rest, data in testing:
        parts = rest.split("/")
        if len(parts) >= 3 and parts[0] == "scenarios":
            key, exact = parts[1], True
        elif len(parts) == 1:
            key, exact = _FLAT_TESTING_SUFFIX.sub("", os.path.splitext(parts[0])[0]), False
        else:
            key, exact = parts[0], True
        matches = [s for s in slugs if s == key] if exact else \
            [s for s in slugs if key == s or key.startswith(s + "-")]
        if not exact and len(matches) > 1:          # prd-1-x and prd-1-x-y: the longest name wins
            longest = max(len(s) for s in matches)
            matches = [s for s in matches if len(s) == longest]
        features = sorted({f for s in matches for f in slugs[s]})
        if len(features) == 1:
            feature = features[0]
            dest = f"{ctx}/{feature}/testing/{rest}"
        else:
            feature = UNFILED
            dest = f"{ctx}/{UNFILED}/testing/{rest}"
            if features:
                report["ambiguous"].append(f"{src} (PRD {key!r} is in features {', '.join(features)})")
            else:
                report["unmatched"].append(f"{src} (no imported PRD named {key!r})")
        items.append({"src": src, "kind": "testing", "dest_rel": dest, "data": data,
                      "feature": feature, "prd": False})
    return items, report


def _import_plan_dir(src_dir, ctx, feature):
    """A loose directory: <dir>/{prds,plans,testing}/..., or docs/ai-shaped with prds/<x>/...,
    plans/<x>/... (the <x> level is dropped). Everything lands in <ctx>/<feature>/."""
    items, ignored = [], []
    for dirpath, dirnames, filenames in os.walk(src_dir):
        dirnames.sort()
        for fn in sorted(filenames):
            if fn == ".DS_Store":
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
            kind, _, rest = rel.partition("/")
            if kind not in IMPORT_KINDS or not rest or os.path.islink(full):
                ignored.append(rel)
                continue
            parts = rest.split("/")
            inner = "/".join(parts[1:]) if kind != "testing" and len(parts) > 1 else rest
            with open(full, "rb") as f:
                data = f.read()
            items.append({"src": full, "kind": kind, "dest_rel": f"{ctx}/{feature}/{kind}/{inner}",
                          "data": data, "feature": feature, "prd": kind == "prds" and fn.endswith(".md")})
    return items, {"ambiguous": [], "unmatched": [], "unsafe_feature": [], "ignored": ignored}


def cmd_store_import(args):
    """store import --repo R --ref REF --context CTX | --from DIR --context CTX --feature F [--dry-run]."""
    if bool(args.repo) == bool(args.from_dir):
        print("store import: give exactly one of --repo (with --ref) or --from", file=sys.stderr)
        return 2
    segs = [("--context", args.context)] + ([("--feature", args.feature)] if args.from_dir else [])
    if args.from_dir and not args.feature:
        print("store import: --from needs --feature", file=sys.stderr)
        return 2
    if not _check_segments("store import", segs):
        return 2
    ctx = args.context
    try:
        if args.repo:
            repo = os.path.abspath(os.path.expanduser(args.repo))
            ref = args.ref or "origin/main"
            repo_name = os.path.basename(os.path.realpath(repo))
            items, report = _import_plan_repo(repo, ref, ctx)
            origin = f"{repo_name}@{ref}"
        else:
            src_dir = os.path.abspath(os.path.expanduser(args.from_dir))
            if not os.path.isdir(src_dir):
                print(f"store import: --from {src_dir} is not a directory", file=sys.stderr)
                return 2
            repo_name = _repo_name(src_dir)
            items, report = _import_plan_dir(src_dir, ctx, args.feature)
            origin = src_dir
    except RuntimeError as e:
        print(f"store import: {e}", file=sys.stderr)
        return 1

    sr = _store_root()
    stamp = {"imported": "true", "context": ctx}
    if repo_name:
        stamp["repo"] = repo_name
    counts = {k: {"new": 0, "same": 0, "conflict": 0} for k in IMPORT_KINDS}
    conflicts, written, planned, features = [], [], {}, set()
    for it in items:
        dest = os.path.join(sr, *it["dest_rel"].split("/"))
        data = _stamp_prd(it["data"], stamp) if it["prd"] else it["data"]
        c = counts[it["kind"]]
        if dest in planned:                                   # two sources -> one store path
            if planned[dest] == data:
                c["same"] += 1
            else:
                c["conflict"] += 1
                conflicts.append(f"{it['src']} -> {_disp(dest, sr)} (another imported file has that path)")
            continue
        planned[dest] = data
        if os.path.lexists(dest):
            with open(dest, "rb") as f:
                same = f.read() == data
            if same:
                c["same"] += 1
            else:
                c["conflict"] += 1
                conflicts.append(f"{it['src']} -> {_disp(dest, sr)} (exists with different content; kept)")
            continue
        c["new"] += 1
        features.add(it["feature"])
        if not args.dry_run:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            written.append(dest)

    verb = "would import" if args.dry_run else "imported"
    print(f"store import: {origin} -> {os.path.join(sr, ctx)}"
          f"{'  (dry run: nothing written)' if args.dry_run else ''}")
    for k in IMPORT_KINDS:
        c = counts[k]
        print(f"  {k + ':':<9} {c['new']} {verb}, {c['same']} identical (skipped), {c['conflict']} conflicts")
    feats = sorted(features)
    print(f"  features: {len(feats)}" + (f" -- {', '.join(feats)}" if feats else ""))
    for label, key in (("CONFLICTS (skipped, store copy kept)", None),
                       ("AMBIGUOUS testing docs (in _unfiled/, not guessed)", "ambiguous"),
                       ("UNMATCHED testing docs (in _unfiled/)", "unmatched"),
                       ("unsafe frontmatter feature (fell back to directory / _unfiled)", "unsafe_feature"),
                       ("ignored (not under prds/, plans/ or testing/)", "ignored")):
        rows = conflicts if key is None else report.get(key, [])
        if rows:
            print(f"  {label}: {len(rows)}")
            for r in rows:
                print(f"    {r}")
    if args.dry_run or not written:
        if not args.dry_run:
            print("  nothing new to commit")
        return 0
    return _commit_store_paths(written, message=f"planning({ctx}): import from {origin}")


# ---- the package: which skills travel together ---------------------------------
# The orchestrator invokes these BY NAME, so they must exist in the target repo's
# own .claude/skills/. `create-prd` is optional (human-gated, run before a build),
# but shipping it keeps the family whole for a new team.
FAMILY = ["prd-orchestrator", "plan-feature", "execute", "e2e-test", "orchestrator-setup"]
FAMILY_OPTIONAL = ["create-prd"]

# agent-browser is NOT vendored here. It ships its OWN version-matched skill
# (`agent-browser skills get core --full`); a frozen copy would drift the way the
# 0.14.0 -> 0.37.0 session-id command did. The e2e worker pulls it fresh at runtime.


def _family_source():
    """The canonical skills dir is the parent of THIS skill — i.e. wherever this
    copy of the family lives. Running `install` from the maintained wiki copies the
    maintained version; running it from a stale target copies that staleness, so
    always install FROM the source of truth."""
    # __file__ = <skills>/prd-orchestrator/scripts/orchestrator.py -> up 3 = <skills>
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def cmd_install(args):
    """Copy the skill family into a target repo's .claude/skills/.

    This is the 'package deal': the orchestrator is useless in a repo that does not
    also have plan-feature, execute and e2e-test to invoke. orchestrator-setup runs
    this as its first step; a team re-runs it to pick up a new version.
    """
    src = os.path.abspath(args.source) if args.source else _family_source()
    dest_repo = os.path.abspath(args.into) if args.into else repo_root(args.root)
    dest = os.path.join(dest_repo, ".claude", "skills")

    if os.path.abspath(src) == os.path.abspath(dest):
        print(f"source and destination are the same ({src}) — nothing to do."); return 1

    import shutil
    os.makedirs(dest, exist_ok=True)
    skills = FAMILY + ([] if args.no_optional else FAMILY_OPTIONAL)
    installed, skipped = [], []
    for name in skills:
        s = os.path.join(src, name)
        if not os.path.isdir(s):
            skipped.append((name, "not in source")); continue
        d = os.path.join(dest, name)
        sv, dv = _skill_version(os.path.join(s, "SKILL.md")), \
                 _skill_version(os.path.join(d, "SKILL.md")) if os.path.exists(d) else None
        if os.path.exists(d) and not args.force and dv == sv:
            skipped.append((name, f"already v{sv}")); continue
        if os.path.exists(d):
            shutil.rmtree(d)
        shutil.copytree(s, d, ignore=shutil.ignore_patterns(
            "*.png", "__pycache__", "*.pyc", ".DS_Store"))
        installed.append((name, sv, dv))

    for name, sv, dv in installed:
        was = f" (was v{dv})" if dv else " (new)"
        print(f"  installed {name}  v{sv}{was}")
    for name, why in skipped:
        print(f"  skipped   {name}  — {why}")
    if not installed:
        print("\nnothing to install — the target is already current "
              "(use --force to overwrite).")
    else:
        print(f"\ninstalled {len(installed)} skill(s) into {os.path.relpath(dest, dest_repo)}/")
        print("next: run the `orchestrator-setup` skill to write .claude/orchestrator.toml.")
    return 0


# ---- the post-commit hook: log the `commit` event deterministically ------------
# Telemetry used to rely on the orchestrating AGENT remembering to call
# `orchestrator.py log --event commit --sha <sha>` after every phase commit. It is
# exactly the kind of thing an agent forgets or misnames under a long run (found
# 2026-09-10: logged `phase_committed` instead of `commit`, silently zeroing the
# telemetry). A post-commit hook removes the agent from that path entirely: git
# itself calls it after every commit, in every worktree of this repo (hooks live in
# the shared .git dir), and it is a no-op everywhere except a worktree that is
# actually mid-orchestration.
_HOOK_MARKER = "# installed by orchestrator.py install-hooks -- do not hand-edit"


def _hook_script_path(root, hook="post-commit"):
    gd = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=root,
                        capture_output=True, text=True).stdout.strip()
    if not gd:
        return None
    if not os.path.isabs(gd):
        gd = os.path.join(root, gd)
    return os.path.join(gd, "hooks", hook)


# post-commit LOGS (never blocks — `|| true`); pre-commit ENFORCES (propagates the
# exit code so a failed gate blocks the commit). The pre-commit's docs fence (see
# _docs_fence) runs in every worktree of a guarded repo; everything else is a no-op outside
# a worktree with an active .agents/orchestrator/RUN.md.
#
# The bodies bake in the INSTALLING script's absolute path first and fall back to the
# repo's own copy: a team repo that does not vendor the skill (ISI) used to have hooks that
# silently `exit 0`ed because $root/.claude/skills/... did not exist. Missing both -> exit 0.
_ORCH_ABS = os.path.abspath(__file__)


def _sh_dq(value):
    """`value` escaped for a POSIX double-quoted string."""
    return re.sub(r'(["\\$`])', r"\\\1", value)


def _hook_locate(orch_abs):
    return (f'root="$(git rev-parse --show-toplevel)"\n'
            f'orch="{_sh_dq(orch_abs)}"\n'
            f'[ -f "$orch" ] || orch="$root/.claude/skills/prd-orchestrator/scripts/orchestrator.py"\n'
            f'[ -f "$orch" ] || exit 0\n')


def _post_commit_body(orch_abs=_ORCH_ABS):
    return _hook_locate(orch_abs) + (
        'mkdir -p "$root/.agents/orchestrator"\n'
        'python3 "$orch" --root "$root" hook-commit >> "$root/.agents/orchestrator/hook-errors.log" 2>&1 || true\n'
        'exit 0\n')


def _pre_commit_body(orch_abs=_ORCH_ABS):
    return _hook_locate(orch_abs) + (
        'python3 "$orch" --root "$root" hook-pre-commit || exit $?\n'
        # Repo-local checks (e.g. the wiki's slides deck gate) chain here, so they survive re-installs.
        'for h in "$root"/.claude/git-hooks/pre-commit.d/*; do [ -x "$h" ] || continue; "$h" || exit 1; done\n'
        'exit 0\n')


_POST_COMMIT_BODY = _post_commit_body()
_PRE_COMMIT_BODY = _pre_commit_body()


def _hook_text(body):
    return f"#!/bin/sh\n{_HOOK_MARKER}\n{body}"


def _install_one_hook(path, body, label):
    """Returns (state, error): state is 'installed'|'upgraded'|'present', or (None, msg) if a
    foreign hook is in the way. A hook carrying _HOOK_MARKER is ours and is rewritten in place
    when its body differs (e.g. an old relative-path body); a hook this skill did not write is
    never clobbered."""
    want = _hook_text(body)
    state = "installed"
    if os.path.exists(path):
        have = open(path, errors="replace").read()
        if _HOOK_MARKER not in have:
            subcmd = "hook-commit" if label == "post-commit" else "hook-pre-commit"
            return None, (f"a {label} hook already exists at {path} and was NOT written by this "
                          f"skill -- not overwriting it. Merge in `orchestrator.py {subcmd}` by hand.")
        if have == want:
            if not os.access(path, os.X_OK):
                os.chmod(path, 0o755)
            return "present", None
        state = "upgraded"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(want)
    os.chmod(path, 0o755)
    return state, None


def cmd_install_hooks(args):
    """Install the two git hooks that make the guardrails deterministic:
      - post-commit — auto-logs the `commit` event, so telemetry can't be forgotten.
      - pre-commit  — BLOCKS a phase commit whose gate has not passed (verify green,
                      plus any e2e/figma that actually ran). See cmd_hook_pre_commit.
    Idempotent; refuses to clobber a hook it did not write. Both are no-ops outside a
    worktree with an active RUN.md."""
    root = repo_root(args.root)
    post = _hook_script_path(root, "post-commit")
    if not post:
        print("not a git repo -- nothing to install"); return 1
    rc = 0
    for path, body, label in ((post, _POST_COMMIT_BODY, "post-commit"),
                              (_hook_script_path(root, "pre-commit"), _PRE_COMMIT_BODY, "pre-commit")):
        state, err = _install_one_hook(path, body, label)
        if err:
            print(err); rc = 1
        else:
            verb = {"present": "already installed", "upgraded": "upgraded"}.get(state, "installed")
            print(f"{verb} at {path}")
    if rc == 0:
        print("hooks live. In a worktree with an active RUN.md: every commit auto-logs a `commit` "
              "event, and a phase commit is blocked unless `orchestrator.py gate --phase N` has "
              "written phase-N/.gate-pass (or .agents/orchestrator/.gate-override is present). "
              "No-op everywhere else.")
    return rc


# ---- the docs guard: PRDs, plans and testing docs never land in a team repo -------
# They live in the workbench store (<wiki>/.planning). `guard install` makes that structural
# in a team repo: info/exclude hides the paths from `git add -A`/`git status`, and the
# pre-commit fence (_docs_fence) refuses any staged add, modify or delete under them -- so a
# `git add -f`, or a file that was tracked before the store existed, is still caught.
# Everything lives in the shared git-common-dir (exclude, config, hooks), so one install
# covers every worktree of the repo, and nothing is ever committed.
_GUARD_DOCS = ("docs/ai/prds/", "docs/ai/plans/")
_GUARD_DEFAULT_TESTING = "docs/ai/testing/"
_GUARD_STATE = ".workbench/"
_GUARD_COMMENT = "# workbench docs guard (orchestrator.py guard install) -- docs live in <wiki>/.planning"
_FENCE_DIFF = ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACDMRTUXB", "-z"]


def _git_out(root, *argv):
    """stdout of `git -C root ...` stripped, or None on a non-zero exit."""
    r = subprocess.run(["git", "-C", root, *argv], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def _norm_guard_dir(d):
    """A repo-relative dir as `a/b/`, or None when it is absolute or climbs out of the repo."""
    if not d or os.path.isabs(d):
        return None
    d = os.path.normpath(d).replace(os.sep, "/")
    if d in (".", "") or d == ".." or d.startswith("../"):
        return None
    return d.rstrip("/") + "/"


def _guard_patterns(root, testing_dir=None):
    """The guarded repo-relative dir prefixes for this repo: the PRD and plan dirs, the testing
    dir(s) (always the default, plus --testing-dir or the toml's [testing].dir when it is a
    different in-repo path), and the Workbench's .workbench/ state."""
    testing = [_GUARD_DEFAULT_TESTING]
    configured = testing_dir
    if configured is None and os.path.exists(config_path(root)):
        cfg, _ = load_config(root)
        configured = (cfg.get("testing") or {}).get("dir")
    extra = _norm_guard_dir(configured)
    if extra and extra not in testing:
        testing.append(extra)
    return list(_GUARD_DOCS) + testing + [_GUARD_STATE]


def _exclude_path(root):
    """<git-common-dir>/info/exclude (git resolves `info/` to the common dir in a linked
    worktree), absolute. None when root is not a git repo."""
    p = _git_out(root, "rev-parse", "--git-path", "info/exclude")
    if not p:
        return None
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(root, p))


def _exclude_lines(path):
    if not path or not os.path.exists(path):
        return set()
    return {ln.strip() for ln in open(path, errors="replace")}


def _pattern_present(pattern, lines):
    return pattern in lines or "/" + pattern in lines


def _fence_prefixes(root):
    """What the fence guards: the defaults plus whatever `guard install` recorded in
    workbench.docsFencePaths (comma or colon separated)."""
    recorded = _git_out(root, "config", "--get", "workbench.docsFencePaths") or ""
    out = list(_GUARD_DOCS) + [_GUARD_DEFAULT_TESTING, _GUARD_STATE]
    for item in re.split(r"[,:]", recorded):
        d = _norm_guard_dir(item.strip())
        if d and d not in out:
            out.append(d)
    return out


def _fence_hit(path, prefixes):
    for pre in prefixes:
        if path.startswith(pre) or path == pre.rstrip("/"):
            return True
        if pre == _GUARD_STATE and ("/" + _GUARD_STATE) in "/" + path:
            return True                     # .workbench/ is ignored at any depth, so fence it at any depth
    return False



# Scan added lines only; diagnostics must never disclose the matched credential.
_SECRET_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----",
    r"\bghp_[A-Za-z0-9]{30,}", r"\bsk-[A-Za-z0-9_-]{20,}",
    r"\bxox[abprs]-[A-Za-z0-9-]{10,}", r"\bAKIA[0-9A-Z]{16}\b",
    r"\b[A-Za-z0-9_]*_(?:TOKEN|SECRET|PASSWORD|KEY)\b[\"']?\s*[:=]\s*[\"']([^\"'\s]{16,})[\"']",
))


def _secret_fence(root):
    """Refuse staged secret literals, failing open on an internal error."""
    try:
        if os.environ.get("WORKBENCH_ALLOW_SECRETS") == "1":
            return 0
        diff = subprocess.run(["git", "-C", root, "diff", "--cached", "-U0", "--no-color",
                               "--diff-filter=AM"], capture_output=True, text=True)
        if diff.returncode:
            raise RuntimeError("staged diff failed")
        path, number, hits = "?", 0, []
        for line in diff.stdout.splitlines():
            if line.startswith("+++ "):
                path = line[6:]
            elif line.startswith("@@ "):
                number = int(re.search(r"\+(\d+)", line).group(1))
            elif line.startswith("+"):
                if any(pattern.search(line[1:]) for pattern in _SECRET_PATTERNS):
                    hits.append(f"{path}:{number}")
                number += 1
            elif line.startswith(" "):
                number += 1
        if not hits:
            return 0
        sys.stderr.write("pre-commit secret fence: staged credential at " + ", ".join(hits)
                         + ". Override: WORKBENCH_ALLOW_SECRETS=1\n")
        if os.path.exists(os.path.join(state_dir(root), "RUN.md")):
            _emit(root, "secret_fence_block", phase=_active_phase(root), detail=", ".join(hits))
        return 1
    except Exception:
        sys.stderr.write("pre-commit secret fence: internal error; allowing commit (fail open)\n")
        return 0


def _docs_fence(root):
    """The pre-commit docs fence. 1 = block (and say why), 0 = allow. Active only when
    `workbench.docsFence` is true (set by `guard install`). Bypass: WORKBENCH_ALLOW_DOCS=1.
    **Fails OPEN** with a stderr warning on any internal error -- a fence bug must never be
    able to wedge every commit in the repo."""
    try:
        if os.environ.get("WORKBENCH_ALLOW_DOCS") == "1":
            return 0
        if (_git_out(root, "config", "--bool", "--get", "workbench.docsFence") or "") != "true":
            return 0
        r = subprocess.run(["git", "-C", root, *_FENCE_DIFF], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"git diff --cached failed: {r.stderr.strip()}")
        prefixes = _fence_prefixes(root)
        hits = [p for p in r.stdout.split("\0") if p and _fence_hit(p, prefixes)]
        if not hits:
            return 0
        sys.stderr.write(
            "pre-commit docs fence: these staged paths are guarded:\n"
            + "".join(f"  {p}\n" for p in hits)
            + "PRDs, plans and testing docs live in the workbench store (<wiki>/.planning); never commit\n"
              "them to this repo. Unstage them (`git restore --staged <path>`; for a tracked file you\n"
              "meant to delete here, that is a human decision). Override for a deliberate human edit:\n"
              "  WORKBENCH_ALLOW_DOCS=1 git commit ...\n")
        if os.path.exists(os.path.join(state_dir(root), "RUN.md")):
            _emit(root, "docs_fence_block", phase=_active_phase(root),
                  detail=", ".join(hits[:20]) + (f" (+{len(hits) - 20} more)" if len(hits) > 20 else ""))
        return 1
    except Exception as e:
        sys.stderr.write(f"pre-commit docs fence: internal error, allowing the commit (fail open): {e}\n")
        return 0


def _guard_state(root, testing_dir=None):
    """Read-only snapshot of the guard for `guard status` and `preflight`."""
    excl = _exclude_path(root)
    lines = _exclude_lines(excl)
    patterns = _guard_patterns(root, testing_dir)
    pre = _hook_script_path(root, "pre-commit")
    hook_text = open(pre, errors="replace").read() if pre and os.path.exists(pre) else None
    return {
        "exclude": excl,
        "patterns": patterns,
        "missing": [p for p in patterns if not _pattern_present(p, lines)],
        "fence": (_git_out(root, "config", "--bool", "--get", "workbench.docsFence") or "") == "true",
        "fence_paths": _git_out(root, "config", "--get", "workbench.docsFencePaths") or "",
        "pre_commit": pre,
        "hook_present": hook_text is not None,
        "hook_marker": bool(hook_text and _HOOK_MARKER in hook_text),
        "hook_current": hook_text == _hook_text(_PRE_COMMIT_BODY),
        "hooks_path": _git_out(root, "config", "--get", "core.hooksPath") or "",
    }


def _guard_installed(st):
    return not st["missing"] and st["fence"] and st["hook_marker"]


def cmd_guard(args):
    root = repo_root(args.root)
    if _git_out(root, "rev-parse", "--git-dir") is None:
        print(f"{root} is not a git repo -- nothing to guard"); return 1
    if args.action == "status":
        st = _guard_state(root, args.testing_dir)
        print(f"exclude:     {st['exclude']}")
        for p in st["patterns"]:
            print(f"  {'present' if p not in st['missing'] else 'MISSING'}  {p}")
        print(f"docsFence:   {'true' if st['fence'] else 'unset'}"
              + (f"  (paths: {st['fence_paths']})" if st["fence_paths"] else ""))
        hook = ("absent" if not st["hook_present"] else
                "FOREIGN (no orchestrator marker)" if not st["hook_marker"] else
                "installed" if st["hook_current"] else "installed (stale body -- re-run guard install)")
        print(f"pre-commit:  {hook}  {st['pre_commit']}")
        print(f"hooksPath:   {st['hooks_path'] or 'unset'}"
              + ("  -- WARNING: git runs hooks from there, so the fence is bypassed" if st["hooks_path"] else ""))
        ok = _guard_installed(st)
        print("guard: installed" if ok else "guard: NOT installed -- run `orchestrator.py guard install`")
        return 0 if ok else 1

    # install
    patterns = _guard_patterns(root, args.testing_dir)
    excl = _exclude_path(root)
    lines = _exclude_lines(excl)
    add = [p for p in patterns if not _pattern_present(p, lines)]
    if add:
        os.makedirs(os.path.dirname(excl), exist_ok=True)
        existing = open(excl, errors="replace").read() if os.path.exists(excl) else ""
        with open(excl, "a") as f:
            if existing and not existing.endswith("\n"):
                f.write("\n")
            if _GUARD_COMMENT not in lines:
                f.write(_GUARD_COMMENT + "\n")
            f.write("".join(p + "\n" for p in add))
        print(f"exclude: added {', '.join(add)} to {excl}")
    else:
        print(f"exclude: already has every guarded path ({excl})")
    for key, val in (("workbench.docsFence", "true"), ("workbench.docsFencePaths", ",".join(patterns))):
        r = subprocess.run(["git", "-C", root, "config", "--local", key, val], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"git config {key} failed: {r.stderr.strip()}"); return 1
    print(f"config:  workbench.docsFence=true, workbench.docsFencePaths={','.join(patterns)}")
    rc = cmd_install_hooks(argparse.Namespace(root=root))
    hooks_path = _git_out(root, "config", "--get", "core.hooksPath")
    if hooks_path:
        print(f"WARNING: core.hooksPath is set ({hooks_path}) -- git runs hooks from there, not the "
              "installed ones, so the docs fence and the phase gate are bypassed in this repo.")
    print("guard installed" if rc == 0 else
          "guard partly installed -- exclude + config are in place, but the hooks could not be written")
    return rc


# Files that belong to one run; everything else in the state dir (events.jsonl is append-only across runs,
# learnings.jsonl spans PRDs, hook logs) stays put when a new run starts.
_PER_RUN = ("surface-final.json", "phase-*", "facts", "worker-hooks", "RUN.md", "review.md", "review*.md", "telemetry.md", "tabs.json",
            "pr-evidence-manifest.md", "e2e-contract.md", "deviations-*.md", "decisions.jsonl", "gaps.json",
            "gaps.md", "noticed.jsonl", "decided.jsonl", ".stop-gate-*", ".gate-override", "BUDGET-EXCEEDED",
            "GATE-FAILED-*", "PARK-REQUESTED", "known-failures", "baseline-dirty")
PARK_REQUEST = "PARK-REQUESTED"
_PARKED_DIR = "orchestrator-parked"


def _run_events(sd):
    path = os.path.join(sd, "events.jsonl")
    events = []
    if os.path.exists(path):
        with open(path, errors="replace") as stream:
            for line in stream:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    events.append(rec)
    return events


def _run_events_state(sd):
    state = "none"
    for rec in _run_events(sd):
        if rec.get("event") in ("run_start", "run_resumed"):
            state = "live"
        elif rec.get("event") == "run_end":
            state = "ended"
    return state


def _parked_blocks(text):
    blocks, current = [], None
    for line in text.splitlines():
        if line.startswith("## "):
            current = {} if line == "## Parked" else None
            if current is not None:
                blocks.append(current)
        elif current is not None:
            match = re.match(r"^- (Parked|Parked HEAD|Reason): (.*)$", line)
            if match:
                key = {"Parked": "parked", "Parked HEAD": "parked_head", "Reason": "reason"}[match[1]]
                current[key] = match[2]
    return blocks


def _parked_block(text):
    blocks = _parked_blocks(text)
    return blocks[-1] if blocks else {}


def _render_parked_block(ts, head, reason, dirty=()):
    reason = " ".join(reason.splitlines())
    block = f"\n## Parked\n- Parked: {ts}\n- Parked HEAD: {head}\n- Reason: {reason}\n"
    if dirty:
        block += f"- Dirty at park ({len(dirty)}, not this run's): {', '.join(dirty)}\n"
    return block


def _run_owned_paths(root, rows):
    """Every path a committed phase of this run changed (from the commit SHAs in RUN.md)."""
    owned = set()
    for row in rows:
        if len(row) > 4 and row[3] == "committed" and re.fullmatch(r"[0-9a-f]{7,40}", row[4]):
            out = _git_out(root, "show", "--name-only", "--format=", row[4])
            owned.update(p for p in (out or "").splitlines() if p)
    return owned


def _porcelain_path(line):
    path = line[3:]
    if " -> " in path:
        path = path.rsplit(" -> ", 1)[1]
    if path.startswith('"'):
        try:
            path = json.loads(path)
        except ValueError:
            pass
    return path


def _dirty_paths(root, sd, allow):
    # NUL records preserve spaces, quoting and rename destinations in the current tree.
    status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all", "-z"],
                            cwd=root, capture_output=True, text=True)
    if status.returncode:
        return f"cannot read the tree: {status.stderr.strip()}"
    baseline = set()
    for name in ("files.txt", "untracked.txt"):
        path = os.path.join(sd, "baseline-dirty", name)
        if os.path.exists(path):
            with open(path, errors="replace") as stream:
                for line in stream.read().splitlines():
                    if line:
                        baseline.add(_porcelain_path(line) if name == "files.txt" else line)
    prefixes = [p for p in baseline if p.endswith("/")] + list(allow)
    paths, records = [], iter(status.stdout.split("\0"))
    for rec in records:
        if not rec:
            continue
        path = rec[3:]
        if "R" in rec[:2] or "C" in rec[:2]:
            next(records, None)
        if path not in baseline and not any(path.startswith(p) for p in prefixes):
            paths.append(path)
    return sorted(set(paths))


def _phase_rows(sd):
    run = os.path.join(sd, "RUN.md")
    if not os.path.exists(run):
        return []
    with open(run, errors="replace") as stream:
        return [[c.strip() for c in line.strip().strip("|").split("|")]
                for line in stream if line.startswith("|") and "---" not in line
                and not line.lower().startswith("| #")]


def _head_sha(root):
    rec = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True)
    return rec.stdout.strip() if rec.returncode == 0 else "(unknown)"


def cmd_park(args):
    root = repo_root(args.root)
    sd = state_dir(root)
    run = os.path.join(sd, "RUN.md")
    if not os.path.isfile(run):
        print("no run to park", file=sys.stderr)
        return 1
    if _run_events_state(sd) == "ended":
        print("nothing to park — the run has ended", file=sys.stderr)
        return 1
    rows = _phase_rows(sd)
    if not args.force:
        for row in rows:
            if len(row) > 3 and row[3] not in ("committed", "pending"):
                print(f"phase {row[0]} is {row[3]} (park after this phase: write PARK-REQUESTED)",
                      file=sys.stderr)
                return 1
    committed = {row[0] for row in rows if len(row) > 3 and row[3] == "committed"}
    for marker in sorted(glob.glob(os.path.join(sd, "GATE-FAILED-*"))):
        phase = os.path.basename(marker).rsplit("-", 1)[-1]
        if not phase.isdigit() or phase not in committed:
            print(f"cannot park: {os.path.basename(marker)} for an uncommitted phase", file=sys.stderr)
            return 1
    cfg, _ = load_config(root)
    dirty = _dirty_paths(root, sd, cfg.get("park", {}).get("allow_dirty", []))
    if isinstance(dirty, str):
        print(f"cannot park: {dirty}", file=sys.stderr)
        return 1
    if dirty and getattr(args, "allow_dirty", False):
        # Unrelated work in a shared tree (the wiki) is not a reason to refuse; work this run
        # itself changed is -- that may be an uncommitted phase.
        clash = sorted(set(dirty) & _run_owned_paths(root, rows))
        if clash:
            print("cannot park: dirty paths this run's phases changed: " + ", ".join(clash[:10]),
                  file=sys.stderr)
            return 1
    elif dirty:
        print("cannot park: dirty paths: " + ", ".join(dirty[:10])
              + (f" (+{len(dirty) - 10} more)" if len(dirty) > 10 else "")
              + " -- commit or stash them, or park with --allow-dirty to record them and park anyway",
              file=sys.stderr)
        return 1
    slug = _run_slug(sd)
    if not _check_segments("park", [("slug", slug)]):
        return 1
    parked_base = os.path.join(os.path.dirname(sd), _PARKED_DIR)
    dest = os.path.join(parked_base, slug)
    if os.path.lexists(dest):
        print(f"cannot park: slug {slug} exists", file=sys.stderr)
        return 1
    print(json.dumps({"panes": [tab["pane_id"] for tab in _read_tabs(root) if tab.get("pane_id")]}))
    sys.stdout.flush()
    request = os.path.join(sd, PARK_REQUEST)
    reason = args.reason
    if not reason and os.path.exists(request):
        with open(request, errors="replace") as stream:
            first = next((line.strip() for line in stream if line.strip()), "")
        try:
            data = json.loads(first)
            reason = data.get("reason") if isinstance(data, dict) else first
        except ValueError:
            reason = first
    reason = reason or "parked via orchestrator.py park"
    if os.path.exists(request):
        os.remove(request)
    _emit(root, "run_end", run_id=_current_run_id(root), detail="parked")
    with open(run, "a") as stream:
        stream.write(_render_parked_block(_utc_now_iso(), _head_sha(root), reason, dirty or ()))
    os.makedirs(parked_base, exist_ok=True)
    os.rename(sd, dest)
    learnings = os.path.join(dest, "learnings.jsonl")
    if os.path.exists(learnings):
        os.makedirs(sd, exist_ok=True)
        shutil.copy2(learnings, os.path.join(sd, "learnings.jsonl"))
    print(json.dumps({"parked": slug, "dest": os.path.relpath(dest, root)}))
    return 0


def cmd_unpark(args):
    root = repo_root(args.root)
    if not _check_segments("unpark", [("slug", args.slug)]):
        return 1
    sd = state_dir(root)
    src = os.path.join(os.path.dirname(sd), _PARKED_DIR, args.slug)
    if os.path.islink(src) or not os.path.isfile(os.path.join(src, "RUN.md")):
        print(f"no parked run {args.slug}", file=sys.stderr)
        return 1
    if os.path.exists(os.path.join(sd, "RUN.md")):
        if _run_events_state(sd) == "live" and not args.force:
            print("a run is live in .agents/orchestrator", file=sys.stderr)
            return 1
        dest = _archive_run(sd)
        print(f"archived the previous run to {os.path.relpath(dest, root)}")
    elif os.path.isdir(sd):
        unexpected = sorted(set(os.listdir(sd)) - {"learnings.jsonl"})
        if unexpected:
            print("unexpected files in .agents/orchestrator: " + ", ".join(unexpected), file=sys.stderr)
            return 1
    live_learnings = os.path.join(sd, "learnings.jsonl")
    parked_learnings = os.path.join(src, "learnings.jsonl")
    if os.path.isfile(live_learnings):
        with open(live_learnings) as stream:
            extra = stream.read().splitlines()
        if extra:
            original = []
            if os.path.isfile(parked_learnings):
                with open(parked_learnings) as stream:
                    original = stream.read().splitlines()
            with open(parked_learnings, "w") as stream:
                stream.write("\n".join(dict.fromkeys(original + extra)) + "\n")
    if os.path.isdir(sd):
        shutil.rmtree(sd)
    os.rename(src, sd)
    request = os.path.join(sd, PARK_REQUEST)
    if os.path.exists(request):
        os.remove(request)
    run = os.path.join(sd, "RUN.md")
    with open(run, errors="replace") as stream:
        parked_head = _parked_block(stream.read()).get("parked_head") or "(unknown)"
    head = _head_sha(root)
    with open(run, "a") as stream:
        stream.write(f"Resumed: {parked_head} → {head} ({datetime.date.today().isoformat()})\n")
    _emit(root, "run_resumed", run_id=_current_run_id(root), detail=f"{parked_head}..{head}")
    print(f"resumed {args.slug}: {parked_head[:9]} → {head[:9]}")
    return 0


def _run_is_live(sd, stalled_s=120 * 60, now=None):
    """'phase N <status>' when RUN.md has a non-terminal phase row and RUN.md/events.jsonl changed within
    `stalled_s`; else None (finished, never started, or stalled)."""
    run = os.path.join(sd, "RUN.md")
    active = None
    for line in open(run, errors="replace"):
        if line.startswith("|") and "---" not in line and not line.lower().startswith("| #"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) > 3 and cells[3] not in ("committed", "failed", "held"):
                active = f"phase {cells[0]} {cells[3]}"
                break
    if not active:
        return None
    paths = [run, os.path.join(sd, "events.jsonl")]
    last = max(os.path.getmtime(p) for p in paths if os.path.exists(p))
    return active if (now or datetime.datetime.now().timestamp()) - last < stalled_s else None


def _run_slug(sd):
    run = os.path.join(sd, "RUN.md")
    with open(run, errors="replace") as stream:
        m = re.search(r"(?m)^PRD:\s*(\S+)", stream.read())
    return re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(m.group(1)) if m else "run").removesuffix(".md") or "run"


def _archive_run(sd):
    """Copy the whole state dir to <repo>/.agents/orchestrator-archive/<prd-slug>[-N]/ (the Telemetry harvester
    reads that folder), then remove the per-run files. A routing.json newer than RUN.md was written for the
    NEXT run (Workbench writes it before the orchestrator's init) and is kept."""
    run = os.path.join(sd, "RUN.md")
    slug = _run_slug(sd)
    base = os.path.join(os.path.dirname(sd), "orchestrator-archive")
    dest, n = os.path.join(base, slug), 2
    while os.path.exists(dest):
        dest, n = os.path.join(base, f"{slug}-{n}"), n + 1
    shutil.copytree(sd, dest, symlinks=True)
    routing = os.path.join(sd, "routing.json")
    keep_routing = os.path.exists(routing) and os.path.getmtime(routing) > os.path.getmtime(run)
    doomed = set()
    for pat in _PER_RUN + (() if keep_routing else ("routing.json",)):
        doomed.update(glob.glob(os.path.join(sd, pat)))
    for p in sorted(doomed):
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p)
        elif os.path.lexists(p):
            os.remove(p)
    return dest


def _active_phase(root):
    """The first non-terminal phase number in RUN.md's table, or None. Shared by the
    post-commit logger and the pre-commit gate so both agree on 'the phase being
    committed'. Returns None when there is no RUN.md, no matching row, or the phase
    cell is not an integer."""
    run_path = os.path.join(state_dir(root), "RUN.md")
    if not os.path.exists(run_path):
        return None
    for line in open(run_path, errors="replace"):
        if line.startswith("|") and "---" not in line and not line.lower().startswith("| #"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) > 3 and cells[3] not in ("committed", "failed", "held"):
                try:
                    return int(cells[0])
                except ValueError:
                    return None
    return None


def _set_phase_row(root, n, status, commit):
    """Set phase N's status and commit cells in RUN.md's table; every other line is kept
    byte-for-byte. The table is what Workbench and `_active_phase` read, and SKILL.md step 7
    left it to the agent -- PRD-4 (2026-10-23) committed phases 6-10 with rows still
    `pending`, so the card stuck at phase 6 and the post-commit hook logged every commit
    as phase 6. Returns True when a row changed."""
    run_path = os.path.join(state_dir(root), "RUN.md")
    if not os.path.exists(run_path):
        return False
    with open(run_path, errors="replace") as stream:
        lines = stream.readlines()
    changed = False
    for i, line in enumerate(lines):
        if not line.startswith("|") or "---" in line or line.lower().startswith("| #"):
            continue
        cells = line.rstrip("\r\n").strip().strip("|").split("|")
        if len(cells) < 5 or cells[0].strip() != str(n):
            continue
        cells[3], cells[4] = f" {status} ", f" {commit} "
        end = line[len(line.rstrip("\r\n")):]
        lines[i] = "|" + "|".join(cells) + "|" + end
        changed = lines[i] != line
        break
    if changed:
        tmp = run_path + ".tmp"
        with open(tmp, "w") as stream:
            stream.writelines(lines)
        os.replace(tmp, run_path)
    return changed


def _runtime_only(root, paths):
    """True when `paths` is non-empty and every path is a runtime-written tracked path --
    one of the repo's `[validation].ignore` globs/prefixes. Such a commit (a PRD status
    change, a store commit, a todo, a feedback entry) is never a phase's commit, even in a
    repo where a run is live: the wiki is both the PRD store and the target of runs that
    build in it. 2026-11-16: a live Picasso run (phase 5 pending) blocked every Workbench
    PRD status change and logged an unrelated PRD's store commit as phase-5 usage."""
    if not paths:
        return False
    cfg, _ = load_config(root)
    globs = [g for g in cfg.get("validation", {}).get("ignore") or [] if isinstance(g, str)]
    return bool(globs) and all(_tree_excluded(p, globs, []) for p in paths)


def _staged_paths(root):
    """Repo-relative paths staged for the commit in progress, or None if git fails."""
    r = subprocess.run(["git", "-C", root, *_FENCE_DIFF], capture_output=True, text=True)
    return [p for p in r.stdout.split("\0") if p] if r.returncode == 0 else None


def _head_paths(root):
    """Repo-relative paths HEAD changed (the commit just made), or None if git fails."""
    r = subprocess.run(["git", "-C", root, "diff-tree", "--root", "--no-commit-id", "--name-only",
                        "--no-renames", "-r", "-z", "HEAD"], capture_output=True, text=True)
    return [p for p in r.stdout.split("\0") if p] if r.returncode == 0 else None


def cmd_hook_commit(args):
    """Called by the installed post-commit hook, never directly by the orchestrating
    agent. Best-effort and silent on any error the caller already redirects to a log
    file -- a telemetry hook must never be able to block a real commit."""
    root = repo_root(args.root)
    phase = _active_phase(root)
    if phase is None:
        return 0   # no active phase -- not an orchestrator commit, or a post-run one
    if _runtime_only(root, _head_paths(root)):
        return 0   # a store/status/todo commit -- never attributed to the phase or its usage
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root,
                         capture_output=True, text=True).stdout.strip()
    _emit(root, "commit", phase=phase, sha=sha, detail="auto-logged by post-commit hook")
    print(f"post-commit hook: logged commit {sha[:9]} for phase {phase}")
    # Deterministic per-phase token capture: harvest the window since the last
    # checkpoint and emit a `usage` event (+ budget check), so telemetry no longer
    # depends on the agent remembering `orchestrator.py usage`. Best-effort -- a
    # telemetry harvest must never be able to break a commit that already happened.
    try:
        _auto_usage(root, phase)
    except Exception:
        pass
    return 0


def cmd_hook_pre_commit(args):
    """Called by the installed pre-commit hook. BLOCKS (exit 1) a phase commit whose
    gate has not passed; allows (exit 0) everywhere else. **Fails OPEN on any
    unexpected error** — a bug in here must never be able to wedge every commit in the
    repo; only a deliberate, identified gate failure returns non-zero."""
    try:
        root = repo_root(args.root)
        if _secret_fence(root):
            return 1
        if _docs_fence(root):                          # first, in every worktree, RUN.md or not
            return 1
        sd = state_dir(root)
        if not os.path.exists(os.path.join(sd, "RUN.md")):
            return 0                                   # not an orchestrator worktree
        if os.path.exists(os.path.join(sd, ".gate-override")):
            return 0                                   # explicit, audited bypass (names its reason)
        phase = _active_phase(root)
        if phase is None:
            return 0                                   # no non-terminal phase -- not our commit
        if os.path.exists(_gate_pass_path(root, phase)):
            return 0                                   # gate passed for this phase
        if _runtime_only(root, _staged_paths(root)):
            return 0                                   # only runtime-written paths -- not a phase commit
        # Store mode (RUN.md has `Store:`): a failed/blocked phase's scenario lives in the WIKI
        # store, so there is no docs-only team-repo commit and no reason to write .gate-override;
        # `store-commit --reason failed` records it in the wiki instead. The override above stays
        # honoured for legacy runs only in practice -- nothing here requires it when Store is set.
        hint = (f"  A failed/blocked phase's scenario is in the store -- record it with\n"
                f"  `orchestrator.py store-commit --phase {phase} --reason failed`, not a team-repo commit.\n"
                if _store(root) else
                f"  For a deliberate docs-only commit of a failed/blocked scenario, first write\n"
                f"  .agents/orchestrator/.gate-override with a one-line reason.\n")
        sys.stderr.write(
            f"pre-commit gate: phase {phase} has not passed the orchestrator gate.\n"
            f"  Run `orchestrator.py gate --phase {phase}` — it re-checks verify (build+test) plus any\n"
            f"  e2e/figma that ran, and writes phase-{phase}/.gate-pass on success.\n" + hint)
        _emit(root, "gate_block_commit", phase=phase)
        return 1
    except Exception:
        return 0                                       # fail open — never wedge commits over a bug here


def cmd_setup(args):
    """Probe the repo and write a draft .claude/orchestrator.toml.

    Deterministic detection only -- everything it cannot prove becomes a TODO for
    the `orchestrator-setup` skill (or a human) to settle. `preflight` refuses to
    run while a TODO remains, so a half-configured repo fails loudly, not subtly.
    """
    root = repo_root(args.root)
    out = config_path(root)
    if os.path.exists(out) and not args.force:
        print(f"{out} already exists (use --force to overwrite)"); return 1

    def has(*rel):
        return any(glob.glob(os.path.join(root, r), recursive=True) for r in rel)

    def pkg_scripts():
        try:
            with open(os.path.join(root, "package.json")) as f:
                return json.load(f).get("scripts", {}) or {}
        except Exception:
            return {}

    levels, notes, app = [], [], {}
    scripts = pkg_scripts()

    if has("*.sln", "**/*.sln"):
        sln = os.path.basename(sorted(glob.glob(os.path.join(root, "*.sln")) or
                                      glob.glob(os.path.join(root, "**/*.sln"), recursive=True))[0])
        levels.append(("build", f"dotnet build {sln} --configuration Release", "0 errors"))
        levels.append(("test", f"dotnet test {sln}", "all pass"))
        notes.append(f"detected .NET solution: {sln}")
    elif has("**/*.csproj"):
        levels.append(("build", "dotnet build --configuration Release", "0 errors"))
        levels.append(("test", "dotnet test", "all pass"))
        notes.append("detected .NET projects (no .sln)")

    if scripts:
        if "build" in scripts:
            levels.append(("frontend-build", "npm run build", "build clean"))
        # a bare `vitest`/`jest` script never exits -- prefer an explicit non-watch one
        test_key = next((k for k in ("test:coverage", "test:ci", "test:unit") if k in scripts), None)
        if test_key:
            levels.append(("frontend-test", f"npm run {test_key}", "green"))
            notes.append(f"chose `npm run {test_key}` over bare `test` (watch-mode risk)")
        elif "test" in scripts:
            levels.append(("frontend-test", "TODO: `npm run test` may be watch mode — confirm a "
                                            "non-watch script", "green"))
    if has("pyproject.toml", "setup.py"):
        levels.append(("test", "TODO: your python test command (pytest?)", "all pass"))
        notes.append("detected a Python project")
    if has("go.mod"):
        levels.append(("build", "go build ./...", "0 errors"))
        levels.append(("test", "go test ./...", "all pass"))
    if has("Cargo.toml"):
        levels.append(("build", "cargo build --release", "0 errors"))
        levels.append(("test", "cargo test", "all pass"))
    if has("Makefile") and not levels:
        levels.append(("build", "TODO: make <target>", "0 errors"))
    if not levels:
        levels.append(("build", "TODO: your build command", "0 errors"))
        levels.append(("test", "TODO: your test command", "all pass"))

    plans_dir = next((d for d in ("docs/ai/plans", "docs/plans", ".agents/plans")
                      if os.path.isdir(os.path.join(root, d))), "docs/ai/plans")
    standards = next((d for d in (".claude/standards/*.md", "docs/standards/*.md")
                      if glob.glob(os.path.join(root, d))), ".claude/standards/*.md")
    always = [f for f in ("AGENTS.md", "CLAUDE.md") if os.path.exists(os.path.join(root, f))]
    divergence = next((f for f in ("docs/ai/KNOWN-ISSUES.md", "KNOWN-ISSUES.md")
                       if os.path.exists(os.path.join(root, f))), "")

    ignored = subprocess.call(["git", "check-ignore", "-q", state_dir(root)], cwd=root) == 0
    slug = re.sub(r"[^a-z0-9]+", "-", os.path.basename(root).lower()).strip("-") or "app"

    def toml_str(v):
        return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'

    L = ["# Generated by `orchestrator.py setup --detect`. Fill every TODO, then run",
         "# `orchestrator.py config --check`. Preflight refuses to run while a TODO remains."]
    for n in notes:
        L.append(f"#   detected: {n}")
    L += ["", "[skills]", 'plan = "plan-feature"', 'exec = "execute"', "", "[validation]", "levels = ["]
    for name, cmd, exp in levels:
        L.append(f"  {{ name = {toml_str(name)}, cmd = {toml_str(cmd)}, expect = {toml_str(exp)} }},")
    L += ["]", "",
          "[app]",
          "# Delete this whole section if the repo has no runnable app: every phase's",
          "# e2e gate then records N/A automatically instead of asking.",
          'start       = "TODO: command that starts the app"',
          'url         = "TODO: http://localhost:PORT"',
          '# A 200 is NOT proof the app is up -- probe something only this app emits.',
          'ready_probe = "TODO: path:/health  (or header:X=Y / text:<marker> / cmd:<shell>)"',
          "timeout_s   = 300", "",
          "[plans]", f"dir = {toml_str(plans_dir)}", "",
          "[e2e]",
          'profile        = ".claude/e2e/profile.md"',
          f"session_prefix = {toml_str(slug + '-e2e')}", "",
          "[testing]",
          f"dir             = {toml_str('docs/ai/testing')}",
          'capture         = "on"',
          "scenario_schema = 1",
          "retain_raw      = false", "",
          "[knowledge]",
          f"standards      = {toml_str(standards)}"]
    if divergence:
        L.append(f"divergence_log = {toml_str(divergence)}")
    L += [f"always_loaded  = [{', '.join(toml_str(a) for a in always)}]"
          "   # @-imported everywhere; NEVER auto-committed",
          "generated      = []", "",
          "[boundary_checks]",
          "checks = []"]

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write("\n".join(L) + "\n")

    print(f"wrote {out}")
    for n in notes:
        print(f"  detected: {n}")
    todos = _todo_markers(root)
    print(f"  {len(todos)} TODO(s) to settle:")
    for t in todos:
        print(f"    {t}")
    if not ignored:
        print(f"\n  ⚠️  {os.path.relpath(state_dir(root), root)} is NOT gitignored — add `/.agents/` "
              f"to .gitignore or run state would be committable.")
    store = _store(root)
    if store:
        print(f"\n  store: {store} -- this run's plans and testing docs go there; the [plans].dir and "
              f"[testing].dir written above are superseded by Store (legacy runs only).")
    else:
        print(f"\n  store: none yet -- `init --prd <store PRD>` sets one under {_store_root()}; "
              f"until then [plans].dir / [testing].dir apply (legacy mode).")
    print("\nnext: run the `orchestrator-setup` skill to settle the TODOs and verify each command.")
    return 0


def cmd_config(args):
    """Validate the repo's orchestrator.toml and resolve everything it names.
    Exit 0 = usable. Exit 1 = something a run would trip over."""
    root = repo_root(args.root)
    cfg, problems = load_config(root)
    print(f"root:   {root}")
    print(f"config: {config_path(root)}"
          + ("" if os.path.exists(config_path(root)) else "   [MISSING -> defaults]"))

    levels = cfg["validation"].get("levels") or []
    if not levels:
        problems.append("[validation] declares no levels -- the builder has nothing to run")
    for lv in levels:
        if not isinstance(lv, dict) or not lv.get("cmd"):
            problems.append(f"[validation] level missing a `cmd`: {lv!r}"); continue
        exe = shlex.split(lv["cmd"])[0] if lv["cmd"].strip() else ""
        # probe that the tool exists WITHOUT executing the level itself
        rc = subprocess.call(f"command -v {shlex.quote(exe)} >/dev/null 2>&1", shell=True)
        mark = "ok " if rc == 0 else "??"
        if rc != 0:
            problems.append(f"[validation] `{exe}` not on PATH (level {lv.get('name','?')})")
        print(f"  level {lv.get('name','?'):<10} {mark} {lv['cmd']}")
        if "failure_pattern" in lv:
            try:
                _failure_pattern(lv["failure_pattern"])
            except (re.error, ValueError, TypeError) as error:
                problems.append(f"[validation] invalid failure_pattern ({lv.get('name', '?')}): {error}")
        if lv.get("known_failures") and not os.path.isfile(os.path.join(root, lv["known_failures"])):
            print(f"  warning: known_failures path missing: {lv['known_failures']} (a state seed may supply it)")

    for lv in levels:
        if not isinstance(lv, dict) or "paths" not in lv:
            continue
        paths = lv["paths"]
        if not isinstance(paths, list) or any(not isinstance(p, str) or not p.strip() or
                p.startswith("/") or ".." in p.split("/") or any(c in p for c in "*?[") for p in paths):
            problems.append(f"[validation] invalid paths ({lv.get('name', '?')}): repo-relative prefixes required")
        else:
            for path in paths:
                if not os.path.exists(os.path.join(root, path)):
                    print(f"  warning: validation paths prefix missing: {path}")
    if "ignore" in cfg["validation"]:
        ignore = cfg["validation"]["ignore"]
        if not isinstance(ignore, list) or any(not isinstance(g, str) or not g.strip() or
                g.startswith("/") or ".." in g.split("/") for g in ignore):
            problems.append("[validation] ignore must be a list of repo-relative globs")
    notes = cfg["knowledge"].get("scope_notes")
    if notes and not os.path.isfile(os.path.join(root, notes)):
        problems.append(f"knowledge.scope_notes missing: {notes}")

    store = _store(root)
    if store:
        srepo = _store_repo(store)
        print(f"  store          {'ok ' if os.path.isdir(store) else 'MISSING'} {store}"
              f"  (repo {srepo or 'NONE'})")
        print(f"  store plans    {_disp(_plans_dir(root, cfg), root)}")
        print(f"  store testing  {_disp(_testing_dir(root, cfg), root)}")
        if not os.path.isdir(store):
            problems.append(f"Store {store} (from RUN.md) does not exist -- `orchestrator.py store path` creates it")
        elif not srepo:
            problems.append(f"Store {store} is not inside a git repo -- store-commit cannot record it")
    else:
        print("  store          -- none (legacy mode: plans/testing under this worktree)")

    for key, val in (("plans.dir", cfg["plans"].get("dir")),
                     ("testing.dir", cfg["testing"].get("dir")),
                     ("e2e.profile", cfg["e2e"].get("profile"))):
        if not val:
            continue
        if store and key in ("plans.dir", "testing.dir"):
            print(f"  {key:<14} --  {val}  (superseded by Store; legacy runs only)")
            continue
        full = os.path.join(root, val)
        ok = os.path.exists(full)
        print(f"  {key:<14} {'ok ' if ok else 'MISSING'} {val}")
        if key in ("plans.dir", "testing.dir") and not os.path.isabs(val):
            relative = os.path.relpath(os.path.abspath(full), root)
            probe = relative.rstrip("/") + "/.probe"
            globs = cfg["validation"].get("ignore") or []
            globs = [g for g in globs if isinstance(g, str)] if isinstance(globs, list) else []
            prefixes = cfg.get("scope", {}).get("exclude", []) + cfg.get("park", {}).get("allow_dirty", [])
            if relative != ".." and not relative.startswith("../") and not _is_ignored(root, probe) \
                    and not _tree_excluded(probe, globs, prefixes):
                print(f"  warning: {key} {val} is in-tree and not gitignored -- the verify tree hash "
                      "always excludes it; gitignore it or list it in [validation] ignore")
        if not ok and key == "e2e.profile":
            problems.append(f"[e2e] profile does not exist: {val}")

    testing = cfg.get("testing") or {}
    if testing.get("capture") not in ("on", "off"):
        problems.append("[testing].capture must be `on` or `off`")
    if testing.get("scenario_schema") != 1:
        problems.append("[testing].scenario_schema must be 1")
    if testing.get("retain_raw") is not False:
        problems.append("[testing].retain_raw must be false; raw trace/media are never committed")
    if testing.get("capture") == "on":
        if store:
            candidate = os.path.join(_testing_dir(root, cfg), ".scenario.md")
            if os.path.isdir(store) and _is_ignored(root, candidate, repo=_testing_repo(root)):
                problems.append("the Store's testing dir is gitignored in its repo; promoted E2E "
                                "scenarios would not survive")
        else:
            candidate = os.path.join(root, testing.get("dir") or "docs/ai/testing", ".scenario.md")
            if _is_ignored(root, candidate):
                problems.append("[testing].dir is gitignored; promoted E2E scenarios would not survive")

    figma = cfg.get("figma") or {}
    if figma.get("enabled"):
        if not figma.get("file_key"):
            problems.append("[figma].enabled is true but [figma].file_key is unset")
        api = os.path.join(root, FIGMA_API_REL)
        api_ok = os.path.exists(api)
        print(f"  figma          {'ok ' if api_ok and figma.get('file_key') else '?? '} "
              f"enabled (file_key {'set' if figma.get('file_key') else 'MISSING'})")
        if not api_ok:
            problems.append(f"[figma] enabled but figma-extractor missing: {FIGMA_API_REL}")
        storage_error = _figma_storage_error(root, cfg, "preflight")
        if storage_error:
            problems.append(storage_error)
        try:
            _figma_checks(root, cfg)
        except ValueError as error:
            problems.append(str(error))
    else:
        print("  figma          -- disabled (figma fidelity gate N/A for every phase)")

    for spec in cfg["knowledge"].get("generated") or []:
        pat = spec.get("paths") if isinstance(spec, dict) else spec
        n = len(glob.glob(os.path.join(root, pat), recursive=True)) if pat else 0
        print(f"  knowledge      {'ok ' if n else '?? '} {pat}  ({n} files)")

    if "surface" in cfg:
        before = len(problems)
        scfg = _surface_cfg(cfg, problems)
        if len(problems) == before:
            print(f"  surface        ok  {len(scfg['paths'])} categor(y|ies), "
                  f"{len(scfg['test_globs'])} test glob(s), {len(scfg['skip_patterns'])} skip pattern(s)")
    else:
        print("  surface        --  off ([surface] absent)")

    todos = _todo_markers(root)
    problems += [f"unfilled TODO -- {t}" for t in todos]

    if problems:
        print("\nproblems:")
        for pr in problems:
            print(f"  - {pr}")
        return 1
    print("\nconfig OK")
    return 0


def _skill_version(path):
    """Read `version:` from a SKILL.md front-matter block."""
    try:
        with open(path, errors="replace") as f:
            for i, line in enumerate(f):
                if i > 12:
                    break
                if line.startswith("version:"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return "?"


def cmd_preflight(args):
    """Assert a worker can ACTUALLY start here before the run spends anything.

    Exit 0 = clear to run. Exit 1 = a human must act first.
    The trust check is the important one -- see reference/worker-preflight.md.
    """
    root = repo_root(args.root)
    fail, warn = [], []
    print(f"root:       {root}")

    # Budget gate: if a prior phase's usage check tripped [budget].max_cost_usd it wrote
    # this sentinel. Preflight runs before each phase, so refusing here is where the run
    # actually stops spending -- the post-commit hook that detected it cannot un-commit.
    sentinel = _budget_sentinel_path(root)
    if os.path.exists(sentinel):
        detail = open(sentinel, errors="replace").read().strip() or "budget exceeded"
        fail.append(f"BUDGET EXCEEDED — {detail}. Halt and surface to Chris; "
                    f"delete {os.path.relpath(sentinel, root)} to override and continue.")

    inside = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=root,
                            capture_output=True, text=True).stdout.strip() == "true"
    if not inside:
        fail.append("not inside a git work tree")
    common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=root,
                            capture_output=True, text=True).stdout.strip()
    gitdir = subprocess.run(["git", "rev-parse", "--git-dir"], cwd=root,
                            capture_output=True, text=True).stdout.strip()
    is_worktree = bool(common) and os.path.abspath(os.path.join(root, common)) != \
        os.path.abspath(os.path.join(root, gitdir))
    print(f"worktree:   {'yes' if is_worktree else 'no (main checkout)'}")
    if not is_worktree:
        warn.append("running in the main checkout, not a worktree -- state and commits "
                    "are not isolated per ticket")

    trusted, detail = trust_state(root)
    print(f"trust:      {'OK' if trusted else 'NOT TRUSTED'} -- {detail}")
    if not trusted:
        if getattr(args, "trust", False):
            ok, msg = grant_trust(root)
            print(f"trust:      {msg}")
            if not ok:
                fail.append(msg)
        else:
            fail.append(
                "this folder is NOT trusted, so an interactive worker will show the "
                "folder-trust dialog (default: 'No, exit'), silently exit, and never write "
                "its artifact -- while herdr still reports ready/idle. "
                "Fix: `orchestrator.py preflight --trust`.")

    sd = state_dir(root)
    rc = subprocess.call(["git", "check-ignore", "-q", sd], cwd=root)
    print(f"state dir:  {'gitignored' if rc == 0 else 'NOT IGNORED'} -- {sd}")
    if rc != 0:
        fail.append(f"{os.path.relpath(sd, root)} is not gitignored -- run state and the "
                    "deviation report would be committable. Add `/.agents/` to .gitignore.")

    # The store: where this run's plans and testing docs live (the wiki, never the team repo).
    store = _store(root)
    if store:
        srepo = _store_repo(store) if os.path.isdir(store) else None
        print(f"store:      {store}" + (f"  (repo {srepo})" if srepo else ""))
        if not os.path.isdir(store):
            fail.append(f"Store {store} (from RUN.md) does not exist -- create it with "
                        f"`orchestrator.py store path --context <ctx> --feature <id>`")
        elif not srepo:
            fail.append(f"Store {store} is not inside a git repo -- `store-commit` could not record "
                        f"the run's plans and scenarios")
    else:
        print("store:      none (legacy mode)")
        warn.append("no `Store:` in RUN.md -- legacy mode: plans and testing docs are written into "
                    "this worktree. Re-run `init --prd <absolute store PRD>` (or `--store DIR`) to use the store.")

    # The docs guard (info/exclude + workbench.docsFence + the marker pre-commit hook): required in
    # store mode, where a PRD/plan/testing doc landing in this repo is a bug; advisory in legacy mode.
    if inside:
        gs = _guard_state(root)
        print(f"guard:      {'installed' if _guard_installed(gs) else 'NOT installed'}")
        gaps_ = []
        if gs["missing"]:
            gaps_.append("info/exclude lacks " + ", ".join(gs["missing"]))
        if not gs["fence"]:
            gaps_.append("workbench.docsFence is unset")
        if not gs["hook_marker"]:
            gaps_.append("no orchestrator pre-commit hook" if not gs["hook_present"] else
                         f"the pre-commit hook at {gs['pre_commit']} is not this skill's (merge "
                         f"`orchestrator.py hook-pre-commit` into it by hand)")
        if gaps_:
            msg = ("docs guard not installed (" + "; ".join(gaps_) + ") -- run "
                   "`orchestrator.py guard install`")
            (fail if store else warn).append(msg)
        if gs["hooks_path"]:
            warn.append(f"core.hooksPath is set ({gs['hooks_path']}) -- git runs hooks from there, so the "
                        "docs fence and the phase-commit gate are bypassed in this repo")

    # The e2e roster: the end-of-PRD gate needs a machine license from machines.md. Resolving it
    # here means a missing roster stops the run at kickoff, not as a skipped gate at close-out.
    if inside:
        cfg_, _ = load_config(root)
        # Only repos whose app gates sign-in on machine licences declare `[e2e] roster = true`.
        if (cfg_.get("e2e") or {}).get("roster") and _e2e_skill_present(root):
            roster = _e2e_roster_path(root)
            if roster:
                print(f"e2e roster: {roster}")
            else:
                fail.append("e2e roster not found: the e2e-orchestrator's machines.md is in neither "
                            "this tree nor the main clone; the e2e gate cannot pick a machine license")

    # Version drift: a worktree's copy of the skills can be months behind the
    # canonical one. Warn, never block -- see the distribution note in README.
    canon = os.environ.get("ORCH_CANONICAL_SKILLS")
    if canon:
        for skill in ("prd-orchestrator", "execute", "plan-feature"):
            mine = os.path.join(root, ".claude", "skills", skill, "SKILL.md")
            theirs = os.path.join(canon, skill, "SKILL.md")
            if not (os.path.exists(mine) and os.path.exists(theirs)):
                continue
            if _skill_version(mine) != _skill_version(theirs):
                warn.append(f"{skill} is v{_skill_version(mine)} here but "
                            f"v{_skill_version(theirs)} canonically — this worktree is stale")

    # The package deal: the orchestrator invokes these BY NAME, so a target repo
    # missing one silently stalls when the loop reaches that stage. Warn only.
    cfg, problems = load_config(root)
    for pr in problems:
        warn.append(pr)

    skills_dir = os.path.join(root, ".claude", "skills")
    for name in ("plan-feature", "execute", "e2e-test"):
        if not os.path.isdir(os.path.join(skills_dir, name)):
            warn.append(f"required skill '{name}' is not in .claude/skills/ -- the loop "
                        f"invokes it by name. Run `orchestrator.py install`.")

    # agent-browser is the e2e engine. Only relevant when the repo has a runnable app.
    if cfg["app"].get("url") or cfg["app"].get("start"):
        if subprocess.call("command -v agent-browser >/dev/null 2>&1", shell=True) != 0:
            warn.append("agent-browser is not on PATH -- the e2e gate cannot drive a browser. "
                        "Install it (brew install agent-browser), then `agent-browser doctor`.")
        else:
            # surface the vendor's own environment check (its thresholds, not ours)
            doc = subprocess.run(["agent-browser", "doctor"], capture_output=True, text=True)
            out = (doc.stdout or "") + (doc.stderr or "")
            if re.search(r"(?im)^\s*pass\s+Google Chrome", out) is None:
                warn.append("agent-browser doctor does not report Chrome as present -- the e2e "
                            "gate needs a browser. Run `agent-browser doctor` and read its output.")
            if subprocess.call("command -v ffmpeg >/dev/null 2>&1", shell=True) != 0:
                warn.append("ffmpeg is not on PATH -- e2e video recording will be skipped "
                            "(screenshots still captured). `brew install ffmpeg` to enable it.")

    if os.environ.get("HERDR_ENV") != "1":
        warn.append("HERDR_ENV != 1 -- the loop needs herdr 0.9+ to open worker tabs")

    hook_path = _hook_script_path(root)
    if hook_path and not os.path.exists(hook_path):
        warn.append("no post-commit hook installed -- the `commit` telemetry event relies on "
                     "the agent remembering to log it by hand. Fix: `orchestrator.py install-hooks`.")

    routing, rproblems = load_routing(root)
    fail.extend(rproblems)
    if routing is not None:
        kinds = {st: stage_route(root, st)["kind"] for st in ROUTING_STAGES}
        print("routing:    " + ", ".join(f"{k}={v}" for k, v in kinds.items()) + "  (routing.json)")
        if kinds["builder"] != "claude" and (_run_field(root, "Autonomy gate") or "").startswith("autonomous"):
            # Allowed (Chris, 2026-10-07): a non-Claude builder has no git fence, so it COULD commit or push on
            # its own; the orchestrator's pre-commit gate still guards the commits it makes itself.
            warn.append(f"Autonomy gate is autonomous and the builder runs on {kinds['builder']} -- it has no git "
                        "fence, so nothing stops that worker committing or pushing itself. Check `git log` after each phase.")
        for st, k in kinds.items():
            if k != "claude":
                warn.append(f"{st} runs on {k}: no Stop gate or git fence for that worker")
    engine = e2e_engine(root)
    print(f"e2e engine: {engine}" + (" (Claude worker as fallback)" if engine == "nimble" else ""))
    if engine == "nimble":
        problem = nimble_health()
        if problem:
            warn.append(f"Nimble e2e engine unavailable ({problem}) -- every e2e phase will use the "
                        "Claude worker fallback. Fix: start Ollama and `ollama pull nimble:9b`.")
        rc, health = pilot_library("health")
        if rc == 0:
            print(f"e2e {health}")   # what this PRD inherits from every run before it

    todos = _todo_markers(root)
    if todos:
        fail.append(f"{len(todos)} unfilled TODO in {CONFIG_REL} -- run the "
                    "`orchestrator-setup` skill to finish it")

    for w in warn:
        print(f"  warn: {w}")
    if fail:
        print("\nBLOCKED -- fix before starting a run:")
        for f_ in fail:
            print(f"  - {f_}")
        return 1
    print("\npreflight OK")
    return 0


# ---- the deviation report (replaces check + render) -------------------------
# A record is admissible only if the agent can QUOTE THE PRD. That single
# requirement is self-enforcing: implementation decisions have no quote to make.

BLAST_RANK = {"schema": 0, "money": 1, "data": 2, "auth": 3, "api-contract": 4}
ONE_WAY_BLAST = {"schema", "money", "data", "auth"}
KINDS = {"contradicts", "extends", "reinterprets", "architecture"}


def _prd_text(root, prd):
    if not prd:
        return None
    try:
        return open(_resolve_prd(root, prd), errors="replace").read()
    except OSError:
        return None


def _norm(t):
    return " ".join((t or "").split()).lower()


def validate_record(d, root, prd_body):
    """Mechanically check one deviation record. Returns list of problems (empty = valid).
    A failing record is DROPPED from the report with a note -- never blocked."""
    probs = []
    if d.get("kind") not in KINDS:
        probs.append(f"kind {d.get('kind')!r} not in {sorted(KINDS)}")
    blast = d.get("blast")
    if blast not in BLAST_RANK:
        probs.append(f"blast {blast!r} not in {sorted(BLAST_RANK)}")
    if d.get("one_way") and blast not in ONE_WAY_BLAST:
        probs.append(f"one_way requires blast in {sorted(ONE_WAY_BLAST)}, got {blast!r}")
    says = d.get("prd_says") or ""
    if not says.strip():
        probs.append("prd_says is empty (Gate A: quote the PRD or absorb the decision)")
    elif len(says) > 240:
        probs.append(f"prd_says is {len(says)} chars (max 240)")
    elif prd_body is not None and _norm(says) not in _norm(prd_body):
        probs.append("prd_says is not a verbatim substring of the PRD")
    ref = d.get("prd_ref") or ""
    if prd_body is not None and ref:
        anchor = ref.lstrip("#§ ").strip().lower()
        heads = [_norm(l) for l in prd_body.splitlines() if l.lstrip().startswith("#")]
        if anchor and not any(anchor in h for h in heads):
            probs.append(f"prd_ref {ref!r} does not resolve to a PRD heading")
    for f in ("built", "why", "verify"):
        if not (d.get(f) or "").strip():
            probs.append(f"{f} is empty")
    where = d.get("where") or []
    if isinstance(where, str):
        where = [where]
    if not where:
        probs.append("where is empty")
    store = _store(root)
    for w in where:
        pth = str(w).split(":")[0]
        if pth and not os.path.exists(os.path.join(root, pth)) \
                and not (store and os.path.exists(os.path.join(store, pth))):
            probs.append(f"where does not resolve: {pth}")
    ok, why = evidence_resolves(d, root)
    if not ok:
        probs.append(why)
    return probs


def _acceptance_rows(sd):
    """Read unresolved acceptance proof from phase summaries, in phase order."""
    rows = []
    try:
        phases = [(int(m.group(1)), name) for name in os.listdir(sd)
                  if (m := re.fullmatch(r"phase-(\d+)", name))]
    except OSError:
        return rows
    for phase_n, name in sorted(phases):
        try:
            with open(os.path.join(sd, name, "summary.md"), errors="replace") as stream:
                lines = stream.read().splitlines()
        except OSError:
            continue
        active = False
        for line in lines:
            if re.fullmatch(r"## Acceptance\s*", line):
                active = True
                continue
            if line.startswith("## "):
                active = False
            if not active:
                continue
            match = re.match(r"^\|\s*(AC\d+[^|]*)\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|?\s*$", line)
            if match:
                ac, result, proof = (cell.strip() for cell in match.groups())
                status = re.match(r"^[\W_]*(not\s+met|not\s+proven)\b", result, re.I)
                if status:
                    rows.append((phase_n, ac, " ".join(status[1].lower().split()), proof))
    return rows


def cmd_report(args):
    """Write the ONE end-of-run deviation report. Never blocks; never commits."""
    root = repo_root(args.root)
    sd = state_dir(root)
    decisions = load_decisions(root)
    prd = args.prd or _run_field(root, "PRD")
    prd_body = _prd_text(root, prd)
    slug = os.path.splitext(os.path.basename(prd or "run"))[0]
    out = os.path.join(sd, f"deviations-{slug}.md")

    # Refuse to write anywhere git would track. Makes the guarantee true in ANY repo.
    if subprocess.call(["git", "check-ignore", "-q", out], cwd=root) != 0:
        print(f"REFUSING to write {out}: it is not gitignored.\n"
              f"The deviation report is a review artifact and must never be committed.\n"
              f"Add `/.agents/` to .gitignore, then re-run.", file=sys.stderr)
        return 2

    valid, dropped = [], []
    for d in decisions:
        probs = validate_record(d, root, prd_body)
        (dropped if probs else valid).append((d, probs))
    valid = [d for d, _ in valid]
    valid.sort(key=lambda d: (not d.get("one_way"), BLAST_RANK.get(d.get("blast"), 9),
                              d.get("phase", 0)))

    n_one = sum(1 for d in valid if d.get("one_way"))
    L = [f"# PRD deviations — {prd or '(PRD unrecorded)'}", ""]
    L.append(f"_Generated {datetime.datetime.now().isoformat(timespec='seconds')} · "
             f"{len(valid)} reportable · {n_one} one-way_")
    L.append("")
    L.append(f"**{len(valid)} item{'s' if len(valid) != 1 else ''} need an engineer's eye. "
             f"Nothing was blocked; everything below is already in the tree.**")
    L.append("This file is generated and gitignored — do not commit it.")
    L.append("")
    cfg, _ = load_config(root)
    surface, surface_hits, surface_missing = _surface_section(root, cfg)
    L.extend(surface)
    if not valid:
        L.append("_No reportable deviations. The run built what the PRD asked for._")
    for i, d in enumerate(valid, 1):
        flag = "⚠️ one-way · " if d.get("one_way") else ""
        L.append(f"## {i}. {flag}{d.get('blast')} · Phase {d.get('phase','?')}")
        L.append(f"**PRD said** ({d.get('prd_ref','?')}): *\"{d.get('prd_says','')}\"*")
        L.append(f"**Built instead:** {d.get('built','')}")
        L.append(f"**Why:** {d.get('why','')}")
        where = d.get("where") or []
        L.append(f"**Where:** " + ", ".join(f"`{w}`" for w in
                 (where if isinstance(where, list) else [where])))
        L.append(f"**Verify in 30s:** {d.get('verify','')}")
        L.append("")

    absorbed = args.absorbed if args.absorbed is not None else _count_absorbed(root)
    if absorbed is not None:
        # This line matters: it tells the reader the FILTER RAN, so silence reads as
        # filtered rather than broken.
        L.append(f"_{absorbed} lower-level implementation decision(s) were absorbed and are "
                 f"not listed (pattern-matching to existing code, naming, file placement, "
                 f"UI detail)._")
    else:
        L.append("_No worker reported an absorbed-decision count, so the number filtered is "
                 "unknown. A run with 0 reportable deviations and no count is indistinguishable "
                 "from a run where nothing was recorded at all._")
    L.append("")
    if dropped:
        L.append("## Records dropped as malformed")
        L.append("_Reported, not hidden: each failed a mechanical check, so it is not "
                 "trustworthy enough to act on._")
        for d, probs in dropped:
            L.append(f"- `{d.get('id','?')}` phase {d.get('phase','?')}: {'; '.join(probs)}")
        L.append("")

    rough = _rough_phases(root)
    if rough:
        L.append("## Phases that did not land clean")
        for r in rough:
            L.append(f"- **{r.get('event')}** phase {r.get('phase','?')}: "
                     f"{r.get('detail') or r.get('reason') or ''}")
        L.append("")

    incomplete = []
    for r in _events(root, {"journey_incomplete"}):
        key = (r.get("phase", "?"), r.get("detail") or "")
        if key not in incomplete:
            incomplete.append(key)
    if incomplete:
        L.append("## Journeys incomplete")
        for phase_n, detail in incomplete:
            L.append(f"- phase {phase_n}: {detail} — the scenario promoted without a step table")
        L.append("")

    acceptance = _acceptance_rows(sd)
    acceptance_missing = list(dict.fromkeys(
        r.get("phase", "?") for r in _events(root, {"acceptance_missing"})))
    if acceptance or acceptance_missing:
        L.append("## Acceptance not met or not proven")
        for phase_n, ac, result, proof in acceptance:
            L.append(f"- phase {phase_n} · {ac} · {result} — {proof}")
        for phase_n in acceptance_missing:
            L.append(f"- phase {phase_n}: no ## Acceptance table (acceptance_missing)")
        L.append("")
        print(f"  Acceptance: {len(acceptance)} not met or not proven, "
              f"{len(acceptance_missing)} missing table(s)")

    gaps = load_gaps(root)["findings"]
    open_gaps = [g for g in gaps if g.get("status") == "open"]
    if gaps:
        L.append("## Gap pass")
        L.append(f"_{len(gaps)} finding(s) at kickoff · {len(gaps) - len(open_gaps)} settled by a "
                 f"planner or a human · {len(open_gaps)} still open_")
        for g in open_gaps:
            L.append(f"- **{g['id']}** [{g['kind']}] P{',P'.join(map(str, g['phases']))}: "
                     f"{g['description']} — recommended: {g['resolution']}")
        if open_gaps:
            L.append("_An open gap means no planner claimed it in `## Gaps addressed`; "
                     "the builder resolved it silently or it is still unresolved. Check the phase._")
        L.append("")

    noticed = _harvest_records(root, "noticed")
    if noticed:
        L.extend(["## Noticed, not done", *[f"- P{r['phase']} · {r['text']}" for r in noticed]])
        dropped_count = sum(int(m[1]) for r in _events(root, {"noticed_ingest"})
                            if (m := re.search(r"(\d+) dropped", r.get("detail", ""))))
        if dropped_count:
            L.append(f"_{dropped_count} line(s) dropped over the 3-per-phase cap_")
        L.append("")
    decided = _harvest_records(root, "decided")
    if decided:
        L.append("## Decisions made for you")
        for r in decided:
            flag = "**For the owner** " if r["kind"] == "for_chris" else ""
            warning = " ⚠️ one-way" if r.get("one_way") else ""
            L.append(f"- P{r['phase']} {r['id']}: {flag}{r['text']}{warning}")
        L.append("")

    with open(out, "w") as f:
        f.write("\n".join(L) + "\n")
    print(f"wrote {out}")
    print(f"  {len(valid)} reportable ({n_one} one-way), {len(dropped)} dropped as malformed")
    if _surface_cfg(cfg) is not None:
        print(f"  Surface: {surface_hits} hit(s), {surface_missing} phase(s) not scanned")
    for d in valid[:3]:
        print(f"  [{d.get('id','?')}] {'ONE-WAY ' if d.get('one_way') else ''}"
              f"{d.get('blast')} P{d.get('phase','?')}: {d.get('built','')[:90]}")
    return 0


def _run_field(root, key):
    run = os.path.join(state_dir(root), "RUN.md")
    if not os.path.exists(run):
        return None
    with open(run, errors="replace") as stream:
        for line in stream:
            if line.lower().startswith(key.lower() + ":"):
                val = line.split(":", 1)[1]
                return val.split("#", 1)[0].strip()      # drop the inline comment
    return None


def _count_absorbed(root):
    """How many decisions were absorbed rather than reported.

    Each worker writes its own count to `phase-N/absorbed` (see contract.md); we
    sum them. Falls back to a single `absorbed.count`. Returns None when NOTHING
    reported a count -- which is different from zero, and must read differently in
    the report: "0 absorbed" is a claim, "unknown" is honest.
    """
    sd = state_dir(root)
    total, seen = 0, False
    for f in sorted(glob.glob(os.path.join(sd, "phase-*", "absorbed"))):
        try:
            total += int(open(f).read().strip()); seen = True
        except Exception:
            pass
    if not seen:
        try:
            total = int(open(os.path.join(sd, "absorbed.count")).read().strip()); seen = True
        except Exception:
            pass
    return total if seen else None


def _rough_phases(root):
    return _events(root, {"quarantined", "failed", "e2e_fail", "verify_fail"})


def _events(root, keep):
    p = os.path.join(state_dir(root), "events.jsonl")
    if not os.path.exists(p):
        return []
    out = []
    for line in open(p, errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("event") in keep:
            out.append(r)
    return out


# ---- the gap pass: find the questions BEFORE a planner pays to discover them ----
# Measured on PRD-11: planning was 61% of phase 2's tokens and 46% of phase 4's,
# because the PRD text posed a question nobody had asked yet. Nothing in the family
# looked ACROSS phases before the first planner ran -- create-prd grills on
# decisions, plan-feature plans one phase cold, the coupling check runs after a
# build. The gap pass is one subagent call at kickoff (reference/gap-pass.md holds
# the prompt) over the PRD's own phase list: does phase 1's output shape match what
# phase 3 consumes, where would two reasonable builders choose differently, what
# happens on empty input. Its findings are handed to each phase's planner as
# "known gaps" so the planner starts at the answer, not the question.
#
# Like the deviation ledger: validated mechanically, malformed records DROPPED and
# listed (never silently), and nothing here blocks a phase.

GAP_KINDS = {"conflict", "gap", "ambiguity"}
RISK_LEVELS = ("high", "normal")
GAP_STATUSES = {"open", "resolved", "absorbed"}


def _run_phase_numbers(root):
    """Phase numbers from RUN.md's table (the transcribed PRD phases). Empty when the
    table has not been filled yet -- which the gap pass treats as 'not ready'."""
    run = os.path.join(state_dir(root), "RUN.md")
    nums = []
    if not os.path.exists(run):
        return nums
    for line in open(run, errors="replace"):
        if not line.startswith("|") or "---" in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and cells[0].isdigit() and cells[1].upper() != "TODO":
            nums.append(int(cells[0]))
    return nums


def _gaps_path(root):
    return os.path.join(state_dir(root), "gaps.json")


def load_gaps(root):
    p = _gaps_path(root)
    if not os.path.exists(p):
        return {"findings": []}
    try:
        data = json.load(open(p))
    except (OSError, ValueError) as e:
        sys.stderr.write(f"gaps.json: unreadable ({e}) -- starting empty\n")
        return {"findings": []}
    data.setdefault("findings", [])
    return data


def _write_gaps(root, data):
    data["ts"] = _utc_now_iso()
    with open(_gaps_path(root), "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    _render_gaps_md(root, data)


def _phase_list(value):
    """Accept [1,3], ["P1","phase 3"], "1", 2 -- the analyst's JSON is loosely typed."""
    if value is None:
        return []
    if not isinstance(value, list):
        value = [value]
    out = []
    for v in value:
        m = re.search(r"\d+", str(v))
        if m:
            out.append(int(m.group()))
    return sorted(set(out))


def _normalise_findings(raw):
    """Flatten the analyst's JSON into one list. Accepts the grouped shape
    {conflicts:[], gaps:[], ambiguities:[]} (each item names `phases` or `phase`) or
    a flat {findings:[{kind,...}]}. Returns the list with `kind` filled in."""
    out = []
    if isinstance(raw, list):
        raw = {"findings": raw}
    for key, kind in (("conflicts", "conflict"), ("gaps", "gap"), ("ambiguities", "ambiguity")):
        for item in raw.get(key) or []:
            if isinstance(item, dict):
                out.append({**item, "kind": item.get("kind") or kind})
    for item in raw.get("findings") or []:
        if isinstance(item, dict):
            out.append(dict(item))
    return out


def _normalise_risk(raw):
    if not isinstance(raw, dict) or "risk" not in raw:
        return None
    entries = raw["risk"]
    if not isinstance(entries, list):
        entries = [entries]
    return [dict(d) if isinstance(d, dict) else {"risk": d} for d in entries]


def validate_risk(d, known):
    probs = []
    phases = _phase_list(d.get("phase", d.get("phases")))
    if len(phases) != 1:
        probs.append("risk needs exactly one phase")
    elif phases[0] not in known:
        probs.append(f"phase {phases[0]} not in RUN.md's table {known}")
    if d.get("risk") not in RISK_LEVELS:
        probs.append("risk must be high or normal")
    if d.get("risk") == "high" and not str(d.get("why") or "").strip():
        probs.append("why is empty for high risk")
    return probs


def gap_risk(root, phase):
    return load_gaps(root).get("risk", {}).get(str(phase))


def validate_gap(d, known_phases):
    """Mechanical checks on one finding. Returns problems (empty = valid)."""
    probs = []
    if d.get("kind") not in GAP_KINDS:
        probs.append(f"kind {d.get('kind')!r} not in {sorted(GAP_KINDS)}")
    phases = _phase_list(d.get("phases", d.get("phase", d.get("whats"))))
    if not phases:
        probs.append("names no phase")
    elif known_phases:
        unknown = [p for p in phases if p not in known_phases]
        if unknown:
            probs.append(f"phase(s) {unknown} not in RUN.md's table {known_phases}")
    for f in ("description", "resolution"):
        if not str(d.get(f) or "").strip():
            probs.append(f"{f} is empty")
    return probs


def _render_gaps_md(root, data):
    findings = data.get("findings", [])
    open_ = [g for g in findings if g.get("status") == "open"]
    L = [f"# Gap pass — {_run_field(root, 'PRD') or '(PRD unrecorded)'}", ""]
    L.append(f"_{len(findings)} finding(s) · {len(open_)} open · generated {data.get('ts', '')}_")
    L.append("")
    L.append("Pre-build review of the PRD's phases: inter-phase contracts, ordering not in "
             "`depends on`, and choices two reasonable builders would make differently. Each open "
             "item is handed to its phase's planner as a known gap. **Nothing here blocks a phase.** "
             "This file is generated and gitignored.")
    L.append("")
    highs = [(p, r) for p, r in data.get("risk", {}).items() if r.get("risk") == "high"]
    if highs:
        L += ["## Risk", ""] + [f"- P{p} high: {r['why']}" for p, r in highs] + [""]
    if not findings:
        L.append("_No findings. The phases read as consistent and unambiguous._")
    for g in findings:
        ph = ", ".join(f"P{p}" for p in g.get("phases", []))
        tag = {"open": "⏳", "resolved": "✅", "absorbed": "◦"}.get(g.get("status"), "?")
        L.append(f"## {g['id']} {tag} {g['kind']} · {ph}")
        L.append(f"**Issue:** {g.get('description', '')}")
        L.append(f"**Recommended:** {g.get('resolution', '')}")
        for extra in g.get("introduces") or []:
            L.append(f"- introduces: {extra}")
        if g.get("status") != "open":
            L.append(f"**{g['status'].capitalize()}** by {g.get('resolved_by', '?')} "
                     f"(phase {g.get('resolved_phase', '?')}): {g.get('how', '')}")
        L.append("")
    with open(os.path.join(state_dir(root), "gaps.md"), "w") as f:
        f.write("\n".join(L) + "\n")


def gaps_write(root, raw, source="analyst", replace=False):
    """Validate + persist the analyst's findings. Returns (kept, dropped)."""
    known = _run_phase_numbers(root)
    data = {"findings": []} if replace else load_gaps(root)
    existing_ids = {g["id"] for g in data["findings"]}
    n = max([int(re.sub(r"\D", "", g["id"]) or 0) for g in data["findings"]] + [0])
    kept, dropped = [], []
    for d in _normalise_findings(raw):
        probs = validate_gap(d, known)
        if not known:
            probs.append("RUN.md has no phases yet -- transcribe the PRD's phase table first")
        if probs:
            dropped.append((d, probs)); continue
        n += 1
        gid = str(d.get("id") or f"g{n}")
        while gid in existing_ids:
            n += 1; gid = f"g{n}"
        existing_ids.add(gid)
        rec = {"id": gid, "kind": d["kind"],
               "phases": _phase_list(d.get("phases", d.get("phase", d.get("whats")))),
               "description": str(d["description"]).strip(),
               "resolution": str(d["resolution"]).strip(),
               "introduces": [str(x) for x in (d.get("introduces")
                                                 or d.get("resolution_introduces_gaps") or [])],
               "status": "open", "source": source}
        if d.get("step") not in (None, ""):
            rec["step"] = d["step"]
        data["findings"].append(rec); kept.append(rec)
    risks = _normalise_risk(raw)
    if risks is not None:
        data["risk"] = {}
        for d in risks:
            probs = validate_risk(d, known)
            if probs:
                dropped.append((d, probs)); continue
            phase = str(_phase_list(d.get("phase", d.get("phases")))[0])
            if data["risk"].get(phase, {}).get("risk") != "high":
                data["risk"][phase] = {"risk": d["risk"], "why": str(d.get("why") or "").strip(),
                                       "source": source}
    _write_gaps(root, data)
    high = sum(r["risk"] == "high" for r in data.get("risk", {}).values())
    detail = f"{len(kept)} finding(s), {len(dropped)} dropped"
    if risks is not None:
        detail += f"; risk {high} high"
    _emit(root, "gap_pass", detail=detail,
          stage="gaps")
    return kept, dropped


def gaps_for_phase(root, phase):
    return [g for g in load_gaps(root)["findings"]
            if g.get("status") == "open" and phase in g.get("phases", [])]


def gaps_block(root, phase):
    """The compact text the planner prompt carries. Empty string when nothing is open."""
    items = gaps_for_phase(root, phase)
    if not items:
        return ""
    L = [f"Known gaps for phase {phase} (found by the kickoff gap pass; resolve each by reading "
         f"the code, and record how under `## Gaps addressed` in your plan as `- gN: <how>`):"]
    for g in items:
        others = [p for p in g["phases"] if p != phase]
        with_ = f" (shared with P{', P'.join(map(str, others))})" if others else ""
        L.append(f"- {g['id']} [{g['kind']}]{with_}: {g['description']} "
                 f"→ recommended: {g['resolution']}")
    return "\n".join(L)


def gaps_resolve(root, gid, how, by="planner", phase=None, status="resolved"):
    data = load_gaps(root)
    for g in data["findings"]:
        if g["id"] == gid:
            g["status"] = status; g["how"] = how; g["resolved_by"] = by
            if phase is not None:
                g["resolved_phase"] = phase
            _write_gaps(root, data)
            _emit(root, "gap_resolved", phase=phase, detail=f"{gid} {status} by {by}")
            return True
    return False


def _section_lines(text, heading_re):
    """The `- ` list lines under the first heading matching heading_re (any level),
    up to the next heading. Case-insensitive."""
    lines = text.splitlines()
    out, inside = [], False
    for line in lines:
        if re.match(r"^\s{0,3}#{1,6}\s", line):
            if inside:
                break
            inside = bool(re.search(heading_re, line, re.IGNORECASE))
            continue
        if inside and re.match(r"^\s*[-*]\s+", line):
            out.append(re.sub(r"^\s*[-*]\s+", "", line).strip())
    return out


def gaps_ingest(root, phase, text, by="planner"):
    """Mark resolved every `- gN: how` line under `## Gaps addressed`. Returns
    (resolved_ids, unknown_ids)."""
    resolved, unknown = [], []
    for item in _section_lines(text, r"gaps?\s+addressed"):
        m = re.match(r"`?(g\d+)`?\s*[:—-]\s*(.*)$", item, re.IGNORECASE)
        if not m:
            continue
        gid, how = m.group(1).lower(), m.group(2).strip()
        (resolved if gaps_resolve(root, gid, how, by=by, phase=phase) else unknown).append(gid)
    return resolved, unknown


def cmd_gaps(args):
    root = repo_root(args.root)
    if not os.path.isdir(state_dir(root)):
        print("no run here (run `orchestrator.py init` first)", file=sys.stderr); return 3
    if args.action == "write":
        src = args.source_file or "-"
        try:
            text = sys.stdin.read() if src == "-" else open(src).read()
            raw = json.loads(text)
        except (OSError, ValueError) as e:
            print(f"gaps write: cannot parse analyst JSON ({e})", file=sys.stderr); return 2
        kept, dropped = gaps_write(root, raw, source=args.by or "analyst", replace=args.replace)
        print(f"gaps: {len(kept)} finding(s) recorded, {len(dropped)} dropped as malformed "
              f"({os.path.relpath(os.path.join(state_dir(root), 'gaps.md'), root)})")
        if _normalise_risk(raw) is not None:
            risks = load_gaps(root).get("risk", {}).values()
            print(f"risk: {sum(r['risk'] == 'high' for r in risks)} high, "
                  f"{sum(r['risk'] == 'normal' for r in risks)} normal")
        for g in kept:
            print(f"  {g['id']} [{g['kind']}] P{',P'.join(map(str, g['phases']))}: "
                  f"{g['description'][:100]}")
        for d, probs in dropped:
            print(f"  dropped: {'; '.join(probs)} -- {str(d.get('description', ''))[:60]!r}",
                  file=sys.stderr)
        return 0
    if args.action == "show":
        if args.phase is not None:
            print(gaps_block(root, args.phase) or f"(no open gaps for phase {args.phase})")
            return 0
        data = load_gaps(root)
        items = [g for g in data["findings"] if not args.open or g.get("status") == "open"]
        if not items:
            print("(no gaps recorded)" if not data["findings"] else "(no open gaps)"); return 0
        for g in items:
            print(f"{g['id']:<4} {g.get('status', '?'):<9} {g['kind']:<9} "
                  f"P{',P'.join(map(str, g['phases'])):<6} {g['description'][:90]}")
        return 0
    if args.action == "resolve":
        if not (args.id and args.how):
            print("gaps resolve needs --id gN --how '<what settled it>'", file=sys.stderr); return 2
        ok = gaps_resolve(root, args.id, args.how, by=args.by or "human", phase=args.phase,
                          status="absorbed" if args.absorb else "resolved")
        print(f"{args.id}: {'resolved' if ok else 'NOT FOUND in gaps.json'}")
        return 0 if ok else 2
    if args.action == "ingest":
        if not args.source_file or args.phase is None:
            print("gaps ingest needs --phase N --from <plan path>", file=sys.stderr); return 2
        try:
            text = open(args.source_file, errors="replace").read()
        except OSError as e:
            print(f"gaps ingest: {e}", file=sys.stderr); return 2
        resolved, unknown = gaps_ingest(root, args.phase, text, by=args.by or "planner")
        print(f"gaps ingest: {len(resolved)} resolved ({', '.join(resolved) or '-'})"
              + (f"; unknown ids: {', '.join(unknown)}" if unknown else ""))
        return 0
    return 2


# ---- the facts cache: what this run has already learned about the codebase -----
# "Fresh context per worker" is right, and it has a cost: phase 3's planner
# re-discovers what phase 1's planner found. Facts are the artifact that carries a
# discovery forward without carrying a transcript. A fact is one line, must cite a
# path that exists in the tree (or it is dropped and listed -- same posture as the
# deviation ledger), and is deduplicated. Workers report new ones under `## New
# facts` in the artifact they already write; `ingest` harvests them; `facts show`
# is pasted into the next prompt.

FACT_PARTITIONS = ("domain", "patterns", "tests", "boundaries", "data", "gotchas")
_PATHISH = re.compile(r"(?<![\w/])((?:[\w.\-]+/)+[\w.\-]*|[\w\-]+\.[A-Za-z]{1,6})(?::\d+(?:-\d+)?)?")


def _facts_dir(root):
    return os.path.join(state_dir(root), "facts")


def _fact_cites(root, text):
    """Every path-shaped token in the fact that resolves in the tree."""
    hits = []
    for m in _PATHISH.finditer(text):
        cand = m.group(1).rstrip("/.,;:)")
        if not cand or "." not in cand and "/" not in cand:
            continue
        if os.path.exists(os.path.join(root, cand)):
            hits.append(cand)
    return hits


def _norm_fact(text):
    return re.sub(r"\s+", " ", re.sub(r"_\(p\d+ \w+\)_$", "", text)).strip().lower()


def load_facts(root, partition=None):
    out = {}
    for p in FACT_PARTITIONS:
        if partition and p != partition:
            continue
        path = os.path.join(_facts_dir(root), f"{p}.md")
        if not os.path.exists(path):
            continue
        with open(path, errors="replace") as f:
            lines = [re.sub(r"^\s*-\s+", "", l).rstrip() for l in f if l.strip().startswith("-")]
        if lines:
            out[p] = lines
    return out


def facts_add(root, partition, lines, phase=None, stage=None):
    """Append deduplicated, cited facts. Returns (added, dropped) where dropped is
    [(line, reason)]."""
    if partition not in FACT_PARTITIONS:
        return [], [(l, f"unknown partition {partition!r} (use one of {', '.join(FACT_PARTITIONS)})")
                    for l in lines]
    existing = {_norm_fact(l) for l in load_facts(root, partition).get(partition, [])}
    os.makedirs(_facts_dir(root), exist_ok=True)
    path = os.path.join(_facts_dir(root), f"{partition}.md")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(f"# {partition}\n\n")
    added, dropped = [], []
    tag = f" _(p{phase} {stage})_" if phase is not None and stage else ""
    with open(path, "a") as f:
        for raw in lines:
            line = re.sub(r"^\s*[-*]\s+", "", raw).strip()
            if not line:
                continue
            if len(line) > 300:
                dropped.append((line, "longer than 300 chars -- a fact is one line, not a paragraph")); continue
            if not _fact_cites(root, line):
                dropped.append((line, "cites no path that exists in the tree")); continue
            if _norm_fact(line) in existing:
                dropped.append((line, "duplicate")); continue
            existing.add(_norm_fact(line))
            f.write(f"- {line}{tag}\n"); added.append(line)
    return added, dropped


def facts_block(root):
    """The text pasted into a worker prompt. Empty string when nothing is recorded."""
    facts = load_facts(root)
    if not facts:
        return ""
    L = ["Facts already discovered this run (cited; do not re-look these up):"]
    for p, lines in facts.items():
        L.append(f"### {p}")
        L.extend(f"- {l}" for l in lines)
    return "\n".join(L)


def facts_ingest(root, phase, text, stage):
    """Harvest `- <partition>: <fact>` lines under `## New facts`. Returns (added, dropped)."""
    by_part = {}
    dropped = []
    for item in _section_lines(text, r"new\s+facts"):
        m = re.match(r"`?(\w[\w-]*)`?\s*:\s*(.+)$", item)
        if not m:
            dropped.append((item, "not `- <partition>: <fact>`")); continue
        by_part.setdefault(m.group(1).lower(), []).append(m.group(2))
    added = []
    for part, lines in by_part.items():
        a, d = facts_add(root, part, lines, phase=phase, stage=stage)
        added.extend(a); dropped.extend(d)
    if added or dropped:
        _emit(root, "facts_ingest", phase=phase, stage=stage,
              detail=f"{len(added)} added, {len(dropped)} dropped")
    return added, dropped


def cmd_facts(args):
    root = repo_root(args.root)
    if not os.path.isdir(state_dir(root)):
        print("no run here (run `orchestrator.py init` first)", file=sys.stderr); return 3
    if args.action == "add":
        if not args.partition:
            print(f"facts add needs --partition <{'|'.join(FACT_PARTITIONS)}>", file=sys.stderr); return 2
        lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
        added, dropped = facts_add(root, args.partition, lines, phase=args.phase, stage=args.stage)
        print(f"facts/{args.partition}.md: {len(added)} added, {len(dropped)} dropped")
        for line, why in dropped:
            print(f"  dropped ({why}): {line[:80]}", file=sys.stderr)
        return 0
    if args.action == "show":
        facts = load_facts(root, args.partition)
        if not facts:
            print("(no facts recorded yet)"); return 0
        print(facts_block(root) if not args.partition else
              "\n".join(f"- {l}" for l in facts.get(args.partition, [])))
        return 0
    if args.action == "ingest":
        if not args.source_file or args.phase is None:
            print("facts ingest needs --phase N --from <artifact path>", file=sys.stderr); return 2
        try:
            text = open(args.source_file, errors="replace").read()
        except OSError as e:
            print(f"facts ingest: {e}", file=sys.stderr); return 2
        stage = args.stage or ("builder" if os.path.basename(args.source_file) == "summary.md" else "planner")
        added, dropped = facts_ingest(root, args.phase, text, stage)
        print(f"facts ingest: {len(added)} added, {len(dropped)} dropped")
        for line, why in dropped:
            print(f"  dropped ({why}): {line[:80]}", file=sys.stderr)
        return 0
    return 2


def _harvest_records(root, name):
    path = os.path.join(state_dir(root), name + ".jsonl")
    if not os.path.exists(path):
        return []
    with open(path, errors="replace") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def _append_harvest(root, name, records):
    with open(os.path.join(state_dir(root), name + ".jsonl"), "a") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")


def decisions_ingest(root, phase, text):
    seen = {(r["phase"], r["id"]) for r in _harvest_records(root, "decided")}
    added = []
    for heading, prefix, kind in ((r"decided\s+for\s+you", "D", "decided"),
                                  (r"for\s+(?:the\s+owner|chris)", "Q", "for_chris")):
        for line in _section_lines(text, heading):
            match = re.match(rf"^({prefix}\d+)\s*[:—-]\s*(.+)", line)
            if match and (phase, match[1]) not in seen:
                seen.add((phase, match[1]))
                added.append(dict(phase=phase, id=match[1], kind=kind, text=match[2],
                                  one_way="one-way" in match[2].lower()))
    _append_harvest(root, "decided", added)
    return len(added)


def noticed_ingest(root, phase, text, stage):
    records = _harvest_records(root, "noticed")
    seen = {(r["phase"], r["text"]) for r in records}
    total = sum(r["phase"] == phase for r in records)
    added, dropped = [], 0
    lines = _section_lines(text, r"noticed\W+not\s+done")
    for line in lines:
        if (phase, line) in seen:
            continue
        seen.add((phase, line))
        if total + len(added) >= 3:
            dropped += 1
            continue
        added.append(dict(phase=phase, stage=stage, text=line, ts=_utc_now_iso()))
    _append_harvest(root, "noticed", added)
    if lines:
        _emit(root, "noticed_ingest", phase=phase, stage=stage,
              detail=f"{len(added)} harvested, {dropped} dropped")
    return len(added), dropped


def digest_lines(root, phase):
    decisions = [r for r in _harvest_records(root, "decided") if r["phase"] == phase and r["kind"] == "decided"]
    decided = f"Decided: {len(decisions)}"
    if decisions:
        decided += " (" + ", ".join((r["id"] + " " + r["text"])[:40] for r in decisions[:3]) + ")"
    path = os.path.join(state_dir(root), f"phase-{phase}", "scope.json")
    rec = json.load(open(path)) if os.path.exists(path) else {}
    if rec.get("planned") is None:
        scope = "no touch set"
    elif rec.get("out_of_plan"):
        paths = rec["out_of_plan"]
        scope = f"{len(paths)} out-of-plan file(s) ({', '.join(paths[:2])}" + (", …" if len(paths) > 2 else "") + ")"
    else:
        scope = "in plan"
    return decided, "Scope:   " + scope


def cmd_digest(args):
    print("\n".join(digest_lines(repo_root(args.root), args.phase)))
    return 0


def cmd_fix_plan(args):
    root = repo_root(args.root)
    directory = os.path.join(state_dir(root), f"phase-{args.phase}")
    verify = os.path.join(directory, "verify.json")
    if not os.path.exists(verify) or (rec := json.load(open(verify))).get("result") == "pass":
        print("nothing to fix")
        return 3
    counter = os.path.join(directory, "fix-cycles")
    cycle = int(open(counter).read()) + 1 if os.path.exists(counter) else 1
    if cycle > 2:
        print("fix cap (2) reached -- mark the phase failed")
        return 2
    failing = [r for r in rec.get("levels", []) if r.get("result") == "fail"]
    result = dict(cycle=cycle, worker="builder", label=tab_label(root, "builder", args.phase),
                  failing=[r["name"] for r in failing])
    if cycle == 2:
        handoff = os.path.join(directory, "handoff.md")
        if not os.path.exists(handoff):
            print(f"ask the builder for phase-{args.phase}/handoff.md (≤10 lines: done / stuck / tried) first")
            return 4
        lines = [line for line in open(handoff).read().splitlines() if line.strip()]
        if len(lines) > 10:
            with open(handoff, "w") as stream:
                stream.write("\n".join(lines[:10]) + "\n")
            print("warning: handoff trimmed to 10 non-blank lines", file=sys.stderr)
        cfg, _ = load_config(root)
        plan = _phase_plan_path(root, cfg, args.phase)
        prompt = os.path.join(directory, "fix-2.prompt.md")
        artifact = os.path.join(directory, "verify-fix.md")
        with open(prompt, "w") as stream:
            stream.write(f"Fix verify for phase {args.phase} in orchestrated mode.\n"
                         f"Plan: {plan or 'NO-PLAN-NEEDED (read the PRD phase)'}\n"
                         f"Read handoff: {handoff}\n"
                         "Failing levels: " + json.dumps([{k: r.get(k) for k in ("name", "new_failures")} for r in failing]) + "\n"
                         f"Run orchestrator.py verify --phase {args.phase}.\n"
                         f"Update {directory}/summary.md's ## Acceptance rows.\n"
                         f"Write {artifact} (≤10 lines); reply with only that path.\n"
                         "Do not start or stop the application. Do not commit or stage.\n")
        result.update(worker="fresh", label=tab_label(root, "fix", args.phase),
                      prompt_file=prompt, handoff=handoff, artifact=artifact)
    with open(counter, "w") as stream:
        stream.write(str(cycle))
    for stage in ("builder", "fix"):
        stale = os.path.join(state_dir(root), f".stop-gate-verify-{stage}-{args.phase}.tries")
        if os.path.exists(stale):
            os.remove(stale)
    _emit(root, "fix_cycle", phase=args.phase, detail=f"cycle {cycle} {result['worker']}")
    print(json.dumps(result))
    return 0


def cmd_ingest(args):
    """One call after reading any worker artifact: harvest its `## New facts` and
    `## Gaps addressed` sections together. Idempotent -- duplicates are dropped."""
    root = repo_root(args.root)
    if not os.path.isdir(state_dir(root)):
        print("no run here (run `orchestrator.py init` first)", file=sys.stderr); return 3
    try:
        text = open(args.source_file, errors="replace").read()
    except OSError as e:
        print(f"ingest: {e}", file=sys.stderr); return 2
    stage = args.stage or ("builder" if os.path.basename(args.source_file) == "summary.md" else "planner")
    added, dropped = facts_ingest(root, args.phase, text, stage)
    resolved, unknown = gaps_ingest(root, args.phase, text, by=stage)
    decisions = decisions_ingest(root, args.phase, text)
    kept, extra = noticed_ingest(root, args.phase, text, stage)
    print(f"ingest phase {args.phase} ({stage}): {len(added)} fact(s) added, {len(dropped)} dropped; "
          f"{len(resolved)} gap(s) resolved" + (f", unknown ids {', '.join(unknown)}" if unknown else "")
          + f"; {decisions} decision(s), {kept} noticed ({extra} dropped)")
    for line, why in dropped:
        if why != "duplicate":
            print(f"  dropped fact ({why}): {line[:80]}", file=sys.stderr)
    return 0


# Read-only Bash every worker uses to look at code and its own diff. Stack commands (build, test)
# are the repo's to declare in [worker] allow -- the skill does not guess them.
WORKER_ALLOW_BASE = (
    "git diff", "git status", "git log", "git show", "git ls-files", "git rev-parse",
    "grep", "rg", "cat", "ls", "head", "tail", "wc", "sed -n", "find", "diff", "jq",
)


def worker_allow(root):
    """permissions.allow rules for a worker: this CLI (verify, facts, ...), WORKER_ALLOW_BASE and
    the repo's [worker] allow entries. An entry is a command prefix (`npm test`) or an explicit rule
    (`Bash(npm test:*)`)."""
    cfg, _ = load_config(root)
    extra = (cfg.get("worker") or {}).get("allow") or []
    if not isinstance(extra, list):
        extra = []
    me = os.path.abspath(__file__)
    prefixes = [f"python3 {me}", f"python3 {shlex.quote(me)}"] + list(WORKER_ALLOW_BASE)
    rules = []
    for p in prefixes + [e for e in extra if isinstance(e, str) and e.strip()]:
        p = p.strip()
        rule = p if re.match(r"^[A-Za-z]+\(.*\)$", p) else f"Bash({p}:*)"
        if rule not in rules:
            rules.append(rule)
    return rules


def cmd_worker_settings(args):
    """Generate the per-worker --settings file: Concise output style + the hooks.

    Hooks are delivered THIS way -- never in a settings file on disk that other
    sessions would load. Precedence is managed > --settings > local > project >
    user, but hook entries MERGE rather than replace: --settings can ADD a hook,
    never remove one the repo already defines.

    herdr's `agent start` has no --env flag, so per-worker state rides in the
    hook command line as exported vars (`tab open --env` also works).
    SessionStart emits worker_session (session_id → phase/stage) for telemetry.
    """
    root = repo_root(args.root)
    sd = state_dir(root)
    hooks_dir = os.path.join(sd, "worker-hooks")
    os.makedirs(hooks_dir, exist_ok=True)
    skill_scripts = os.path.dirname(os.path.abspath(__file__))
    h = lambda name: os.path.join(skill_scripts, "hooks", name)

    artifact = args.artifact or ""
    if not artifact:
        if args.stage == "reviewer":
            artifact = os.path.join(sd, "review.md")          # not phase-scoped
        elif args.phase is not None and args.stage in ("builder", "e2e"):
            fname = "e2e.md" if args.stage == "e2e" else "summary.md"
            artifact = os.path.join(sd, f"phase-{args.phase}", fname)

    cfg, _ = load_config(root)
    env = (f'ORCH_STATE_DIR={shlex.quote(sd)} '
           f'ORCH_ARTIFACT={shlex.quote(artifact)} '
           f'ORCH_STAGE={shlex.quote(args.stage)} '
           f'ORCH_PHASE={shlex.quote(str(args.phase if args.phase is not None else ""))}')

    env += (f' ORCH_ROOT={shlex.quote(root)} '
            f'ORCH_INSTRUCTION_FILES={shlex.quote(":".join(cfg["knowledge"].get("always_loaded", [])))}')
    if args.stage in ("builder", "fix"):
        env += f' ORCH_APP_START={shlex.quote(cfg["app"].get("start", ""))}'

    def cmd(script):
        return f"{env} bash {shlex.quote(h(script))}"

    settings = {
        "outputStyle": "Concise",
        "hooks": {
            "SessionStart": [{"hooks": [{"type": "command", "command": cmd("session-start.sh"),
                                         "timeout": 10}]}],
            "Stop": [{"hooks": [{"type": "command", "command": cmd("stop-gate.sh"),
                                 "timeout": 30 if args.stage in ("builder", "fix") else 10}]}],
            "PreToolUse": [{"matcher": "Bash",
                            "hooks": [{"type": "command",
                                       "command": cmd("git-fence.sh"), "timeout": 10}]},
                           {"matcher": "^(Write|Edit|MultiEdit)$",
                            "hooks": [{"type": "command",
                                       "command": cmd("instruction-fence.sh"), "timeout": 10}]}],
        },
    }
    if args.stage in ("builder", "fix"):
        settings["hooks"]["PreToolUse"].append({
            "matcher": "^(Agent|Task)$",
            "hooks": [{"type": "command", "command": cmd("subagent-fence.sh"), "timeout": 10}]})
    # Store mode: planners/builders write plans and scenarios into the wiki store, outside the
    # worktree -- grant it up front so a worker never stalls on a permission prompt there.
    store = _store(root)
    if store:
        perms = settings.setdefault("permissions", {})
        dirs = perms.setdefault("additionalDirectories", [])
        if store not in dirs:
            dirs.append(store)
    # acceptEdits clears file writes, not Bash: every build, test and code read would otherwise stop
    # on a manual prompt and stall an unattended run. Pre-allow this CLI, read-only basics and the
    # repo's declared [worker] allow list. Never anything that mutates outside an Edit (no sed -i,
    # rm, git writes -- the git fence still denies commit/push/reset).
    allow = worker_allow(root)
    if allow:
        settings.setdefault("permissions", {})["allow"] = allow
    # The planner writes no gated artifact and must never be held back by the Stop gate.
    if args.stage == "planner" or not artifact:
        settings["hooks"].pop("Stop")

    # A FRESH worker gets a FRESH retry allowance. Without this, a phase that
    # GATE-FAILED once would immediately GATE-FAIL again on its retry, because the
    # stop-gate's counter is keyed on stage+phase and survives the dead worker.
    for stale in (os.path.join(sd, f".stop-gate-{args.stage}-{args.phase}.tries"),
                  os.path.join(sd, f".stop-gate-verify-{args.stage}-{args.phase}.tries"),
                  os.path.join(sd, f"GATE-FAILED-{args.stage}-{args.phase}")):
        if os.path.exists(stale):
            os.remove(stale)
            print(f"  reset: {os.path.basename(stale)}", file=sys.stderr)

    out = os.path.join(hooks_dir, f"phase-{args.phase or 'x'}-{args.stage}.json")
    with open(out, "w") as f:
        json.dump(settings, f, indent=2)
    print(out)
    if artifact:
        print(f"  gated on: {artifact}", file=sys.stderr)
    return 0


# ---- stage routing (routing.json) --------------------------------------------
# Workbench (Chris's personal launcher) can pick tool/model/effort per stage. It writes
# <state>/routing.json; without the file every stage uses the built-in table below, which is
# the SKILL.md "Model routing" table. Only Claude workers get the Stop gate and git fence --
# those are Claude --settings hooks -- so a non-Claude builder can never commit autonomously.
ROUTING_STAGES = ("planner", "builder", "e2e", "reviewer")
DEFAULT_ROUTING = {
    "planner":  {"kind": "claude", "model": "sonnet", "effort": "medium"},
    "builder":  {"kind": "claude", "model": "sonnet", "effort": "low"},
    "reviewer": {"kind": "claude", "model": "sonnet", "effort": "medium"},
    "e2e":      {"kind": "claude", "model": "claude-sonnet-5-5", "effort": "medium"},
}


# The e2e engine (e2e-gate.md step 4): the Nimble pilot from the e2e-test-orchestrator skill, with a
# Claude worker as the fallback — or Claude only. Default: nimble when the pilot is installed.
E2E_ENGINES = ("nimble", "claude")
PILOT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "e2e-test-orchestrator", "pilot")
JOURNEY_PY = os.path.join(os.path.dirname(os.path.dirname(PILOT_DIR)), "e2e-test", "scripts", "journey.py")
CATALOG_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(PILOT_DIR))))


def e2e_engine(root):
    routing, _ = load_routing(root)
    chosen = (routing or {}).get("e2e_engine")
    if chosen in E2E_ENGINES:
        return chosen
    return "nimble" if os.path.exists(os.path.join(PILOT_DIR, "run.py")) else "claude"


PILOT_APP = os.environ.get("PILOT_APP", "rbcloud")   # the pilot's `--app` — its library key


def pilot_library(command, *extra):
    """Run the pilot's flow-library CLI (`health` / `sync`). Returns (rc, output)."""
    script = os.path.join(PILOT_DIR, "library.py")
    if not os.path.exists(script):
        return 1, f"pilot library not found at {script}"
    try:
        out = subprocess.run([sys.executable, script, command, "--app", PILOT_APP, *extra],
                             capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return 1, f"library {command} timed out"
    return out.returncode, (out.stdout + out.stderr).strip()


def nimble_health():
    """None when the Nimble engine can run here, else the reason (the pilot's own check)."""
    if not os.path.exists(os.path.join(PILOT_DIR, "nimble.py")):
        return f"Nimble pilot not found at {PILOT_DIR}"
    try:
        out = subprocess.run([sys.executable, "-c",
                              f"import sys; sys.path.insert(0, {PILOT_DIR!r}); import nimble; print(nimble.health() or 'ok')"],
                             capture_output=True, text=True, timeout=90)   # a cold model load takes a while
    except subprocess.TimeoutExpired:
        return "nimble.health() timed out"
    msg = (out.stdout.strip().splitlines() or [out.stderr.strip() or "no output"])[-1]
    return None if msg == "ok" else msg


def _routing_path(root):
    return os.path.join(state_dir(root), "routing.json")


def load_routing(root):
    """(routing dict | None, problems). None = no routing.json (use the defaults)."""
    path = _routing_path(root)
    if not os.path.exists(path):
        return None, []
    try:
        data = json.load(open(path))
    except (OSError, ValueError) as e:
        return None, [f"routing.json is unreadable: {e}"]
    problems = []
    if isinstance(data, dict) and data.get("e2e_engine") not in (None, *E2E_ENGINES):
        problems.append(f"routing.json: e2e_engine must be one of {', '.join(E2E_ENGINES)}")
    stages = data.get("stages") if isinstance(data, dict) else None
    if not isinstance(stages, dict):
        return None, ["routing.json has no \"stages\" object"]
    for name, st in stages.items():
        if name not in ROUTING_STAGES:
            problems.append(f"routing.json: unknown stage {name!r} (known: {', '.join(ROUTING_STAGES)})")
            continue
        if not isinstance(st, dict) or not isinstance(st.get("kind"), str) or not st["kind"]:
            problems.append(f"routing.json: stage {name} needs a non-empty \"kind\"")
            continue
        argv = st.get("argv", [])
        if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
            problems.append(f"routing.json: stage {name} \"argv\" must be a list of strings")
        env = st.get("env", {})
        if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
            problems.append(f"routing.json: stage {name} \"env\" must map strings to strings")
    return (None if problems else data), problems


_EFFORT_ORDER = ("low", "medium", "high", "max")


def _raise_effort(cur, floor="medium"):
    if cur not in _EFFORT_ORDER:
        return cur
    return _EFFORT_ORDER[max(_EFFORT_ORDER.index(cur), _EFFORT_ORDER.index(floor))]


def stage_route(root, stage, phase=None):
    """The launch facts for one stage; phase risk only raises default builder effort."""
    routing, _ = load_routing(root)
    st = (routing or {}).get("stages", {}).get(stage)
    if st:
        route = {"stage": stage, "kind": st["kind"], "model": st.get("model"), "effort": st.get("effort"),
                 "argv": list(st.get("argv", [])), "env": dict(st.get("env", {})), "source": "routing.json"}
    else:
        d = DEFAULT_ROUTING[stage]
        route = {"stage": stage, "kind": d["kind"], "model": d["model"], "effort": d["effort"],
                 "argv": ["--model", d["model"], "--effort", d["effort"]], "env": {}, "source": "default"}
    if stage == "builder" and phase is not None and (load_risk(root, phase) or {}).get("risk") == "high":
        applied = route["source"] == "default" and route["kind"] == "claude"
        reason = ("high-risk phase" if applied else "explicit routing.json builder entry"
                  if route["source"] == "routing.json" else f"{route['kind']} worker")
        if applied:
            route["effort"] = _raise_effort(route["effort"])
            route["argv"] = ["--model", route["model"], "--effort", route["effort"]]
        route["risk"] = {"phase": phase, "risk": "high", "applied": applied, "reason": reason}
    return route


def cmd_routing(args):
    """Print the exact `herdr agent start` inputs for a stage's worker, as JSON.

    For a Claude worker this generates its worker-settings file and appends the permission mode
    and --settings, so the hooks always apply. Any other kind is started with its argv as given
    and runs WITHOUT the Stop gate and git fence ("hooks": false) -- record that in RUN.md.
    """
    root = repo_root(args.root)
    _, problems = load_routing(root)
    if problems:
        for p_ in problems:
            print(p_, file=sys.stderr)
        return 1
    r = stage_route(root, args.stage, getattr(args, "phase", None))
    claude = r["kind"] == "claude"
    agent_args = list(r["argv"])
    if claude:
        cfg, _ = load_config(root)
        mode = (cfg.get("worker") or {}).get("permission_mode") or "acceptEdits"
        if mode in ("auto", "bypassPermissions"):
            mode = "acceptEdits"   # never auto: its classifier blocks the orchestrator's own worker/commit commands
        import contextlib, io
        buf = io.StringIO()
        ws = argparse.Namespace(root=args.root, stage=args.stage, phase=args.phase, artifact=None)
        with contextlib.redirect_stdout(buf):
            cmd_worker_settings(ws)
        agent_args += ["--permission-mode", mode, "--settings", buf.getvalue().strip().splitlines()[0]]
    if r["kind"] == "codex" and not any("writable_roots" in a for a in agent_args):
        # Codex's workspace-write sandbox treats `.agents/` as protected even though the rest of the tree is
        # writable, so a codex worker could not write verify.json / summary.md / decisions.jsonl (PRD-10,
        # 2026-10-26; also PRD 27201-2). Name the state dir as a writable root so those writes land.
        agent_args += ["-c", "sandbox_workspace_write.writable_roots=" + json.dumps([state_dir(root)])]
    out = {**r, "agent_args": agent_args, "hooks": claude}
    if args.stage == "e2e":
        # The engine order for this phase's gate; agent_args are the Claude fallback worker's.
        out["engine"] = e2e_engine(root)
        if out["engine"] == "nimble":
            out["pilot"] = os.path.join(PILOT_DIR, "run.py")
            # `pane run` starts the pilot in a bare pane shell; its compile/rescue/judge calls need the
            # stage's login, so the dispatcher prefixes these assignments. Without a routed config dir
            # the pilot inherits this orchestrator's, which is the login known to work.
            env = dict(r["env"])
            if "CLAUDE_CONFIG_DIR" not in env and os.environ.get("CLAUDE_CONFIG_DIR"):
                env["CLAUDE_CONFIG_DIR"] = os.environ["CLAUDE_CONFIG_DIR"]
            out["pilot_env"] = env
            out["pilot_cmd_prefix"] = " ".join(f"{k}={shlex.quote(v)}" for k, v in env.items())
    print(json.dumps(out, indent=2))
    return 0


def _run_window(root):
    events = _run_events(state_dir(root))
    rid = _run_field(root, "Run id")
    starts = [i for i, e in enumerate(events) if e.get("event") == "run_start"]
    matching = [i for i in starts if rid and events[i].get("run_id") == rid]
    start = matching[-1] if matching else starts[-1] if starts else -1
    return events[start + 1:]


def _commit_sources(root, window, phase=None):
    """Classify row anchors and current-run commit events, optionally for one phase."""
    anchors, explicit, hooked, store = set(), set(), set(), set()
    for row in _phase_rows(state_dir(root)):
        if len(row) > 4 and row[3] == "committed" and (phase is None or row[0] == str(phase)):
            anchors.update(s for token in re.findall(r"\b[0-9a-f]{7,40}\b", row[4])
                           if (s := _resolve_commit(root, token)))
    for event in window:
        if event.get("event") == "store_commit":
            if sha := _resolve_commit(root, event.get("sha")):
                store.add(sha)
        elif event.get("event") == "commit" and (phase is None or str(event.get("phase")) == str(phase)):
            if sha := _resolve_commit(root, event.get("sha")):
                (hooked if event.get("detail") == "auto-logged by post-commit hook" else explicit).add(sha)
    return anchors, explicit, hooked, store


def own_commits(root):
    base, head = _run_field(root, "Base commit"), _head_sha(root)
    result = {"mode": "base", "base": base, "head": head, "own": None,
              "foreign": None, "files": [], "filter": "Base..HEAD"}
    if not _run_field(root, "Resumed"):
        return result

    def git_lines(*argv):
        rec = subprocess.run(["git", *argv], cwd=root, capture_output=True, text=True)
        return rec.stdout.splitlines() if rec.returncode == 0 else []

    window = _run_window(root)
    with open(os.path.join(state_dir(root), "RUN.md"), errors="replace") as stream:
        blocks = _parked_blocks(stream.read())
    first_block = blocks[0] if blocks else {}
    park_index = next((i for i, e in enumerate(window)
                       if e.get("event") == "run_end" and e.get("detail") == "parked"), None)
    if park_index is not None:
        pre_park = window[:park_index]
    else:
        ts = first_block.get("parked")
        pre_park = [e for e in window if ts and e.get("ts", "") < ts]
    candidates = [e["sha"] for e in window if e.get("event") == "commit" and e.get("sha")]
    if not any(e.get("event") == "commit" for e in pre_park) and first_block.get("parked_head"):
        candidates = git_lines("rev-list", "--reverse", f"{base}..{first_block['parked_head']}") + candidates
    candidates = list(dict.fromkeys(sha for c in candidates if (sha := _resolve_commit(root, c))))
    anchors, explicit, _, _ = _commit_sources(root, window)
    cache = {}

    def files(sha):
        if sha not in cache:
            cache[sha] = set(git_lines("show", "--name-only", "--format=", sha)) - {""}
        return cache[sha]

    phase_files = set().union(*(files(sha) for sha in anchors | explicit))
    kept = anchors | explicit | {sha for sha in candidates if not anchors or files(sha) & phase_files}
    span = git_lines("rev-list", "--reverse", f"{base}..HEAD")
    own = [sha for sha in span if sha in kept]
    result.update(mode="own", own=own, foreign=[sha for sha in span if sha not in kept],
                  files=sorted(set().union(*(files(sha) for sha in own))),
                  filter="phase paths" if anchors else "none (no committed phase yet)")
    return result


def cmd_review_range(args):
    root = repo_root(args.root)
    if not os.path.isfile(os.path.join(state_dir(root), "RUN.md")) or \
            _run_field(root, "Base commit") in (None, "", "(unknown)"):
        print("no base commit recorded (RUN.md `Base commit:`)", file=sys.stderr)
        return 3
    result = own_commits(root)
    if args.json:
        print(json.dumps(result))
    else:
        print(f"mode: {result['mode']} ({result['filter']})")
        if result["mode"] == "base":
            print(f"range: {result['base']}..HEAD")
        else:
            print(f"own {len(result['own'])}\nforeign {len(result['foreign'])}")
            for sha in result["foreign"]:
                rec = subprocess.run(["git", "show", "-s", "--format=%s", sha], cwd=root,
                                     capture_output=True, text=True)
                print(f"  {sha[:9]} {rec.stdout.strip()}")
    return 0


def cmd_drift(args):
    """Which generated docs did this run invalidate?

    Mechanical, zero-token, zero-judgment: a doc is stale if its `paths` globs
    intersect the run's changed files AND its `last_verified` predates the base
    commit. Reports only -- a generated bundle is NEVER hand-edited, so the output
    is a regeneration queue, not a patch.
    """
    root = repo_root(args.root)
    cfg, problems = load_config(root)
    base = args.base or _run_field(root, "Base commit")
    if not base or base == "(unknown)":
        print("no base commit recorded (RUN.md `Base commit:`); pass --base", file=sys.stderr)
        return 3
    head = args.head or "HEAD"

    rc = own_commits(root) if not args.base else {"mode": "base"}
    if rc["mode"] == "own":
        files = rc["files"]
        print(f"run diff: own commits ({len(rc['own'])}) — {len(rc['foreign'])} foreign ignored  ({len(files)} files)")
    else:
        changed = subprocess.run(["git", "diff", "--name-only", f"{base}..{head}"], cwd=root,
                                 capture_output=True, text=True)
        if changed.returncode != 0:
            print(f"git diff {base}..{head} failed: {changed.stderr.strip()}", file=sys.stderr)
            return 3
        files = [f for f in changed.stdout.splitlines() if f.strip()]
        print(f"run diff: {base[:8]}..{head}  ({len(files)} files)")
    specs = cfg["knowledge"].get("generated") or []
    if not specs:
        print("no [knowledge] generated bundles declared -- nothing to check")
        return 0

    stale = []
    for spec in specs:
        pat = spec.get("paths") if isinstance(spec, dict) else spec
        regen = spec.get("regenerate_with", "(regenerate)") if isinstance(spec, dict) else "(regenerate)"
        for doc in sorted(glob.glob(os.path.join(root, pat), recursive=True)):
            if not os.path.isfile(doc) or not doc.endswith((".md", ".mdx")):
                continue
            meta = _frontmatter(doc)
            lv, globs = meta.get("last_verified"), meta.get("paths") or []
            if not globs:
                continue
            hit = [f for f in files if any(fnmatch.fnmatch(f, g) for g in globs)]
            if not hit:
                continue
            if lv and _is_ancestor(root, base, lv):
                continue       # doc was verified at or after the base -> still fresh
            stale.append((os.path.relpath(doc, root), lv, hit, regen))

    if not stale:
        print("no generated doc was invalidated by this run")
        return 0
    print(f"\n{len(stale)} generated doc(s) invalidated by this run — queue a regeneration.")
    print("Do NOT hand-edit these; the generator discards hand-edits.\n")
    for rel, lv, hit, regen in stale:
        print(f"- {rel}   (last_verified: {lv or 'none'})  -> {regen}")
        for f in hit[:4]:
            print(f"    touched: {f}")
        if len(hit) > 4:
            print(f"    … and {len(hit) - 4} more")
    return 0


def _frontmatter(path):
    """Minimal YAML front-matter reader: scalars + inline/dash lists. Stdlib only."""
    out = {}
    try:
        with open(path, errors="replace") as f:
            if f.readline().strip() != "---":
                return out
            key = None
            for line in f:
                if line.strip() == "---":
                    break
                if line.startswith((" ", "\t")) and line.strip().startswith("- ") and key:
                    out.setdefault(key, []).append(line.strip()[2:].strip().strip("'\""))
                    continue
                if ":" in line:
                    k, v = line.split(":", 1)
                    key, v = k.strip(), v.strip()
                    if v.startswith("[") and v.endswith("]"):
                        out[key] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
                    elif v:
                        out[key] = v.strip("'\"")
                    else:
                        out[key] = []
    except OSError:
        pass
    return out


def _is_ancestor(root, base, sha):
    """True if `sha` is at or before `base` in history (i.e. the doc predates the run)."""
    rc = subprocess.call(["git", "merge-base", "--is-ancestor", sha, base], cwd=root,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return rc != 0     # NOT an ancestor of base => verified at/after base => fresh


def cmd_learnings(args):
    """Cross-run tally of code-review findings. Cheap accumulation, gated promotion.

    Deliberately the same shape as the second brain's own reflect.py: raw
    observations pile up somewhere unbounded that nobody reads, and a separate
    bounded step promotes only what earned it. This command NEVER edits a standard
    -- it reports which classes have recurred enough to deserve one.
    """
    root = repo_root(args.root)
    path = os.path.join(state_dir(root), "learnings.jsonl")

    if args.add:
        rec = {"ts": _utc_now_iso(),
               "class": args.add, "standard_file": args.standard, "phase": args.phase,
               "file": args.file, "prd": args.prd or _run_field(root, "PRD")}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps({k: v for k, v in rec.items() if v is not None}) + "\n")
        print(f"tallied: {args.add}")
        return 0

    if not os.path.exists(path):
        print("no learnings tallied yet"); return 0
    rows = []
    for line in open(path, errors="replace"):
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    counts = {}
    for r in rows:
        counts.setdefault(r.get("class", "?"), []).append(r)
    print(f"{len(rows)} findings tallied across {len({r.get('prd') for r in rows})} PRD(s)\n")
    promote = []
    for cls, rs in sorted(counts.items(), key=lambda kv: -len(kv[1])):
        prds = {r.get("prd") for r in rs if r.get("prd")}
        mark = "  <- PROMOTE" if len(rs) >= 3 and len(prds) >= 2 else ""
        print(f"  {len(rs):>3}x  {cls}{mark}")
        if mark:
            promote.append((cls, rs))
    if promote:
        print("\nRecurred >=3 times across >=2 PRDs — each earns a PROPOSED standards edit.")
        print("⛔ Propose it as a diff; never auto-commit a file that instructs every future agent.\n")
        for cls, rs in promote:
            print(f"- **{cls}** -> {rs[0].get('standard_file') or '(pick the standard)'}")
            for r in rs[:3]:
                print(f"    cite: {r.get('file','?')} (phase {r.get('phase','?')}, {r.get('prd','?')})")
    return 0


_SENSITIVE_INPUT = re.compile(
    r"password|passcode|access[ _-]?code|credential|secret|token|authorization|cookie|"
    r"card[ _-]?(?:number|no)?|cvv|cvc|security[ _-]?code|pin|otp|mfa|"
    r"verification[ _-]?code|one[ _-]?time[ _-]?(?:code|password)",
    re.IGNORECASE,
)


def _prd_slug(prd):
    slug = os.path.splitext(os.path.basename(prd or "run"))[0]
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", slug).strip("-.")
    return slug or "run"


def _phase_result(phase_dir):
    marker = os.path.join(phase_dir, "e2e.md")
    if not os.path.exists(marker):
        raise ValueError("missing e2e.md result marker")
    with open(marker, errors="replace") as stream:
        first = stream.readline().strip()
    match = re.fullmatch(r"RESULT:\s*(pass|fail|blocked)", first, re.IGNORECASE)
    if not match:
        raise ValueError("e2e.md must begin with RESULT: pass|fail|blocked")
    return match.group(1).lower(), marker


def _profile_secret_values(root, cfg):
    profile_rel = (cfg.get("e2e") or {}).get("profile")
    if not profile_rel:
        return {}
    profile = profile_rel if os.path.isabs(profile_rel) else os.path.join(root, profile_rel)
    if not os.path.exists(profile):
        return {}
    with open(profile, errors="replace") as stream:
        text = stream.read()
    names = set(re.findall(r"\$\{?([A-Z][A-Z0-9_]*)\}?", text))
    names.update(re.findall(r"`([A-Z][A-Z0-9_]{2,})`", text))
    values = {name: os.environ[name] for name in names if os.environ.get(name)}
    for name, value in values.items():
        if value in text:
            raise ValueError(
                f"e2e profile contains a literal environment secret referenced by {name}"
            )
    return values


def _secret_shaped(value):
    return bool(
        re.fullmatch(r"\d{4,19}", value)
        or (re.fullmatch(r"\S{6,}", value)
            and re.search(r"[A-Za-z]", value)
            and re.search(r"\d", value))
        or re.fullmatch(r"\S{20,}", value)
    )


def _safe_literals(capture):
    section = re.search(r"(?ims)^## Safe literals\s*$\n(.*?)(?=^## |\Z)", capture)
    if not section:
        return set()
    values = {value.strip() for value in re.findall(r"(?m)^\s*-\s+`([^`]+)`\s*$", section.group(1))}
    opaque = any(_secret_shaped(value) or re.fullmatch(r"\S+", value) for value in values)
    if opaque or any(_SENSITIVE_INPUT.search(value) for value in values):
        raise ValueError("safe literal is secret-shaped or names a sensitive category")
    return values


def _replace_known_secrets(text, secret_values):
    text = str(text)
    for name, value in sorted(secret_values.items(), key=lambda item: len(item[1]), reverse=True):
        if value:
            text = text.replace(value, "${" + name + "}")
    return text


def sanitize_url(url, secret_values, safe_literals):
    sanitized = _replace_known_secrets(url, secret_values)
    parts = urlsplit(sanitized)
    host = parts.hostname or ""
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    try:
        port = parts.port
    except ValueError:
        port = None
    netloc = f"{host}:{port}" if port is not None else host
    path_segments = []
    previous = ""
    secret_predecessors = {"auth", "callback", "invite", "reset", "token", "verify"}
    for segment in parts.path.split("/"):
        structural = (
            not segment
            or re.fullmatch(r"[a-z][a-z0-9._~-]{0,63}", segment)
            and not re.search(r"\d{4,}", segment)
            and previous not in secret_predecessors
        )
        symbolic = re.fullmatch(r"\$\{[A-Z][A-Z0-9_]*\}", segment)
        path_segments.append(
            segment if structural or symbolic or segment in safe_literals else "[REDACTED]"
        )
        if segment:
            previous = segment.lower()
    path = "/".join(path_segments)
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if _SENSITIVE_INPUT.search(key):
            value = "[REDACTED]"
        elif value not in safe_literals and not re.fullmatch(r"\$\{[A-Z][A-Z0-9_]*\}", value):
            value = "[REDACTED: unclassified query]"
        query.append((key, value))
    fragment = parts.fragment
    if "?" in fragment:
        fragment = fragment.split("?", 1)[0] + "?[REDACTED: fragment query]"
    elif fragment and not (
            fragment in safe_literals
            or re.fullmatch(r"\$\{[A-Z][A-Z0-9_]*\}", fragment)
            or (fragment.startswith("/") and not _SENSITIVE_INPUT.search(fragment))):
        fragment = "[REDACTED: unclassified fragment]"
    return urlunsplit((parts.scheme, netloc, path, urlencode(query), fragment))


def sanitize_resolved_element(element, secret_values, safe_literals=None):
    safe_literals = safe_literals or set()
    sanitized = _replace_known_secrets(element, secret_values)
    opening = re.search(r"<([a-zA-Z][\w:-]*)([^>]*)>", sanitized)
    if not opening:
        return "[REDACTED: element fingerprint unavailable]"
    attrs = []
    for name, _, value in re.findall(r"([\w:-]+)\s*=\s*([\"'])(.*?)\2", opening.group(2)):
        lowered = name.lower()
        structural = (
            lowered in {"id", "data-testid", "name"}
            and re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", value)
            and not re.search(r"\d{4,}", value)
        )
        if lowered in {"role", "type"} or structural or value in safe_literals:
            attrs.append(f'{name}="{value}"')
    suffix = (" " + " ".join(attrs)) if attrs else ""
    return f"<{opening.group(1)}{suffix}>"


def sanitize_locator(locator, secret_values, safe_literals):
    sanitized = _replace_known_secrets(locator, secret_values)
    def redact_name(match):
        value = match.group(3)
        if (value in safe_literals or _SENSITIVE_INPUT.fullmatch(value)
                or re.fullmatch(r"\$\{[A-Z][A-Z0-9_]*\}", value)):
            return match.group(0)
        return f"{match.group(1)}{match.group(2)}[REDACTED: unclassified accessible name]{match.group(2)}"

    sanitized = re.sub(
        r"(\bname\s*:\s*)(['\"])(.*?)\2", redact_name, sanitized,
    )
    match = re.search(r"getByText\((['\"])(.*?)\1", sanitized)
    if match and match.group(2) not in safe_literals:
        sanitized = sanitized.replace(match.group(2), "[REDACTED: unclassified locator text]", 1)
    return sanitized


def redact_trace_value(value, locator, secret_values, safe_literals):
    """Return a Git-safe representation of one trace-derived input."""
    if value in (None, ""):
        return value
    if isinstance(value, list):
        return [redact_trace_value(item, locator, secret_values, safe_literals) for item in value]
    value = str(value)
    for name, secret in secret_values.items():
        if secret and value == secret:
            return "${" + name + "}"
    if _SENSITIVE_INPUT.search(locator or ""):
        return "[REDACTED: sensitive input]"
    if value in safe_literals:
        return value
    return "[REDACTED: unclassified input]"


def redact_observed_value(value, secret_values, safe_literals):
    if value in (None, ""):
        return value
    if isinstance(value, list):
        return [redact_observed_value(item, secret_values, safe_literals) for item in value]
    value = str(value)
    for name, secret in secret_values.items():
        if secret and value == secret:
            return "${" + name + "}"
    if value in safe_literals:
        return value
    return "[REDACTED: unclassified observation]"


_CAPTURE_SECTIONS = (
    "Intent", "Acceptance criteria", "Prerequisites", "Safe literals", "Steps",
    "Outcome", "Cleanup", "Stability",
)


def validate_capture_contract(capture):
    headings = set(re.findall(r"(?m)^##\s+(.+?)\s*$", capture))
    for required in _CAPTURE_SECTIONS:
        if required not in headings:
            raise ValueError(f"missing capture section: ## {required}")
        section = re.search(
            rf"(?ims)^##\s+{re.escape(required)}\s*$\n(.*?)(?=^##\s+|\Z)", capture)
        if not section or not section.group(1).strip():
            raise ValueError(f"empty capture section: ## {required}")
    steps = re.search(r"(?ims)^##\s+Steps\s*$\n(.*?)(?=^##\s+|\Z)", capture)
    if not steps or not re.search(r"(?m)^\|\s*\d+\s*\|", steps.group(1)):
        raise ValueError("empty capture section: ## Steps requires at least one numbered row")


def validate_capture_safety(capture):
    for line in capture.splitlines():
        if not line.lstrip().startswith("|") or not _SENSITIVE_INPUT.search(line):
            continue
        cells = [cell.strip().strip("`") for cell in line.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue
        value = cells[4]
        if value not in ("", "—", "-") and not re.fullmatch(
                r"\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED(?:: [^]]+)?\]", value):
            raise ValueError("sensitive input in capture.md must use an environment reference")


def validate_document_safety(text):
    category = (
        r"(?:password|passcode|access[ _-]?code|credential|pin|otp|token|secret|authorization|"
        r"cookie|card[ _-]?(?:number|no)|cvv|cvc)"
    )
    after = re.compile(
        rf"(?i)\b{category}\b\s*(?::|=|\bis\b|\bof\b)\s*"
        r"(?!\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED[^]]*\])\S+"
    )
    imperative_after = re.compile(
        rf"(?i)\b(?:use|enter|type|fill|paste|provide)\s+(?:the\s+)?{category}\s+"
        r"(?!\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED[^]]*\])\S+"
    )
    imperative_before = re.compile(
        rf"(?i)\b(?:use|enter|type|fill|paste|provide)\s+"
        r"(?!\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED[^]]*\])\S+"
        rf"(?:\s+\w+){{0,3}}\s+(?:in(?:to)?|as|for)\s+(?:the\s+)?{category}\b"
    )
    plain_code = re.compile(
        r"(?i)\buse\s+code\s+"
        r"(?!\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED[^]]*\])\S+"
    )
    sign_in = re.compile(
        r"(?i)\b(?:sign|log)\s+in\s+(?:with|using)\s+"
        r"(?!\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED[^]]*\])\S+"
    )
    opaque_imperative = re.compile(
        r"(?i)\b(?:enter|provide)\s+(\S+)"
    )
    opaque_match = opaque_imperative.search(text)
    if (after.search(text) or imperative_after.search(text) or imperative_before.search(text)
            or plain_code.search(text) or sign_in.search(text)
            or (opaque_match and _secret_shaped(opaque_match.group(1).rstrip(".,;")))):
        raise ValueError("sensitive value in Markdown must use an environment reference")


def validate_manual_contract(manual):
    required = (r"(?m)^\*\*Before:\*\*\s*\S", r"(?m)^\*\*Now:\*\*\s*\S",
                r"(?m)^1\.\s+\S", r"(?m)^\*\*You should see:\*\*\s*\S")
    if not all(re.search(pattern, manual) for pattern in required):
        raise ValueError("manual.md requires Before, Now, numbered steps, and You should see")


def e2e_evidence_checksum(phase_dir):
    digest = hashlib.sha256()
    found = False
    for name in ("e2e.md", "capture.md", "manual.md", "journey.json",
                 "media/index.md"):
        path = os.path.join(phase_dir, name)
        if not os.path.exists(path):
            continue
        found = True
        digest.update(name.encode("utf-8") + b"\0")
        with open(path, "rb") as stream:
            for chunk in iter(lambda: stream.read(65536), b""):
                digest.update(chunk)
    if not found:
        raise ValueError("no E2E evidence exists to checksum")
    return digest.hexdigest()


def _sanitize_document(text, secret_values):
    sanitized = _replace_known_secrets(text, secret_values)
    for name, secret in secret_values.items():
        if secret and secret in sanitized:
            raise ValueError(f"redaction failed for environment variable {name}")
    return sanitized


def _testing_dir(root, cfg):
    store = _store(root)
    if store:                      # store mode: <Store>/testing in the wiki, outside the worktree by design
        return os.path.join(store, "testing")
    configured = (cfg.get("testing") or {}).get("dir") or "docs/ai/testing"
    path = configured if os.path.isabs(configured) else os.path.join(root, configured)
    path = os.path.abspath(path)
    if os.path.commonpath((os.path.abspath(root), path)) != os.path.abspath(root):
        raise ValueError("[testing].dir must stay inside the repository")
    return path


def _scenario_path(root, cfg, prd, phase):
    return os.path.join(_testing_dir(root, cfg), "scenarios", _prd_slug(prd),
                        f"phase-{phase}-scenario.md")


def _is_ignored(root, path, repo=None):
    """Would git ignore `path`? Evaluated in `repo` (the store's wiki for store paths), else root."""
    cwd = repo or root
    if not os.path.isdir(cwd):
        return False
    return subprocess.call(
        ["git", "check-ignore", "-q", "--no-index", path], cwd=cwd,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ) == 0


def cmd_testdocs(args):
    """Build PRD-level indexes from already-promoted tracked scenarios."""
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    prd = args.prd or _run_field(root, "PRD")
    slug = _prd_slug(prd)
    outdir = _testing_dir(root, cfg)
    scenarios = sorted(
        glob.glob(os.path.join(outdir, "scenarios", slug, "phase-*-scenario.md")),
        key=_phase_num,
    )
    if not scenarios:
        print("no promoted scenarios found — nothing to aggregate.")
        print("Run `orchestrator.py promote-e2e --phase N` after every non-N/A e2e gate.")
        return 0

    os.makedirs(outdir, exist_ok=True)
    flow_path = os.path.join(outdir, f"{slug}-test-flow.md")
    man_path = os.path.join(outdir, f"{slug}-manual-test.md")

    flow = [f"# Test flow — {prd or slug}", "",
            f"_Built from {len(scenarios)} promoted, tracked E2E scenario(s)._", "",
            "**This file is an input, not a test.** It records what a browser agent actually did to",
            "prove each acceptance criterion: the screen, the element, the action, the data and the",
            "assertion that confirmed it. It exists so a Playwright spec can be generated from a real",
            "recorded run rather than guessed from the source.", "",
            "Selectors are recorded exactly as they were used. Where a selector was fragile, the capture",
            "says so — that is a note for whoever writes the spec, not a defect.", ""]
    man = [f"# How to test — {prd or slug}", "",
           f"_Built from {len(scenarios)} promoted, tracked E2E scenario(s)._", "",
           "## What changed", "",
           "Each section below is copied from the canonical scenario registry.", ""]

    for scenario in scenarios:
        n = _phase_num(scenario)
        text = open(scenario, errors="replace").read().strip()
        flow.append(f"## Phase {n}")
        flow.append("")
        flow.append(text)
        flow.append("")
        manual = re.search(
            r"(?ims)^## Manual verification\s*$\n(.*?)(?=^## Provenance\s*$|\Z)", text)
        if manual:
            man += [f"## Phase {n}", "", manual.group(1).strip(), ""]

    for path, lines in ((flow_path, flow), (man_path, man)):
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"wrote {_disp(path, root)}")

    repo = _testing_repo(root)
    if _is_ignored(root, flow_path, repo=repo) or _is_ignored(root, man_path, repo=repo):
        print("\n  WARNING: the testing dir is gitignored, so these will not be committed —"
              "\n  which defeats accumulating them for later test generation. Check [testing] dir.")
    elif _store(root):
        print("\n  These are in the store (wiki), never the team repo. Record them with:"
              f"\n    next: orchestrator.py store-commit --reason 'testing artifacts from {slug}'")
    else:
        print("\n  These paths are eligible for Git tracking. Include them in the testing-docs commit:"
              f"\n    git add {os.path.relpath(outdir, root)} && "
              f"git commit -m 'docs: testing artifacts from {slug}'")
    return 0


def cmd_pr_evidence(args):
    """Consolidate every phase's curated `pr-evidence.md` into one manifest the
    close-out PR step can attach — local file collection only, no network calls.
    The actual upload-and-embed (turning each path into an ADO attachment URL and a
    markdown image line in the PR body) is the orchestrator's job at close-out, using
    the same two-step REST upload the `attach-prd-ado` skill already proves works for
    arbitrary file content, not this script's — keeping ADO specifics out of a script
    this repo-agnostic.

    A phase with no visual surface (a backend-only fix, an internal refactor) writes
    no `pr-evidence.md` at all, which is correct — it does not get an empty entry here.
    """
    root = repo_root(args.root)
    sd = state_dir(root)
    cap = args.cap or 8

    entries = []  # (phase_num, abs_path, caption)
    for ev_file in sorted(glob.glob(os.path.join(sd, "phase-*", "pr-evidence.md")),
                          key=_phase_num):
        pdir = os.path.dirname(ev_file)
        n = _phase_num(ev_file)
        for line in open(ev_file, errors="replace"):
            line = line.strip()
            m = re.match(r"^-\s*(\S.*?\.(?:png|jpe?g|webp))\s*—\s*(.+)$", line)
            if not m:
                continue
            rel, caption = m.group(1), m.group(2).strip()
            full = os.path.join(pdir, rel)
            if not os.path.exists(full):
                print(f"  skip (missing file): phase {n}: {rel}")
                continue
            entries.append((n, full, caption))

    if not entries:
        print("no phase-*/pr-evidence.md files found — nothing to attach to a PR.")
        print("A phase with no visual surface correctly writes none; a UI phase's e2e")
        print("gate should have written one if it ran.")
        return 0

    if len(entries) > cap:
        print(f"  {len(entries)} evidence shots found, capping at {cap} "
              f"(one per phase first, then earliest-first) — override with --cap")
        by_phase = {}
        for n, path, caption in entries:
            by_phase.setdefault(n, []).append((path, caption))
        picked = []
        for n in sorted(by_phase):
            picked.append((n,) + by_phase[n][0])
        i = 0
        while len(picked) < cap:
            advanced = False
            for n in sorted(by_phase):
                if len(picked) >= cap:
                    break
                if i + 1 < len(by_phase[n]):
                    picked.append((n,) + by_phase[n][i + 1])
                    advanced = True
            if not advanced:
                break
            i += 1
        entries = picked[:cap]

    out = os.path.join(sd, "pr-evidence-manifest.md")
    with open(out, "w") as f:
        f.write("# PR evidence manifest — local paths, not yet uploaded\n\n")
        f.write("Upload each to the linked work item (attach-prd-ado's two-step REST\n")
        f.write("upload works for any file content), then embed `![caption](url)` under\n")
        f.write("a Screenshots section in the PR body. Unverified in this org until the\n")
        f.write("first real use — check it renders once the PR opens.\n\n")
        for n, path, caption in entries:
            f.write(f"- phase {n}: `{os.path.relpath(path, root)}` — {caption}\n")
    print(f"wrote {os.path.relpath(out, root)} ({len(entries)} shot(s))")
    return 0


def _phase_num(path):
    m = re.search(r"phase-(\d+)", path)
    return int(m.group(1)) if m else 0


# Fallback only, for a journey.json written before `actingSteps` existed: mirrors e2e-test journey.ACTING
# (the one definition). A finished journey carries the verdict; never recount it.
_JOURNEY_ACTING = {"open", "goto", "navigate", "click", "dblclick", "fill", "type", "select", "check",
                   "uncheck", "press", "back", "forward", "reload", "eval"}
_SYMBOLIC = re.compile(r"\$\{[A-Z][A-Z0-9_]*\}")


def _phase_journey(phase_dir):
    """(journey | None, "complete"|"incomplete", reason) for a phase's journey.json. Never
    raises: a missing or broken journey is recorded, never a block (PRD-2 D7)."""
    path = os.path.join(phase_dir, "journey.json")
    if not os.path.exists(path):
        return None, "incomplete", "no journey.json"
    try:
        with open(path, errors="replace") as stream:
            journey = json.load(stream)
    except (OSError, ValueError):
        return None, "incomplete", "invalid journey.json"
    if (not isinstance(journey, dict) or journey.get("schema") != 1
            or not isinstance(journey.get("steps"), list)):
        return None, "incomplete", "invalid journey.json"
    acting = journey.get("actingSteps")
    if not isinstance(acting, int) or isinstance(acting, bool):
        acting = sum(1 for s in journey["steps"]
                     if isinstance(s, dict) and s.get("action") in _JOURNEY_ACTING)
    if acting < 1:
        return journey, "incomplete", "no acting steps"
    if journey.get("journey") == "incomplete":
        return journey, "incomplete", journey.get("reason") or "recorded incomplete"
    return journey, "complete", ""


def _journey_cell(value):
    # validate_capture_safety splits rows on every "|": replace, never escape (bundle._cell rule).
    return str(value if value not in (None, "") else "—").replace("|", "/").replace("\n", " ")


def export_journey_spec(phase_dir):
    journey, _, _ = _phase_journey(phase_dir)
    catalog = journey.get("catalog") if journey else None
    if not isinstance(catalog, str):
        return None, "no cataloged journey"
    # Shape only: journey.py export-playwright owns the containment check (realpath inside the catalog).
    if not catalog.startswith(".claude/e2e/journeys/"):
        return None, "invalid catalog path"
    path = os.path.join(CATALOG_ROOT, catalog, "journey.json")
    if not os.path.isfile(path):
        return None, "cataloged journey not found"
    try:
        # JOURNEY_CATALOG scopes journey.py's containment check to the catalog this path was built from.
        env = {**os.environ, "JOURNEY_CATALOG": os.path.join(CATALOG_ROOT, ".claude", "e2e", "journeys")}
        out = subprocess.run([sys.executable, "-I", JOURNEY_PY, "export-playwright", path],
                             timeout=60, capture_output=True, text=True, env=env)
        if out.returncode:
            lines = out.stderr.strip().splitlines()
            return None, lines[-1] if lines else f"export exited {out.returncode}"
        return out.stdout.strip(), ""
    except (OSError, subprocess.SubprocessError) as error:
        return None, str(error)


def _journey_markdown(journey, secrets, safe_literals):
    """The repo copy of a journey's steps: every undeclared value redacted, as the capture is."""
    rows = ["| # | screen / url | action | locator | input | picked | wait / trigger | assertion | evidence |",
            "|---|---|---|---|---|---|---|---|---|"]
    unresolved = 0
    for i, step in enumerate(s for s in journey.get("steps") or [] if isinstance(s, dict)):
        url = step.get("url")
        if url:
            # The repo copy keeps the screen, not the host: strip scheme + netloc.
            url = urlunsplit(urlsplit(sanitize_url(str(url), secrets, safe_literals))._replace(
                scheme="", netloc="")) or "/"
        else:
            url = "—"
        loc = step.get("locator") if isinstance(step.get("locator"), dict) else None
        if loc and loc.get("playwright"):
            locator = sanitize_locator(str(loc["playwright"]), secrets, safe_literals)
        elif step.get("unresolved"):
            unresolved += 1
            locator = f"{step.get('raw') or '?'} (unresolved)"
        else:
            locator = "—"
        raw_input = step.get("input")
        if raw_input in (None, ""):
            shown = "—"
        elif _SYMBOLIC.fullmatch(str(raw_input)) or "{unique}" in str(raw_input):
            shown = str(raw_input)
        else:
            shown = redact_trace_value(str(raw_input), locator, secrets, safe_literals)
        picked = step.get("picked")
        picked = redact_observed_value(picked, secrets, safe_literals) if picked not in (None, "") else "—"
        if isinstance(picked, list):
            picked = ", ".join(map(str, picked))
        wait = _replace_known_secrets(step.get("wait") or "—", secrets)
        claim = _replace_known_secrets(step.get("assert") or "—", secrets)
        shot = step.get("shot")
        evidence = f"`{os.path.basename(str(shot))}`" if shot else "—"
        action = str(step.get("action") or "?") + ("" if step.get("ok", True) else " ✗")
        rows.append(f"| {step.get('n') or i + 1} | {_journey_cell(url)} | {_journey_cell(action)} | "
                    f"`{_journey_cell(locator)}` | {_journey_cell(shown)} | {_journey_cell(picked)} | "
                    f"{_journey_cell(wait)} | {_journey_cell(claim)} | {_journey_cell(evidence)} |")
    table = "\n".join(rows)
    if unresolved:
        table += f"\n\n> ⚠️ {unresolved} step(s) had an unresolved ref"
    validate_capture_safety(table)
    return table


def _render_e2e_scenario(root, cfg, prd, phase):
    """Render one phase's raw browser evidence without changing the worktree."""
    if (cfg.get("testing") or {}).get("capture", "on") != "on":
        raise ValueError("[testing].capture is not on")
    phase_dir = os.path.join(state_dir(root), f"phase-{phase}")
    result, marker = _phase_result(phase_dir)
    capture_path = os.path.join(phase_dir, "capture.md")
    manual_path = os.path.join(phase_dir, "manual.md")
    for required in (capture_path, manual_path):
        if not os.path.exists(required):
            raise ValueError(f"missing {os.path.basename(required)}")
    media_index = os.path.join(phase_dir, "media", "index.md")
    if result != "blocked" and not os.path.exists(media_index):
        raise ValueError("missing media/index.md for a browser run")

    with open(capture_path, errors="replace") as stream:
        capture = stream.read()
    with open(manual_path, errors="replace") as stream:
        manual = stream.read()
    validate_capture_contract(capture)
    secrets = _profile_secret_values(root, cfg)
    capture = _sanitize_document(capture, secrets)
    manual = _sanitize_document(manual, secrets)
    validate_capture_safety(capture)
    validate_document_safety(capture)
    validate_document_safety(manual)
    validate_manual_contract(manual)
    safe_literals = _safe_literals(capture)
    checksum = e2e_evidence_checksum(phase_dir)
    journey, journey_status, journey_reason = _phase_journey(phase_dir)
    captured = datetime.datetime.fromtimestamp(
        os.path.getmtime(marker), datetime.timezone.utc,
    ).isoformat(timespec="seconds").replace("+00:00", "Z")
    scenario_id = f"{_prd_slug(prd)}-phase-{phase}-scenario"
    lines = [f"# E2E scenario — {_prd_slug(prd)} phase {phase}", "",
             f"- Schema: `{(cfg.get('testing') or {}).get('scenario_schema', 1)}`",
             f"- Scenario ID: `{scenario_id}`",
             f"- Source PRD: `{prd or '(unknown)'}`",
             f"- Phase: `{phase}`",
             f"- Base commit: `{_run_field(root, 'Base commit') or '(unknown)'}`",
             f"- Captured at: `{captured}`",
             f"- Evidence SHA-256: `{checksum}`",
             f"- Result: `{result}`",
             f"- Journey: `{journey_status}`", "",
             "## Journey record", "", capture.strip(), ""]

    if journey_status == "complete":
        lines += ["## Steps", "", _journey_markdown(journey, secrets, safe_literals).strip(), ""]
    else:
        lines += ["## Steps", "", f"Journey: incomplete — {journey_reason}.", ""]
        if journey is not None and journey_reason == "no-assertion":
            lines += [_journey_markdown(journey, secrets, safe_literals).strip(), ""]

    lines += ["## Manual verification", "", manual.strip(), "",
              "## Provenance", "",
              "Raw journey and media were temporary gitignored evidence and are not retained in Git.", ""]
    rendered = _sanitize_document("\n".join(lines), secrets)
    output = _scenario_path(root, cfg, prd, phase)
    return output, rendered


def promote_e2e(root, cfg, prd, phase):
    """Promote one phase's ignored browser evidence into a redacted tracked scenario."""
    output, rendered = _render_e2e_scenario(root, cfg, prd, phase)
    if _is_ignored(root, output, repo=_testing_repo(root)):
        raise ValueError("configured testing output is gitignored")
    os.makedirs(os.path.dirname(output), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".scenario-", suffix=".md", dir=os.path.dirname(output))
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(rendered)
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return output


def validate_promoted_e2e(root, cfg, prd, phase, committed=False):
    output = _scenario_path(root, cfg, prd, phase)
    if not os.path.exists(output):
        return False, f"missing durable scenario: {_disp(output, root)}"
    if _is_ignored(root, output, repo=_testing_repo(root)):
        return False, f"durable scenario is gitignored: {_disp(output, root)}"
    try:
        result, _ = _phase_result(os.path.join(state_dir(root), f"phase-{phase}"))
    except ValueError as error:
        return False, str(error)
    with open(output, errors="replace") as stream:
        text = stream.read()
    try:
        _, generated = _render_e2e_scenario(root, cfg, prd, phase)
    except (OSError, ValueError) as error:
        return False, str(error)
    if text != generated:
        return False, "durable scenario differs from the generated current-evidence document"
    if f"- Result: `{result}`" not in text:
        return False, "durable scenario result does not match e2e.md"
    if "- Schema: `" not in text or "- Scenario ID: `" not in text:
        return False, "durable scenario is missing required metadata"
    phase_dir = os.path.join(state_dir(root), f"phase-{phase}")
    try:
        checksum = e2e_evidence_checksum(phase_dir)
    except ValueError as error:
        return False, str(error)
    if f"- Evidence SHA-256: `{checksum}`" not in text:
        return False, "durable scenario does not match the current E2E evidence"
    if committed:
        # Store mode: the scenario must be tracked and clean at the WIKI's HEAD (store-commit
        # put it there); legacy: at the worktree's HEAD, exactly as before.
        store = _store(root)
        repo = _store_repo(store) if store else root
        if not repo:
            return False, f"durable scenario's store is not in a git repo: {_disp(output, root)}"
        relative = os.path.relpath(os.path.realpath(output), repo) if store \
            else os.path.relpath(output, root)
        tracked = subprocess.call(
            ["git", "ls-files", "--error-unmatch", "--", relative], cwd=repo,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ) == 0
        clean_at_head = tracked and subprocess.call(
            ["git", "diff", "--quiet", "HEAD", "--", relative], cwd=repo,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ) == 0
        if not clean_at_head:
            where = "in the wiki (run `orchestrator.py store-commit`)" if store else "at HEAD"
            return False, f"durable scenario is not committed {where}: {_disp(output, root)}"
    return True, ""


def cmd_promote_e2e(args):
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    prd = args.prd or _run_field(root, "PRD")
    try:
        output = promote_e2e(root, cfg, prd, args.phase)
        ok, reason = validate_promoted_e2e(root, cfg, prd, args.phase)
        if not ok:
            raise ValueError(reason)
    except (OSError, ValueError) as error:
        print(f"e2e promotion failed: {error}", file=sys.stderr)
        return 2
    _emit(root, "e2e_promoted", phase=args.phase, detail=_disp(output, root))
    print(f"wrote {_disp(output, root)}")
    print("durability gate: pass (tracked path, schema and result validated)")
    _, status, reason = _phase_journey(os.path.join(state_dir(root), f"phase-{args.phase}"))
    if status != "complete":
        # Loud, never blocking (PRD-2 D7): report() lists these under "Journeys incomplete".
        _emit(root, "journey_incomplete", phase=args.phase, detail=reason)
        print(f"journey: incomplete — {reason} (recorded; promotion not blocked)")
    spec, reason = export_journey_spec(os.path.join(state_dir(root), f"phase-{args.phase}"))
    print(f"spec: {spec}" if spec else f"spec: not exported — {reason} (promotion not blocked)")
    return 0


def cmd_validate_e2e(args):
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    prd = args.prd or _run_field(root, "PRD")
    ok, reason = validate_promoted_e2e(root, cfg, prd, args.phase, committed=args.committed)
    if not ok:
        print(f"durability gate: fail — {reason}", file=sys.stderr)
        return 2
    print("durability gate: pass")
    return 0


# ---- figma fidelity gate ----------------------------------------------------
# Pull the PRD's Figma frames (source of truth) and gate a UI phase's commit on
# a filled screenshot-vs-Figma comparison. The pull reuses the figma-extractor
# skill's REST wrapper; the comparison itself is done by the e2e worker against
# reference/figma-gate.md. See that file for the checklist and classification.

FIGMA_API_REL = os.path.join(".claude", "skills", "figma-extractor", "scripts", "figma-api.sh")
_DESIGN_HEADING = re.compile(r"(?im)^#{1,6}\s.*design contract")
_NODE_ID = re.compile(r"\b(\d{3,}[:-]\d{3,})\b")
_FIGMA_RESULT = re.compile(r"RESULT:\s*(pass|fail|na)\s*$", re.IGNORECASE)


def _figma_cfg(cfg):
    return cfg.get("figma") or {}


def _figma_enabled(cfg):
    fg = _figma_cfg(cfg)
    return bool(fg.get("enabled")) and bool(fg.get("file_key"))


def _figma_bundle_dir(root, cfg, prd):
    base = _figma_cfg(cfg).get("bundle_dir", ".agents/figma")
    base = base if os.path.isabs(base) else os.path.join(root, base)
    return os.path.join(base, _prd_slug(prd))


def _figma_checks(root, cfg):
    mode = _run_field(root, "Figma checks") or _figma_cfg(cfg).get("checks", "end")
    if mode not in ("skip", "per-phase", "end"):
        raise ValueError("Figma checks must be skip, per-phase, or end")
    return mode


def _figma_storage_error(root, cfg, prd):
    # Ignore rules do not protect files already in the index (including force-added files).
    root = os.path.realpath(root)
    bundle = os.path.realpath(_figma_bundle_dir(root, cfg, prd))
    if os.path.commonpath([os.path.realpath(root), bundle]) != os.path.realpath(root):
        return "Figma bundle must be in an ignored directory inside the working tree"
    base = os.path.dirname(bundle)
    tracked = subprocess.run(["git", "ls-files", "--", os.path.relpath(base, root)],
                             cwd=root, capture_output=True, text=True)
    if tracked.returncode != 0:
        return "Cannot verify that Figma artifacts are untracked"
    if tracked.stdout.strip():
        return "Figma images and extracted design data must never be tracked; untrack the bundle first"
    if not _is_ignored(root, os.path.join(bundle, ".probe")):
        return "Figma bundle directory must be gitignored; images and extracted design data are local only"
    return ""


def _figma_compare_path(root, phase):
    return os.path.join(state_dir(root), f"phase-{phase}", "figma-compare.md")


def _surface_slug(surface):
    return re.sub(r"[^a-zA-Z0-9]+", "-", surface).strip("-").lower() or "surface"


def _figma_frames_from_prd(prd_path):
    """Parse the PRD's Design contract table into [(surface, node_id)].

    Reads the first Markdown table under the '## ... Design contract' heading and
    pulls each row's surface label (first cell) plus a `NNNN:NNNN` / `NNNN-NNNN`
    node-id from any cell; node-ids are normalised to colon form. Returns [] when
    the section or a parseable frame is absent -- the SKILL decides whether that
    is a PRD gap for a UI PRD.
    """
    if not prd_path or not os.path.exists(prd_path):
        return []
    with open(prd_path, errors="replace") as stream:
        text = stream.read()
    heading = _DESIGN_HEADING.search(text)
    if not heading:
        return []
    section = text[heading.end():]
    nxt = re.search(r"(?m)^#{1,6}\s", section)
    if nxt:
        section = section[:nxt.start()]
    frames, seen = [], set()
    for line in section.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if len(cells) < 2 or set("".join(cells)) <= set("-: "):
            continue  # separator / empty
        node = None
        for cell in cells:
            match = _NODE_ID.search(cell)
            if match:
                node = match.group(1).replace("-", ":")
                break
        if not node or node in seen:
            continue
        surface = cells[0]
        if surface.lower() in ("surface", "frame", "screen", "screen / surface"):
            continue
        seen.add(node)
        frames.append((surface, node))
    return frames


def figma_pull(root, cfg, prd, frames, force=False):
    """Pull `frames` into an ignored local snapshot. Returns (bundle, pulled, skipped)."""
    file_key = _figma_cfg(cfg).get("file_key")
    api = os.path.join(root, FIGMA_API_REL)
    if not os.path.exists(api):
        raise ValueError(f"figma-extractor not installed: {FIGMA_API_REL}")
    bundle = _figma_bundle_dir(root, cfg, prd)
    storage_error = _figma_storage_error(root, cfg, prd)
    if storage_error:
        raise ValueError(storage_error)
    os.makedirs(bundle, exist_ok=True)
    pulled, skipped, index = [], [], []
    for surface, node in frames:
        slug = _surface_slug(surface)
        png = os.path.join(bundle, f"{slug}.png")
        tokens = os.path.join(bundle, f"{slug}.tokens.json")
        index.append((surface, node, slug))
        if os.path.exists(png) and os.path.exists(tokens) and not force:
            skipped.append(slug)
            continue
        tmp = tempfile.mkdtemp(dir=bundle)
        try:
            subprocess.run(["bash", api, "image", file_key, node,
                            "--format", "png", "--scale", "2", "--output", tmp],
                           cwd=root, check=True, capture_output=True, text=True)
            produced = [os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith(".png")]
            if not produced:
                raise ValueError(f"figma image produced no PNG for {node}")
            os.replace(produced[0], png)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        node_json = subprocess.run(["bash", api, "nodes", file_key, node],
                                   cwd=root, check=True, capture_output=True, text=True).stdout
        with open(tokens, "w") as stream:
            stream.write(node_json)
        pulled.append(slug)
    lines = [f"# Figma bundle -- {_prd_slug(prd)}", "",
             f"- File key: `{file_key}`", f"- Source PRD: `{prd or '(unknown)'}`", "",
             "| Surface | node-id | Screenshot | Tokens |", "|---|---|---|---|"]
    for surface, node, slug in index:
        lines.append(f"| {surface} | `{node}` | `{slug}.png` | `{slug}.tokens.json` |")
    with open(os.path.join(bundle, "index.md"), "w") as stream:
        stream.write("\n".join(lines) + "\n")
    return bundle, pulled, skipped


def cmd_figma_pull(args):
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    prd = args.prd or _run_field(root, "PRD")
    if not _figma_enabled(cfg):
        print("figma gate: N/A -- [figma] not enabled or [figma].file_key unset; nothing to pull")
        return 3
    try:
        if _figma_checks(root, cfg) == "skip":
            print("figma gate: N/A -- skipped at kickoff; nothing to pull")
            return 3
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    frames = _figma_frames_from_prd(_resolve_prd(root, prd))   # root-relative, never cwd-relative
    if not frames:
        print("figma-pull: no Design-contract frames with a node-id found in the PRD.\n"
              "  If this PRD has UI phases, that is a PRD gap -- add a Design contract table\n"
              "  with a node-id column (see reference/figma-gate.md). If it has no UI, the\n"
              "  figma gate is N/A for every phase.", file=sys.stderr)
        return 3
    try:
        bundle, pulled, skipped = figma_pull(root, cfg, prd, frames, force=args.force)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) and error.stderr else error
        print(f"figma-pull failed: {detail}", file=sys.stderr)
        return 2
    _emit(root, "figma_pull", detail=os.path.relpath(bundle, root))
    print(f"figma bundle: {os.path.relpath(bundle, root)} "
          f"({len(pulled)} pulled, {len(skipped)} already present, {len(frames)} frames)")
    return 0


def _figma_compare_result(path):
    """Return (result, unresolved_regressions). Raises ValueError if malformed."""
    if not os.path.exists(path):
        raise ValueError(f"missing figma-compare.md: {os.path.basename(path)}")
    with open(path, errors="replace") as stream:
        text = stream.read()
    first = text.splitlines()[0].strip() if text.strip() else ""
    match = _FIGMA_RESULT.fullmatch(first)
    if not match:
        raise ValueError("figma-compare.md must begin with RESULT: pass|fail|na")
    regressions = 0
    for line in text.splitlines():
        low = line.lower()
        if line.lstrip().startswith("|") and re.search(r"\bregression\b", low):
            if not re.search(r"\b(resolved|fixed|confirm|deferred)\b", low):
                regressions += 1
    return match.group(1).lower(), regressions


def validate_figma(root, cfg, prd, phase, committed=False, final=False):
    """The Figma fidelity gate. Pass unless there is an unresolved regression."""
    if not _figma_enabled(cfg):
        return True, "figma gate N/A (not enabled)"
    try:
        mode = _figma_checks(root, cfg)
    except ValueError as error:
        return False, str(error)
    storage_error = _figma_storage_error(root, cfg, prd)
    if storage_error:
        return False, storage_error
    if mode == "skip":
        return True, "figma gate N/A (skipped at kickoff)"
    if mode == "end" and not final:
        return True, "figma gate deferred to end; validate with --final before close-out"
    path = _figma_compare_path(root, phase)
    try:
        result, regressions = _figma_compare_result(path)
    except ValueError as error:
        return False, str(error)
    if result == "na":
        return True, "figma compare N/A for this phase"
    if result == "fail" or regressions > 0:
        return False, (f"figma compare has {regressions} unresolved regression row(s) "
                       f"(RESULT: {result})")
    # --committed remains accepted for existing callers; design artifacts always stay untracked.
    return True, ""


def cmd_validate_figma(args):
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    prd = args.prd or _run_field(root, "PRD")
    ok, reason = validate_figma(root, cfg, prd, args.phase, committed=args.committed, final=args.final)
    if not ok:
        print(f"figma fidelity gate: fail -- {reason}", file=sys.stderr)
        _emit(root, "figma_fail", phase=args.phase, detail=reason)
        return 2
    _emit(root, "figma_pass", phase=args.phase, detail=reason or "clean")
    print(f"figma fidelity gate: pass{(' -- ' + reason) if reason else ''}")
    return 0


# ---- verify (build+test) artifact + the phase-commit gate -------------------
# "The builder says the tests passed" used to be prose. `verify` runs the repo's
# own [validation].levels and records a machine-checkable phase-N/verify.json, and
# `gate` composes verify + the e2e durability gate (only when e2e actually ran) +
# the figma gate into one pass/fail and writes phase-N/.gate-pass. The pre-commit
# hook (cmd_hook_pre_commit) requires that token, so a phase cannot be committed
# with a red build, an unpromoted e2e, or an unresolved figma regression.

def _verify_path(root, phase):
    return os.path.join(state_dir(root), f"phase-{phase}", "verify.json")


def _gate_pass_path(root, phase):
    return os.path.join(state_dir(root), f"phase-{phase}", ".gate-pass")


def _tree_excludes(root, cfg):
    globs = [g for g in cfg.get("validation", {}).get("ignore") or [] if isinstance(g, str)]
    prefixes = [".agents/"]
    for section in ("plans", "testing"):
        directory = cfg.get(section, {}).get("dir")
        if not isinstance(directory, str) or os.path.isabs(directory):
            continue
        relative = os.path.relpath(os.path.abspath(os.path.join(root, directory)), os.path.abspath(root))
        if relative != ".." and not relative.startswith("../"):
            prefixes.append(relative.rstrip("/") + "/")
    prefixes += cfg.get("scope", {}).get("exclude", []) + cfg.get("park", {}).get("allow_dirty", [])
    return globs, prefixes


def _tree_excluded(path, globs, prefixes):
    return any(_under_prefix(path, p) for p in prefixes) or any(
        _under_prefix(path, g) if g.endswith("/") else fnmatch.fnmatchcase(path, g) for g in globs)


SURFACE_TEST_GLOBS = ("tests/", "test/", "*/tests/*", "*/test/*", "*/__tests__/*",
                      "test_*.py", "*/test_*.py", "*_test.py", "*_test.go", "*.test.*",
                      "*.spec.*", "*Tests.cs", "*Test.cs", "*.Tests/*")
SURFACE_SKIP_PATTERNS = (".skip(", "it.skip", "xit(", "@pytest.mark.skip", "@unittest.skip",
                         "[Fact(Skip", "[Ignore")


def _surface_strings(value, paths=False):
    return isinstance(value, list) and all(isinstance(s, str) and s.strip() and
        (not paths or not s.startswith("/") and ".." not in s.split("/")) for s in value)


def _surface_cfg(cfg, problems=None):
    problems = problems if problems is not None else []
    if "surface" not in cfg:
        return None
    section = cfg.get("surface")
    if not isinstance(section, dict):
        problems.append("[surface] must be a table")
        return None
    paths = section.get("paths", [])
    if not isinstance(paths, list) or any(not isinstance(p, dict) for p in paths):
        problems.append("[surface] paths must be a list of { name, globs, risk } tables")
    result, names = {"paths": []}, set()
    for i, p in enumerate(paths if isinstance(paths, list) else []):
        if not isinstance(p, dict):
            continue
        name, before = p.get("name"), len(problems)
        prefix = f"[surface] paths[{i}] ({name})"
        if not isinstance(name, str) or not name.strip():
            problems.append(prefix + ": non-empty name required")
        if not p.get("globs") or not _surface_strings(p["globs"], paths=True):
            problems.append(prefix + ": globs must be non-empty repo-relative globs")
        if not isinstance(p.get("risk", True), bool):
            problems.append(prefix + ": risk must be a bool")
        if len(problems) == before:
            result["paths"].append({"name": name, "globs": p["globs"], "risk": p.get("risk", True)})
            if name in names:
                problems.append(prefix + ": duplicate name")
            names.add(name)
    for key, default in (("test_globs", SURFACE_TEST_GLOBS), ("skip_patterns", SURFACE_SKIP_PATTERNS)):
        value = section.get(key, list(default))
        if not _surface_strings(value, paths=key == "test_globs"):
            problems.append(f"[surface] {key} must be a list of non-empty " +
                            ("repo-relative globs" if key == "test_globs" else "strings"))
            value = default
        result[key] = list(value)
    return result


def _glob_hit(path, globs):
    return _tree_excluded(path, globs, ())


def _surface_git(root, *argv):
    rec = subprocess.run(["git", *argv], cwd=root, capture_output=True, text=True)
    if rec.returncode:
        raise RuntimeError(rec.stderr.strip() or f"git {argv[0]} failed")
    return rec.stdout


def _resolve_commit(root, sha):
    if not isinstance(sha, str) or not sha or sha.startswith("-"):
        return None
    try:
        return _surface_git(root, "rev-parse", "--verify", "-q", f"{sha}^{{commit}}").strip()
    except (OSError, RuntimeError):
        return None


def _surface_record(path):
    try:
        with open(path) as stream:
            rec = json.load(stream)
        return rec if isinstance(rec, dict) else {}
    except (OSError, ValueError):
        return {}


def _surface_order(root, shas):
    if not shas:
        return []
    # Git preserves argument order for timestamp ties; seed descendants before ancestors.
    selected = set(shas)
    ordered = [s for s in _surface_git(root, "rev-list", "--topo-order", *shas).splitlines() if s in selected]
    return list(reversed(_surface_git(root, "log", "--no-walk=sorted", "--format=%H", *ordered).splitlines()))


def phase_commits(root, phase, extra=()):
    window, notes = _run_window(root), []
    anchors, explicit, hooked, store = _commit_sources(root, window, phase)
    cfg, _ = load_config(root)
    plan = _phase_plan_path(root, cfg, phase)
    planned = []
    if plan:
        with open(plan, errors="replace") as stream:
            planned = plan_touch_set(stream.read()) or []
    kept = anchors | explicit
    # Without a touch set, the newest phase hook is the pending phase commit until logged.
    if not planned and not kept:
        for event in reversed(window):
            if event.get("event") == "commit" and str(event.get("phase")) == str(phase) and \
                    (sha := _resolve_commit(root, event.get("sha"))) in hooked - store:
                kept.add(sha)
                break
    for sha in hooked - store:
        files = {p for _, path, old in _commit_changes(root, sha) for p in (path, old) if p}
        if any(_under_prefix(path, prefix) for path in files for prefix in planned):
            kept.add(sha)
    prior = _surface_record(os.path.join(state_dir(root), f"phase-{phase}", "surface.json"))
    # A prior scan is not proof that a hook-only commit belonged to this phase.
    kept.update(s for token in prior.get("commits", [])
                if (s := _resolve_commit(root, token)) and s not in hooked)
    kept.update(s for token in prior.get("extra_commits", []) if (s := _resolve_commit(root, token)))
    for token in extra:
        sha = _resolve_commit(root, token)
        if sha:
            kept.add(sha)
        else:
            notes.append(f"commit {token} not found")
    shas = _surface_order(root, kept - store)
    if not shas:
        notes.append("no base recorded" if _run_field(root, "Base commit") in (None, "", "(unknown)")
                     else f"no commits recorded for phase {phase}")
    return shas, notes


def _commit_changes(root, sha):
    parent = _resolve_commit(root, sha + "^1")
    revisions = [parent, sha] if parent else ["--root", sha]
    parts = _surface_git(root, "diff-tree", "-r", "--no-commit-id", "-z", "--name-status",
                         "-M", *revisions).split("\0")
    changes, i = [], 0
    while i < len(parts) and parts[i]:
        status, path = parts[i], parts[i + 1]
        i += 2
        old = None
        if status[0] in "RC":
            old, path = path, parts[i]
            i += 1
        changes.append((status[0], path, old))
    return changes


def _added_lines(root, sha, paths):
    parent = _resolve_commit(root, sha + "^1") or "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    added = {}
    for path in paths:
        # One literal path per diff also handles Git's quoted headers for unusual filenames.
        patch = _surface_git(root, "diff", "-U0", "--no-color", "--no-ext-diff", "-M", parent,
                             sha, "--", ":(literal)" + path)
        added[path] = [line[1:] for line in patch.splitlines()
                       if line.startswith("+") and not line.startswith("+++")]
    return added


def _levels_at(root, rev):
    if not rev:
        return {}
    try:
        if not _surface_git(root, "ls-tree", "-z", rev, "--", CONFIG_REL):
            return {}
        cfg = tomllib.loads(_surface_git(root, "show", f"{rev}:{CONFIG_REL}"))
        levels = cfg.get("validation", {}).get("levels", [])
        return {lv.get("name") or lv["cmd"]: lv["cmd"] for lv in levels
                if isinstance(lv, dict) and isinstance(lv.get("cmd"), str)}
    except (OSError, RuntimeError, ValueError, TypeError, AttributeError):
        return None


def _surface_key(hit):
    return tuple(hit.get(k) for k in ("kind", "category", "path", "level", "pattern"))


def surface_scan(root, scfg, shas):
    hits, notes, seen = [], [], set()

    def add(hit):
        key = _surface_key(hit)
        if key not in seen:
            seen.add(key)
            if len(hits) < 200:
                hits.append(hit)
            elif "surface hits truncated at 200" not in notes:
                notes.append("surface hits truncated at 200")

    for sha in shas:
        try:
            changes = _commit_changes(root, sha)
            short = sha[:9]
            for status, path, old in changes:
                for p in dict.fromkeys(p for p in (old, path) if p):
                    for cat in scfg["paths"]:
                        if _glob_hit(p, cat["globs"]):
                            add(dict(kind="path", category=cat["name"], path=p, risk=cat["risk"], sha=short))
                if status == "D" and _glob_hit(path, scfg["test_globs"]):
                    exists = subprocess.run(["git", "cat-file", "-e", f"{shas[-1]}:{path}"],
                                            cwd=root, capture_output=True).returncode == 0
                    if not exists:
                        add(dict(kind="test_deleted", category="deleted test", path=path, sha=short))
            test_paths = [p for status, p, _ in changes if status in ("A", "M", "R")
                          and _glob_hit(p, scfg["test_globs"])]
            for path, lines in _added_lines(root, sha, test_paths).items():
                for pattern in scfg["skip_patterns"]:
                    line = next((line for line in lines if pattern in line), None)
                    if line is not None:
                        add(dict(kind="test_skipped", category="skipped test", path=path, pattern=pattern,
                                 line=line.strip()[:120], sha=short))
            if any(".claude/orchestrator.toml" in (p, old) for _, p, old in changes):
                before = _levels_at(root, _resolve_commit(root, sha + "^1"))
                after = _levels_at(root, sha)
                if before is None or after is None:
                    notes.append(f"unreadable or unparseable TOML at {short}; validation levels skipped")
                else:
                    for name, cmd in before.items():
                        kind = "level_removed" if name not in after else "level_changed" if cmd != after[name] else None
                        if kind:
                            add(dict(kind=kind, category="validation level", path=".claude/orchestrator.toml",
                                     level=name, sha=short))
        except Exception as error:
            notes.append(f"scan failed for {sha}: {error}")
    return hits, notes


def _hit_line(label, h):
    kind = h["kind"]
    if kind == "path":
        return f"{label} touched {h['category']}: {h['path']}"
    if kind == "test_deleted":
        return f"{label} deleted test: {h['path']}"
    if kind == "test_skipped":
        return f"{label} skipped a test: {h['path']} ({h['pattern']})"
    if kind == "level_removed":
        return f"{label} removed validation level {h['level']}"
    return f"{label} changed validation level {h['level']} (cmd)"


def cmd_surface(args):
    root = repo_root(args.root)
    scfg = _surface_cfg(load_config(root)[0])
    if scfg is None:
        print("surface: not configured ([surface] absent) -- nothing scanned")
        return 3
    sd = state_dir(root)
    if not os.path.isdir(sd):
        print("surface: no run state")
        return 3
    phase = getattr(args, "phase", None)
    final = getattr(args, "final", False)
    if phase is None and not final:
        print("usage: surface --phase N [--sha S] | --final")
        return 2
    out = os.path.join(sd, "surface-final.json" if final else f"phase-{phase}/surface.json")
    label = "Post-phase commits" if final else f"Phase {phase}"
    try:
        if final:
            if getattr(args, "sha", None):
                print("surface: warning: --sha ignored with --final")
            window, notes = _run_window(root), []
            base = _run_field(root, "Base commit")
            if not base or base == "(unknown)":
                shas, notes = [], ["no base recorded"]
            else:
                anchors, explicit, _, _ = _commit_sources(root, window)
                attributed = anchors | explicit
                phases = {int(row[0]) for row in _phase_rows(sd) if row[0].isdigit()}
                phases.update(int(e["phase"]) for e in window if e.get("event") == "commit"
                              and str(e.get("phase")).isdigit())
                for number in phases:
                    attributed.update(phase_commits(root, number)[0])
                shas = [s for s in _surface_git(root, "rev-list", "--reverse", f"{base}..HEAD").splitlines()
                        if s in attributed]
            claimed = {s for p in glob.glob(os.path.join(sd, "phase-*", "surface.json"))
                       for s in _surface_record(p).get("commits", [])}
            store = {_resolve_commit(root, e.get("sha")) for e in _run_window(root)
                     if e.get("event") == "store_commit"}
            shas = [s for s in shas if s not in claimed | store]
        else:
            shas, notes = phase_commits(root, phase, getattr(args, "sha", None) or ())
        hits, scan_notes = surface_scan(root, scfg, shas)
        notes += scan_notes
    except Exception as error:
        shas, hits, notes = [], [], [f"scan failed: {error}"]
    previous = _surface_record(out)
    extra_commits = set(previous.get("extra_commits", []))
    if not final:
        extra_commits.update(s for token in getattr(args, "sha", None) or ()
                             if (s := _resolve_commit(root, token)))
    old_hits = [h for h in previous.get("hits", []) if isinstance(h, dict)]
    seen = {_surface_key(h) for h in old_hits}
    new = [h for h in hits if _surface_key(h) not in seen]
    merged = old_hits + new
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as stream:
        json.dump(dict(phase="final" if final else phase, ts=datetime.datetime.now().isoformat(),
                       commits=shas, extra_commits=sorted(extra_commits), hits=merged, notes=notes), stream, indent=2)
        stream.write("\n")
    for hit in new:
        print("surface: " + _hit_line(label, hit))
    if not new:
        print(f"surface: {label}: no new hits ({len(merged)} total, {len(shas)} commit(s) scanned)")
    if new:
        _emit(root, "surface_hit", nulls=True, phase=None if final else phase, hits=len(new),
              categories=sorted({h["category"] for h in new}),
              detail="; ".join(_hit_line(label, h) for h in new[:3]))
    return 0


def _surface_section(root, cfg):
    sd = state_dir(root)
    configured = _surface_cfg(cfg) is not None
    paths = sorted(glob.glob(os.path.join(sd, "phase-*", "surface.json")),
                   key=lambda p: int(os.path.basename(os.path.dirname(p)).split("-")[-1]))
    final = os.path.join(sd, "surface-final.json")
    records = [(f"Phase {os.path.basename(os.path.dirname(p))[6:]}", _surface_record(p)) for p in paths]
    if os.path.isfile(final):
        records.append(("Post-phase commits", _surface_record(final)))
    lines, seen, missing = [], set(), set()
    for label, record in records:
        for hit in record.get("hits", []):
            key = (label, _surface_key(hit))
            if key not in seen:
                seen.add(key)
                lines.append(f"- {_hit_line(label, hit)} ({hit.get('sha', '?')})")
        for note in record.get("notes", []):
            lines.append(f"- {label}: {note}")
        if any(str(note).startswith("scan failed") for note in record.get("notes", [])) or \
                not record.get("commits") and record.get("notes"):
            missing.add(label)
    if not configured and not seen:
        return [], 0, 0
    if configured:
        for row in _phase_rows(sd):
            if len(row) > 4 and row[3] == "committed" and not os.path.isfile(
                    os.path.join(sd, f"phase-{row[0]}", "surface.json")):
                missing.add(f"Phase {row[0]}")
        if paths and not os.path.isfile(final):
            missing.add("Post-phase commits")
    lines.extend(f"- {label}: surface not run" for label in sorted(
        missing, key=lambda label: int(label.split()[1]) if label.startswith("Phase ") else float("inf")))
    return (["## Surface hits", "_Found by script from each phase's own commits ([surface] in "
             ".claude/orchestrator.toml); reported, never held._", *(lines or ["Surface hits: none"]), ""],
            len(seen), len(missing))


def tree_hash(root, cfg):
    """Hash working content with an isolated index; git failures leave verify unbound."""
    globs, prefixes = _tree_excludes(root, cfg)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            # --git-path index follows GIT_INDEX_FILE, so locate the real index before overriding it.
            located = subprocess.run(["git", "rev-parse", "--git-path", "index"], cwd=root,
                                     capture_output=True, env=os.environ.copy())
            if located.returncode:
                return None
            real_index = os.path.join(root, os.fsdecode(located.stdout).strip())
            index = os.path.join(tmp, "index")
            env = {**os.environ, "GIT_INDEX_FILE": index}

            def git(*args, input=None):
                rec = subprocess.run(["git", *args], cwd=root, capture_output=True,
                                     env=env, input=input)
                if rec.returncode:
                    raise RuntimeError(rec.stderr.decode(errors="replace"))
                return rec.stdout

            git("rev-parse", "--verify", "-q", "HEAD")
            if os.path.isfile(real_index):
                # Git uses the index mtime to detect racy same-stat edits.
                shutil.copy2(real_index, index)
            else:
                git("read-tree", "HEAD")
            git("add", "-A")
            excluded = [p for p in git("ls-files", "-z").split(b"\0")
                        if p and _tree_excluded(os.fsdecode(p), globs, prefixes)]
            if excluded:
                git("update-index", "-z", "--force-remove", "--stdin", input=b"\0".join(excluded) + b"\0")
            return git("write-tree").decode().strip()
    except Exception:
        return None


def _tree_diff(root, old, new, cap=20):
    try:
        return list(filter(None, _git_scope(root, "diff-tree", "-r", "--name-only", "--no-renames",
                                            "-z", old, new).split("\0")))[:cap]
    except Exception:
        return []


def verify_freshness(root, cfg, phase):
    fresh = dict(state="na", result=None, rec={}, current=None, changed=[])
    if not (cfg["validation"].get("levels") or []):
        return fresh
    try:
        with open(_verify_path(root, phase)) as stream:
            rec = json.load(stream)
        if not isinstance(rec, dict):
            raise ValueError("verify record must be an object")
    except (OSError, ValueError):
        fresh["state"] = "missing"
        return fresh
    current = tree_hash(root, cfg)
    fresh.update(rec=rec, result=rec.get("result"), current=current)
    if current is None:
        fresh["state"] = "unbound"
    elif "tree" not in rec:
        fresh.update(state="stale", note="no tree recorded")
    elif rec["tree"] != current:
        fresh.update(state="stale", changed=_tree_diff(root, rec["tree"], current))
    else:
        fresh["state"] = "current"
    return fresh


def _verify_check(root, cfg, phase):
    fresh = verify_freshness(root, cfg, phase)
    state, result = fresh["state"], fresh["result"]
    if state == "na":
        print("verify-check: n/a (no levels)")
        return 0
    if state in ("missing", "stale"):
        detail = ", ".join(fresh["changed"][:5]) or fresh.get("note", "")
        print(f"verify-check: {state} {result or 'unknown'} {detail}".rstrip())
        return 3
    if result != "pass":
        failed = [r.get("name", "?") for r in fresh["rec"].get("levels", []) if r.get("result") == "fail"]
        print(f"verify-check: {state} {result or 'unknown'} (failed: {', '.join(failed) or 'unknown'})")
        return 2
    if state == "unbound":
        print("verify-check: pass (tree unverifiable: no HEAD or not a git repo)")
    else:
        print("verify-check: current pass")
    return 0


def _failure_pattern(pattern):
    compiled = re.compile(pattern, re.MULTILINE)
    if compiled.groups != 1:
        raise ValueError("expected exactly one capture group")
    return compiled


def _verify_level(root, lv, name, cmd):
    record = {"name": name, "cmd": cmd, "expect": lv.get("expect", "")}
    pattern = lv.get("failure_pattern")
    paths = [os.path.join(state_dir(root), "known-failures", name + ".txt")]
    if lv.get("known_failures"):
        paths.append(os.path.join(root, lv["known_failures"]))
    baseline = next((p for p in paths if os.path.isfile(p)), None)
    if not pattern or not baseline:
        rc = subprocess.run(cmd, shell=True, cwd=root).returncode
        record.update(returncode=rc, result="pass" if rc == 0 else "fail")
        return record
    try:
        compiled = _failure_pattern(pattern)
    except (re.error, ValueError, TypeError) as error:
        record.update(returncode=None, result="fail", baseline=f"invalid failure_pattern: {error}")
        return record
    rec = subprocess.run(cmd, shell=True, cwd=root, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, errors="replace")
    sys.stdout.write(rec.stdout)
    record.update(returncode=rec.returncode, result="pass" if rec.returncode == 0 else "fail")
    if rec.returncode == 0:
        return record
    found = list(dict.fromkeys(m.group(1).strip() for m in compiled.finditer(rec.stdout)))
    known = set()
    with open(baseline, errors="replace") as stream:
        for line in stream.read().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                match = compiled.match(line)
                known.add(match.group(1).strip() if match else line)
    new = [f for f in found if f not in known]
    record.update(result="pass" if found and not new else "fail",
                  baseline=f"{len(found) - len(new)} known, {len(new)} new",
                  known_failures=os.path.relpath(baseline, root))
    if record["result"] == "fail":
        record["new_failures"] = new[:50]
    print(f"  baseline [{name}]: {record['baseline']}")
    return record


def _git_scope(root, *args):
    rec = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if rec.returncode:
        raise RuntimeError(rec.stderr.strip() or "git failed")
    return rec.stdout


def _phase_base(root, phase):
    run = os.path.join(state_dir(root), "RUN.md")
    if os.path.exists(run):
        for line in open(run, errors="replace"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) > 4 and cells[0] == str(phase) and cells[3] == "committed":
                try:
                    sha = _git_scope(root, "rev-parse", "--verify", "-q", cells[4] + "^{commit}").strip()
                    return sha + "^"
                except RuntimeError:
                    break
    try:
        return _git_scope(root, "rev-parse", "HEAD").strip()
    except RuntimeError:
        return None


def _baseline_excluded(root):
    directory = os.path.join(state_dir(root), "baseline-dirty")
    try:
        patch = open(os.path.join(directory, "preexisting.patch"), errors="replace").read()
        untracked = set(open(os.path.join(directory, "untracked.txt"), errors="replace").read().splitlines())
        status = open(os.path.join(directory, "files.txt"), errors="replace").read().splitlines()
    except OSError:
        return {}, set()
    untracked.update(_porcelain_path(line) for line in status if line.startswith("?? "))
    hunks = {}
    for block in re.split(r"(?m)(?=^diff --git )", patch):
        match = re.match(r"diff --git a/(.+?) b/", block)
        if match:
            hunks[match[1]] = block
    return hunks, untracked


def _under_prefix(path, prefix):
    return path.startswith(prefix) if prefix.endswith("/") else path == prefix or path.startswith(prefix + "/")


def phase_touched(root, cfg, phase, base=None):
    base = base or _phase_base(root, phase)
    if not base:
        raise RuntimeError("HEAD is unavailable")
    paths = set(filter(None, _git_scope(root, "diff", "--name-only", "--no-renames", "-z", base).split("\0")))
    paths.update(filter(None, _git_scope(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0")))
    prefixes = cfg.get("scope", {}).get("exclude", []) + cfg.get("park", {}).get("allow_dirty", [])
    generated = [g if isinstance(g, str) else g.get("paths", "") for g in cfg.get("knowledge", {}).get("generated", [])]
    hunks, untracked = _baseline_excluded(root)
    touched = []
    for path in sorted(paths):
        if any(_under_prefix(path, pre) for pre in [*prefixes, *untracked]):
            continue
        if any(fnmatch.fnmatch(path, pattern) for pattern in generated):
            continue
        if path in hunks and _git_scope(root, "diff", "HEAD", "--", path) == hunks[path]:
            continue
        touched.append(path)
    return base, touched


def _level_in_scope(lv, touched, config_touched):
    return "paths" not in lv or config_touched or any(
        _under_prefix(path, prefix) for path in touched for prefix in lv["paths"])


def _set_phase_note(root, n, token):
    path = os.path.join(state_dir(root), "RUN.md")
    if not os.path.isfile(path):
        return False
    with open(path, newline="") as stream:
        lines = stream.readlines()
    for i, line in enumerate(lines):
        if not line.startswith("|"):
            continue
        # Split in place so all bytes outside the note cell survive.
        cells = line.split("|")
        count = len(cells) - (2 if line.rstrip().endswith("|") else 1)
        if count < 6 or cells[1].strip() != str(n):
            continue
        note = re.sub(r"\s*(?:·\s*)?risk: [^·]*(?:·\s*(?:builder effort [^·]*|effort not raised \([^·]*\)))?",
                      "", cells[6]).strip().strip("·").strip()
        value = token if note in ("", "-") else f"{note} · {token}"
        cells[6] = re.match(r"\s*", cells[6])[0] + value + re.search(r"\s*$", cells[6])[0]
        lines[i] = "|".join(cells)
        if lines[i] == line:
            return False
        with open(path + ".tmp", "w", newline="") as stream:
            stream.writelines(lines)
        os.replace(path + ".tmp", path)
        return True
    return False


def risk_token(rec):
    if rec["risk"] != "high":
        return "risk: normal"
    source = " + ".join(rec["source"])
    if rec["surface"]:
        source += ": " + rec["surface"][0]["category"]
    route = rec["route"]
    return f"risk: high ({source})" + (" · builder effort medium" if route["applied"] else
                                      f" · effort not raised ({route['reason']})")


def cmd_risk(args):
    root = repo_root(args.root)
    sd = state_dir(root)
    if not os.path.isdir(sd):
        print("risk: no run state")
        return 3
    if getattr(args, "summary", False):
        phases = sorted(int(m.group(1)) for name in os.listdir(sd)
                        if (m := re.fullmatch(r"phase-(\d+)", name)))
        count = 0
        for phase in phases:
            rec = load_risk(root, phase)
            if not rec or rec.get("risk") != "high":
                continue
            count += 1
            try:
                with open(os.path.join(sd, f"phase-{phase}", "surface.json")) as stream:
                    commits = json.load(stream)["commits"]
                if not isinstance(commits, list):
                    raise ValueError("commits is not a list")
            except (OSError, ValueError, KeyError, TypeError):
                cell = next((row[4] for row in _phase_rows(sd)
                             if len(row) >= 5 and row[0] == str(phase)), "-")
                commits = [] if cell == "-" else [cell]
            print(f"P{phase} high {' + '.join(rec.get('source', [])) or '-'} "
                  f"commits: {', '.join(commits) or '-'}")
        print(f"high-risk phases: {count}")
        return 0
    phase = args.phase
    plan = getattr(args, "plan", None)
    try:
        cfg, _ = load_config(root)
        plan = plan or _phase_plan_path(root, cfg, phase)
        rec = compute_risk(root, cfg, phase, plan)
    except Exception as err:
        try:
            gap = gap_risk(root, phase)
        except Exception:
            gap = None
        sources = ["gap pass"] if isinstance(gap, dict) and gap.get("risk") == "high" else []
        rec = {"phase": phase, "risk": "high" if sources else "normal", "source": sources,
               "gap": gap, "surface": [],
               "plan": os.fspath(plan) if plan else None, "notes": [f"rating failed: {err}"],
               "ts": _utc_now_iso()}
        print(f"risk: rating failed: {err}")
    path = _risk_path(root, phase)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as stream:
        json.dump(rec, stream, indent=2)
    rec["route"] = stage_route(root, "builder", phase).get("risk") or {"applied": None, "reason": "normal"}
    token = risk_token(rec)
    if not _set_phase_note(root, phase, token):
        rec["notes"].append("RUN.md note unchanged or row missing")
    with open(path, "w") as stream:
        json.dump(rec, stream, indent=2)
    print(token)
    for hit in rec["surface"]:
        print(f"  surface: {hit['category']}: {hit['path']}")
    _emit(root, "phase_risk", nulls=True, phase=phase, risk=rec["risk"], source=rec["source"],
          categories=list(dict.fromkeys(h["category"] for h in rec["surface"])),
          applied=rec["route"]["applied"], detail=token)
    return 0


def _phase_plan_path(root, cfg, phase):
    events = [e for e in _events(root, {"plan_done", "plan_skipped"}) if e.get("phase") == phase]
    if not events or events[-1]["event"] == "plan_skipped":
        return None
    detail = events[-1].get("detail", "")
    if os.path.isabs(detail) and os.path.isfile(detail):
        return detail
    store = _store(root)
    candidates = ([os.path.join(store, "plans", os.path.basename(detail))] if store else [])
    candidates.append(os.path.join(root, cfg["plans"]["dir"], os.path.basename(detail)))
    return next((p for p in candidates if os.path.isfile(p)), None)


def plan_touch_set(text):
    if not re.search(r"(?im)^\s{0,3}#{1,6}\s+touch\s+set\s*$", text):
        return None
    return [re.split(r"\s", line.replace("`", ""), maxsplit=1)[0]
            for line in _section_lines(text, r"touch\s+set")]


def plan_blast(text):
    match = re.search(r"(?im)^\s{0,3}#{1,6}\s+blast\s+radius\s*$", text)
    if match:
        for line in text[match.end():].splitlines():
            if line.strip():
                word = line.strip().split()[0].lower()
                return word if word in ("light", "normal", "deep") else "normal"
    return "normal"


def _literal_prefix(glob):
    return re.split(r"[*?\[]", glob, maxsplit=1)[0]


def _touch_hits_globs(entry, globs):
    entry = entry.removeprefix("./")
    if entry.endswith("/"):
        def matches_directory(parts, patterns, prefix):
            # Remaining glob segments can name descendants of this directory.
            if not parts:
                return True
            if not patterns:
                return prefix
            if patterns[0] == "**":
                return (matches_directory(parts, patterns[1:], prefix) or
                        matches_directory(parts[1:], patterns, prefix))
            return (fnmatch.fnmatchcase(parts[0], patterns[0]) and
                    matches_directory(parts[1:], patterns[1:], prefix))

        return any(_literal_prefix(g).startswith(entry) or
                   (g.endswith("/") and entry.startswith(g)) or
                   (not g.endswith("/") and (fnmatch.fnmatchcase(entry.rstrip("/"), g) or
                                              fnmatch.fnmatchcase(entry + "x", g))) or
                   matches_directory(entry.rstrip("/").split("/"), g.split("/")[:-1],
                                     g.endswith("/")) for g in globs)
    return any((g.endswith("/") and entry.startswith(g)) or fnmatch.fnmatchcase(entry, g)
               for g in globs)


def plan_risk_hits(text, scfg):
    touch = plan_touch_set(text)
    if touch is None:
        return None
    hits = []
    for category in (scfg or {}).get("paths", []):
        if category["risk"] is not True:
            continue
        for entry in touch:
            hit = {"category": category["name"], "path": entry}
            if _touch_hits_globs(entry, category["globs"]) and hit not in hits:
                hits.append(hit)
                if len(hits) == 20:
                    return hits
    return hits


def _risk_path(root, phase):
    return os.path.join(state_dir(root), f"phase-{phase}", "risk.json")


def load_risk(root, phase):
    try:
        with open(_risk_path(root, phase)) as stream:
            data = json.load(stream)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def compute_risk(root, cfg, phase, plan):
    gap, hits, notes, sources = gap_risk(root, phase), [], [], []
    if gap and gap.get("risk") == "high":
        sources.append("gap pass")
    if gap is None:
        notes.append("no gap-pass rating")
    scfg = _surface_cfg(cfg)
    if scfg is None:
        notes.append("[surface] absent")
    if not plan:
        notes.append("no plan (gap pass only)")
    else:
        try:
            with open(plan) as stream:
                matches = plan_risk_hits(stream.read(), scfg)
            if matches is None:
                notes.append("no touch set (gap pass only)")
            else:
                hits = matches
        except (OSError, UnicodeError) as err:
            notes.append(f"plan unreadable: {err}")
    if hits:
        sources.append("surface")
    return {"phase": phase, "risk": "high" if sources else "normal", "source": sources,
            "gap": gap, "surface": hits, "plan": os.fspath(plan) if plan else None,
            "notes": notes, "ts": _utc_now_iso()}


def _mirrors_planned(path, planned):
    for item in planned:
        if item.endswith("/"):
            continue
        stem, ext = os.path.splitext(os.path.basename(item))
        if os.path.basename(path) in {stem + ".test" + ext, stem + ".spec" + ext,
                                     "test_" + stem + ".py", stem + "_test.py"}:
            return True
    return False


def _write_scope(root, cfg, args):
    base, touched = phase_touched(root, cfg, args.phase, getattr(args, "base", None))
    plan = getattr(args, "plan", None) or _phase_plan_path(root, cfg, args.phase)
    if plan and not os.path.isabs(plan):
        plan = os.path.join(root, plan)
    text = open(plan, errors="replace").read() if plan else ""
    planned = plan_touch_set(text)
    outside = [p for p in touched if not any(_under_prefix(p, pre) for pre in planned)
               and not _mirrors_planned(p, planned)] if planned is not None else []
    rec = dict(phase=args.phase, base=base, plan=plan, planned=planned, touched=touched,
               out_of_plan=outside, blast=plan_blast(text), ts=_utc_now_iso())
    directory = os.path.join(state_dir(root), f"phase-{args.phase}")
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, "scope.json"), "w") as stream:
        json.dump(rec, stream, indent=2)
    if outside:
        _emit(root, "scope_flag", phase=args.phase,
              detail=f"{len(outside)} out-of-plan: {', '.join(outside[:5])}")
    print("scope: " + (f"{len(outside)} out-of-plan file(s)" if planned is not None else "no touch set"))


def cmd_verify(args):
    """Run the repo's [validation].levels in order and record the result at
    phase-N/verify.json. Stops at the first failing level unless --keep-going.
    Exit 0 = all green, 2 = a level failed (or none are configured)."""
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    if getattr(args, "check", False):
        return _verify_check(root, cfg, args.phase)
    levels = cfg["validation"].get("levels") or []
    if not levels:
        print("no [validation].levels configured -- nothing to verify "
              "(fix .claude/orchestrator.toml)", file=sys.stderr)
        return 2
    os.makedirs(os.path.join(state_dir(root), f"phase-{args.phase}"), exist_ok=True)
    results, overall = [], "pass"
    full = getattr(args, "full", False) or args.phase == 0
    base, touched = getattr(args, "base", None), None
    if not full:
        try:
            base, touched = phase_touched(root, cfg, args.phase, base)
            full = CONFIG_REL.replace(os.sep, "/") in touched
        except Exception as error:
            print(f"verify: touched set unavailable ({error}) -- running every level")
            full = True
    for lv in levels:
        cmd = (lv.get("cmd") or "").strip()
        if not cmd:
            continue
        name = lv.get("name") or shlex.split(cmd)[0]
        if not full and not _level_in_scope(lv, touched, False):
            results.append(dict(name=name, cmd=cmd, expect=lv.get("expect", ""),
                                paths=lv["paths"], result="skipped (out of scope)"))
            print(f"  skip [{name}] (out of scope)")
            continue
        print(f"  verify [{name}] {cmd}")
        result = _verify_level(root, lv, name, cmd)
        results.append(result)
        if result["result"] == "fail":
            overall = "fail"
            if not args.keep_going:
                break
    tree = tree_hash(root, cfg)
    # Re-runs may finish within the same second; ts also identifies a rewritten record.
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    record = {"phase": args.phase, "result": overall, "ts": ts, "levels": results, "tree": tree,
              "full": full, "base": base, "touched": len(touched) if touched is not None else None}
    with open(_verify_path(root, args.phase), "w") as stream:
        json.dump(record, stream, indent=2)
    passed = sum(1 for r in results if r["result"] == "pass")
    skipped = sum(r["result"] == "skipped (out of scope)" for r in results)
    detail = f"{passed}/{len(results) - skipped} levels green"
    if skipped:
        detail += f", {skipped} skipped (out of scope)"
    _emit(root, "verify_pass" if overall == "pass" else "verify_fail", phase=args.phase, detail=detail)
    print(f"verify: {overall} -- {detail} ({os.path.relpath(_verify_path(root, args.phase), root)})")
    return 0 if overall == "pass" else 2


def validate_verify(root, cfg, phase):
    """(ok, reason). Build+test gate: if the repo declares [validation].levels, a
    green phase-N/verify.json must exist. A repo with no levels has nothing to verify,
    so it passes trivially (portability)."""
    if not (cfg["validation"].get("levels") or []):
        return True, "no [validation].levels -- verify N/A"
    path = _verify_path(root, phase)
    if not os.path.exists(path):
        return False, "missing verify.json -- run `orchestrator.py verify --phase N`"
    try:
        rec = json.load(open(path))
    except (OSError, ValueError) as error:
        return False, f"unreadable verify.json ({error})"
    if rec.get("result") != "pass":
        failed = [r.get("name", "?") for r in rec.get("levels", []) if r.get("result") == "fail"]
        return False, f"build/test not green (failed: {', '.join(failed) or 'unknown'})"
    return True, ""


def validate_gate(root, cfg, prd, phase):
    """(ok, reasons). The deterministic phase-commit gate, gathering EVERY failure so
    one run tells the whole story:
      - verify (build+test) is always required (or N/A when no levels are declared);
      - the e2e durability gate is required only when e2e actually ran for this phase
        (phase-N/e2e.md exists) -- an end-only-deferred or N/A phase has no marker and
        is not blocked here;
      - the figma gate self-noops unless a comparison was due (validate_figma handles
        disabled/skip/deferred), so calling it is always safe."""
    reasons = []
    ok, why = validate_verify(root, cfg, phase)
    if not ok:
        reasons.append(f"verify: {why}")
    if os.path.exists(os.path.join(state_dir(root), f"phase-{phase}", "e2e.md")):
        ok, why = validate_promoted_e2e(root, cfg, prd, phase)
        if not ok:
            reasons.append(f"e2e: {why}")
    ok, why = validate_figma(root, cfg, prd, phase)
    if not ok:
        reasons.append(f"figma: {why}")
    return (not reasons), reasons


def cmd_gate(args):
    """Run the phase-commit gate and, on a full pass, write phase-N/.gate-pass so the
    pre-commit hook lets the commit through. The orchestrator runs this immediately
    before committing a phase; a failure means do not commit."""
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    prd = args.prd or _run_field(root, "PRD")
    rerun_started, rerun_error, stderr_tail = False, None, ""
    try:
        fresh = verify_freshness(root, cfg, args.phase)
        if fresh["state"] == "stale":
            rerun_started = True
            changed = fresh["changed"]
            print(f"gate: tree changed since verify -- re-running verify once ({len(changed)} path(s))",
                  file=sys.stderr)
            command = [sys.executable, os.path.abspath(__file__), "--root", root,
                       "verify", "--phase", str(args.phase)]
            if fresh["rec"].get("full"):
                command.append("--full")
            if fresh["rec"].get("base"):
                command.extend(["--base", fresh["rec"]["base"]])
            child = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   text=True, errors="replace")
            stderr_tail = child.stderr.strip()[-2000:]
            if child.returncode not in (0, 2):
                raise RuntimeError(f"verify re-run exited {child.returncode}")
            with open(_verify_path(root, args.phase)) as stream:
                new = json.load(stream)
            if new.get("ts") == fresh["rec"].get("ts"):
                raise RuntimeError("verify re-run did not rewrite verify.json (ts unchanged)")
            ran = [lv["name"] for lv in new.get("levels", []) if lv.get("result") in ("pass", "fail")]
            paths_note = ': ' + ', '.join(changed[:5]) if changed else '; no tree recorded'
            _emit(root, "verify_stale", phase=args.phase,
                  detail=f"tree changed ({len(changed)} path(s){paths_note}); re-ran {len(ran)} level(s): {', '.join(ran)} -> {new.get('result')}",
                  paths=changed[:20], levels=ran, result=new.get("result"))
        elif fresh["state"] == "unbound":
            _emit(root, "verify_unbound", phase=args.phase,
                  detail="tree unverifiable (no HEAD or not a git repo); decided on the recorded result")
    except Exception as error:
        if rerun_started:
            rerun_error = f"verify: re-run failed ({error})"
            if stderr_tail:
                rerun_error += f"; stderr tail: {stderr_tail}"
        else:
            print(f"gate: freshness check failed ({error}) -- deciding on recorded result", file=sys.stderr)
    ok, reasons = validate_gate(root, cfg, prd, args.phase)
    if rerun_error:
        ok = False
        reasons.append(rerun_error)
    try:
        _write_scope(root, cfg, args)
    except Exception as error:
        try:
            directory = os.path.join(state_dir(root), f"phase-{args.phase}")
            os.makedirs(directory, exist_ok=True)
            with open(os.path.join(directory, "scope.json"), "w") as stream:
                json.dump({"phase": args.phase, "error": str(error)}, stream)
        except Exception:
            pass
    gate_pass = _gate_pass_path(root, args.phase)
    if not ok:
        if os.path.exists(gate_pass):
            os.remove(gate_pass)                       # a prior pass is now stale
        print(f"gate: FAIL -- phase {args.phase}", file=sys.stderr)
        for reason in reasons:
            print(f"  - {reason}", file=sys.stderr)
        _emit(root, "gate_fail", phase=args.phase, detail="; ".join(reasons))
        return 2
    token = {"phase": args.phase, "ts": _utc_now_iso(), "result": "pass"}
    try:                                               # bind the pass to the e2e evidence when it ran
        token["evidence"] = e2e_evidence_checksum(
            os.path.join(state_dir(root), f"phase-{args.phase}"))
    except Exception:
        pass                                           # verify-only phase (N/A or end-only e2e)
    os.makedirs(os.path.dirname(gate_pass), exist_ok=True)
    with open(gate_pass, "w") as stream:
        json.dump(token, stream, indent=2)
    _emit(root, "gate_pass", phase=args.phase)
    print(f"gate: pass -- wrote {os.path.relpath(gate_pass, root)} "
          f"(pre-commit hook will now allow the phase {args.phase} commit)")
    return 0


def cmd_resume(args):
    """Where is this run, in one screen? The walk-away guarantee is exercised
    constantly (`resumed` fires 19x in the real logs); re-deriving it from prose
    used to cost a full re-read of SKILL.md plus RUN.md."""
    root = repo_root(args.root)
    sd = state_dir(root)
    parked = os.path.join(os.path.dirname(sd), _PARKED_DIR)
    if os.path.isdir(parked):
        print("parked runs: " + ", ".join(sorted(os.listdir(parked))))
    if not os.path.isdir(sd):
        print("no run in progress (no .agents/orchestrator)"); return 3
    for k in ("PRD", "Base commit", "Autonomy gate", "Started"):
        v = _run_field(root, k)
        if v:
            print(f"{k+':':<15} {v}")
    run = os.path.join(sd, "RUN.md")
    if os.path.isfile(run):
        with open(run, errors="replace") as stream:
            resumed = [line.rstrip() for line in stream if line.startswith("Resumed:")]
        if resumed:
            print(resumed[-1])
    request = os.path.join(sd, PARK_REQUEST)
    if os.path.exists(request):
        with open(request, errors="replace") as stream:
            print(f"!! PARK-REQUESTED: {stream.read().strip()}")
    rows = []
    if os.path.exists(run):
        for line in open(run, errors="replace"):
            if line.startswith("|") and "---" not in line and not line.lower().startswith("| #"):
                rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    done = [r for r in rows if len(r) > 3 and r[3] == "committed"]
    print(f"{'phases:':<15} {len(done)}/{len(rows)} committed")
    for r in rows:
        if len(r) > 3 and r[3] != "committed":
            print(f"                 -> phase {r[0]} '{r[1]}' is {r[3]}"
                  + (f" (depends on {r[2]})" if len(r) > 2 and r[2] not in ("-", "") else ""))
    ev = os.path.join(sd, "events.jsonl")
    last = None
    if os.path.exists(ev):
        for line in open(ev, errors="replace"):
            line = line.strip()
            if line:
                try:
                    last = json.loads(line)
                except json.JSONDecodeError:
                    pass
    if last:
        print(f"{'last event:':<15} {last.get('event')} "
              f"(phase {last.get('phase','?')}, {last.get('ts','')})")
    for marker in sorted(glob.glob(os.path.join(sd, "GATE-FAILED-*"))):
        print(f"  !! {os.path.basename(marker)}: {open(marker).read().strip()}")
    gaps = load_gaps(root)["findings"]
    if gaps:
        n_open = sum(1 for g in gaps if g.get("status") == "open")
        print(f"{'gap pass:':<15} {len(gaps)} finding(s), {n_open} open "
              f"(`gaps show --phase N` before each planner)")
    n_facts = sum(len(v) for v in load_facts(root).values())
    if n_facts:
        print(f"{'facts:':<15} {n_facts} recorded (`facts show` goes into every worker prompt)")
    nxt = _run_field(root, "current")
    print(f"{'next action:':<15} {nxt or 'read RUN.md ## Current'}")
    return 0


# ---- token usage, harvested from Claude Code's own session transcripts --------
# Claude Code writes every session to <config-dir>/projects/<enc-cwd>/<session>.jsonl,
# one line per message, each with `timestamp`, `cwd`, `sessionId`, and
# `message.usage` (input / output / cache tokens). That is the exact, file-based
# source — far more reliable than scraping `/context` or `/stats` out of a pane's
# alternate-screen TUI. We filter by the EXACT `cwd` field (not a guessed path
# encoding) and a time window, so every worker + the orchestrator that ran in this
# root during the window is counted -- across ALL config dirs (_transcript_roots),
# since workers run under a different CLAUDE_CONFIG_DIR than the orchestrator.
# This is Claude Code only by design: other agents (Codex, Cursor, Copilot) either
# keep no comparable local per-message token file or bill server-side, so counting
# them locally is not reliable -- telemetry says so rather than undercounting silently.

_USAGE_KEYS = ("input_tokens", "output_tokens",
               "cache_creation_input_tokens", "cache_read_input_tokens")


def _transcript_roots():
    """Every Claude Code config dir that may hold session transcripts, deduped by
    realpath. Workers routinely run under a different CLAUDE_CONFIG_DIR than the
    orchestrator (e.g. ~/.claude-personal2 / "ccp2"), so reading only ~/.claude
    silently drops most of a run's tokens -- the workers' -- which is the single
    biggest telemetry leak (found 2026-09: ccp2 held 292 transcript files, none
    counted). We scan $CLAUDE_CONFIG_DIR plus every ~/.claude*/projects."""
    candidates = []
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    if env:
        candidates.append(os.path.join(env, "projects"))
    candidates.append(os.path.expanduser("~/.claude/projects"))
    candidates += sorted(glob.glob(os.path.expanduser("~/.claude*/projects")))
    roots, seen = [], set()
    for candidate in candidates:
        if not os.path.isdir(candidate):
            continue
        rp = os.path.realpath(candidate)
        if rp in seen:
            continue
        seen.add(rp)
        roots.append(candidate)
    return roots


def _parse_iso_utc(ts):
    """Parse an ISO-8601 timestamp (events.jsonl's own, or a transcript's) into an
    aware UTC datetime, so callers compare instants rather than raw strings — a raw
    string compare breaks the moment either side's precision or offset format
    differs (seconds vs milliseconds, 'Z' vs '+00:00'), and silently returns 0
    matches rather than an error. A naive timestamp (no offset) is assumed UTC,
    matching this script's own _utc_now_iso() convention. Returns None on failure."""
    if not ts:
        return None
    try:
        dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def transcript_usage(root, since=None, until=None, stages=None):
    """Sum token usage from every transcript line whose cwd == root and whose
    timestamp falls in [since, until]. Returns (totals, meta).

    since/until come from events.jsonl (`_utc_now_iso()` — UTC, 'Z'-suffixed) and
    transcript `timestamp` fields are also UTC 'Z'-suffixed, so they compare
    correctly. Parsed via `_parse_iso_utc` rather than a raw string compare: a mismatched
    format/timezone on either side used to compare as if both were UTC lexical
    strings, which silently dropped real sessions and picked up unrelated ones
    whose timestamps happened to sort into the (wrongly-shifted) window instead —
    found 2026-09-10, undercounted 9 real worker sessions down to 5.
    """
    root = os.path.abspath(root)
    totals = {k: 0 for k in _USAGE_KEYS}
    sessions, per_model, n = set(), {}, 0
    sub = {"totals": {k: 0 for k in _USAGE_KEYS}, "per_model": {}, "agents": 0,
           "messages": 0, "by_session": {}, "by_stage": {}}
    roots = _transcript_roots()
    if not roots:
        return totals, {"sessions": 0, "messages": 0, "per_model": {}, "roots": 0,
                        "subagent": sub, "note": "no ~/.claude*/projects — no transcripts to read"}
    since_dt = _parse_iso_utc(since) if since else None
    until_dt = _parse_iso_utc(until) if until else None

    def _usage_lines(tf, root, since_dt, until_dt):
        # Skip inactive files before reading either main or subagent transcripts.
        if since_dt is not None:
            try:
                if os.path.getmtime(tf) < since_dt.timestamp():
                    return
            except OSError:
                return  # vanished/unreadable transcript: nothing to count
        try:
            stream = open(tf, errors="replace")
        except OSError:
            return
        with stream:
            for line in stream:
                line = line.strip()
                if not line or '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if os.path.abspath(d.get("cwd", "")) != root:
                    continue
                ts_dt = _parse_iso_utc(d.get("timestamp", ""))
                if ts_dt is None or (since_dt and ts_dt < since_dt) or (until_dt and ts_dt > until_dt):
                    continue
                u = (d.get("message") or {}).get("usage")
                if isinstance(u, dict):
                    yield d, u

    for base in roots:
        for tf in glob.glob(os.path.join(base, "*", "*.jsonl")):
            for d, u in _usage_lines(tf, root, since_dt, until_dt):
                for k in _USAGE_KEYS:
                    totals[k] += int(u.get(k) or 0)
                n += 1
                if d.get("sessionId"):
                    sessions.add(d["sessionId"])
                m = (d.get("message") or {}).get("model")
                if m:
                    pm = per_model.setdefault(m, {k: 0 for k in _USAGE_KEYS})
                    for k in _USAGE_KEYS:
                        pm[k] += int(u.get(k) or 0)
        for tf in glob.glob(os.path.join(base, "*", "*", "subagents", "*.jsonl")):
            counted_sessions, counted_stages = set(), set()
            counted = False
            for d, u in _usage_lines(tf, root, since_dt, until_dt):
                sid = d.get("sessionId") or os.path.basename(os.path.dirname(os.path.dirname(tf)))
                stage = (stages or {}).get(sid, "unattributed")
                rows = [sub]
                for key, name in (("by_session", sid), ("by_stage", stage)):
                    rows.append(sub[key].setdefault(name, {
                        "totals": {k: 0 for k in _USAGE_KEYS}, "per_model": {}, "agents": 0}))
                for row, seen in ((sub, counted), (rows[1], sid in counted_sessions),
                                  (rows[2], stage in counted_stages)):
                    if not seen:
                        row["agents"] += 1
                counted = True
                counted_sessions.add(sid)
                counted_stages.add(stage)
                sub["messages"] += 1
                m = (d.get("message") or {}).get("model")
                for row in rows:
                    for k in _USAGE_KEYS:
                        row["totals"][k] += int(u.get(k) or 0)
                    if m:
                        pm = row["per_model"].setdefault(m, {k: 0 for k in _USAGE_KEYS})
                        for k in _USAGE_KEYS:
                            pm[k] += int(u.get(k) or 0)
    return totals, {"sessions": len(sessions), "messages": n, "per_model": per_model,
                    "roots": len(roots), "subagent": sub}


def _fmt_tokens(t):
    tot = t["input_tokens"] + t["output_tokens"] + \
        t["cache_creation_input_tokens"] + t["cache_read_input_tokens"]
    return (f"{tot:,} tok  (in {t['input_tokens']:,} · out {t['output_tokens']:,} · "
            f"cache-w {t['cache_creation_input_tokens']:,} · "
            f"cache-r {t['cache_read_input_tokens']:,})")


# ---- cost: a rate table (overridable), applied to the per-model token breakdown --
# First-party Anthropic per-MTok rates, VERIFIED 2026-09-08 against
# platform.claude.com/docs/en/about-claude/pricing (5-minute cache-write column;
# cache-read = 0.10x input, 0.025x on Fable/Mythos 5.1). RATES DRIFT and models
# change — re-check that page, and override or extend in .claude/orchestrator.toml
# [pricing]:
#   [pricing]
#   as_of = "2026-06"
#   "claude-sonnet-5" = { input = 2.0, output = 10.0, cache_write = 2.5, cache_read = 0.2 }
# Keys are matched as a PREFIX of the transcript's model id (longest match wins), so
# "claude-sonnet-5" also covers any dated suffix.
DEFAULT_RATES_AS_OF = "2026-09-08"
DEFAULT_RATES = {   # per 1,000,000 tokens, USD
    "claude-opus-5":     {"input": 5.0,  "output": 25.0, "cache_write": 6.25, "cache_read": 0.50},
    "claude-opus-4-8":   {"input": 5.0,  "output": 25.0, "cache_write": 6.25, "cache_read": 0.50},
    "claude-opus-4-7":   {"input": 5.0,  "output": 25.0, "cache_write": 6.25, "cache_read": 0.50},
    "claude-opus-4-6":   {"input": 5.0,  "output": 25.0, "cache_write": 6.25, "cache_read": 0.50},
    "claude-sonnet-5":   {"input": 2.0,  "output": 10.0, "cache_write": 2.5,  "cache_read": 0.20},
    "claude-sonnet-4-6": {"input": 3.0,  "output": 15.0, "cache_write": 3.75, "cache_read": 0.30},
    "claude-haiku-4-5":  {"input": 1.0,  "output": 5.0,  "cache_write": 1.25, "cache_read": 0.10},
    "claude-fable-5-1":  {"input": 10.0, "output": 50.0, "cache_write": 12.5, "cache_read": 0.25},
    "claude-fable-5":    {"input": 10.0, "output": 50.0, "cache_write": 12.5, "cache_read": 1.00},
}


def _rate_for(model, table):
    """Longest-prefix match of a model id against the rate table. None if unpriced."""
    best = None
    for key in table:
        if model.startswith(key) and (best is None or len(key) > len(best)):
            best = key
    return table.get(best) if best else None


def cost_of(per_model, cfg):
    """USD estimate from a per-model token breakdown. Returns (total, as_of, unpriced)."""
    table = dict(DEFAULT_RATES)
    as_of = DEFAULT_RATES_AS_OF
    pricing = (cfg or {}).get("pricing") or {}
    for k, v in pricing.items():
        if k == "as_of":
            as_of = v
        elif isinstance(v, dict):
            table[k] = v            # override or add
    total, unpriced = 0.0, []
    for model, u in per_model.items():
        r = _rate_for(model, table)
        if not r:
            unpriced.append(model); continue
        total += (u.get("input_tokens", 0) * r.get("input", 0)
                  + u.get("output_tokens", 0) * r.get("output", 0)
                  + u.get("cache_creation_input_tokens", 0) * r.get("cache_write", 0)
                  + u.get("cache_read_input_tokens", 0) * r.get("cache_read", 0)) / 1_000_000
    return total, as_of, unpriced


def _run_start_ts(root):
    """The latest run_start timestamp -- the fixed point for this run's cost."""
    p = os.path.join(state_dir(root), "events.jsonl")
    if not os.path.exists(p):
        return None
    latest = None
    with open(p, errors="replace") as stream:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "run_start" and event.get("ts"):
                latest = event["ts"]
    return latest


def _last_checkpoint_ts(root):
    """Where a usage window should start: the most recent `usage` event, else the run
    start. Chains auto-usage windows so successive phases don't re-count each other."""
    p = os.path.join(state_dir(root), "events.jsonl")
    last = None
    if os.path.exists(p):
        for line in open(p, errors="replace"):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "usage" and event.get("ts"):
                last = event["ts"]
    return last or _run_start_ts(root)


def _run_start_events(root):
    """Every run_start event in file order. One events.jsonl can hold several runs:
    `init` never truncates it."""
    p = os.path.join(state_dir(root), "events.jsonl")
    out = []
    if not os.path.exists(p):
        return out
    with open(p, errors="replace") as stream:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict) and event.get("event") == "run_start":
                out.append(event)
    return out


def _new_run_id(root):
    """run_id for a new run_start: RUN.md's `Run id:` (written by init) unless it is
    missing, malformed, or already stamped on an earlier run_start; then a fresh one."""
    rid = (_run_field(root, "Run id") or "").lower()
    used = {e.get("run_id") for e in _run_start_events(root)}
    if RUN_ID_RE.match(rid) and rid not in used:
        return rid
    return os.urandom(6).hex()


def _current_run_id(root):
    """run_id of the latest run_start. A run started before run_ids existed gets
    sha1(realpath(root) + run_start ts)[:12], the same id the Workbench harvester
    derives for it (PRD-1 §8 *Run identity*)."""
    starts = _run_start_events(root)
    if starts:
        last = starts[-1]
        if RUN_ID_RE.match(str(last.get("run_id") or "")):
            return last["run_id"]
        if last.get("ts"):
            return hashlib.sha1((os.path.realpath(root) + last["ts"]).encode()).hexdigest()[:12]
    rid = (_run_field(root, "Run id") or "").lower()
    return rid if RUN_ID_RE.match(rid) else None


def _budget_sentinel_path(root):
    return os.path.join(state_dir(root), "BUDGET-EXCEEDED")


def check_budget(root, cfg, phase=None):
    """Compare the run's running cost to [budget].max_cost_usd. On overage, write the
    BUDGET-EXCEEDED sentinel (preflight refuses to start the next phase while it exists)
    and emit `budget_exceeded`. Returns (over, cost, max_cost); (False, 0.0, None) when
    no budget is configured. Best-effort -- a harvest error never raises."""
    max_cost = (cfg.get("budget") or {}).get("max_cost_usd")
    if not max_cost:
        return False, 0.0, None
    try:
        _, run_meta = transcript_usage(root, since=_run_start_ts(root), until=None)
        cost, _as_of, _unpriced = cost_of(run_meta["per_model"], cfg.get("pricing"))
    except Exception:
        return False, 0.0, max_cost
    if cost > max_cost:
        try:
            with open(_budget_sentinel_path(root), "w") as stream:
                stream.write(f"~${cost:,.2f} > ${max_cost:,.2f} budget "
                             f"(as of {_utc_now_iso()}, at phase {phase})\n")
        except OSError:
            pass
        _emit(root, "budget_exceeded", phase=phase, detail=f"~${cost:,.2f} > ${max_cost:,.2f}")
        return True, cost, max_cost
    return False, cost, max_cost


def _auto_usage(root, phase):
    """Emit a `usage` event for the window since the last checkpoint and run the budget
    check. Called by the post-commit hook so per-phase token capture is deterministic --
    the agent no longer has to remember `orchestrator.py usage`. Best-effort; the caller
    swallows any error so telemetry can never break a commit."""
    since = _last_checkpoint_ts(root)
    totals, meta = transcript_usage(root, since=since, until=None)
    tot = sum(totals[k] for k in _USAGE_KEYS)
    _emit(root, "usage", phase=phase, stage="phase",
          detail=f"{tot} tokens, {meta['sessions']} session(s) [auto/post-commit]",
          **{k: totals[k] for k in _USAGE_KEYS}, total_tokens=tot, sessions=meta["sessions"])
    cfg, _ = load_config(root)
    check_budget(root, cfg, phase)


def validate_e2e_before_usage(root, cfg, prd, phase):
    if phase is None:
        return True, ""
    marker = os.path.join(state_dir(root), f"phase-{phase}", "e2e.md")
    if not os.path.exists(marker):
        events = os.path.join(state_dir(root), "events.jsonl")
        explicit_na = False
        in_current_run = False
        if os.path.exists(events):
            with open(events, errors="replace") as stream:
                for line in stream:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("event") == "run_start":
                        in_current_run = True
                        explicit_na = False
                    elif (event.get("event") == "e2e_na"
                            and in_current_run
                            and str(event.get("phase")) == str(phase)
                            and str(event.get("detail") or "").strip()):
                        explicit_na = True
        if explicit_na:
            return True, ""
        return False, "missing E2E decision: require evidence or an e2e_na event with a reason"
    require_commit = _run_field(root, "Autonomy gate") == "autonomous"
    return validate_promoted_e2e(root, cfg, prd, phase, committed=require_commit)


def cmd_usage(args):
    """Harvest token usage for a window from the session transcripts, EMIT a
    `usage` event into events.jsonl, and print it. The orchestrator calls this
    right after a worker settles (it knows the stage's start time).

    Also checks the RUNNING total against `[budget].max_cost_usd` (if the repo
    sets one) -- this is the actual dollar enforcement Chris asked for
    (2026-09-10): the check runs at the one point spend can still be stopped
    (right after a phase, before the next one starts), not just reported at
    close-out after all the money is already spent."""
    root = repo_root(args.root)
    totals, meta = transcript_usage(root, since=args.since, until=args.until)
    tot = sum(totals[k] for k in _USAGE_KEYS)
    _emit(root, "usage", phase=args.phase, stage=args.stage,
          detail=f"{tot} tokens, {meta['sessions']} session(s)",
          **{k: totals[k] for k in _USAGE_KEYS},
          total_tokens=tot, sessions=meta["sessions"])
    print(f"usage {('phase '+str(args.phase)) if args.phase is not None else ''}"
          f"{(' '+args.stage) if args.stage else ''}: {_fmt_tokens(totals)}"
          f"  [{meta['messages']} msgs, {meta['sessions']} session(s)]")
    if meta.get("note"):
        print(f"  note: {meta['note']}")

    cfg, _ = load_config(root)
    prd = _run_field(root, "PRD")
    durable, reason = validate_e2e_before_usage(root, cfg, prd, args.phase)
    if not durable:
        print(f"  E2E DURABILITY PENDING: {reason}", file=sys.stderr)
        print("  Promote and validate the phase before usage can become the terminal budget check.",
              file=sys.stderr)
        return 3
    over, cost_so_far, max_cost = check_budget(root, cfg, args.phase)
    if max_cost:
        print(f"  running total: ~${cost_so_far:,.2f} of ${max_cost:,.2f} budget")
        if over:
            print(f"\n  BUDGET EXCEEDED: ~${cost_so_far:,.2f} > ${max_cost:,.2f} "
                  f"([budget].max_cost_usd in {CONFIG_REL})")
            print(f"  Wrote {os.path.relpath(_budget_sentinel_path(root), root)} — "
                  f"preflight will refuse to start the next phase until you clear it. Halt "
                  f"and surface it to Chris rather than continuing to spend.")
            return 2
    return 0


# ---- e2e engine cost: what a Claude e2e worker costs vs what a Nimble run spent ------
# The baseline is every past Claude e2e worker session in the transcripts; the Nimble side is the
# pilot's pooled ledger (library/<app>/usage.jsonl), one line per run. The pilot's paid calls run
# with --no-session-persistence, so they never show up in the transcript scan — no double count.
E2E_WORKER_MARKERS = {   # a worker session is identified by the contract its first prompt starts with
    "prd-e2e-phase": "You are validating **one** phase",
    "plan-item": "You are executing **one** item of an RBCloud e2e test plan",
}
E2E_COST_CACHE = "e2e-cost-cache.json"   # in the library dir (gitignored): mtime-keyed scan results
_E2E_HEAD_BYTES = 200_000
_PHASE_IN_PROMPT = re.compile(r"\bphase\s+(\d+)\b", re.IGNORECASE)


def pilot_library_dir(app=None):
    root = os.environ.get("PILOT_LIBRARY_ROOT") or os.path.join(os.path.dirname(PILOT_DIR), "library")
    return os.path.join(root, app or PILOT_APP)


def _first_user_text(lines):
    for d in lines:
        if d.get("type") != "user":
            continue
        c = (d.get("message") or {}).get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            for part in c:
                if isinstance(part, dict) and part.get("type") == "text":
                    return part.get("text", "")
    return ""


def _scan_e2e_transcript(path):
    """One transcript → its e2e-worker row, or None if it is not one. Usage is deduped per
    (message.id, requestId): a streamed message repeats its usage on every content block."""
    try:
        with open(path, errors="replace") as fh:
            head = fh.read(_E2E_HEAD_BYTES)
    except OSError:
        return None
    if not any(m in head for m in E2E_WORKER_MARKERS.values()):
        return None
    lines = []
    with open(path, errors="replace") as fh:
        for line in fh:
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    prompt = _first_user_text(lines)
    kind = next((k for k, m in E2E_WORKER_MARKERS.items()
                 if prompt.lstrip().startswith(m) or m in prompt[:400]), None)
    if not kind:
        return None
    per_model, seen, stamps = {}, set(), []
    for d in lines:
        if d.get("timestamp"):
            stamps.append(d["timestamp"])
        msg = d.get("message") or {}
        u = msg.get("usage")
        if not isinstance(u, dict):
            continue
        key = (msg.get("id"), d.get("requestId"))
        if key in seen:
            continue
        seen.add(key)
        pm = per_model.setdefault(msg.get("model", "?"), {k: 0 for k in _USAGE_KEYS})
        for k in _USAGE_KEYS:
            pm[k] += int(u.get(k) or 0)
    times = [t for t in (_parse_iso_utc(s) for s in stamps) if t]
    if not seen or not times:
        return None
    start, end = min(times), max(times)
    phase = _PHASE_IN_PROMPT.search(prompt[:600])
    return {"kind": kind, "start": start.isoformat(), "date": start.date().isoformat(),
            "mins": round((end - start).total_seconds() / 60, 1), "turns": len(seen),
            "tokens": sum(sum(pm.values()) for pm in per_model.values()),
            "models": sorted(per_model), "per_model": per_model,
            "phase": int(phase.group(1)) if phase else None,
            "cwd": next((d.get("cwd") for d in lines if d.get("cwd")), ""),
            "session": next((d.get("sessionId") for d in lines if d.get("sessionId")), path),
            "file": path}


def e2e_worker_sessions(cfg=None, cache_path=None):
    """Every Claude e2e worker session in every transcript root, priced with the rate table.
    Each file's scan is cached by (mtime, size), so only new or grown transcripts are re-read.
    Prices are applied at read time, so a [pricing] change re-prices the whole history."""
    cache_path = cache_path or os.path.join(pilot_library_dir(), E2E_COST_CACHE)
    try:
        with open(cache_path) as fh:
            cache = json.load(fh)
        files = cache.get("files", {}) if cache.get("version") == 1 else {}
    except (OSError, ValueError):
        files = {}
    fresh, rows, sessions = {}, [], set()
    for base in _transcript_roots():
        for tf in sorted(glob.glob(os.path.join(base, "*", "*.jsonl"))):
            try:
                st = os.stat(tf)
            except OSError:
                continue
            hit = files.get(tf)
            if hit and hit.get("mtime") == st.st_mtime and hit.get("size") == st.st_size:
                row = hit.get("row")
            else:
                row = _scan_e2e_transcript(tf)
            fresh[tf] = {"mtime": st.st_mtime, "size": st.st_size, "row": row}
            if row and row["session"] not in sessions:
                sessions.add(row["session"])
                rows.append(dict(row, usd=round(cost_of(row["per_model"], cfg)[0], 3)))
    if fresh != files:
        try:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            tmp = cache_path + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"version": 1, "files": fresh}, f)
            os.replace(tmp, cache_path)
        except OSError:
            pass
    return sorted(rows, key=lambda r: r["start"])


def nimble_usage_ledger(app=None):
    """The pilot's pooled usage.jsonl — one record per Nimble run, across worktrees and PRDs."""
    path = os.path.join(pilot_library_dir(app), "usage.jsonl")
    out = []
    if os.path.exists(path):
        with open(path, errors="replace") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    out.append(rec)
    return out


def _spread(values):
    """n / median / mean / p90 (nearest rank) / total of a list of dollar amounts."""
    import math
    import statistics
    if not values:
        return {"n": 0, "median": 0.0, "mean": 0.0, "p90": 0.0, "total": 0.0}
    ordered = sorted(values)
    return {"n": len(values), "median": round(statistics.median(ordered), 3),
            "mean": round(statistics.mean(ordered), 3),
            "p90": round(ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)], 3),
            "total": round(sum(ordered), 3)}


def e2e_baseline(rows, before=None, kind="prd-e2e-phase"):
    """The counterfactual: the median past Claude e2e-phase worker. `before` (a run start) keeps a
    run's own fallback workers out of its baseline; if nothing predates it, every row is used."""
    pool = [r for r in rows if r["kind"] == kind]
    cut = _parse_iso_utc(before) if before else None
    if cut:
        past = [r for r in pool if (_parse_iso_utc(r["start"]) or cut) < cut]
        pool = past or pool
    s = _spread([r["usd"] for r in pool])
    s["from"] = pool[0]["date"] if pool else None
    s["to"] = pool[-1]["date"] if pool else None
    return s


def _nimble_summary(records):
    runs = [r for r in records if r.get("result") in ("pass", "fail", "blocked")]
    return {"runs": len(runs),
            "results": {k: sum(1 for r in runs if r.get("result") == k) for k in ("pass", "fail", "blocked")},
            "per_run": _spread([float(r.get("total_cost_usd") or 0) for r in runs]),
            "total_usd": round(sum(float(r.get("total_cost_usd") or 0) for r in records), 3),
            "compile_only": len(records) - len(runs),
            "local_decisions": sum(int((r.get("local") or {}).get("decisions") or 0) for r in runs)}


def cmd_e2e_cost(args):
    """What Claude e2e workers have cost, from every transcript, beside what Nimble runs spent."""
    root = repo_root(args.root)
    cfg, _ = load_config(root)
    rows = e2e_worker_sessions(cfg)
    ledger = nimble_usage_ledger()
    if args.since:
        rows = [r for r in rows if r["date"] >= args.since]
        ledger = [r for r in ledger if str(r.get("ts", ""))[:10] >= args.since]
    by_kind = {k: dict(_spread([r["usd"] for r in rows if r["kind"] == k]),
                       median_tokens=int(_median([r["tokens"] for r in rows if r["kind"] == k])),
                       median_mins=_median([r["mins"] for r in rows if r["kind"] == k]))
               for k in E2E_WORKER_MARKERS}
    nim = _nimble_summary(ledger)
    _, as_of, _ = cost_of({}, cfg)
    if args.json:
        print(json.dumps({"claude": [{k: v for k, v in r.items() if k != "per_model"} for r in rows],
                          "claude_summary": by_kind, "nimble": nim, "rates_as_of": as_of}, indent=1))
        return 0
    print("| date | kind | minutes | turns | tokens | model | $ |")
    print("|---|---|---|---|---|---|---|")
    for r in rows:
        models = ",".join(m.replace("claude-", "") for m in r["models"])
        print(f"| {r['date']} | {r['kind']} | {r['mins']} | {r['turns']} | {r['tokens']:,} | "
              f"{models} | {r['usd']:.2f} |")
    print(f"\nClaude e2e workers — {len(rows)} session(s), priced at rates as of {as_of}:")
    for k, s in by_kind.items():
        if s["n"]:
            print(f"  {k}: n={s['n']}  median ${s['median']:.2f}  mean ${s['mean']:.2f}  "
                  f"p90 ${s['p90']:.2f}  total ${s['total']:.2f}  | median {s['median_tokens']:,} tokens, "
                  f"{s['median_mins']} min")
    r = nim["results"]
    print(f"Nimble runs — {nim['runs']} run(s): {r['pass']} pass / {r['fail']} fail / {r['blocked']} blocked"
          + (f"  median ${nim['per_run']['median']:.2f} paid per run" if nim["runs"] else "")
          + f"  total ${nim['total_usd']:.2f}"
          + (f" (incl. {nim['compile_only']} compile-only)" if nim["compile_only"] else ""))
    if not nim["runs"]:
        print("  (no usage.jsonl lines yet — every pilot run from now on adds one)")
    return 0


def _median(values):
    import statistics
    return round(statistics.median(values), 1) if values else 0


def _phase_nimble_records(root, phase_dir, since):
    """Every Nimble run this phase had in this run: the bundle's nimble-usage.json, a fallen-back
    attempt's under nimble-attempt/, and any earlier re-e2e run only the pooled ledger kept."""
    recs = []
    for rel in ("nimble-usage.json", os.path.join("nimble-attempt", "nimble-usage.json")):
        try:
            with open(os.path.join(phase_dir, rel)) as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(rec, dict):
            recs.append(rec)
    since_dt = _parse_iso_utc(since) if since else None
    keys = {(r.get("ts"), r.get("result")) for r in recs}
    for rec in nimble_usage_ledger():
        if os.path.abspath(str(rec.get("dir") or "")) != os.path.abspath(phase_dir):
            continue
        ts = _parse_iso_utc(str(rec.get("ts") or ""))
        if since_dt and (ts is None or ts < since_dt):
            continue
        if (rec.get("ts"), rec.get("result")) not in keys:
            keys.add((rec.get("ts"), rec.get("result")))
            recs.append(rec)
    return recs


def e2e_cost_section(root, cfg, run_start, rows=None):
    """telemetry.md's `E2E engine cost` lines: per phase, Nimble's actual spend, any Claude
    fallback's, and the estimated all-Claude cost — the median past Claude e2e-phase worker."""
    rows = e2e_worker_sessions(cfg) if rows is None else rows
    base = e2e_baseline(rows, before=run_start)
    since_dt = _parse_iso_utc(run_start) if run_start else None
    sd = state_dir(root)
    phase_dirs = sorted((int(m.group(1)), os.path.join(sd, name)) for name in os.listdir(sd)
                        if (m := re.fullmatch(r"phase-(\d+)", name)) and os.path.isdir(os.path.join(sd, name)))
    L, saved, notes, any_phase = [], 0.0, [], False
    table = ["| phase | engine | Nimble $ | fallback worker $ | est. all-Claude $ | saved $ |",
             "|---|---|---|---|---|---|"]
    for n, pdir in phase_dirs:
        nim = _phase_nimble_records(root, pdir, run_start)
        fallback = [r for r in rows if r["kind"] == "prd-e2e-phase" and r.get("phase") == n
                    and os.path.abspath(r.get("cwd") or "") == os.path.abspath(root)
                    and (since_dt is None or (_parse_iso_utc(r["start"]) or since_dt) >= since_dt)]
        if not nim and not fallback:
            continue
        any_phase = True
        n_usd = sum(float(r.get("total_cost_usd") or 0) for r in nim)
        f_usd = sum(r["usd"] for r in fallback)
        # A bundle from before the pilot metered itself still shows Nimble ran: its attempt dir or script.
        unmetered = not nim and (os.path.isdir(os.path.join(pdir, "nimble-attempt"))
                                 or os.path.exists(os.path.join(pdir, "nimble-script.json")))
        if fallback:
            engine = ("Nimble → fallback" if nim else "Nimble (unmetered) → fallback" if unmetered
                      else "fallback worker only")
            phase_saved = 0.0
            if nim:
                notes.append(f"- Phase {n}: Nimble blocked and fell back to a Claude worker (${f_usd:.2f}) — "
                             f"no savings for this phase, and the Nimble attempt's ${n_usd:.2f} was wasted.")
            elif unmetered:
                notes.append(f"- Phase {n}: Nimble blocked and fell back to a Claude worker (${f_usd:.2f}) — "
                             f"no savings for this phase; the attempt predates usage metering, so its "
                             f"spend is unknown.")
        else:
            engine = "Nimble (" + "/".join(sorted({str(r.get("result")) for r in nim})) + ")"
            phase_saved = base["median"] - n_usd
            saved += phase_saved
        table.append(f"| {n} | {engine} | {n_usd:.2f} | {f_usd:.2f} | {base['median']:.2f} | "
                     f"{phase_saved:.2f} |")
    if not any_phase:
        return ["## E2E engine cost", "", "_No e2e spend recorded for any phase of this run._", ""]
    span = f"{base['from']}..{base['to']}" if base["n"] else "no history"
    L += ["## E2E engine cost", "",
          f"**Nimble saved ≈ ${saved:,.2f} vs an all-Claude e2e** (baseline: median of {base['n']} past "
          f"Claude e2e workers, ${base['median']:.2f} each, {span}). _An estimate: the counterfactual is a "
          f"typical past worker, not this phase run by one._", ""] + table
    if notes:
        L += [""] + notes
    if not base["n"]:
        L.append("- ⚠ no past Claude e2e-phase workers in the transcripts — the baseline is $0")
    return L + [""]


def cmd_telemetry(args):
    """Close-out rollup: was this faster/cheaper than doing it by hand?

    Wall time (overall + per phase) from the event timestamps; token totals from
    the transcripts; activity counts from events + decisions. Writes telemetry.md
    (gitignored) and prints. Human baseline, if recorded in RUN.md, is shown beside
    the machine's wall time so the comparison is right there."""
    import datetime as _dt
    root = repo_root(args.root)
    archived = bool(getattr(args, "state_dir", None))
    sd = getattr(args, "state_dir", None) or state_dir(root)
    if not os.path.isabs(sd):
        sd = os.path.join(root, sd)
    ev_path = os.path.join(sd, "events.jsonl")
    if not os.path.exists(ev_path):
        print("no events.jsonl — nothing to summarise"); return 3
    evs = []
    for line in open(ev_path, errors="replace"):
        line = line.strip()
        if line:
            try:
                evs.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    if not evs:
        print("events.jsonl is empty"); return 3

    def ts(e):
        return e.get("ts") or e.get("timestamp") or ""
    def parse(t):
        try:
            d = _dt.datetime.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            return None
        # Worker-hook events (build_done/e2e_done/gate_block/stage_done) are logged in
        # naive *system-local* time, while _emit writes UTC-aware. Normalise naive ->
        # UTC (astimezone on a naive datetime presumes system-local) so the two never
        # collide in subtraction. Root fix belongs in the hook logger.
        if d.tzinfo is None:
            d = d.astimezone(_dt.timezone.utc)
        return d

    _min = _dt.datetime.min.replace(tzinfo=_dt.timezone.utc)
    starts = [i for i, e in enumerate(evs) if e.get("event") == "run_start"]
    if starts:
        evs = evs[starts[-1]:]     # one events.jsonl can hold several runs; report the latest
    evs.sort(key=lambda e: parse(ts(e)) or _min)

    stages = {e["session_id"]: e.get("stage") or "unattributed" for e in evs
              if e.get("event") == "worker_session" and e.get("session_id")}

    def zs(t):
        d = parse(t)
        return d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else t

    run_start, run_end = zs(ts(evs[0])), zs(ts(evs[-1]))

    def hms(a, b):
        pa, pb = parse(a), parse(b)
        if not pa or not pb:
            return "?"
        s = int((pb - pa).total_seconds())
        h, r = divmod(s, 3600); m, s = divmod(r, 60)
        return (f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s")

    # per-phase wall windows: first event of a phase -> its first `commit` event.
    # Excludes `usage` events deliberately — they are audit/accounting records that can
    # be emitted long after (even a backfill, well after run end), and including them
    # in this scan previously stretched every phase's reported window out to whichever
    # usage event landed last, regardless of when the phase actually finished.
    phases = {}
    for e in evs:
        ph = e.get("phase")
        if ph is None or e.get("event") == "usage":
            continue
        phases.setdefault(ph, {"start": ts(e), "end": ts(e), "committed": False})
        if e.get("event") == "commit":
            if not phases[ph]["committed"]:
                phases[ph]["end"] = ts(e)
                phases[ph]["committed"] = True
        elif not phases[ph]["committed"]:
            phases[ph]["end"] = ts(e)

    counts = {}
    for e in evs:
        counts[e.get("event", "?")] = counts.get(e.get("event", "?"), 0) + 1
    decisions = load_decisions(root, sd=sd)
    n_dev = len(decisions)
    n_oneway = sum(1 for d in decisions if d.get("one_way"))

    totals, meta = transcript_usage(root, since=run_start, until=run_end, stages=stages)
    tot_tok = sum(totals[k] for k in _USAGE_KEYS)
    cfg_pricing, _ = load_config(root)
    if archived:
        baseline = missing_e2e = "n/a (archived run)"
        e2e_lines = ["## E2E engine cost", "", "n/a (archived run)", ""]
    else:
        baseline = _run_field(root, "Human estimate")
        missing_e2e = ', '.join(_phases_missing_e2e(root)) or 'none'
        try:
            e2e_lines = e2e_cost_section(root, cfg_pricing, run_start)
        except Exception as e:   # telemetry must never fail on the cost estimate
            e2e_lines = ["## E2E engine cost", "", f"_not computed: {type(e).__name__}: {e}_", ""]

    L = ["# Run telemetry — was it worth it?", "",
         f"_Run window {run_start} → {run_end}_", "",
         "## Time",
         f"- **Wall clock:** {hms(run_start, run_end)}"
         + (f"   |   **your estimate by hand:** {baseline}" if baseline else ""),
         "", "| phase | wall | committed |", "|---|---|---|"]
    for ph in sorted(phases):
        p = phases[ph]
        L.append(f"| {ph} | {hms(p['start'], p['end'])} | {'yes' if p['committed'] else 'no'} |")
    L += ["", "## Tokens",
          f"- **Total:** {_fmt_tokens(totals)}",
          f"- across **{meta['sessions']} worker session(s)**, {meta['messages']} messages"]
    per_model = meta.get("per_model") or {}
    if per_model:
        L.append("- tokens by model: "
                 + ", ".join(f"{m.split('/')[-1]} "
                             f"{sum(v.values()):,}" for m, v in per_model.items()))
    cost, as_of, unpriced = cost_of(per_model, cfg_pricing)
    L.append(f"- **estimated cost: ~${cost:,.2f}**  _(rates as of {as_of}; "
             f"cost = tokens × per-model rate — override in [pricing] if they've moved)_")
    if unpriced:
        L.append(f"  - ⚠ no rate for: {', '.join(sorted(set(unpriced)))} — add them under [pricing]")
    if meta.get("note"):
        L.append(f"- note: {meta['note']}")
    sub_stdout = "  subagent: none found"
    L += ["", "## Subagents", "", "_Counted separately: the Total above excludes them._"]
    try:
        sub = meta["subagent"]
        if sub["messages"]:
            L += ["", "| stage | subagents | tokens | est. cost |", "|---|---|---|---|"]
            parts = []
            for stage in sorted(sub["by_stage"], key=lambda k: (k == "unattributed", k)):
                row = sub["by_stage"][stage]
                tokens = sum(row["totals"].values())
                sub_cost, _, _ = cost_of(row["per_model"], cfg_pricing)
                L.append(f"| {stage} | {row['agents']} | {tokens:,} | ~${sub_cost:,.2f} |")
                parts.append(f"{stage} {row['agents']} · {tokens:,} tok ~${sub_cost:,.2f}")
            sub_cost, _, _ = cost_of(sub["per_model"], cfg_pricing)
            L.append(f"- **subagent total:** {_fmt_tokens(sub['totals'])} ~${sub_cost:,.2f}")
            sub_stdout = "  subagents: " + "; ".join(parts)
        else:
            L.append("- subagent: none found")
    except Exception as e:
        L.append(f"_not computed: {type(e).__name__}: {e}_")
        sub_stdout = f"  subagents: not computed: {type(e).__name__}: {e}"
    L += [""] + e2e_lines
    risk_by_phase = {e["phase"]: e.get("risk") for e in evs
                     if e.get("event") == "phase_risk" and e.get("phase") is not None}
    high_phases = sorted(p for p, risk in risk_by_phase.items() if risk == "high")
    risk_suffix = " (" + ", ".join(f"P{p}" for p in high_phases) + ")" if high_phases else ""
    L += ["## Activity",
          f"- phases committed: {counts.get('commit', 0)}",
          f"- high-risk phases: {len(high_phases)}{risk_suffix}",
          f"- fix cycles (verify/e2e/gate failures): {sum(counts.get(k, 0) for k in ('verify_fail', 'e2e_fail', 'gate_fail', 'gate_failed'))}",
          f"- e2e: {counts.get('e2e_pass',0)} pass / {counts.get('e2e_fail',0)} fail / {counts.get('e2e_na',0)} N/A",
          f"- e2e missing for committed phase(s): {missing_e2e}",
          f"- deviations recorded: {n_dev} ({n_oneway} one-way)",
          f"- phases quarantined/failed/held: "
          f"{counts.get('quarantined',0)+counts.get('failed',0)+counts.get('held',0)}", ""]
    if not baseline:
        L += ["_Tip: record `Human estimate: <e.g. ~2 days>` in RUN.md to see it next to the wall "
              "clock above._", ""]

    if archived:
        print("\n".join(L))
        return 0
    out = os.path.join(sd, "telemetry.md")
    with open(out, "w") as f:
        f.write("\n".join(L) + "\n")
    print(f"wrote {out}")
    print(f"  wall {hms(run_start, run_end)}"
          + (f" vs your estimate {baseline}" if baseline else "")
          + f"  |  {tot_tok:,} tokens ~${cost:,.2f}"
          + f"  |  {counts.get('commit', 0)} phases committed")
    print(sub_stdout)
    headline = next((x for x in e2e_lines if x.startswith("**Nimble saved")), None)
    if headline:
        print("  " + headline.replace("**", "").split(" _An estimate")[0])
    for note in (x for x in e2e_lines if x.startswith("- Phase ")):
        print("  " + note[2:])
    return 0


# ---- worker tabs ---------------------------------------------------------------
# Every worker (planner, builder, reviewer, e2e, pilot lane) and the app run in their OWN herdr tab —
# never a split pane of the orchestrator's tab, which stacked a whole run's workers into one screen.
# `tab open` is the one way to create them: a label that identifies the run, the stage's routing env,
# a wait for the new shell's prompt (text sent before it is silently lost), and a tabs.json record so
# `tab sweep` at close-out can close everything this run opened — and nothing it didn't.
ROUTED_STAGES = {"planner": "planner", "builder": "builder", "fix": "builder", "reviewer": "reviewer",
                 "coupling": "reviewer", "e2e": "e2e", "figma": "e2e", "pilot": "e2e"}
# Tabs that run no routed agent: their worker_start `kind` is fixed.
TAB_KINDS = {"app": "process", "pilot": "nimble"}
# "pilot" is the e2e lane's plain-process engine: its compile/rescue calls need the e2e stage's config dir.
TAB_PROMPT_RE = r"[%$#>❯] *$"


def _herdr(*argv, timeout=60):
    try:
        out = subprocess.run(["herdr", *argv], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, "", str(e)
    return out.returncode, out.stdout, out.stderr


def _tabs_path(root):
    return os.path.join(state_dir(root), "tabs.json")


def _read_tabs(root):
    try:
        data = json.load(open(_tabs_path(root)))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _write_tabs(root, tabs):
    os.makedirs(state_dir(root), exist_ok=True)
    tmp = _tabs_path(root) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(tabs, f, indent=2)
    os.replace(tmp, _tabs_path(root))


def tab_prefix(root):
    return f"orch:{_prd_slug(_run_field(root, 'PRD'))}:"


def tab_label(root, stage, phase=None, suffix=None):
    label = tab_prefix(root) + (f"p{phase}:" if phase is not None else "") + stage
    return f"{label}:{suffix}" if suffix else label


# --- dispatch / await: the deterministic "is the worker done?" pair -----------------------------
# `herdr agent prompt --wait` returns on the first lifecycle lull (or, for a long worker, never
# returns usefully), and an orchestrating agent that blocks on it goes quiet while the worker has
# long since written its artifact. These two commands replace it: `dispatch` sends the prompt and
# stamps the time; `await` polls the ARTIFACT, with typed exits for every other outcome, and is
# meant to run under run_in_background so the harness re-wakes the orchestrator when it exits.
AWAIT_EXIT = {"artifact": 0, "idle-no-artifact": 3, "blocked": 4, "timeout": 5, "pane-gone": 6,
              "gate-failed": 7}


def _dispatch_path(root, pane):
    return os.path.join(state_dir(root), "dispatch", re.sub(r"[^A-Za-z0-9_.-]", "_", pane) + ".json")


def _agent_status(pane):
    rc, out, _ = _herdr("agent", "get", pane, timeout=20)
    if rc != 0:
        return None
    try:
        return json.loads(out)["result"]["agent"].get("agent_status", "unknown")
    except (ValueError, KeyError, TypeError):
        return "unknown"


def cmd_dispatch(args):
    """Send a worker its prompt without blocking, and stamp when it was sent."""
    root = repo_root(args.root)
    text = open(args.prompt_file).read() if args.prompt_file else args.prompt
    if not text:
        print("dispatch needs --prompt or --prompt-file", file=sys.stderr)
        return 2
    rc, out, err = _herdr("agent", "prompt", args.pane, text, timeout=60)
    if rc != 0:
        print(f"dispatch failed: {err.strip() or out.strip()}", file=sys.stderr)
        return 1
    path = _dispatch_path(root, args.pane)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"pane": args.pane, "since": time.time()}, open(path, "w"))
    print(json.dumps({"dispatched": args.pane, "next": "orchestrator.py await --pane "
                      + args.pane + " --artifact <path|glob>  (run with run_in_background)"}))
    return 0


def cmd_await(args):
    """Block until the worker's artifact exists, or a typed reason it never will.

    Artifact = any --artifact path/glob whose file is non-empty and modified at/after the dispatch
    stamp (so a stale file never counts). Exits: 0 artifact · 3 idle with no artifact for
    --idle-grace-s (worker stopped mid-task, or NO-PLAN-NEEDED: read the pane tail) · 4 blocked
    (needs input) · 5 timeout · 6 pane gone · 7 idle with a GATE-FAILED marker (the Stop hook gave up and the worker really stopped; a marker
    while the worker is still working is ignored, e.g. it is waiting on its own sub-agents). Prints one JSON line."""
    root = repo_root(args.root)
    since = args.since
    if since is None:
        try:
            since = json.load(open(_dispatch_path(root, args.pane)))["since"]
        except (OSError, ValueError, KeyError):
            since = time.time()
    sd = state_dir(root)
    deadline = time.time() + args.timeout_s
    idle_since = None
    blocked_since = None
    gate_marker = None

    def done(reason, **kw):
        print(json.dumps({"reason": reason, "pane": args.pane, **kw}))
        return AWAIT_EXIT[reason]

    while True:
        found = None
        for pat in args.artifact or []:
            for f in sorted(glob.glob(pat)):
                try:
                    if os.path.getsize(f) > 0 and os.path.getmtime(f) >= since:
                        found = f
                except OSError:
                    pass
        if found and not args.settle:
            return done("artifact", path=found)
        for m in glob.glob(os.path.join(sd, "GATE-FAILED-*")):
            try:
                if os.path.getmtime(m) >= since:
                    gate_marker = m
            except OSError:
                pass
        status = _agent_status(args.pane)
        if status is None:
            return done("pane-gone")
        if status == "blocked":
            # herdr also reports `blocked` while a worker waits on its own sub-agents, so only a
            # block that persists past the grace period is real (a genuine prompt never clears).
            blocked_since = blocked_since or time.time()
            if time.time() - blocked_since >= args.blocked_grace_s:
                return done("blocked")
        else:
            blocked_since = None
        if status in ("idle", "done"):
            idle_since = idle_since or time.time()
            if found and time.time() - idle_since >= args.settle_s:
                return done("artifact", path=found)
            if time.time() - idle_since >= args.idle_grace_s:
                if gate_marker:
                    return done("gate-failed", path=gate_marker)
                return done("idle-no-artifact")
        else:
            idle_since = None
        if time.time() >= deadline:
            return done("timeout")
        time.sleep(args.poll_s)


def cmd_tab(args):
    """open | close | sweep | list the run's worker tabs. Prints JSON for open/list."""
    root = repo_root(getattr(args, "root", None))
    tabs = _read_tabs(root)
    ws = os.environ.get("HERDR_WORKSPACE_ID")
    if args.action == "list":
        print(json.dumps(tabs, indent=2))
        return 0
    if args.action == "open":
        if not args.stage:
            print("tab open needs --stage", file=sys.stderr)
            return 1
        if not ws:
            print("HERDR_WORKSPACE_ID is not set -- run the orchestrator inside herdr", file=sys.stderr)
            return 1
        label = tab_label(root, args.stage, args.phase, args.suffix)
        live = next((t for t in tabs if t.get("label") == label), None)
        if live and not args.fresh:
            print(json.dumps({**live, "reused": True}, indent=2))
            return 0
        if live:
            _herdr("tab", "close", live["tab_id"])
            tabs = [t for t in tabs if t is not live]
        env, route = {}, None
        if args.stage in ROUTED_STAGES:
            route = stage_route(root, ROUTED_STAGES[args.stage], args.phase)
            env = dict(route.get("env") or {})
            env["ORCH_TAB_STAGE"] = args.stage    # routing stage differs from the tab's stage
        for kv in getattr(args, "env", None) or []:   # extra per-worker env, e.g. ORCH_FIGMA=1
            k, _, v = kv.partition("=")
            if k:
                env[k] = v
        argv = ["tab", "create", "--workspace", ws, "--cwd", args.cwd or root, "--label", label, "--no-focus"]
        for k, v in env.items():
            argv += ["--env", f"{k}={v}"]
        rc, out, err = _herdr(*argv)
        if rc != 0:
            print(f"herdr tab create failed: {(err or out).strip()[:300]}", file=sys.stderr)
            return 1
        res = json.loads(out)["result"]
        rec = {"label": label, "tab_id": res["tab"]["tab_id"], "pane_id": res["root_pane"]["pane_id"],
               "stage": args.stage, "phase": args.phase, "opened": _utc_now_iso()}
        _write_tabs(root, tabs + [rec])
        kind, model, effort = (TAB_KINDS[args.stage], None, None) if args.stage in TAB_KINDS else \
            ((route["kind"], route.get("model"), route.get("effort")) if route else (None, None, None))
        _emit(root, "worker_start", nulls=True, phase=args.phase, stage=args.stage, kind=kind,
              model=model, effort=effort, config_dir=env.get("CLAUDE_CONFIG_DIR"),
              pane_id=rec["pane_id"])
        # A new tab's shell takes a few seconds to reach its prompt; `agent start` / `pane run` before
        # that is silently dropped (seen on herdr 0.9.1: ~10 s with a zsh profile).
        for _ in range(2):   # the first tab of a session has been seen to need a second wait
            wrc, _, _ = _herdr("pane", "wait-output", rec["pane_id"], "--regex", TAB_PROMPT_RE,
                               "--source", "recent", "--timeout", str(args.wait_ms),
                               timeout=args.wait_ms / 1000 + 10)
            if wrc == 0:
                break
        print(json.dumps({**rec, "ready": wrc == 0}, indent=2))
        return 0
    if args.action == "close":
        keep, closed = [], []
        for t in tabs:
            if (args.label and t.get("label") == args.label) or (args.tab and t.get("tab_id") == args.tab):
                _herdr("tab", "close", t["tab_id"])
                closed.append(t["label"])
            else:
                keep.append(t)
        if args.tab and not closed:   # a tab this run opened but lost track of
            _herdr("tab", "close", args.tab)
            closed.append(args.tab)
        _write_tabs(root, keep)
        print(f"closed {len(closed)} tab(s)" + (f": {', '.join(closed)}" if closed else ""))
        return 0
    # sweep: everything in tabs.json, plus any tab in this workspace carrying this run's prefix
    prefix = tab_prefix(root)
    ids = {t["tab_id"]: t["label"] for t in tabs}
    if ws:
        rc, out, _ = _herdr("tab", "list", "--workspace", ws)
        if rc == 0:
            try:
                for t in json.loads(out).get("result", {}).get("tabs", []):
                    if str(t.get("label", "")).startswith(prefix):
                        ids.setdefault(t["tab_id"], t["label"])
            except ValueError:
                pass
    for tab_id in ids:
        _herdr("tab", "close", tab_id)
    _write_tabs(root, [])
    print(f"swept {len(ids)} tab(s) with prefix {prefix}")
    return 0


def cmd_library_sync(args):
    """Close-out: commit what this PRD's e2e runs taught the pilot's flow library.

    The library is self-maintaining — runs adopt proven flows, fold duplicates, earn anchor
    trust, re-calibrate the gate and queue blocks as they go. This makes it durable: one
    commit, scoped to the library path in the repo that holds it (never the target repo's
    files, never anything else staged there), never pushed. A no-op when nothing changed
    or the Nimble engine never ran."""
    root = repo_root(getattr(args, "root", None))
    prd = args.prd or _run_field(root, "PRD") or "pilot runs"
    source = f"{os.path.splitext(os.path.basename(prd))[0]} ({os.path.basename(root)})"
    rc, out = pilot_library("sync", "--source", source)
    print(out)
    _, health = pilot_library("health")
    if health:
        print(health)
    _emit(root, "library_sync", detail=out[:200])
    return 0 if rc == 0 else 1


def cmd_estimate(args):
    root = repo_root(args.root)
    values = [args.low, args.likely, args.high]
    basis = args.basis
    if not all(math.isfinite(v) and v >= 0 for v in values) or not args.low <= args.likely <= args.high or not basis.strip():
        print("estimate needs finite non-negative low ≤ likely ≤ high and a non-empty basis", file=sys.stderr)
        return 2
    path = os.path.join(state_dir(root), "RUN.md")
    if not os.path.isfile(path):
        print("estimate needs RUN.md", file=sys.stderr)
        return 2
    rid = _run_field(root, "Run id")
    starts = _run_start_events(root)
    if not rid or not starts or starts[-1].get("run_id") != rid:
        print("log run_start first: the estimate must belong to this run", file=sys.stderr)
        return 2
    records = []
    with open(os.path.join(state_dir(root), "events.jsonl"), errors="replace") as stream:
        for line in stream:
            try:
                event = json.loads(line)
                if isinstance(event, dict):
                    records.append(event)
            except json.JSONDecodeError:
                continue
    source = "revised" if any(e.get("event") == "human_estimate" and e.get("run_id") == rid for e in records) else "kickoff"
    ts = _utc_now_iso()
    if source == "kickoff":
        clean = re.sub(r"[#\r\n]+", " ", basis)
        line = f"Human estimate: low {args.low:g}h · likely {args.likely:g}h · high {args.high:g}h · basis: {clean} · stamped {ts} (kickoff)"
        with open(path) as stream:
            text = stream.read()
        if re.search(r"^Human estimate:.*$", text, re.I | re.M):
            text = re.sub(r"^Human estimate:.*$", lambda _: line, text, flags=re.I | re.M)
        elif re.search(r"^Base commit:.*$", text, re.I | re.M):
            text = re.sub(r"^Base commit:.*$", lambda m: m[0] + "\n" + line, text, count=1, flags=re.I | re.M)
        else:
            text += "\n" + line + "\n"
        with open(path, "w") as stream:
            stream.write(text)
    low, likely, high = [int(v) if float(v).is_integer() else v for v in values]
    _emit(root, "human_estimate", ts=ts, run_id=rid, low=low, likely=likely, high=high, basis=basis, source=source)
    print(f"estimate: {source} — {low}/{likely}/{high}")
    return 0


# An e2e_na reason must say why the phase has nothing live to test. A blocked sign-in, a
# license gate or an unavailable app is a roster/environment problem to solve, not an N/A.
E2E_NA_BLOCKED = re.compile(
    r"licen[cs]e|machine|sign[- ]?in|log[- ]?in|credential|password|access code|"
    r"app\b.{0,30}(down|unavailable|not (up|running|reachable))|unavailable|blocked|"
    r"could(n't| not)|cannot|can't|unable", re.I)


def _e2e_roster_path(root):
    """The e2e-orchestrator's gitignored machines.md: current tree, then the main clone."""
    rel = os.path.join(".claude", "skills", "e2e-test-orchestrator", "machines.md")
    cands = [os.path.join(root, rel)]
    common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            cwd=root, capture_output=True, text=True).stdout.strip()
    if common:
        cands.append(os.path.join(os.path.dirname(common), rel))
    return next((c for c in cands if os.path.isfile(c)), None)


def _e2e_skill_present(root):
    """True when this repo ships the e2e-orchestrator skill (so a roster is expected)."""
    rel = os.path.join(".claude", "skills", "e2e-test-orchestrator", "SKILL.md")
    common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            cwd=root, capture_output=True, text=True).stdout.strip()
    return any(os.path.isfile(os.path.join(b, rel))
               for b in (root, os.path.dirname(common) if common else root))


def _phases_missing_e2e(root):
    """Phases committed in the current run with neither an e2e_pass nor an e2e_na event."""
    evs = _events(root, {"run_start", "commit", "e2e_pass", "e2e_na"})
    start = max((i for i, e in enumerate(evs) if e.get("event") == "run_start"), default=-1)
    evs = evs[start + 1:]
    committed = {str(e.get("phase")) for e in evs if e.get("event") == "commit" and e.get("phase") is not None}
    decided = {str(e.get("phase")) for e in evs if e.get("event") in ("e2e_pass", "e2e_na")}
    return sorted(committed - decided, key=lambda x: (len(x), x))


def cmd_log(args):
    """Append one event to the audit log. The orchestrator calls this at every
    meaningful transition so the run leaves a reviewable trail.

    --event's argparse `choices=VALID_EVENTS` rejects an unrecognised name before
    this function ever runs: a name outside that set used to be accepted silently
    and just never counted by cmd_telemetry. Now it's a hard error at the moment
    the typo happens, not a silent gap discovered at close-out.

    run_start/run_end carry run_id; stage_skipped validates the stage and reason
    and preserves a phase-less skip as JSON null."""
    root = repo_root(args.root)
    if args.event == "run_end" and args.detail not in RUN_END_STATUSES:
        print(f"run_end needs --detail {'|'.join(RUN_END_STATUSES)}", file=sys.stderr)
        return 2
    if args.event == "e2e_na":
        reason = (args.detail or "").strip()
        if not reason or E2E_NA_BLOCKED.search(reason):
            roster = _e2e_roster_path(root)
            print("e2e_na needs a reason the phase has nothing live to test (backend-only, no UI "
                  "surface). A license gate, sign-in, unavailable machine or unavailable app is NOT "
                  "N/A: take a machine from the roster"
                  + (f" ({roster})" if roster else " (machines.md was not found)")
                  + " and run the e2e gate.", file=sys.stderr)
            return 2
    if args.event == "run_end" and args.detail == "completed":
        missing = _phases_missing_e2e(root)
        if missing:
            print("run_end completed refused: no e2e_pass or valid e2e_na for phase(s) "
                  + ", ".join(missing) + ". Run the e2e gate, or log run_end --detail partial.",
                  file=sys.stderr)
            return 2
    if args.event == "stage_skipped":
        if args.stage not in TELEMETRY_STAGES or not (args.detail or "").strip():
            print(f"stage_skipped needs --stage one of {', '.join(TELEMETRY_STAGES)} "
                  f"and --detail <reason>", file=sys.stderr)
            return 2
        _emit(root, "stage_skipped", nulls=True, phase=args.phase, stage=args.stage,
              detail=args.detail)
    else:
        run_id = (_new_run_id(root) if args.event == "run_start"
                  else _current_run_id(root) if args.event == "run_end" else None)
        _emit(root, args.event, run_id=run_id, phase=args.phase, stage=args.stage,
              detail=args.detail, sha=args.sha, duration_s=getattr(args, "duration_s", None))
    # The agent's own `commit` (the post-commit hook bypasses cmd_log) lands the phase in
    # RUN.md's table, so a skipped step-7 rewrite can no longer strand the tracker.
    if args.event == "commit" and args.phase and args.sha:
        _set_phase_row(root, args.phase, "committed", args.sha[:10])
    print(f"logged: {args.event}"
          + (f" phase {args.phase}" if args.phase else "")
          + (f" — {args.detail}" if args.detail else ""))
    return 0


def cmd_timeline(args):
    """Render the append-only event log as a human-readable timeline for review."""
    root = repo_root(args.root)
    path = os.path.join(state_dir(root), "events.jsonl")
    if not os.path.exists(path):
        print("no events logged yet")
        return 0
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    if args.limit:
        rows = rows[-args.limit:]
    for r in rows:
        ts = r.get("ts", "")[-8:]  # HH:MM:SS
        ph = f"P{r['phase']}" if r.get("phase") is not None else "  "
        stage = r.get("stage", "")
        loc = f"{ph:>3} {stage:<8}".rstrip()
        detail = r.get("detail") or r.get("matched") or r.get("resume_at") or \
            r.get("topic") or r.get("sha") or r.get("reason") or ""
        print(f"{ts}  {loc:<12}  {r.get('event',''):<20}  {detail}")
    print(f"\n{len(rows)} events  ({path})")
    return 0


def cmd_status(args):
    root = repo_root(args.root)
    decisions = load_decisions(root)
    one_way = [d for d in decisions if d.get("one_way")]
    print(f"root: {root}")
    print(f"deviations recorded: {len(decisions)}  one-way: {len(one_way)}")
    for d in one_way:
        print(f"  ONE-WAY [{d.get('id','?')}] phase {d.get('phase','?')} "
              f"({d.get('blast')}): {d.get('built','')[:80]}")
    run = os.path.join(state_dir(root), "RUN.md")
    if os.path.exists(run):
        for line in open(run, errors="replace"):
            if line.startswith("current:") or (line.startswith("|") and any(
                    k in line for k in ("pending", "held", "committed", "building", "failed"))):
                print("  " + line.rstrip())
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--root", help="working tree root (default: git toplevel of cwd)")
    sub = p.add_subparsers(dest="subcmd", required=True)

    pi = sub.add_parser("init"); pi.add_argument("--prd"); pi.add_argument("--force", action="store_true")
    pi.add_argument("--gate", default="commit", help="which step needs a human (default: commit)")
    pi.add_argument("--store", help="store dir for this run (default: derived from an absolute store PRD)")

    pk = sub.add_parser("park")
    pk.add_argument("--reason")
    pk.add_argument("--force", action="store_true")
    pk.add_argument("--allow-dirty", action="store_true",
                    help="park despite dirty paths no phase of this run changed; records them in RUN.md")
    pu = sub.add_parser("unpark")
    pu.add_argument("--slug", required=True)
    pu.add_argument("--force", action="store_true")
    sub.add_parser("review-range").add_argument("--json", action="store_true")
    psf = sub.add_parser("surface", help="list high-stakes paths/tests/levels a phase touched (reports, never holds)")
    g = psf.add_mutually_exclusive_group(required=True)
    g.add_argument("--phase", type=int)
    g.add_argument("--final", action="store_true")
    psf.add_argument("--sha", action="append", help="add a fix commit to this phase's set")

    prk = sub.add_parser("risk", help="rate a phase high/normal from the gap pass + plan touch set vs [surface] (reports; never holds)")
    g = prk.add_mutually_exclusive_group(required=True)
    g.add_argument("--phase", type=int)
    g.add_argument("--summary", action="store_true")
    prk.add_argument("--plan")

    pst = sub.add_parser("store", help="the wiki store for PRDs, plans and testing docs")
    pst.add_argument("action", choices=["path", "import"])
    pst.add_argument("--context", required=True, help="rbcloud | isi | ...")
    pst.add_argument("--feature", help="parent Feature id, else the ticket key / branch slug "
                                       "(required for `path` and `import --from`)")
    pst.add_argument("--json", action="store_true")
    pst.add_argument("--repo", help="import: a team repo whose committed docs/ai/{prds,plans,testing} to copy")
    pst.add_argument("--ref", default="origin/main", help="import --repo: the ref to read (default origin/main)")
    pst.add_argument("--from", dest="from_dir", help="import: a loose dir with prds/ plans/ testing/")
    pst.add_argument("--dry-run", action="store_true", help="import: report only, write nothing")

    psc = sub.add_parser("store-commit", help="commit store paths in the wiki (path-whitelisted, never pushed)")
    psc.add_argument("--phase", type=int)
    psc.add_argument("--reason", help="e.g. failed, close-out, testdocs")
    psc.add_argument("--store", help="store dir (default: RUN.md `Store:`)")
    psc.add_argument("--path", action="append", help="a path under <wiki>/.planning/ (repeatable; default: the Store)")

    sub.add_parser("config").add_argument("--check", action="store_true",
                                          help="(default; accepted for readability)")
    pp = sub.add_parser("preflight")
    pp.add_argument("--trust", action="store_true",
                    help="grant this root hasTrustDialogAccepted in the active config dir")

    pr = sub.add_parser("report")
    pr.add_argument("--prd", help="PRD path (default: read from RUN.md)")
    pr.add_argument("--absorbed", type=int,
                    help="absorbed-decision count (default: sum of phase-*/absorbed)")

    sub.add_parser("status")

    pe = sub.add_parser("estimate")
    for key in ("low", "likely", "high"):
        pe.add_argument("--" + key, type=float, required=True)
    pe.add_argument("--basis", required=True)

    plg = sub.add_parser("log")
    plg.add_argument("--event", required=True, choices=sorted(VALID_EVENTS),
                     help="one of VALID_EVENTS -- see the module docstring")
    plg.add_argument("--phase", type=int)
    plg.add_argument("--stage", help="free text; for stage_skipped one of: " + ", ".join(TELEMETRY_STAGES))
    plg.add_argument("--detail")
    plg.add_argument("--sha")
    plg.add_argument("--duration-s", type=float, dest="duration_s",
                     help="wall time of the stage this event closes")

    pro = sub.add_parser("routing")
    pro.add_argument("--stage", required=True, choices=ROUTING_STAGES)
    pro.add_argument("--phase", type=int)
    pw = sub.add_parser("worker-settings")
    pw.add_argument("--stage", required=True,
                    choices=["planner", "builder", "e2e", "reviewer", "fix"])
    pw.add_argument("--phase", type=int)
    pw.add_argument("--artifact", help="absolute path the Stop gate requires (default: derived)")

    pin = sub.add_parser("install")
    pin.add_argument("--into", help="target repo root (default: current git toplevel)")
    pin.add_argument("--source", help="canonical skills dir (default: this family's own dir)")
    pin.add_argument("--force", action="store_true", help="overwrite even if versions match")
    pin.add_argument("--no-optional", action="store_true", help="skip create-prd")

    sub.add_parser("install-hooks")
    pgd = sub.add_parser("guard", help="keep PRDs/plans/testing docs out of this repo (exclude + pre-commit fence)")
    pgd.add_argument("action", choices=["install", "status"])
    pgd.add_argument("--root", default=argparse.SUPPRESS, help="the repo to guard (same as the global --root)")
    pgd.add_argument("--testing-dir", dest="testing_dir",
                     help="extra repo-relative testing dir to guard (default: the toml's [testing].dir)")
    sub.add_parser("hook-commit")
    sub.add_parser("hook-pre-commit")

    pvr = sub.add_parser("verify")
    pvr.add_argument("--check", action="store_true",
                     help="no re-run: exit 0 current and green, 2 red, 3 missing or stale")
    pvr.add_argument("--phase", type=int, required=True)
    pvr.add_argument("--full", action="store_true", help="run every level, ignoring per-level paths; the pre-review verify")
    pvr.add_argument("--base")
    pvr.add_argument("--keep-going", action="store_true",
                     help="run every level even after one fails (default: stop at first failure)")

    for command in ("digest", "fix-plan"):
        sub.add_parser(command).add_argument("--phase", type=int, required=True)

    pgt = sub.add_parser("gate")
    pgt.add_argument("--phase", type=int, required=True)
    pgt.add_argument("--plan")
    pgt.add_argument("--prd", help="PRD path (default: read from RUN.md)")

    ps = sub.add_parser("setup")
    ps.add_argument("--detect", action="store_true", help="(default; accepted for readability)")
    ps.add_argument("--force", action="store_true", help="overwrite an existing orchestrator.toml")

    pd = sub.add_parser("drift")
    pd.add_argument("--base", help="base commit (default: RUN.md `Base commit:`)")
    pd.add_argument("--head", default="HEAD")

    sub.add_parser("resume")

    ppe = sub.add_parser("promote-e2e")
    ppe.add_argument("--phase", type=int, required=True)
    ppe.add_argument("--prd", help="PRD path (default: read from RUN.md)")

    pve = sub.add_parser("validate-e2e")
    pve.add_argument("--phase", type=int, required=True)
    pve.add_argument("--prd", help="PRD path (default: read from RUN.md)")
    pve.add_argument("--committed", action="store_true",
                     help="also require the scenario to match the version committed at HEAD")

    pfp = sub.add_parser("figma-pull")
    pfp.add_argument("--prd", help="PRD path (default: read from RUN.md)")
    pfp.add_argument("--force", action="store_true",
                     help="re-pull frames whose PNG + tokens already exist")

    pvf = sub.add_parser("validate-figma")
    pvf.add_argument("--phase", type=int, required=True)
    pvf.add_argument("--prd", help="PRD path (default: read from RUN.md)")
    pvf.add_argument("--committed", action="store_true",
                     help="compatibility flag; Figma artifacts must always remain untracked")
    pvf.add_argument("--final", action="store_true", help="validate the end-of-run Figma comparison")

    ptd = sub.add_parser("testdocs")
    ptd.add_argument("--prd", help="PRD path (default: read from RUN.md)")

    pev = sub.add_parser("pr-evidence")
    pev.add_argument("--cap", type=int, help="max shots to include (default: 8)")

    pln = sub.add_parser("learnings")
    pln.add_argument("--add", help="finding class to tally (omit to show the tally)")
    pln.add_argument("--standard", help="standards file this class belongs to")
    pln.add_argument("--phase", type=int)
    pln.add_argument("--file", help="file:line the finding was raised against")
    pln.add_argument("--prd")

    pu = sub.add_parser("usage")
    pu.add_argument("--since", help="ISO timestamp lower bound (a stage's start)")
    pu.add_argument("--until", help="ISO timestamp upper bound (default: now)")
    pu.add_argument("--phase", type=int)
    pu.add_argument("--stage", help="plan|build|e2e|review")

    ptel = sub.add_parser("telemetry")
    ptel.add_argument("--state-dir", help="read an archived run's state dir (e.g. .agents/orchestrator-archive/<slug>); prints, writes nothing")
    pec = sub.add_parser("e2e-cost", help="past Claude e2e worker cost vs Nimble runs' spend")
    pec.add_argument("--json", action="store_true")
    pec.add_argument("--since", help="YYYY-MM-DD: only sessions/runs on or after this date")

    ptb = sub.add_parser("tab")
    ptb.add_argument("action", choices=["open", "close", "sweep", "list"])
    ptb.add_argument("--stage", help="planner|builder|fix|reviewer|coupling|e2e|figma|pilot|app")
    ptb.add_argument("--phase", type=int)
    ptb.add_argument("--suffix", help="extra label part, e.g. a lane number")
    ptb.add_argument("--cwd", help="default: the repo root")
    ptb.add_argument("--fresh", action="store_true", help="open: replace a live tab with the same label")
    ptb.add_argument("--label"); ptb.add_argument("--tab")
    ptb.add_argument("--wait-ms", type=int, default=45000)
    ptb.add_argument("--env", action="append", help="open: extra KEY=VALUE for this tab (repeatable)")

    pdp = sub.add_parser("dispatch", help="send a worker its prompt without blocking")
    pdp.add_argument("--pane", required=True)
    pdp.add_argument("--prompt"); pdp.add_argument("--prompt-file")
    paw = sub.add_parser("await", help="block until a worker's artifact exists (typed exits)")
    paw.add_argument("--pane", required=True)
    paw.add_argument("--artifact", action="append", help="path or glob (repeatable)")
    paw.add_argument("--since", type=float, help="epoch; default the pane's dispatch stamp")
    paw.add_argument("--timeout-s", type=float, default=3600)
    paw.add_argument("--idle-grace-s", type=float, default=90)
    paw.add_argument("--poll-s", type=float, default=10)
    paw.add_argument("--blocked-grace-s", type=float, default=180)
    paw.add_argument("--settle", action="store_true",
                     help="the artifact only counts once the worker is also idle (for artifacts a worker "
                          "writes early and amends, e.g. a reviewer merging sub-agent findings)")
    paw.add_argument("--settle-s", type=float, default=20, help="with --settle: idle seconds required")

    pls = sub.add_parser("library-sync")
    pls.add_argument("--prd", help="default: the PRD in RUN.md")

    pgp = sub.add_parser("gaps", help="the kickoff gap pass over the PRD's phases")
    pgp.add_argument("action", choices=["write", "show", "resolve", "ingest"])
    pgp.add_argument("--from", dest="source_file",
                     help="write: analyst JSON file (or - for stdin); ingest: the plan path")
    pgp.add_argument("--phase", type=int, help="show: only this phase's open gaps; ingest/resolve: the phase")
    pgp.add_argument("--open", action="store_true", help="show: open findings only")
    pgp.add_argument("--id", help="resolve: the finding id, e.g. g3")
    pgp.add_argument("--how", help="resolve: what settled it")
    pgp.add_argument("--by", help="who: analyst|planner|builder|human|code")
    pgp.add_argument("--absorb", action="store_true", help="resolve: mark absorbed (not worth a planner's time)")
    pgp.add_argument("--replace", action="store_true", help="write: discard earlier findings first")

    pfc = sub.add_parser("facts", help="the per-run facts cache")
    pfc.add_argument("action", choices=["add", "show", "ingest"])
    pfc.add_argument("--partition", choices=FACT_PARTITIONS)
    pfc.add_argument("--phase", type=int)
    pfc.add_argument("--stage", help="planner|builder|e2e|reviewer (ingest infers it from the filename)")
    pfc.add_argument("--from", dest="source_file", help="ingest: the artifact to harvest `## New facts` from")

    pig = sub.add_parser("ingest", help="harvest `## New facts` + `## Gaps addressed` from one artifact")
    pig.add_argument("--phase", type=int, required=True)
    pig.add_argument("--from", dest="source_file", required=True)
    pig.add_argument("--stage", help="default: builder for summary.md, else planner")

    pt = sub.add_parser("timeline")
    pt.add_argument("--limit", type=int, help="show only the last N events")

    args = p.parse_args()
    fn = {"park": cmd_park, "unpark": cmd_unpark, "review-range": cmd_review_range, "surface": cmd_surface, "risk": cmd_risk,
          "init": cmd_init, "config": cmd_config, "preflight": cmd_preflight,
          "report": cmd_report, "status": cmd_status, "digest": cmd_digest, "fix-plan": cmd_fix_plan,
          "log": cmd_log, "estimate": cmd_estimate, "timeline": cmd_timeline,
          "usage": cmd_usage, "telemetry": cmd_telemetry, "e2e-cost": cmd_e2e_cost,
          "install": cmd_install, "install-hooks": cmd_install_hooks, "hook-commit": cmd_hook_commit,
          "hook-pre-commit": cmd_hook_pre_commit, "verify": cmd_verify, "gate": cmd_gate,
          "setup": cmd_setup, "worker-settings": cmd_worker_settings, "routing": cmd_routing, "drift": cmd_drift,
          "resume": cmd_resume, "learnings": cmd_learnings,
          "promote-e2e": cmd_promote_e2e, "validate-e2e": cmd_validate_e2e,
          "figma-pull": cmd_figma_pull, "validate-figma": cmd_validate_figma,
          "testdocs": cmd_testdocs,
          "pr-evidence": cmd_pr_evidence, "library-sync": cmd_library_sync, "tab": cmd_tab, "dispatch": cmd_dispatch, "await": cmd_await,
          "gaps": cmd_gaps, "facts": cmd_facts, "ingest": cmd_ingest,
          "store": cmd_store, "store-commit": cmd_store_commit, "guard": cmd_guard}[args.subcmd]
    rc = fn(args)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
