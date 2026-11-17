#!/usr/bin/env python3
"""journey.py — record what an E2E run actually did into one schema'd journey.json.

A CLI and an importable module (the Nimble pilot imports it). State is the journey directory:
`journey.json` (rewritten atomically after every step) and `.last-snapshot.txt` (scratch, never
cataloged). Every subcommand takes `--dir`, else `$JOURNEY_DIR` — never the cwd.

    journey.py start --app rbcloud --source prd-phase --ref prd=x,phase=1 --story "…" [--criteria …]
    journey.py ab --session S snapshot -i      # pass-through shim around agent-browser
    journey.py ab --session S click @e12       # appends a step, @e12 → role + accessible name
    journey.py note|assert|shot|wait …         # intent the browser log cannot carry
    journey.py fixture <entity> <id> [--name …] [--created]
    journey.py finish --result pass|fail|blocked
    journey.py render [--out PATH]
    journey.py export-playwright <journey.json>

`finish` substitutes credentials with `${E2E_*}`, refuses (exit 2) a journey that still holds one,
and copies journey.json + scenario.md into the wiki catalog `.claude/e2e/journeys/<app>/<id>/`,
appending one line to its `index.jsonl` under an exclusive lock. Stdlib only.
"""

from __future__ import annotations

import argparse
import datetime
import fcntl
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SCHEMA = 1

# Same pattern as prd-orchestrator's _SENSITIVE_INPUT: a capture row naming one of these
# must carry an environment reference (or a redaction), never a literal.
SENSITIVE = re.compile(
    r"password|passcode|access[ _-]?code|credential|secret|token|authorization|cookie|"
    r"card[ _-]?(?:number|no)?|cvv|cvc|security[ _-]?code|pin|otp|mfa|"
    r"verification[ _-]?code|one[ _-]?time[ _-]?(?:code|password)",
    re.IGNORECASE,
)


def secret_shaped(value: str) -> bool:
    """prd-orchestrator's _secret_shaped: digit runs, mixed letter+digit tokens, long tokens."""
    return bool(re.fullmatch(r"\d{4,19}", value)
                or (re.fullmatch(r"\S{6,}", value) and re.search(r"[A-Za-z]", value)
                    and re.search(r"\d", value))
                or re.fullmatch(r"\S{20,}", value))


ACTING = {"open", "goto", "navigate", "click", "dblclick", "fill", "type", "select", "check",
          "uncheck", "press", "back", "forward", "reload", "eval"}
# ACTING is the ONE definition of an acting step: it gates recording and counts the verdict. Screenshots
# are recorded but never act. finish persists the count as journey.json `actingSteps` so no reader recounts.
COMMANDS = {"open", "goto", "navigate", "click", "dblclick", "type", "fill", "press", "keyboard",
            "hover", "focus", "check", "uncheck", "select", "drag", "upload", "download", "scroll",
            "wait", "screenshot", "pdf", "snapshot", "eval", "connect", "close", "back", "forward",
            "reload", "get", "is", "find", "record"}
NAV_EVAL = re.compile(r"location|history\.|href|navigate")
REF = re.compile(r"@?(e\d+)")
SYMBOLIC = re.compile(r"\$\{[A-Z][A-Z0-9_]*\}")
CRED_NAMES = {
    "E2E_USER": ("E2E_USER", "LOCAL_VALID_USERNAME"),
    "E2E_PASS": ("E2E_PASS", "LOCAL_VALID_PASSWORD"),
    "E2E_ACCESS_CODE": ("E2E_ACCESS_CODE", "LOCAL_VALID_PIN", "POST_LOGIN_POPUP_CODE"),
}
SNAPSHOT_LINE = re.compile(    # pilot/snapshot.py LINE
    r'^(?P<indent>\s*)- (?P<role>[A-Za-z][\w-]*)'
    r'(?: "(?P<name>(?:[^"\\]|\\.)*)")?'
    r'(?: \[(?P<attrs>[^\]]*)\])?'
    r'(?P<rest>.*)$'
)
SCRATCH = ".last-snapshot.txt"


# -- paths ---------------------------------------------------------------------------------
def wiki_root() -> Path:
    """From this file, never the cwd: a worker's cwd is a target-repo worktree with its own CLAUDE.md."""
    here = Path(__file__).resolve()
    guess = here.parents[4]
    if (guess / "CLAUDE.md").exists():
        return guess
    for p in here.parents:
        if (p / "CLAUDE.md").exists() and (p / ".claude" / "skills").is_dir():
            return p
    return guess


