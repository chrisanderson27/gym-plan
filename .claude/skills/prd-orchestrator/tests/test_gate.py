import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


TOML_OK = '[validation]\nlevels = [{ name = "unit", cmd = "true" }]\n'
TOML_FAIL = '[validation]\nlevels = [{ name = "unit", cmd = "false" }]\n'
RUN_MD = (
    "# RUN\n\n"
    "| # | Phase | Plan | Status |\n"
    "|---|---|---|---|\n"
    "| 1 | the thing | plan.md | pending |\n"
)


def ns(root, **kw):
    return argparse.Namespace(root=str(root), **kw)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".claude").mkdir()
        self.sd = self.root / ".agents" / "orchestrator"
        (self.sd / "phase-1").mkdir(parents=True)

    def write_config(self, body):
        (self.root / ".claude" / "orchestrator.toml").write_text(body)

    def write_run(self):
        (self.sd / "RUN.md").write_text(RUN_MD)


class VerifyTests(Base):
    def test_verify_writes_green_json_and_exits_zero(self):
        self.write_config(TOML_OK)
        rc = orchestrator.cmd_verify(ns(self.root, phase=1, keep_going=False))
        self.assertEqual(0, rc)
        rec = json.loads((self.sd / "phase-1" / "verify.json").read_text())
        self.assertEqual("pass", rec["result"])
        self.assertEqual("pass", rec["levels"][0]["result"])

    def test_verify_records_failure_and_exits_two(self):
        self.write_config(TOML_FAIL)
        rc = orchestrator.cmd_verify(ns(self.root, phase=1, keep_going=False))
        self.assertEqual(2, rc)
        rec = json.loads((self.sd / "phase-1" / "verify.json").read_text())
        self.assertEqual("fail", rec["result"])

    def test_validate_verify_requires_green_json_when_levels_exist(self):
        cfg = {"validation": {"levels": [{"name": "unit", "cmd": "true"}]}}
        ok, why = orchestrator.validate_verify(str(self.root), cfg, 1)
        self.assertFalse(ok)                      # no verify.json yet
        self.assertIn("missing verify.json", why)

    def test_validate_verify_is_na_without_levels(self):
        ok, why = orchestrator.validate_verify(str(self.root), {"validation": {"levels": []}}, 1)
        self.assertTrue(ok)
        self.assertIn("N/A", why)


class GateTests(Base):
    def test_gate_passes_and_writes_token_on_green_verify_only_phase(self):
        self.write_config(TOML_OK)
        orchestrator.cmd_verify(ns(self.root, phase=1, keep_going=False))
        rc = orchestrator.cmd_gate(ns(self.root, phase=1, prd=None))
        self.assertEqual(0, rc)
        token = json.loads((self.sd / "phase-1" / ".gate-pass").read_text())
        self.assertEqual("pass", token["result"])

    def test_gate_fails_and_leaves_no_token_on_red_verify(self):
        self.write_config(TOML_FAIL)
        orchestrator.cmd_verify(ns(self.root, phase=1, keep_going=False))
        rc = orchestrator.cmd_gate(ns(self.root, phase=1, prd=None))
        self.assertEqual(2, rc)
        self.assertFalse((self.sd / "phase-1" / ".gate-pass").exists())

    def test_gate_removes_a_stale_pass_when_it_now_fails(self):
        self.write_config(TOML_FAIL)
        (self.sd / "phase-1" / ".gate-pass").write_text('{"result":"pass"}')
        orchestrator.cmd_verify(ns(self.root, phase=1, keep_going=False))
        orchestrator.cmd_gate(ns(self.root, phase=1, prd=None))
        self.assertFalse((self.sd / "phase-1" / ".gate-pass").exists())


class PreCommitHookTests(Base):
    def test_no_run_md_allows_commit(self):
        self.assertEqual(0, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_active_phase_without_gate_pass_blocks(self):
        self.write_run()
        self.assertEqual(1, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_gate_pass_allows_commit(self):
        self.write_run()
        (self.sd / "phase-1" / ".gate-pass").write_text('{"result":"pass"}')
        self.assertEqual(0, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_override_allows_commit(self):
        self.write_run()
        (self.sd / ".gate-override").write_text("docs-only commit of a blocked scenario")
        self.assertEqual(0, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_store_mode_block_points_at_store_commit_not_override(self):
        import contextlib, io
        (self.sd / "RUN.md").write_text(f"Store: {self.root / 'store'}\n" + RUN_MD)
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(1, orchestrator.cmd_hook_pre_commit(ns(self.root)))
        self.assertIn("store-commit --phase 1 --reason failed", err.getvalue())
        self.assertNotIn(".gate-override", err.getvalue())

    def _git_repo_with_staged(self, *paths):
        import subprocess
        run = lambda *a: subprocess.run(["git", "-C", str(self.root), *a], check=True, capture_output=True)
        run("init", "-q")
        for p in paths:
            f = self.root / p
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text("x\n")
            run("add", "--", p)

    def test_runtime_only_commit_passes_a_live_unpassed_phase(self):
        self.write_config(TOML_OK + 'ignore = [".planning/", "todos/"]\n')
        self.write_run()
        self._git_repo_with_staged(".planning/f/prds/prd-1-x.md", "todos/t.md")
        self.assertEqual(0, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_a_phase_path_in_the_commit_still_blocks(self):
        self.write_config(TOML_OK + 'ignore = [".planning/"]\n')
        self.write_run()
        self._git_repo_with_staged(".planning/f/prds/prd-1-x.md", "src/app.py")
        self.assertEqual(1, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_no_ignore_list_keeps_blocking(self):
        self.write_config(TOML_OK)
        self.write_run()
        self._git_repo_with_staged(".planning/f/prds/prd-1-x.md")
        self.assertEqual(1, orchestrator.cmd_hook_pre_commit(ns(self.root)))

    def test_post_commit_skips_a_runtime_only_commit(self):
        import contextlib, io, subprocess
        self.write_config(TOML_OK + 'ignore = [".planning/"]\n')
        self.write_run()
        self._git_repo_with_staged(".planning/f/prds/prd-1-x.md")
        subprocess.run(["git", "-C", str(self.root), "-c", "user.email=t@t", "-c", "user.name=t",
                        "-c", "commit.gpgsign=false", "commit", "-qm", "status"], check=True)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(0, orchestrator.cmd_hook_commit(ns(self.root)))
        self.assertEqual("", out.getvalue())
        self.assertFalse((self.sd / "events.jsonl").exists())

    def test_all_phases_terminal_allows_commit(self):
        (self.sd / "RUN.md").write_text(
            "| # | Phase | Plan | Status |\n|---|---|---|---|\n| 1 | x | p | committed |\n")
        self.assertEqual(0, orchestrator.cmd_hook_pre_commit(ns(self.root)))


if __name__ == "__main__":
    unittest.main()
