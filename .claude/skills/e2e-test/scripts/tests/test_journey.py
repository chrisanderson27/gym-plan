import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "journey.py"
FIXTURE = (Path(__file__).resolve().parents[3] / "e2e-test-orchestrator" / "pilot" / "tests"
           / "fixtures" / "delivery_ticket.txt")

# Tests must never write the tracked catalog: point it at a temp dir before anything runs.
CATALOG = tempfile.mkdtemp(prefix="journey-catalog-")
os.environ["JOURNEY_CATALOG"] = CATALOG

SPEC = importlib.util.spec_from_file_location("journey", SCRIPT)
journey = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(journey)


def tearDownModule():
    shutil.rmtree(CATALOG, ignore_errors=True)


FAKE = """#!/bin/sh
echo "$@" >> "{log}"
for a in "$@"; do
  case "$a" in FAILME) echo "boom" >&2; exit 1;; esac
done
for a in "$@"; do
  case "$a" in
    snapshot) cat "{snap}"; exit 0;;
    get) echo "http://localhost:5000/open-orders"; exit 0;;
  esac
done
echo ok
"""

IFRAME_SNAPSHOT = """- main
  - button "Outer" [ref=e1]
- Iframe [ref=e2]
  - button "Inner Save" [ref=e3]
"""


class JourneyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.dir = self.tmp / "run"
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        self.snap = self.tmp / "snap.txt"
        self.snap.write_text(FIXTURE.read_text())
        self.log = self.tmp / "argv.log"
        fake = bin_dir / "agent-browser"
        fake.write_text(FAKE.format(log=self.log, snap=self.snap))
        fake.chmod(0o755)
        self.env = {k: v for k, v in os.environ.items()
                    if k not in ("AGENT_BROWSER", "JOURNEY_DIR", "JOURNEY_UNIQUE")}
        self.env.update({"PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
                         "JOURNEY_DIR": str(self.dir), "JOURNEY_CATALOG": CATALOG})
        self.app = f"t{id(self)}"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def j(self, *args, env=None, cwd=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                              env=env or self.env, cwd=cwd or self.tmp)

    def start(self, **over):
        ref = over.get("ref", "prd=my-prd,phase=3")
        r = self.j("start", "--app", self.app, "--source", over.get("source", "prd-phase"),
                   "--ref", ref, "--story", over.get("story", "Delivery ticket prints"),
                   "--criteria", "Ticket prints", "--base-url", "http://localhost:5000")
        self.assertEqual(0, r.returncode, r.stderr)

    def steps(self):
        return json.loads((self.dir / "journey.json").read_text())["steps"]

    def index(self):
        p = Path(CATALOG) / "index.jsonl"
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []

    def mine(self):
        return [r for r in self.index() if r["app"] == self.app]

    def test_start_writes_schema_one(self):
        self.start()
        data = json.loads((self.dir / "journey.json").read_text())
        self.assertEqual(1, data["schema"])
        self.assertEqual({"prd": "my-prd", "phase": 3}, data["ref"])
        self.assertEqual([], data["steps"])

    def test_click_resolves_ref_and_passes_through(self):
        self.start()
        self.j("ab", "--session", "S", "snapshot", "-i")
        r = self.j("ab", "--session", "S", "click", "@e8")
        self.assertEqual(0, r.returncode)
        self.assertEqual("ok\n", r.stdout)
        step = self.steps()[0]
        self.assertEqual("button", step["locator"]["role"])
        self.assertEqual("Delivery Ticket", step["locator"]["name"])
        self.assertEqual("getByRole('button', { name: 'Delivery Ticket' })", step["locator"]["playwright"])
        self.assertEqual("/open-orders", step["url"])
        self.assertIn("--session S click @e8", self.log.read_text())

    def test_unknown_ref_is_unresolved(self):
        self.start()
        self.j("ab", "snapshot")
        self.j("ab", "click", "@e999")
        step = self.steps()[0]
        self.assertIsNone(step["locator"])
        self.assertEqual("@e999", step["raw"])
        self.assertTrue(step["unresolved"])

    def test_iframe_ref(self):
        self.snap.write_text(IFRAME_SNAPSHOT)
        self.start()
        self.j("ab", "snapshot")
        self.j("ab", "click", "@e3")
        loc = self.steps()[0]["locator"]
        self.assertTrue(loc["inIframe"])
        self.assertTrue(loc["playwright"].startswith("frameLocator('iframe')."))

    def test_failure_propagates(self):
        self.start()
        r = self.j("ab", "click", "@e8", "FAILME")
        self.assertEqual(1, r.returncode)
        self.assertFalse(self.steps()[0]["ok"])

    def test_credential_substituted_at_record_time(self):
        env = dict(self.env, E2E_PASS="s3cretPass9")
        self.start()
        self.j("ab", "snapshot", env=env)
        self.j("ab", "fill", "@e4", "s3cretPass9", env=env)
        self.assertEqual("${E2E_PASS}", self.steps()[0]["input"])
        for p in self.dir.rglob("*"):
            if p.is_file():
                self.assertNotIn("s3cretPass9", p.read_text(errors="replace"))

    def test_finish_refuses_a_leaked_credential(self):
        env = dict(self.env, E2E_PASS="s3cretPass9")
        self.start()
        self.j("ab", "snapshot", env=env)
        self.j("ab", "fill", "@e4", "harmless", env=env)
        data = json.loads((self.dir / "journey.json").read_text())
        data["steps"][0]["input"] = "xx s3cretPass9"
        (self.dir / "journey.json").write_text(json.dumps(data))
        os.environ["E2E_PASS"] = "s3cretPass9"
        try:
            creds = {"E2E_PASS": ["s3cretPass9"]}
            # substitution would fix it; disable the backstop substitution to prove the refusal
            orig = journey.substitute
            journey.substitute = lambda text, creds, unique=None: text
            err = io.StringIO()
            try:
                with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                    out, status, rc = journey.finish_journey(self.dir, result="pass", creds=creds)
            finally:
                journey.substitute = orig
        finally:
            os.environ.pop("E2E_PASS", None)
        self.assertEqual(2, rc)
        self.assertIn("step 1", err.getvalue())
        self.assertNotIn("s3cretPass9", err.getvalue())
        self.assertEqual("incomplete", status)
        cat = json.loads((Path(out) / "journey.json").read_text())
        self.assertEqual("credential-leak", cat["reason"])
        self.assertIsNone(cat["steps"][0]["input"])
        self.assertNotIn("s3cretPass9", (Path(out) / "journey.json").read_text())

    def test_zero_acting_steps_is_incomplete(self):
        self.start()
        self.j("ab", "snapshot")
        r = self.j("finish", "--result", "blocked")
        self.assertEqual(0, r.returncode, r.stderr)
        data = json.loads((self.dir / "journey.json").read_text())
        self.assertEqual("incomplete", data["journey"])
        self.assertEqual("no-steps", data["reason"])
        self.assertEqual(0, data["actingSteps"])
        self.assertEqual(1, len(self.mine()))

    def test_finish_persists_acting_steps_and_catalog_path(self):
        self.start()
        self.j("ab", "click", "@e8")
        self.j("ab", "screenshot", str(self.tmp / "a.png"))
        self.j("assert", "row moved", "--ok")
        r = self.j("finish", "--result", "pass")
        self.assertEqual(0, r.returncode, r.stderr)
        data = json.loads((self.dir / "journey.json").read_text())
        self.assertEqual(1, data["actingSteps"])
        self.assertEqual("complete", data["journey"])
        self.assertEqual(r.stdout.strip(), data["catalog"])
        self.assertTrue(data["catalog"].endswith(data["id"]))
        self.assertEqual(1, self.mine()[0]["steps"])

    def test_acting_is_one_definition(self):
        sys.path.insert(0, str(SCRIPT.parent))
        import journey
        self.assertFalse(hasattr(journey, "NOT_ACTING"))
        self.assertEqual(1, journey.acting_steps({"steps": [
            {"action": "click"}, {"action": "screenshot"}, {"action": "wait"}]}))

    def test_fixture_lands_in_prerequisites(self):
        self.start()
        for args in [("customer", "4092", "--name", "KING"),
                     ("work-order", "1834", "--created"), ("customer", "4092", "--created")]:
            r = self.j("fixture", *args)
            self.assertEqual(0, r.returncode, r.stderr)
        self.assertEqual([
            {"entity": "customer", "id": "4092", "name": "KING", "created": True},
            {"entity": "work-order", "id": "1834", "name": None, "created": True},
        ], journey.load(self.dir)["prerequisites"]["fixtures"])

    def test_fixture_credential_is_substituted(self):
        self.start()
        env = dict(self.env, E2E_PASS="s3cretPass9")
        r = self.j("fixture", "login", "s3cretPass9", "--name", "s3cretPass9", env=env)
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertEqual("${E2E_PASS}", journey.load(self.dir)["prerequisites"]["fixtures"][0]["id"])
        for p in self.dir.rglob("*"):
            if p.is_file():
                self.assertNotIn("s3cretPass9", p.read_text(errors="replace"))

    def test_finish_substitutes_fixture_values(self):
        self.start()
        data = journey.load(self.dir)
        data["prerequisites"]["fixtures"] = [journey.fixture_entry("login", "s3cretPass9", name="Order 123456")]
        journey.save(self.dir, data)
        r = self.j("finish", "--result", "blocked", "--unique", "123456", env=dict(self.env, E2E_PASS="s3cretPass9"))
        self.assertEqual(0, r.returncode, r.stderr)
        fixture = journey.load(self.dir)["prerequisites"]["fixtures"][0]
        self.assertEqual("${E2E_PASS}", fixture["id"])
        self.assertEqual("Order {unique}", fixture["name"])

    def test_no_assertion_is_incomplete_with_result_untouched(self):
        self.start()
        self.j("ab", "click", "@e8")
        r = self.j("finish", "--result", "pass")
        self.assertEqual(0, r.returncode, r.stderr)
        data = journey.load(self.dir)
        self.assertEqual(("incomplete", "no-assertion", "pass"),
                         (data["journey"], data["reason"], data["result"]))
        self.assertEqual(1, len(self.mine()))

    def test_reason_precedence(self):
        self.start()
        self.j("ab", "screenshot", str(self.tmp / "a.png"))
        r = self.j("finish", "--result", "pass")
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertEqual("no-steps", journey.load(self.dir)["reason"])

    def _catalog_dir(self, app="app", hints=None):
        target = Path(CATALOG) / app / self.tmp.name
        target.mkdir(parents=True)
        if hints is not None:
            shutil.copyfile(hints, target.parent / "playwright.json")
        self.addCleanup(shutil.rmtree, target.parent, True)
        return target

    def test_export_playwright_matches_golden(self):
        fixture = SCRIPT.parent / "tests/fixtures/sample-journey"
        # The RBCloud hints come from the tracked per-app catalog file, not from the skill.
        target = self._catalog_dir("rbcloud", hints=SCRIPT.parents[3] / "e2e/journeys/rbcloud/playwright.json")
        shutil.copyfile(fixture / "journey.json", target / "journey.json")
        env = {k: v for k, v in self.env.items() if k != "JOURNEY_DIR"}
        r = self.j("export-playwright", str(target / "journey.json"), env=env)
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertTrue(r.stdout.strip().endswith("spec.ts"))
        spec = (target / "spec.ts").read_text()
        self.assertEqual((fixture / "expected.spec.ts").read_text(), spec)
        self.assertNotIn("worker", spec)
        self.assertNotIn("engine", spec)
        self.assertIn("process.env.E2E_PASS", spec)

    def test_export_playwright_old_journey(self):
        target = self._catalog_dir()
        path = target / "journey.json"
        path.write_text(json.dumps({"schema": 1, "prerequisites": {"fixtures": []},
                                    "steps": [{"action": "open", "input": "https://example.test/home"}]}))
        r = self.j("export-playwright", str(path))
        self.assertEqual(0, r.returncode, r.stderr)
        spec = (target / "spec.ts").read_text()
        self.assertIn("(none recorded)", spec)
        self.assertIn("page.goto('/home')", spec)
        self.assertIn("// Move to: the app's Playwright test folder.", spec)   # no playwright.json for this app

    def test_export_playwright_rejects_bad_input(self):
        path = self._catalog_dir() / "journey.json"
        self.assertEqual(2, self.j("export-playwright", str(path)).returncode)
        for data in ({"schema": 2}, [], "broken"):
            path.write_text(json.dumps(data))
            self.assertEqual(2, self.j("export-playwright", str(path)).returncode)
            self.assertFalse((path.parent / "spec.ts").exists())

    def test_export_playwright_only_inside_the_catalog(self):
        good = json.dumps({"schema": 1, "steps": []})
        outside = self.tmp / "journey.json"
        outside.write_text(good)
        self.assertEqual(2, self.j("export-playwright", str(outside)).returncode)
        self.assertFalse((self.tmp / "spec.ts").exists())
        # A symlinked app dir that resolves outside the catalog is refused too.
        real = self.tmp / "elsewhere" / "id"
        real.mkdir(parents=True)
        (real / "journey.json").write_text(good)
        link = Path(CATALOG) / f"escape-{self.tmp.name}"
        link.symlink_to(self.tmp / "elsewhere")
        self.addCleanup(link.unlink)
        r = self.j("export-playwright", str(link / "id" / "journey.json"))
        self.assertEqual(2, r.returncode)
        self.assertIn("inside the catalog", r.stderr)
        self.assertFalse((real / "spec.ts").exists())

    def test_export_write_failure_is_not_a_rejected_input(self):
        target = self._catalog_dir()
        (target / "journey.json").write_text(json.dumps({"schema": 1, "steps": []}))
        (target / "spec.ts").mkdir()                       # the spec cannot be written over a directory
        self.assertEqual(1, self.j("export-playwright", str(target / "journey.json")).returncode)

    def test_export_hints_are_read_from_the_app_catalog_dir(self):
        target = self._catalog_dir("someapp")
        (target.parent / "playwright.json").write_text(json.dumps({"folder": "e2e/specs/", "note": "Sign in\nonce."}))
        (target / "journey.json").write_text(json.dumps({"schema": 1, "steps": []}))
        self.assertEqual(0, self.j("export-playwright", str(target / "journey.json")).returncode)
        self.assertIn("// Move to: e2e/specs/. Sign in once.", (target / "spec.ts").read_text())

    def test_export_values_escape_untrusted_interpolation(self):
        self.assertEqual("`Order ${unique} \\${danger()}`", journey._value("Order {unique} ${danger()}", {}))
        self.assertEqual("'' /* TODO: redacted value */", journey._value("[REDACTED: secret]", {}))
        self.assertEqual("'a\\n\\'b`'", journey._js("a\n'b`"))
        self.assertEqual("x\\ny\\'z", journey._q("x\ny'z"))          # locators escape line breaks too
        self.assertEqual("`a\\`b\\n`", "`" + journey._escape_js("a`b\n", "`") + "`")

    def test_catalog_layout_and_collision(self):
        self.start()
        self.j("ab", "snapshot")
        self.j("ab", "click", "@e8")
        self.j("ab", "click", "@e999")
        self.assertEqual(0, self.j("finish", "--result", "pass").returncode)
        rows = self.mine()
        self.assertEqual(1, len(rows))
        cat = Path(CATALOG) / rows[0]["id"]
        self.assertRegex(cat.name, r"^\d{4}-\d{2}-\d{2}-prd-phase-my-prd-phase-3$")
        self.assertEqual({"journey.json", "scenario.md"}, {p.name for p in cat.iterdir()})
        self.assertEqual(["/open-orders"], rows[0]["urls"])
        self.assertEqual(2, rows[0]["steps"])
        self.assertEqual(1, rows[0]["unresolved"])
        self.start()
        self.j("ab", "click", "@e8")
        self.j("finish", "--result", "pass")
        rows = self.mine()
        self.assertEqual(2, len(rows))
        self.assertTrue(rows[1]["id"].endswith("-2"))

    def test_concurrent_finishers(self):
        dirs = []
        for i in range(4):
            d = self.tmp / f"run{i}"
            env = dict(self.env, JOURNEY_DIR=str(d))
            self.j("start", "--app", self.app, "--source", "adhoc", "--story", "same story", env=env)
            self.j("ab", "click", "@e8", env=env)
            dirs.append(env)
        procs = [subprocess.Popen([sys.executable, str(SCRIPT), "finish", "--result", "pass"],
                                  env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for e in dirs]
        for p in procs:
            p.communicate()
            self.assertEqual(0, p.returncode)
        rows = self.mine()
        self.assertEqual(4, len(rows))
        self.assertEqual(4, len({r["id"] for r in rows}))

    def test_render_has_steps_and_no_engine(self):
        self.start()
        self.j("ab", "snapshot")
        self.j("ab", "fill", "@e4", "KING")
        r = self.j("render")
        self.assertEqual(0, r.returncode, r.stderr)
        text = (self.dir / "scenario.md").read_text()
        self.assertIn("## Steps", text)
        self.assertIn("KING", text)
        self.assertNotIn("engine", text.lower())
        self.assertNotIn("nimble", text.lower())

    def test_no_dir_exits_two(self):
        env = {k: v for k, v in self.env.items() if k != "JOURNEY_DIR"}
        self.assertEqual(2, self.j("note", "x", env=env).returncode)
        self.assertEqual(2, self.j("ab", "click", "@e1", env=env).returncode)

    def test_literal_kept_in_catalog(self):
        self.start()
        self.j("ab", "snapshot")
        self.j("ab", "fill", "@e4", "KING")
        self.j("finish", "--result", "pass")
        cat = Path(CATALOG) / self.mine()[0]["id"] / "journey.json"
        self.assertEqual("KING", json.loads(cat.read_text())["steps"][0]["input"])

    def test_json_snapshot_and_note_assert(self):
        self.snap.write_text(json.dumps({"data": {"snapshot": FIXTURE.read_text()}}))
        self.start()
        self.j("ab", "--json", "snapshot")
        self.j("ab", "click", "@e8")
        self.j("note", "opened the dialog")
        self.j("assert", "dialog shows", "--ok")
        data = json.loads((self.dir / "journey.json").read_text())
        self.assertEqual("Delivery Ticket", data["steps"][0]["locator"]["name"])
        self.assertEqual("opened the dialog", data["steps"][0]["note"])
        self.assertEqual("dialog shows", data["assertions"][0]["claim"])


if __name__ == "__main__":
    unittest.main()