def catalog_root() -> Path:
    # JOURNEY_CATALOG overrides the root: suites point it at a temp dir, and the export callers (promote, the
    # Workbench route) set it to scope export-playwright's containment check. Do not drop it from those callers.
    env = os.environ.get("JOURNEY_CATALOG")
    return Path(env) if env else wiki_root() / ".claude" / "e2e" / "journeys"


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _path_of(url) -> str | None:
    """The screen, not the host: path (+ hash route), never the query."""
    if not url:
        return None
    m = re.match(r"^[a-z][a-z0-9+.-]*://[^/?#]*([^?#]*)(?:\?[^#]*)?(#.*)?$", str(url), re.I)
    if not m:
        return str(url)
    return (m.group(1) or "/") + (m.group(2) or "")


# -- the journey object ----------------------------------------------------------------------
def new_journey(*, app, source, ref, story, criteria, engine, base_url, run_id=None) -> dict:
    return {
        "schema": SCHEMA, "id": None, "app": app, "source": source, "ref": dict(ref or {}),
        "runId": run_id, "story": story, "criteria": list(criteria or []), "engine": engine,
        "baseUrl": base_url, "startedAt": _now(), "finishedAt": None, "result": None,
        "journey": "incomplete",
        "prerequisites": {"login": "${E2E_USER}", "machine": None, "fixtures": []},
        "steps": [], "assertions": [], "notes": "",
    }


def load(d) -> dict:
    return json.loads((Path(d) / "journey.json").read_text())


