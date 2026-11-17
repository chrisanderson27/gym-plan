"""init on a state dir that already holds a run: archive it whole, clear its per-run files (so a stale
phase-N/.gate-pass can never pass a new run's gate), keep append-only history, refuse while it is live."""
import argparse
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

SKILL = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("orchestrator", SKILL / "scripts/orchestrator.py")
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)

RUN_MD = """# Orchestration run

PRD: .planning/feature/prds/prd-1-old-thing.md
Root: {root}

## Phases

| # | phase | depends on | status  | commit | artifact / note |
|---|-------|------------|---------|--------|-----------------|
| 1 | One   | -          | {s1} | abc     | - |
| 2 | Two   | -          | {s2} | def     | - |
"""


class InitArchive(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".agents/orchestrator"
        self.archive = self.root / ".agents/orchestrator-archive"
        patch = mock.patch.dict(os.environ)
        patch.start()
        self.addCleanup(patch.stop)
        for key in ("ORCH_STATE_DIR", "ORCH_TAB_STAGE", "ORCH_PHASE", "ORCH_STAGE"):
            os.environ.pop(key, None)

    def old_run(self, s1="committed", s2="committed", age_s=0):
        self.state.mkdir(parents=True, exist_ok=True)
        (self.state / "RUN.md").write_text(RUN_MD.format(root=self.root, s1=s1, s2=s2))
        (self.state / "phase-1").mkdir(exist_ok=True)
        (self.state / "phase-1/verify.json").write_text('{"result": "pass"}')
        (self.state / "phase-1/.gate-pass").write_text("ok")
        (self.state / "facts").mkdir(exist_ok=True)
        (self.state / "facts/domain.md").write_text("- a fact\n")
        (self.state / "decisions.jsonl").write_text('{"id": "d1"}\n')
        (self.state / "events.jsonl").write_text('{"event": "run_start"}\n')
        (self.state / "learnings.jsonl").write_text('{"class": "x"}\n')
        (self.state / "routing.json").write_text('{"old": true}')
        if age_s:
            past = time.time() - age_s
            for p in self.state.rglob("*"):
                os.utime(p, (past, past))
        else:
            past = time.time() - 60   # routing.json is older than RUN.md unless a test says otherwise
            os.utime(self.state / "routing.json", (past, past))

    def init(self, prd="new.md", force=False):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            orchestrator.cmd_init(argparse.Namespace(root=str(self.root), prd=prd, force=force, gate="commit"))
        return out.getvalue()

    def test_finished_run_is_archived_and_cleared(self):
        self.old_run()
        out = self.init()
        dest = self.archive / "prd-1-old-thing"
        self.assertIn("archived the previous run", out)
        self.assertTrue((dest / "RUN.md").exists())
        self.assertTrue((dest / "phase-1/.gate-pass").exists())
        self.assertFalse((self.state / "phase-1").exists(), "stale gate token must not survive into the new run")
        self.assertFalse((self.state / "facts").exists())
        self.assertFalse((self.state / "routing.json").exists(), "a routing.json older than RUN.md is the old run's")
        self.assertEqual((self.state / "decisions.jsonl").read_text(), "")
        self.assertIn('"run_start"', (self.state / "events.jsonl").read_text())
        self.assertTrue((self.state / "learnings.jsonl").exists())
        self.assertIn("PRD: new.md", (self.state / "RUN.md").read_text())

    def test_fresh_routing_for_the_next_run_is_kept(self):
        self.old_run()
        future = time.time() + 5
        os.utime(self.state / "routing.json", (future, future))
        self.init()
        self.assertEqual((self.state / "routing.json").read_text(), '{"old": true}')

    def test_live_run_is_refused(self):
        self.old_run(s2="building")
        with self.assertRaises(SystemExit) as cm:
            self.init()
        self.assertEqual(cm.exception.code, 1)
        self.assertFalse(self.archive.exists())
        self.assertTrue((self.state / "phase-1/.gate-pass").exists())

    def test_force_archives_a_live_run(self):
        self.old_run(s2="building")
        self.init(force=True)
        self.assertTrue((self.archive / "prd-1-old-thing/RUN.md").exists())
        self.assertFalse((self.state / "phase-1").exists())

    def test_stalled_run_is_archived_without_force(self):
        self.old_run(s2="building", age_s=3 * 3600)
        self.init()
        self.assertTrue((self.archive / "prd-1-old-thing/RUN.md").exists())

    def test_name_collision_gets_a_suffix(self):
        self.old_run()
        self.init(prd=".planning/feature/prds/prd-1-old-thing.md")
        (self.state / "RUN.md").write_text(RUN_MD.format(root=self.root, s1="committed", s2="committed"))
        self.init()
        self.assertTrue((self.archive / "prd-1-old-thing-2/RUN.md").exists())

    def test_legacy_init_writes_no_store_line(self):
        out = self.init(prd="docs/ai/prds/prd-1-thing.md")
        run = (self.state / "RUN.md").read_text()
        self.assertNotIn("Store:", run)
        self.assertNotIn("store ", out)

    def test_store_prd_writes_store_and_archives_by_slug(self):
        planning = self.root / "wiki/.planning"
        prd = planning / "isi/ISI-9/prds/prd-2-store-thing.md"
        prd.parent.mkdir(parents=True)
        prd.write_text("# PRD\n")
        with mock.patch.dict(os.environ, {"WORKBENCH_STORE_ROOT": str(planning)}):
            self.init(prd=str(prd))
            run = (self.state / "RUN.md").read_text()
            self.assertIn(f"Store: {planning / 'isi/ISI-9'}", run)
            self.assertIn(f"PRD: {prd}", run)
            self.init(force=True)                        # next run archives this one by PRD slug
        self.assertTrue((self.archive / "prd-2-store-thing/RUN.md").exists())
        self.assertNotIn("Store:", (self.state / "RUN.md").read_text())


if __name__ == "__main__":
    unittest.main()
