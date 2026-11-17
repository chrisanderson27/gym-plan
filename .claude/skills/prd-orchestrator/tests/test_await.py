import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class AwaitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        (self.root / ".claude").mkdir()
        (self.root / ".claude" / "orchestrator.toml").write_text(
            '[validation]\nlevels = [{ name = "unit", cmd = "true" }]\n')
        (self.root / ".agents" / "orchestrator").mkdir(parents=True)
        self.status = "working"
        orig = orchestrator._agent_status
        orchestrator._agent_status = lambda pane: self.status
        self.addCleanup(setattr, orchestrator, "_agent_status", orig)

    def run_await(self, **kw):
        args = argparse.Namespace(root=str(self.root), pane="p1", artifact=[str(self.root / "out.md")],
                                  since=0.0, timeout_s=3, idle_grace_s=0.2, blocked_grace_s=0.2, settle=False, settle_s=0.1, poll_s=0.05)
        for k, v in kw.items():
            setattr(args, k, v)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = orchestrator.cmd_await(args)
        return rc, json.loads(buf.getvalue())

    def test_artifact_wins_even_while_worker_still_reports_working(self):
        (self.root / "out.md").write_text("plan")
        rc, out = self.run_await()
        self.assertEqual((rc, out["reason"]), (0, "artifact"))

    def test_settle_waits_for_idle_after_early_artifact(self):
        (self.root / "out.md").write_text("first pass")
        self.status = "working"
        self.assertEqual(self.run_await(settle=True, timeout_s=0.3)[1]["reason"], "timeout")
        self.status = "idle"
        rc, out = self.run_await(settle=True)
        self.assertEqual((rc, out["reason"]), (0, "artifact"))

    def test_stale_artifact_before_dispatch_does_not_count(self):
        f = self.root / "out.md"
        f.write_text("old")
        rc, out = self.run_await(since=time.time() + 100, timeout_s=0.3)
        self.assertEqual(out["reason"], "timeout")

    def test_empty_artifact_does_not_count(self):
        (self.root / "out.md").write_text("")
        rc, out = self.run_await(timeout_s=0.3)
        self.assertEqual(out["reason"], "timeout")

    def test_idle_without_artifact_is_typed(self):
        self.status = "idle"
        rc, out = self.run_await()
        self.assertEqual((rc, out["reason"]), (3, "idle-no-artifact"))

    def test_blocked_and_pane_gone(self):
        self.status = "blocked"
        self.assertEqual(self.run_await()[0], 4)
        self.assertEqual(self.run_await(blocked_grace_s=99, timeout_s=0.3)[1]["reason"], "timeout")
        self.status = None
        self.assertEqual(self.run_await()[0], 6)

    def test_gate_failed_marker_counts_only_once_worker_is_idle(self):
        sd = self.root / ".agents" / "orchestrator"
        (sd / "GATE-FAILED-builder-1").write_text("x")
        self.status = "working"
        self.assertEqual(self.run_await(timeout_s=0.3)[1]["reason"], "timeout")
        self.status = "idle"
        rc, out = self.run_await()
        self.assertEqual((rc, out["reason"]), (7, "gate-failed"))


if __name__ == "__main__":
    unittest.main()
