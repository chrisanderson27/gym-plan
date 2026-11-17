import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class Routing(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".claude").mkdir()
        (self.root / ".claude" / "orchestrator.toml").write_text('[validation]\nlevels = [{ name = "unit", cmd = "true" }]\n')
        self.sd = self.root / ".agents" / "orchestrator"
        self.sd.mkdir(parents=True)

    def route(self, stage, phase=1):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = orchestrator.cmd_routing(argparse.Namespace(root=str(self.root), stage=stage, phase=phase))
        return rc, (json.loads(out.getvalue()) if rc == 0 else None)

    def write(self, stages):
        (self.sd / "routing.json").write_text(json.dumps({"version": 1, "stages": stages}))

    def test_no_file_uses_the_skill_table_with_hooks(self):
        rc, r = self.route("builder")
        self.assertEqual(rc, 0)
        self.assertEqual(r["source"], "default")
        self.assertEqual(r["argv"], ["--model", "sonnet", "--effort", "low"])
        self.assertTrue(r["hooks"])
        self.assertEqual(r["agent_args"][4:6], ["--permission-mode", "acceptEdits"])
        self.assertTrue(Path(r["agent_args"][7]).exists())   # the generated worker settings file

    def test_auto_permission_mode_is_coerced_to_accept_edits(self):
        (self.root / ".claude").mkdir(exist_ok=True)
        (self.root / ".claude" / "orchestrator.toml").write_text('[worker]\npermission_mode = "auto"\n')
        rc, r = self.route("builder")
        self.assertEqual(rc, 0)
        self.assertEqual(r["agent_args"][4:6], ["--permission-mode", "acceptEdits"])

    def test_routing_json_argv_is_used_verbatim_and_non_claude_drops_hooks(self):
        self.write({
            "planner": {"kind": "claude", "model": "claude-opus-5-5", "effort": "high", "argv": ["--model", "claude-opus-5-5", "--effort", "high"], "env": {"CLAUDE_CONFIG_DIR": "/x"}},
            "builder": {"kind": "cursor", "model": "gpt-6", "argv": ["--model", "gpt-6"]},
        })
        rc, plan = self.route("planner")
        self.assertEqual(plan["source"], "routing.json")
        self.assertEqual(plan["agent_args"][:4], ["--model", "claude-opus-5-5", "--effort", "high"])
        self.assertIn("--settings", plan["agent_args"])
        self.assertEqual(plan["env"], {"CLAUDE_CONFIG_DIR": "/x"})
        rc, build = self.route("builder")
        self.assertEqual(build["agent_args"], ["--model", "gpt-6"])
        self.assertFalse(build["hooks"])
        rc, review = self.route("reviewer")   # a stage the file leaves out falls back to the table
        self.assertEqual(review["source"], "default")

    def test_codex_worker_gets_the_state_dir_as_a_writable_root(self):
        self.write({"builder": {"kind": "codex", "argv": ["--sandbox", "workspace-write"]}})
        rc, build = self.route("builder")
        self.assertEqual(build["agent_args"][:2], ["--sandbox", "workspace-write"])
        self.assertEqual(build["agent_args"][-2:], ["-c", "sandbox_workspace_write.writable_roots=" + json.dumps([str(self.sd)])])
        self.assertEqual(build["argv"], ["--sandbox", "workspace-write"])
        self.assertFalse(build["hooks"])

    def test_bad_routing_json_is_rejected(self):
        self.write({"deployer": {"kind": "claude"}, "builder": {"kind": "claude", "argv": "--model x"}})
        rc, _ = self.route("builder")
        self.assertEqual(rc, 1)
        _, problems = orchestrator.load_routing(str(self.root))
        self.assertEqual(len(problems), 2)


class AutonomousCodexBuilder(Routing):
    def test_a_codex_builder_in_autonomous_mode_warns_instead_of_failing(self):
        (self.sd / "RUN.md").write_text("# Orchestration run\n\nAutonomy gate: autonomous\n")
        self.write({"builder": {"kind": "codex", "argv": ["--model", "gpt-5"]}})
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                orchestrator.cmd_preflight(argparse.Namespace(root=str(self.root), trust=False))
            except SystemExit:
                pass
        text = out.getvalue()
        self.assertIn("builder runs on codex -- it has no git fence", text)
        self.assertNotIn("only a Claude worker carries the git fence", text)


class E2eEngine(Routing):
    def test_defaults_to_nimble_when_the_pilot_is_installed(self):
        self.assertEqual(orchestrator.e2e_engine(str(self.root)),
                         "nimble" if Path(orchestrator.PILOT_DIR, "run.py").exists() else "claude")

    def test_routing_json_picks_the_engine_and_the_e2e_route_reports_it(self):
        self.write({"e2e": {"kind": "claude", "model": "claude-sonnet-5-5", "argv": ["--model", "claude-sonnet-5-5"]}})
        data = json.loads((self.sd / "routing.json").read_text())
        data["e2e_engine"] = "claude"
        (self.sd / "routing.json").write_text(json.dumps(data))
        rc, r = self.route("e2e")
        self.assertEqual(r["engine"], "claude")
        self.assertNotIn("pilot", r)
        data["e2e_engine"] = "nimble"
        (self.sd / "routing.json").write_text(json.dumps(data))
        rc, r = self.route("e2e")
        self.assertEqual(r["engine"], "nimble")
        self.assertTrue(r["pilot"].endswith("e2e-test-orchestrator/pilot/run.py"))
        self.assertIn("--settings", r["agent_args"])   # the Claude fallback worker keeps its hooks

    def test_nimble_route_gives_the_pilot_its_env_as_a_command_prefix(self):
        from unittest import mock

        def write(stage):
            (self.sd / "routing.json").write_text(json.dumps(
                {"version": 1, "e2e_engine": "nimble", "stages": {"e2e": stage}}))

        write({"kind": "claude", "argv": [], "env": {"CLAUDE_CONFIG_DIR": "/u/.claude two"}})
        _, r = self.route("e2e")
        self.assertEqual(r["pilot_env"], {"CLAUDE_CONFIG_DIR": "/u/.claude two"})
        self.assertEqual(r["pilot_cmd_prefix"], "CLAUDE_CONFIG_DIR='/u/.claude two'")
        write({"kind": "claude", "argv": []})
        with mock.patch.dict(orchestrator.os.environ, {"CLAUDE_CONFIG_DIR": "/u/.claude-work"}):
            _, r = self.route("e2e")
        self.assertEqual(r["pilot_cmd_prefix"], "CLAUDE_CONFIG_DIR=/u/.claude-work")   # the orchestrator's own

    def test_unknown_engine_is_rejected(self):
        (self.sd / "routing.json").write_text(json.dumps({"e2e_engine": "selenium", "stages": {}}))
        _, problems = orchestrator.load_routing(str(self.root))
        self.assertEqual(len(problems), 1)

    def test_e2e_fallback_is_a_valid_event(self):
        self.assertIn("e2e_fallback", orchestrator.VALID_EVENTS)


if __name__ == "__main__":
    unittest.main()
