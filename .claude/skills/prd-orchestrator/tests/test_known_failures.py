"""A failure baseline accepts known names, never crashes or unmatched output."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import tempfile
import tomllib
import unittest
from unittest import mock

SCRIPT = Path(__file__).parents[1] / "scripts/orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)
PATTERN = r"^✖ (?!failing tests:$)(.+?)(?: \(\d[\d.]*ms\))?$"


class KnownFailuresTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".claude").mkdir()
        self.sd = self.root / ".agents/orchestrator"
        (self.sd / "known-failures").mkdir(parents=True)
        patch = mock.patch.dict(os.environ)
        patch.start()
        self.addCleanup(patch.stop)
        for key in list(os.environ):
            if key.startswith("ORCH_"):
                os.environ.pop(key)

    def config(self, output="✖ known one (1.2ms)\n", rc=1, pattern=PATTERN, configured=None, more=None):
        cmd = "printf %s " + shlex.quote(output) + f"; exit {rc}"
        level = {"name": "unit", "cmd": cmd, "failure_pattern": pattern}
        if configured:
            level["known_failures"] = configured
        levels = [level] + (more or [])
        body = '[validation]\nlevels = [' + ", ".join(
            '{' + ", ".join(f"{key} = {json.dumps(value, ensure_ascii=False)}" for key, value in lv.items()) + '}'
            for lv in levels) + ']\n'
        (self.root / ".claude/orchestrator.toml").write_text(body)

    def seed(self, text="# baseline\nknown one\nknown two\n"):
        (self.sd / "known-failures/unit.txt").write_text(text)

    def verify(self, keep=False):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = orchestrator.cmd_verify(argparse.Namespace(root=str(self.root), phase=1, keep_going=keep))
        rec = json.loads((self.sd / "phase-1/verify.json").read_text())
        return rc, rec, out.getvalue()

    def test_real_file_pattern_normalizes_failures_and_excludes_recap(self):
        root = Path(__file__).parents[4]
        path = root / ".planning/workbench-prd-queue/testing/known-failures-prd-3-parked.txt"
        if not path.exists():
            self.skipTest("portable checkout has no baseline fixture")
        with (root / ".claude/orchestrator.toml").open('rb') as stream:
            level = next(lv for lv in tomllib.load(stream)["validation"]["levels"] if lv["name"] == "tests")
        compiled = re.compile(level["failure_pattern"], re.MULTILINE)
        self.assertEqual(level["failure_pattern"], PATTERN)
        names = []
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            match = compiled.fullmatch(line)
            if line == "✖ failing tests:":
                self.assertIsNone(match)
                continue
            self.assertIsNotNone(match, line)
            name = match.group(1)
            self.assertFalse(name.startswith("✖ "))
            self.assertNotRegex(name, r"\(\d[\d.]*ms\)$")
            names.append(name)
        self.assertEqual(len(names), 49)
        self.assertNotIn("failing tests:", names)

    def test_baseline_only_deduplicates_and_passes(self):
        self.seed()
        self.config("  ✖ known one (1ms)\n✖ known one (1.2ms)\n✖ known two (1.2ms)\n"
                    "✖ known one (1.2ms)\n✖ failing tests:\n")
        rc, rec, out = self.verify()
        self.assertEqual(rc, 0)
        lv = rec["levels"][0]
        self.assertEqual(lv["result"], "pass")
        self.assertEqual(lv["baseline"], "2 known, 0 new")
        self.assertEqual(lv["returncode"], 1)
        self.assertIn("baseline [unit]: 2 known, 0 new", out)
        self.assertTrue(orchestrator.validate_verify(str(self.root),
                        {"validation": {"levels": [{}]}}, 1)[0])

    def test_two_known_names_deduplicate(self):
        self.seed()
        self.config("  ✖ known one (1ms)\n✖ known one (1.2ms)\n✖ known two (1.2ms)\n✖ known two (1.2ms)\n")
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 0)
        self.assertEqual(rec["levels"][0]["baseline"], "2 known, 0 new")

    def test_one_new_failure_fails(self):
        self.seed()
        self.config("✖ known one (1.2ms)\n✖ new one (1.2ms)\n")
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 2)
        self.assertEqual(rec["levels"][0]["baseline"], "1 known, 1 new")
        self.assertEqual(rec["levels"][0]["new_failures"], ["new one"])

    def test_zero_matches_nonzero_fails(self):
        self.seed()
        self.config("boom\n", rc=2)
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 2)
        self.assertEqual(rec["levels"][0]["baseline"], "0 known, 0 new")
        self.assertEqual(rec["levels"][0]["result"], "fail")

    def test_recap_alone_cannot_pass_a_red_level(self):
        self.seed()
        self.config("✖ failing tests:\n")
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 2)
        self.assertEqual(rec["levels"][0]["baseline"], "0 known, 0 new")

    def test_known_node_failure_still_runs_web_and_propagates_its_result(self):
        config = Path(__file__).parents[4] / ".claude/orchestrator.toml"
        if not config.exists():
            self.skipTest("portable checkout has no validation config")
        with config.open("rb") as stream:
            levels = [lv for lv in tomllib.load(stream)["validation"]["levels"]
                      if lv["name"] in ("tests", "web-tests")]
        commands = self.root / "bin"
        commands.mkdir()
        (self.root / "workbench/test").mkdir(parents=True)
        (self.root / "workbench/test/unit.test.mjs").touch()
        node = commands / "node"
        node.write_text("#!/bin/sh\nprintf '✖ known one (1ms)\\n'\nexit 1\n")
        node.chmod(0o755)
        (self.sd / "known-failures/tests.txt").write_text("known one\n")
        body = '[validation]\nlevels = [' + ", ".join(
            '{' + ", ".join(f"{key} = {json.dumps(value, ensure_ascii=False)}" for key, value in lv.items()) + '}'
            for lv in levels) + ']\n'
        (self.root / ".claude/orchestrator.toml").write_text(body)
        npm = commands / "npm"
        marker = self.root / "workbench/web-ran"
        for web_rc in (0, 1):
            with self.subTest(web_rc=web_rc):
                marker.unlink(missing_ok=True)
                npm.write_text(f"#!/bin/sh\ntouch web-ran\nexit {web_rc}\n")
                npm.chmod(0o755)
                with mock.patch.dict(os.environ, {"PATH": str(commands) + os.pathsep + os.environ["PATH"]}):
                    rc, rec, _ = self.verify()
                self.assertTrue(marker.exists(), "web suite must run after known node failures")
                self.assertEqual(rc, 0 if web_rc == 0 else 2)
                self.assertEqual(rec["levels"][0]["baseline"], "1 known, 0 new")
                self.assertEqual(rec["levels"][-1]["result"], "pass" if web_rc == 0 else "fail")

    def test_clean_exit_has_no_note(self):
        self.seed()
        self.config("all passed\n", rc=0)
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 0)
        self.assertNotIn("baseline", rec["levels"][0])

    def test_state_seed_wins(self):
        self.seed()
        (self.root / "baseline.txt").write_text("different name\n")
        self.config(configured="baseline.txt")
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 0)
        self.assertEqual(rec["levels"][0]["known_failures"], ".agents/orchestrator/known-failures/unit.txt")

    def test_configured_baseline_used_without_seed(self):
        (self.root / "baseline.txt").write_text("✖ known one\n")
        self.config(configured="baseline.txt")
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 0)
        self.assertEqual(rec["levels"][0]["known_failures"], "baseline.txt")

    def test_pattern_without_baseline_keeps_returncode_behavior(self):
        self.config()
        rc, rec, _ = self.verify()
        self.assertEqual(rc, 2)
        self.assertNotIn("baseline", rec["levels"][0])

    def test_invalid_patterns_fail_verify_and_config(self):
        self.seed()
        for pattern in ("(a)(b)", "["):
            with self.subTest(pattern=pattern):
                self.config(pattern=pattern)
                rc, rec, _ = self.verify()
                self.assertEqual(rc, 2)
                self.assertTrue(rec["levels"][0]["baseline"].startswith("invalid failure_pattern"))
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    self.assertEqual(orchestrator.cmd_config(argparse.Namespace(root=str(self.root), check=True)), 1)
                self.assertIn("invalid failure_pattern", out.getvalue())

    def test_keep_going_runs_later_level_after_new_failure(self):
        self.seed()
        self.config("✖ new one\n", more=[{"name": "later", "cmd": "true"}])
        rc, rec, _ = self.verify(keep=True)
        self.assertEqual(rc, 2)
        self.assertEqual([lv["result"] for lv in rec["levels"]], ["fail", "pass"])
