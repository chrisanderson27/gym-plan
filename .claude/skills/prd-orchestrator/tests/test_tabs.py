import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class FakeHerdr:
    """Records herdr calls; `tab create` hands out ids, `tab list` reports what's open."""

    def __init__(self, extra_tabs=()):
        self.calls, self.open, self.n = [], {}, 0
        for tid, label in extra_tabs:
            self.open[tid] = label

    def __call__(self, *argv, timeout=60):
        self.calls.append(argv)
        if argv[:2] == ("tab", "create"):
            self.n += 1
            tid, label = f"wX:t{self.n}", argv[argv.index("--label") + 1]
            self.open[tid] = label
            return 0, json.dumps({"result": {"tab": {"tab_id": tid, "label": label},
                                             "root_pane": {"pane_id": f"wX:p{self.n}"}}}), ""
        if argv[:2] == ("tab", "close"):
            self.open.pop(argv[2], None)
            return 0, "", ""
        if argv[:2] == ("tab", "list"):
            return 0, json.dumps({"result": {"tabs": [{"tab_id": k, "label": v} for k, v in self.open.items()]}}), ""
        if argv[:2] == ("pane", "wait-output"):
            return 0, "", ""
        return 0, "", ""


class Tabs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        sd = self.root / ".agents" / "orchestrator"
        sd.mkdir(parents=True)
        (sd / "RUN.md").write_text("# run\nPRD: .planning/x/prds/prd-4-widgets.md\n")
        (sd / "routing.json").write_text(json.dumps({"stages": {"builder": {
            "kind": "claude", "model": "sonnet", "effort": "low", "argv": ["--model", "sonnet"],
            "env": {"CLAUDE_CONFIG_DIR": "/home/x/.claude-personal2"}}}}))
        env = mock.patch.dict(os.environ, {"HERDR_WORKSPACE_ID": "wX"})
        env.start(); self.addCleanup(env.stop)

    def tab(self, fake, action, **kw):
        ns = argparse.Namespace(root=str(self.root), action=action, stage=None, phase=None, suffix=None,
                                cwd=None, fresh=False, label=None, tab=None, wait_ms=1000, env=None)
        for k, v in kw.items():
            setattr(ns, k, v)
        out = io.StringIO()
        with mock.patch.object(orchestrator, "_herdr", fake), contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(io.StringIO()):
            rc = orchestrator.cmd_tab(ns)
        return rc, out.getvalue()

    def test_open_creates_a_labelled_tab_with_routing_env_and_waits(self):
        fake = FakeHerdr()
        rc, out = self.tab(fake, "open", stage="builder", phase=3)
        self.assertEqual(rc, 0)
        rec = json.loads(out)
        self.assertEqual(rec["label"], "orch:prd-4-widgets:p3:builder")
        self.assertTrue(rec["ready"])
        create = next(c for c in fake.calls if c[:2] == ("tab", "create"))
        self.assertIn("--no-focus", create)
        self.assertIn("CLAUDE_CONFIG_DIR=/home/x/.claude-personal2", create)   # never a split pane
        self.assertFalse(any(c[:2] == ("pane", "split") for c in fake.calls))
        self.assertTrue(any(c[:2] == ("pane", "wait-output") for c in fake.calls))
        self.assertEqual(json.loads((self.root / ".agents/orchestrator/tabs.json").read_text())[0]["tab_id"], "wX:t1")

    def test_fix_stage_uses_builder_routing_and_app_gets_no_env(self):
        fake = FakeHerdr()
        self.tab(fake, "open", stage="fix", phase=2)
        self.tab(fake, "open", stage="app")
        creates = [c for c in fake.calls if c[:2] == ("tab", "create")]
        self.assertIn("CLAUDE_CONFIG_DIR=/home/x/.claude-personal2", creates[0])
        self.assertNotIn("--env", creates[1])
        self.assertEqual(creates[1][creates[1].index("--label") + 1], "orch:prd-4-widgets:app")

    def test_extra_env_is_added_to_the_tab(self):
        fake = FakeHerdr()
        self.tab(fake, "open", stage="e2e", phase=4, env=["ORCH_FIGMA=1"])
        create = next(c for c in fake.calls if c[:2] == ("tab", "create"))
        self.assertIn("ORCH_FIGMA=1", create)

    def test_reopen_reuses_unless_fresh(self):
        fake = FakeHerdr()
        self.tab(fake, "open", stage="builder", phase=1)
        _, out = self.tab(fake, "open", stage="builder", phase=1)
        self.assertTrue(json.loads(out)["reused"])
        _, out = self.tab(fake, "open", stage="builder", phase=1, fresh=True)
        self.assertEqual(json.loads(out)["tab_id"], "wX:t2")
        self.assertNotIn("wX:t1", fake.open)

    def worker_events(self):
        return [json.loads(line) for line in
                (self.root / ".agents/orchestrator/events.jsonl").read_text().splitlines()]

    def test_open_emits_worker_start_with_routing(self):
        self.tab(FakeHerdr(), "open", stage="builder", phase=3)
        event, = self.worker_events()
        self.assertEqual(event["event"], "worker_start")
        self.assertEqual(event["kind"], "claude")
        self.assertEqual(event["model"], "sonnet")
        self.assertEqual(event["effort"], "low")
        self.assertEqual(event["config_dir"], "/home/x/.claude-personal2")
        self.assertEqual(event["pane_id"], "wX:p1")
        self.assertEqual(event["phase"], 3)
        self.assertEqual(event["stage"], "builder")

    def test_fix_tab_carries_tab_stage_env(self):
        fake = FakeHerdr()
        self.tab(fake, "open", stage="fix", phase=2)
        create = next(c for c in fake.calls if c[:2] == ("tab", "create"))
        self.assertIn("ORCH_TAB_STAGE=fix", create)
        event, = self.worker_events()
        self.assertEqual(event["stage"], "fix")
        self.assertEqual(event["kind"], "claude")

    def test_app_worker_start_is_a_process_with_nulls(self):
        self.tab(FakeHerdr(), "open", stage="app")
        event, = self.worker_events()
        self.assertEqual(event["kind"], "process")
        for field in ("phase", "model", "effort", "config_dir"):
            self.assertIn(field, event)
            self.assertIsNone(event[field])

    def test_reuse_does_not_emit_again(self):
        fake = FakeHerdr()
        self.tab(fake, "open", stage="builder", phase=1)
        self.tab(fake, "open", stage="builder", phase=1)
        self.assertEqual(len(self.worker_events()), 1)
        self.tab(fake, "open", stage="builder", phase=1, fresh=True)
        self.assertEqual(len(self.worker_events()), 2)

    def test_close_by_label_and_sweep_only_this_runs_prefix(self):
        fake = FakeHerdr(extra_tabs=[("wX:t90", "orch:prd-4-widgets:p9:e2e"),    # ours, lost from tabs.json
                                     ("wX:t91", "orch:other-prd:p1:builder"),   # another run's
                                     ("wX:t92", "Chris's shell")])
        self.tab(fake, "open", stage="planner", phase=1)
        self.tab(fake, "open", stage="e2e", phase=2)
        self.tab(fake, "close", label="orch:prd-4-widgets:p1:planner")
        self.assertEqual([t["label"] for t in json.loads((self.root / ".agents/orchestrator/tabs.json").read_text())],
                         ["orch:prd-4-widgets:p2:e2e"])
        self.tab(fake, "sweep")
        self.assertEqual(sorted(fake.open), ["wX:t91", "wX:t92"])
        self.assertEqual(json.loads((self.root / ".agents/orchestrator/tabs.json").read_text()), [])


if __name__ == "__main__":
    unittest.main()
