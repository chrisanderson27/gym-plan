import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class E2eGateGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        (self.root / ".claude").mkdir()
        (self.root / ".claude" / "orchestrator.toml").write_text(
            '[validation]\nlevels = [{ name = "unit", cmd = "true" }]\n')
        self.sd = self.root / ".agents" / "orchestrator"
        self.sd.mkdir(parents=True)

    def log(self, event, phase=None, detail=None):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            rc = orchestrator.cmd_log(argparse.Namespace(
                root=str(self.root), event=event, phase=phase, stage=None, detail=detail,
                sha=None, duration_s=None))
        return rc, err.getvalue()

    def test_e2e_na_rejects_license_and_sign_in_reasons(self):
        for reason in ("Machine License gate blocks sign-in", "app unavailable", "could not log in", ""):
            rc, err = self.log("e2e_na", 1, reason)
            self.assertEqual(rc, 2, reason)
            self.assertIn("NOT", err)

    def test_e2e_na_accepts_a_real_reason(self):
        rc, _ = self.log("e2e_na", 1, "backend-only change, no UI surface")
        self.assertEqual(rc, 0)

    def test_run_end_completed_needs_an_e2e_decision_per_committed_phase(self):
        self.log("run_start")
        self.log("commit", 1)
        self.log("commit", 2)
        self.log("e2e_pass", 1)
        rc, err = self.log("run_end", detail="completed")
        self.assertEqual(rc, 2)
        self.assertIn("phase(s) 2", err)
        self.log("e2e_na", 2, "backend-only change, no UI surface")
        self.assertEqual(self.log("run_end", detail="completed")[0], 0)

    def test_run_end_partial_is_never_refused(self):
        self.log("run_start")
        self.log("commit", 1)
        self.assertEqual(self.log("run_end", detail="partial")[0], 0)

    def test_roster_resolves_from_the_main_clone_for_a_worktree(self):
        rel = Path(".claude/skills/e2e-test-orchestrator/machines.md")
        (self.root / rel).parent.mkdir(parents=True)
        (self.root / rel).write_text("roster")
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q",
                        "--allow-empty", "-m", "i"], cwd=self.root, check=True)
        wt = Path(self.temp.name + "-wt")
        subprocess.run(["git", "worktree", "add", "-q", str(wt)], cwd=self.root, check=True)
        self.addCleanup(lambda: subprocess.run(
            ["git", "worktree", "remove", "--force", str(wt)], cwd=self.root))
        self.assertEqual(Path(orchestrator._e2e_roster_path(str(wt))).resolve(),
                         (self.root / rel).resolve())


if __name__ == "__main__":
    unittest.main()