def save(d, journey: dict) -> Path:
    d = Path(d)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "journey.json.tmp"
    tmp.write_text(json.dumps(journey, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, d / "journey.json")
    return d / "journey.json"


def acting_steps(journey: dict) -> int:
    return sum(1 for s in journey.get("steps") or []
               if isinstance(s, dict) and s.get("action") in ACTING)


def fixture_entry(entity, id, *, name=None, created=False) -> dict:
    return {"entity": str(entity), "id": str(id) if id is not None else None,
            "name": name or None, "created": bool(created)}


def add_fixture(journey, entry) -> dict:
    fixtures = journey.setdefault("prerequisites", {}).setdefault("fixtures", [])
    for old in fixtures:
        if isinstance(old, dict) and (old.get("entity"), old.get("id")) == (entry["entity"], entry["id"]):
            old["name"] = entry.get("name") or old.get("name")
            old["created"] = bool(old.get("created") or entry.get("created"))
            return old
    fixtures.append(entry)
    return entry


# -- credentials -----------------------------------------------------------------------------
def _dotenv(path: Path) -> dict[str, str]:
    """rbcloud.load_dotenv's parse, without touching os.environ."""
    out: dict[str, str] = {}
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out.setdefault(k.removeprefix("export ").strip(), v.strip().strip('"').strip("'"))
    return out


def _worktree() -> Path | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                             timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return Path(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None


def _roster_login(worktree: Path | None):
    path = wiki_root() / ".claude" / "skills" / "e2e-test-orchestrator" / "pilot" / "roster.py"
    try:
        spec = importlib.util.spec_from_file_location("_journey_roster", path)
        roster = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(roster)
        found = roster.locate(worktree or wiki_root())
        return roster.parse_login(found.read_text()) if found else None
    except (ImportError, OSError, AttributeError, FileNotFoundError):
        return None


def credential_values(worktree=None) -> dict[str, list[str]]:
    """Every known value of E2E_USER / E2E_PASS / E2E_ACCESS_CODE, most authoritative first:
    machines.md `## Login`, then the environment (and its aliases), then .env files. All of them
    are substituted — a stale .env value typed by mistake is still a credential. Never printed."""
    worktree = Path(worktree) if worktree else _worktree()
    out: dict[str, list[str]] = {k: [] for k in CRED_NAMES}

    def add(name, value):
        if value and value not in out[name]:
            out[name].append(value)

    login = _roster_login(worktree)
    if login:
        add("E2E_USER", login.user)
        add("E2E_PASS", login.password)
        add("E2E_ACCESS_CODE", login.code)
    envs = [dict(os.environ)] + [_dotenv(p / ".env") for p in (worktree, wiki_root()) if p]
    for env in envs:
        for name, aliases in CRED_NAMES.items():
            for alias in aliases:
                add(name, env.get(alias))
    return out


def _creds_list(creds) -> list[tuple[str, str]]:
    pairs = []
    for name, values in (creds or {}).items():
        for v in ([values] if isinstance(values, str) else values or []):
            if v:
                pairs.append((name, v))
    return sorted(pairs, key=lambda p: len(p[1]), reverse=True)


def substitute(text, creds, unique: str | None = None):
    """Credential → `${NAME}`. Exact match for all; substring only for passwords and codes (a
    username like `chris` must not mangle `christopher`). Lists are substituted element-wise."""
    if isinstance(text, list):
        return [substitute(t, creds, unique) for t in text]
    if text is None or not isinstance(text, str):
        return text
    for name, value in _creds_list(creds):
        if text == value:
            return "${" + name + "}"
    for name, value in _creds_list(creds):
        if name != "E2E_USER" and len(value) >= 4 and value in text:
            text = text.replace(value, "${" + name + "}")
    unique = unique or os.environ.get("JOURNEY_UNIQUE")
    if unique and unique in text:
        text = text.replace(unique, "{unique}")
    return text


def leaks(journey: dict, creds) -> list[int]:
    bad = []
    pairs = _creds_list(creds)
    for i, s in enumerate(journey.get("steps") or [], 1):
        if not isinstance(s, dict):
            continue
        vals = []
        for key in ("input", "picked"):
            v = s.get(key)
            vals += v if isinstance(v, list) else [v]
        for v in (str(x) for x in vals if x not in (None, "")):
            if any((name == "E2E_USER" and v == value) or (name != "E2E_USER" and value in v)
                   for name, value in pairs):
                bad.append(s.get("n") or i)
                break
    return bad


# -- snapshot refs ---------------------------------------------------------------------------
def _attrs(raw: str | None) -> dict:
    out = {}
    for part in (raw or "").split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def parse_refs(snapshot_text: str) -> dict[str, dict]:
    """`eN` and `@eN` → {role, name, inIframe}, from an agent-browser accessibility tree."""
    refs: dict[str, dict] = {}
    stack: list[tuple[int, str]] = []
    for line in (snapshot_text or "").splitlines():
        m = SNAPSHOT_LINE.match(line)
        if not m:
            continue
        indent = len(m["indent"])
        while stack and stack[-1][0] >= indent:
            stack.pop()
        ref = _attrs(m["attrs"]).get("ref")
        if ref:
            info = {"role": m["role"].lower(), "name": (m["name"] or "").replace('\\"', '"'),
                    "inIframe": any(r.lower() == "iframe" for _, r in stack)}
            refs[ref] = info
            refs["@" + ref] = info
        stack.append((indent, m["role"]))
    return refs


_LINE_BREAKS = (("\n", "\\n"), ("\r", "\\r"), ("\u2028", "\\u2028"), ("\u2029", "\\u2029"))


def _escape_breaks(text: str) -> str:
    for old, new in _LINE_BREAKS:
        text = text.replace(old, new)
    return text


def _escape_js(text: str, quote: str) -> str:
    """The body of a JS string literal delimited by `quote` (' or `): one escaper for every literal we write."""
    return _escape_breaks(text.replace("\\", "\\\\").replace(quote, "\\" + quote))


def _q(s: str) -> str:
    return _escape_js(s, "'")


def playwright_for(role: str, name: str, in_iframe: bool) -> str:
    base = f"getByRole('{_q(role)}', {{ name: '{_q(name)}' }})" if name else f"getByRole('{_q(role)}')"
    return f"frameLocator('iframe').{base}" if in_iframe else base


# -- rendering -------------------------------------------------------------------------------
def _cell(s) -> str:
    if isinstance(s, list):
        s = ", ".join(map(str, s))
    return str(s if s not in (None, "") else "—").replace("|", "/").replace("\n", " ")


def render_scenario(journey: dict) -> str:
    """The catalog scenario.md: literals kept. Never names the engine."""
    meta = [("id", journey.get("id")), ("app", journey.get("app")), ("source", journey.get("source")),
            ("ref", ", ".join(f"{k}={v}" for k, v in (journey.get("ref") or {}).items() if v is not None)),
            ("result", journey.get("result")), ("journey", journey.get("journey")),
            ("started", journey.get("startedAt")), ("finished", journey.get("finishedAt")),
            ("baseUrl", journey.get("baseUrl"))]
    lines = [f"# {journey.get('story') or 'E2E journey'}", ""]
    lines += [f"- {k}: `{v}`" for k, v in meta if v not in (None, "")]
    if journey.get("reason"):
        lines.append(f"- reason: `{journey['reason']}`")
    lines += ["", "## Acceptance criteria", ""]
    lines += [f"- {c}" for c in journey.get("criteria") or []] or ["- none recorded"]
    lines += ["", "## Steps", "",
              "| # | screen / url | action | locator | input | picked | wait / trigger | assertion | evidence |",
              "|---|---|---|---|---|---|---|---|---|"]
    for i, s in enumerate(journey.get("steps") or [], 1):
        loc = s.get("locator") or {}
        locator = loc.get("playwright") or (f"{s.get('raw')} (unresolved)" if s.get("unresolved")
                                            else s.get("raw"))
        action = str(s.get("action") or "?") + ("" if s.get("ok", True) else " ✗")
        shot = f"`{s['shot']}`" if s.get("shot") else None
        lines.append(f"| {s.get('n') or i} | {_cell(s.get('url'))} | {_cell(action)} | "
                     f"{_cell(f'`{locator}`' if locator else None)} | {_cell(s.get('input'))} | "
                     f"{_cell(s.get('picked'))} | {_cell(s.get('wait'))} | {_cell(s.get('assert'))} | "
                     f"{_cell(shot)} |")
    lines += ["", "## Assertions", ""]
    lines += [f"- {'✓' if a.get('ok') else '✗'} {a.get('claim')} ({a.get('judge')})"
              for a in journey.get("assertions") or []] or ["- none recorded"]
    notes = [s for s in [journey.get("notes")] if s] + [f"step {s.get('n')}: {s['note']}"
                                                         for s in journey.get("steps") or [] if s.get("note")]
    lines += ["", "## Notes", ""] + ([f"- {n}" for n in notes] or ["- none"])
    return "\n".join(lines) + "\n"


# -- draft specs -----------------------------------------------------------------------------
def _js(value) -> str:
    return "'" + _escape_js(str(value if value is not None else ""), "'") + "'"


def _comment(value) -> str:
    return re.sub(r"[\r\n\u2028\u2029]+", " ", str(value if value is not None else ""))


def _value(value, creds=None) -> str:
    value = substitute(value, credential_values() if creds is None else creds)
    text = str(value) if value is not None else ""
    if text.startswith("[REDACTED"):
        return "'' /* TODO: redacted value */"
    if SYMBOLIC.fullmatch(text):
        return f"process.env.{text[2:-1]} ?? ''"
    if SYMBOLIC.search(text) or "{unique}" in text:
        text = _escape_js(text, "`")
        # Only recorded placeholders become expressions; all other interpolation stays literal.
        text = re.sub(r"\$\{([^}]*)\}", lambda m: "${process.env." + m[1] + " ?? ''}"
                      if re.fullmatch(r"[A-Z][A-Z0-9_]*", m[1]) else "\\" + m[0], text)
        return "`" + text.replace("{unique}", "${unique}") + "`"
    return _js(text)


def _check(claim):
    if isinstance(claim, dict):
        kind, arg = str(claim.get("check", "")), claim.get("args", "")
        if isinstance(arg, list):
            arg = "|".join(map(str, arg))
        if not arg and ":" in kind:
            kind, _, arg = kind.partition(":")
        return kind.strip(), str(arg).strip()
    kind, _, arg = str(claim or "").partition(":")
    return kind.strip(), arg.strip()


def _expect(claim, judge, last_locator) -> str:
    kind, arg = _check(claim)
    if kind == "url-contains":
        pattern = re.sub(r"([.*+?^${}()|\[\]\\/])", r"\\\1", str(arg))
        pattern = _escape_breaks(pattern)
        return f"await expect(page).toHaveURL(/{pattern}/);"
    if kind in ("text-contains", "text-absent"):
        neg = "not." if kind == "text-absent" else ""
        return f"await expect(page.locator('body')).{neg}toContainText({_js(arg)});"
    if kind == "visible":
        return f"await expect(page.getByText({_js(arg)}).first()).toBeVisible();"
    if kind == "dialog-visible":
        return f"await expect(page.getByRole('dialog', {{ name: {_js(arg)} }})).toBeVisible();"
    if kind == "dialog-closed":
        return "await expect(page.getByRole('dialog')).toHaveCount(0);"
    if last_locator and kind in ("checked", "value-equals"):
        method = "toBeChecked()" if kind == "checked" else f"toHaveValue({_js(arg)})"
        return f"await expect({last_locator}).{method};"
    return f"// TODO assert ({_comment(judge)}): {_comment(claim)}"


def _catalog_journey(path) -> Path:
    """The one containment check for export: a <catalog>/<app>/<id>/journey.json, symlinks resolved."""
    real, root = Path(path).resolve(), catalog_root().resolve()
    try:
        parts = real.relative_to(root).parts
    except ValueError:
        parts = ()
    if len(parts) != 3 or parts[-1] != "journey.json":
        raise ValueError(f"expected <app>/<id>/journey.json inside the catalog {catalog_root()}")
    if not real.is_file():
        raise ValueError(f"no journey at {path}")
    return real


def _spec_hints(app_dir: Path) -> tuple[str, str]:
    """Where an app's specs live and how they sign in: per-app memory in <catalog>/<app>/playwright.json, not here."""
    try:
        hints = json.loads((app_dir / "playwright.json").read_text())
    except (OSError, ValueError):
        hints = {}
    hints = hints if isinstance(hints, dict) else {}
    return _comment(hints.get("folder") or "the app's Playwright test folder"), _comment(hints.get("note") or "")


def export_playwright(path) -> Path:
    path = _catalog_journey(path)
    try:
        journey = json.loads(path.read_text())
    except ValueError as error:
        raise ValueError(f"unreadable journey: {error}") from None
    if not isinstance(journey, dict) or journey.get("schema") != SCHEMA:
        raise ValueError("expected a schema-1 journey object")
    creds = credential_values()
    folder, note = _spec_hints(path.parent.parent)
    status = str(journey.get("journey") or "incomplete")
    if journey.get("reason"):
        status += f" ({journey['reason']})"
    lines = [f"// Draft Playwright spec generated from journey {_comment(journey.get('id') or '(uncataloged)')} — review before use.",
             f"// Recorded against {_comment(journey.get('baseUrl'))} · result: {_comment(journey.get('result'))} · journey: {_comment(status)}",
             f"// Move to: {folder}. {note}".rstrip(), "// Test data:"]
    fixtures = (journey.get("prerequisites") or {}).get("fixtures") or []
    for fixture in fixtures:
        if isinstance(fixture, dict):
            data = str(fixture.get("entity") or "fixture")
            if fixture.get("id") is not None:
                data += " " + str(substitute(fixture["id"], creds))
            if fixture.get("name"):
                data += ' "' + str(substitute(fixture["name"], creds)) + '"'
            if fixture.get("created"):
                data += " (created)"
        else:
            data = substitute(str(fixture), creds)
        lines.append("//   - " + _comment(data))
    if not fixtures:
        lines.append("//   (none recorded)")
    title = str(journey.get("id") or "").rsplit("/", 1)[-1] or run_slug(journey)
    lines += ["import { test, expect } from '@playwright/test';", "",
              f"test.describe({_js(journey.get('story') or 'E2E journey')}, () => {{",
              f"  test({_js(title)}, async ({{ page }}) => {{"]
    steps = [s for s in journey.get("steps") or [] if isinstance(s, dict)]
    if any("{unique}" in str(substitute(s.get(k), creds)) for s in steps for k in ("input", "picked")):
        lines.append("    const unique = Date.now().toString().slice(-6);")
    assertions = [a for a in journey.get("assertions") or [] if isinstance(a, dict)]
    consumed, last_locator = set(), None

    def assertion(a):
        if a.get("ok") is False:
            lines.append("    // failed during the recorded run")
        lines.append("    " + _expect(a.get("claim"), a.get("judge") or "check", last_locator))

    for i, step in enumerate(steps, 1):
        action, inp = step.get("action"), step.get("input")
        loc = step.get("locator") or {}
        locator = "page." + loc["playwright"] if loc.get("playwright") else None
        if locator:
            last_locator = locator
        if step.get("ok") is False:
            lines.append(f"    // step {_comment(step.get('n') or i)} failed during the recorded run")
        command = None
        if action == "open":
            command = f"await page.goto({_js(step.get('url') or _path_of(inp))});"
        elif action in {"click", "dblclick", "fill", "type", "select", "check", "uncheck"}:
            if not locator or step.get("unresolved"):
                command = f"// TODO: {action} {_comment(step.get('raw'))} (target not resolved during the run)"
            else:
                if not loc.get("name"):
                    lines.append("    // TODO: locator has no accessible name")
                if action in {"fill", "type"}:
                    command = f"await {locator}.fill({_value(inp, creds)});"
                elif action == "select":
                    picked = step.get("picked")
                    value = "[" + ", ".join(_value(v, creds) for v in picked) + "]" if isinstance(picked, list) else _value(picked, creds)
                    command = f"await {locator}.selectOption({value});"
                else:
                    command = f"await {locator}.{action}();"
        elif action == "press":
            command = f"await page.keyboard.press({_js(inp)});"
        elif action in {"back", "forward", "reload"}:
            method = {"back": "goBack", "forward": "goForward", "reload": "reload"}[action]
            command = f"await page.{method}();"
        elif action == "eval":
            value = substitute(inp, creds)
            command = (f"// TODO: navigation eval: {_comment(value)}" if any(x in str(value) for x in ("${", "{unique}", "[REDACTED"))
                       else f"await page.evaluate({_js(value)});")
        elif action == "screenshot":
            command = "// screenshot: " + _comment(step.get("shot"))
        if command:
            lines.append("    " + command)
        for wait in str(step.get("wait") or "").split(";"):
            if wait.strip():
                check = _expect(wait.strip(), "check", last_locator)
                lines.append("    " + ("// wait: " + _comment(wait.strip()) if check.startswith("//") else check))
        for n, a in enumerate(assertions):
            if n not in consumed and step.get("assert") is not None and step["assert"] == a.get("claim"):
                assertion(a)
                consumed.add(n)
                break
    remaining = [a for n, a in enumerate(assertions) if n not in consumed]
    if remaining:
        lines.append("    // Assertions")
        for a in remaining:
            assertion(a)
    lines += ["  });", "});", ""]
    spec = path.with_name("spec.ts")
    tmp = spec.with_name("spec.ts.tmp")
    tmp.write_text("\n".join(lines))
    os.replace(tmp, spec)
    return spec


# -- finish + catalog ------------------------------------------------------------------------
def _slug(s) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def run_slug(journey: dict) -> str:
    ref, source = journey.get("ref") or {}, journey.get("source")
    if source == "prd-phase" and (ref.get("prd") or ref.get("phase") is not None):
        raw = f"{ref.get('prd') or 'prd'}-phase-{ref.get('phase')}"
    elif source == "pr-evidence" and ref.get("item") is not None:
        raw = f"{ref['pr']}-item-{ref['item']}" if ref.get("pr") else f"item-{ref['item']}"
    elif source == "test-plan" and ref.get("item") is not None:
        raw = f"{ref.get('plan') or 'plan'}-item-{ref['item']}"
    else:
        raw = str(journey.get("story") or "journey")[:40]
    return _slug(raw) or "journey"


def _index_line(journey: dict) -> dict:
    urls: list[str] = []
    for s in journey.get("steps") or []:
        u = s.get("url")
        if u and u not in urls:
            urls.append(u)
    return {"id": journey.get("id"), "app": journey.get("app"), "source": journey.get("source"),
            "ref": journey.get("ref"), "story": journey.get("story"), "result": journey.get("result"),
            "journey": journey.get("journey"), "steps": acting_steps(journey),
            "unresolved": sum(1 for s in journey.get("steps") or [] if s.get("unresolved")),
            "urls": urls, "finishedAt": journey.get("finishedAt")}


def catalog(journey: dict) -> Path:
    """Copy into <catalog>/<app>/<date>-<source>-<slug>[-N]/ and append the index line. The run dir
    is claimed inside the index lock, so two concurrent finishers never share a name."""
    root = catalog_root()
    app_dir = root / _slug(journey.get("app") or "app")
    app_dir.mkdir(parents=True, exist_ok=True)
    day = (journey.get("finishedAt") or _now())[:10]
    base = f"{day}-{journey.get('source') or 'adhoc'}-{run_slug(journey)}"
    with open(root / "index.jsonl", "a", encoding="utf-8") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            n, name = 1, base
            while True:
                try:
                    os.mkdir(app_dir / name)
                    break
                except FileExistsError:
                    n += 1
                    name = f"{base}-{n}"
            journey["id"] = f"{app_dir.name}/{name}"
            save(app_dir / name, journey)
            (app_dir / name / "scenario.md").write_text(render_scenario(journey))
            fh.write(json.dumps(_index_line(journey), ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)
    return app_dir / name


def _shown(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(wiki_root()))
    except ValueError:
        return str(path)


def finish_journey(d, *, result, notes=None, creds=None, unique=None) -> tuple[str, str, int]:
    """Close the journey, refuse a credential, write scenario.md, catalog it. Returns
    (catalog_dir, status, rc). Every result is cataloged — incomplete ones too (PRD-2 D7)."""
    d = Path(d)
    journey = load(d)
    journey["finishedAt"] = _now()
    journey["result"] = result
    if notes:
        journey["notes"] = "\n".join(x for x in [journey.get("notes"), notes] if x)
    creds = credential_values() if creds is None else creds
    for s in journey.get("steps") or []:
        for key in ("input", "picked", "url"):
            s[key] = substitute(s.get(key), creds, unique)
    for fixture in (journey.get("prerequisites") or {}).get("fixtures") or []:
        if isinstance(fixture, dict):
            for key in ("id", "name"):
                fixture[key] = substitute(fixture.get(key), creds, unique)
    bad = leaks(journey, creds)
    rc = 0
    journey.pop("reason", None)
    journey["actingSteps"] = acting_steps(journey)
    if bad:
        for s in journey["steps"]:
            if s.get("n") in bad:
                s["input"] = None
                s["picked"] = None
        journey["journey"], journey["reason"], rc = "incomplete", "credential-leak", 2
        print(f"journey: refused — credential in step {', '.join(map(str, bad))}", file=sys.stderr)
    elif journey["actingSteps"] < 1:
        journey["journey"], journey["reason"] = "incomplete", "no-steps"
    elif not [a for a in journey.get("assertions") or [] if isinstance(a, dict)]:
        journey["journey"], journey["reason"] = "incomplete", "no-assertion"
    else:
        journey["journey"] = "complete"
    save(d, journey)
    (d / "scenario.md").write_text(render_scenario(journey))
    out = catalog(journey)
    journey["catalog"] = _shown(out)    # repo-relative, so a Node reader never hardcodes the root
    save(d, journey)    # the in-run copy learns its catalog id and path
    (d / "scenario.md").write_text(render_scenario(journey))
    print(_shown(out))
    return str(out), journey["journey"], rc


# -- the agent-browser shim ------------------------------------------------------------------
def _binary() -> str | None:
    return os.environ.get("AGENT_BROWSER") or shutil.which("agent-browser")


def _split(args: list[str]) -> tuple[list[str], str | None, list[str]]:
    """(globals, command, rest). Global flag values (`--session S`) are never read as the command."""
    for i, a in enumerate(args):
        if a in COMMANDS:
            return args[:i], a, args[i + 1:]
    return args, None, []


def _snapshot_text(stdout: str, json_mode: bool) -> str:
    if json_mode:
        try:
            data = json.loads(stdout)
            return str((data.get("data") or {}).get("snapshot") or "")
        except (ValueError, AttributeError):
            return stdout
    return stdout


def _current_url(binary: str, globals_: list[str]) -> str | None:
    try:
        out = subprocess.run([binary, *globals_, "get", "url"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    text = out.stdout.strip()
    try:
        data = json.loads(text)
        d = data.get("data") if isinstance(data, dict) else None
        text = str((d.get("url") if isinstance(d, dict) else d) or text)
    except ValueError:
        pass
    return text.splitlines()[-1].strip() if text else None


def _record(d: Path, globals_: list[str], cmd: str, rest: list[str], rc: int, binary: str) -> None:
    if cmd == "snapshot":
        return
    positional = [a for a in rest if not a.startswith("-")]
    if cmd == "eval" and not NAV_EVAL.search(" ".join(rest)):
        return
    if cmd not in ACTING and cmd != "screenshot":
        return
    journey = load(d)
    action = "open" if cmd in ("goto", "navigate") else cmd
    steps = journey["steps"]
    step = {"n": len(steps) + 1, "url": None, "action": action, "locator": None, "raw": None,
            "input": None, "picked": None, "wait": None, "assert": None, "ok": rc == 0,
            "shot": None, "note": None}
    if action == "open":
        step["url"] = _path_of(positional[0]) if positional else None
    else:
        step["url"] = _path_of(_current_url(binary, globals_)) or (steps[-1]["url"] if steps else None)
    target_cmds = {"click", "dblclick", "fill", "type", "select", "check", "uncheck"}
    if cmd in target_cmds and positional:
        target = positional[0]
        step["raw"] = target
        if REF.fullmatch(target):
            try:
                refs = parse_refs((d / SCRATCH).read_text())
            except OSError:
                refs = {}
            info = refs.get(target) or refs.get(REF.fullmatch(target).group(1))
            if info:
                step["locator"] = {**info, "playwright": playwright_for(info["role"], info["name"],
                                                                         info["inIframe"])}
            else:
                step["unresolved"] = True
    creds = credential_values()
    if cmd in ("fill", "type") and len(positional) > 1:
        step["input"] = substitute(" ".join(positional[1:]), creds)
    elif cmd == "press" and positional:
        step["input"] = positional[0]
    elif cmd == "select" and len(positional) > 1:
        step["picked"] = substitute(positional[1:], creds)
    elif cmd == "eval" and positional:
        step["input"] = substitute(" ".join(positional), creds)
    elif cmd == "screenshot" and positional:
        step["shot"] = os.path.basename(positional[-1])
    steps.append(step)
    save(d, journey)


def cmd_ab(d: Path, args: list[str]) -> int:
    binary = _binary()
    if not binary:
        print("journey: agent-browser not found on PATH (set AGENT_BROWSER)", file=sys.stderr)
        return 127
    out = subprocess.run([binary, *args], capture_output=True)
    sys.stdout.buffer.write(out.stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(out.stderr)
    sys.stderr.buffer.flush()
    try:
        globals_, cmd, rest = _split(args)
        if cmd == "snapshot" and out.returncode == 0:
            text = _snapshot_text(out.stdout.decode("utf-8", "replace"), "--json" in globals_ + rest)
            (d / SCRATCH).write_text(text)
        elif cmd:
            _record(d, globals_, cmd, rest, out.returncode, binary)
    except Exception as e:  # noqa: BLE001 — the shim must never fail the wrapped command
        print(f"journey: not recorded: {type(e).__name__}: {e}", file=sys.stderr)
    return out.returncode


# -- CLI -------------------------------------------------------------------------------------
def _ref(raw: str | None) -> dict:
    out = {}
    for part in (raw or "").split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            v = v.strip()
            out[k.strip()] = int(v) if v.isdigit() else v
    return out


def _step(journey: dict, n: int | None) -> dict:
    steps = journey.get("steps") or []
    if not steps:
        raise SystemExit("journey: no step recorded yet")
    if n is None:
        return steps[-1]
    for s in steps:
        if s.get("n") == n:
            return s
    raise SystemExit(f"journey: no step {n}")


def _dir(value: str | None) -> Path:
    d = value or os.environ.get("JOURNEY_DIR")
    if not d:
        print("journey: no --dir and no JOURNEY_DIR", file=sys.stderr)
        raise SystemExit(2)
    return Path(d)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "ab":
        rest = argv[1:]
        dir_arg = None
        if len(rest) >= 2 and rest[0] == "--dir":
            dir_arg, rest = rest[1], rest[2:]
        return cmd_ab(_dir(dir_arg), rest)

    ap = argparse.ArgumentParser(prog="journey.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def p(name, **kw):
        sp = sub.add_parser(name, **kw)
        sp.add_argument("--dir", help="the journey directory (default: $JOURNEY_DIR)")
        return sp

    s = p("start")
    s.add_argument("--app", required=True)
    s.add_argument("--source", required=True, choices=["prd-phase", "pr-evidence", "test-plan", "adhoc"])
    s.add_argument("--ref", help="k=v,… (all-digit values become numbers)")
    s.add_argument("--story", required=True)
    s.add_argument("--criteria", action="append", default=[])
    s.add_argument("--engine", default="worker", choices=["worker", "nimble"])
    s.add_argument("--base-url")
    s.add_argument("--run-id")
    s.add_argument("--machine")
    sub.add_parser("ab", help="journey.py ab <agent-browser args…> — pass-through shim")
    n = p("note")
    n.add_argument("text")
    g = n.add_mutually_exclusive_group()
    g.add_argument("--step", type=int)
    g.add_argument("--journey", action="store_true")
    a = p("assert")
    a.add_argument("claim")
    ok = a.add_mutually_exclusive_group(required=True)
    ok.add_argument("--ok", dest="ok", action="store_true")
    ok.add_argument("--fail", dest="ok", action="store_false")
    a.add_argument("--judge", default="llm", choices=["check", "llm", "human"])
    a.add_argument("--step", type=int)
    fixture = p("fixture")
    fixture.add_argument("entity")
    fixture.add_argument("id")
    fixture.add_argument("--name")
    fixture.add_argument("--created", action="store_true")
    sh = p("shot")
    sh.add_argument("file")
    sh.add_argument("--step", type=int)
    w = p("wait")
    w.add_argument("text")
    w.add_argument("--step", type=int)
    f = p("finish")
    f.add_argument("--result", required=True, choices=["pass", "fail", "blocked"])
    f.add_argument("--notes")
    f.add_argument("--unique", help="per-run suffix to normalise to {unique}")
    r = p("render")
    r.add_argument("--out")
    export = sub.add_parser("export-playwright")
    export.add_argument("journey")
    args = ap.parse_args(argv)
    if args.cmd == "export-playwright":
        try:
            print(_shown(export_playwright(args.journey)))
            return 0
        except (OSError, ValueError) as error:
            print("journey: " + str(error).replace("\n", " ").replace("\r", " "), file=sys.stderr)
            # 2 = the journey was rejected (outside the catalog, missing, malformed); 1 = we failed to write it.
            return 2 if isinstance(error, ValueError) else 1
    d = _dir(args.dir)

    if args.cmd == "start":
        d.mkdir(parents=True, exist_ok=True)
        (d / SCRATCH).unlink(missing_ok=True)
        j = new_journey(app=args.app, source=args.source, ref=_ref(args.ref), story=args.story,
                        criteria=args.criteria, engine=args.engine, base_url=args.base_url,
                        run_id=args.run_id)
        j["prerequisites"]["machine"] = args.machine
        save(d, j)
        print(d)
        return 0
    if args.cmd == "finish":
        _, _, rc = finish_journey(d, result=args.result, notes=args.notes, unique=args.unique)
        return rc
    if args.cmd == "render":
        out = Path(args.out) if args.out else d / "scenario.md"
        out.write_text(render_scenario(load(d)))
        print(out)
        return 0

    j = load(d)
    if args.cmd == "fixture":
        creds = credential_values()
        add_fixture(j, fixture_entry(args.entity, substitute(args.id, creds),
                                     name=substitute(args.name, creds), created=args.created))
    elif args.cmd == "note":
        if args.journey:
            j["notes"] = "\n".join(x for x in [j.get("notes"), args.text] if x)
        else:
            _step(j, args.step)["note"] = args.text
    elif args.cmd == "assert":
        j.setdefault("assertions", []).append({"claim": args.claim, "judge": args.judge, "ok": args.ok})
        if j.get("steps"):
            _step(j, args.step)["assert"] = args.claim
    elif args.cmd == "shot":
        _step(j, args.step)["shot"] = os.path.basename(args.file)
    elif args.cmd == "wait":
        _step(j, args.step)["wait"] = args.text
    save(d, j)
    return 0


if __name__ == "__main__":
    sys.exit(main())
