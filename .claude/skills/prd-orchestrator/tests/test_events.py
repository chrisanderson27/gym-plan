import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SKILL = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("orchestrator", SKILL / "scripts/orchestrator.py")
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".agents/orchestrator"
        self.state.mkdir(parents=True)
        self.events = self.state / "events.jsonl"
        patch = mock.patch.dict(os.environ)
        patch.start()
        self.addCleanup(patch.stop)
        for key in ("ORCH_STATE_DIR", "ORCH_TAB_STAGE", "ORCH_PHASE", "ORCH_STAGE"):
            os.environ.pop(key, None)

    def records(self):
        return [json.loads(line) for line in self.events.read_text().splitlines()] if self.events.exists() else []

    def log(self, event, **kw):
        args = argparse.Namespace(root=str(self.root), event=event, phase=None, stage=None,
                                  detail=None, sha=None)
        for key, value in kw.items():
            setattr(args, key, value)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return orchestrator.cmd_log(args)

    def hook(self, script, payload="", **kw):
        env = os.environ.copy()
        env.update(ORCH_STATE_DIR=str(self.state), ORCH_STAGE="builder", ORCH_PHASE="3")
        env.update(kw)
        return subprocess.run(["bash", str(SKILL / "scripts/hooks" / script)], input=payload,
                              env=env, text=True, capture_output=True, check=False)


class HookTimestamps(Base):
    def test_stop_gate_and_heartbeat_are_utc(self):
        artifact = self.state / "summary.md"
        artifact.write_text("done\n## Acceptance\n| AC1 | met | timestamp fixture |\n")
        result = self.hook("stop-gate.sh", ORCH_PHASE="1", ORCH_ARTIFACT=str(artifact))
        self.assertEqual(result.returncode, 0)
        event = self.records()[-1]
        self.assertEqual(event["event"], "build_done")
        self.assertRegex(event["ts"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertTrue((self.state / "hook-heartbeat.log").read_text().split()[0].endswith("Z"))


class SessionStartHook(Base):
    payload = json.dumps({"session_id": "0b1c2d3e-aaaa-bbbb-cccc-123456789abc", "source": "startup", "cwd": "/x"})

    def test_emits_session_silently(self):
        result = self.hook("session-start.sh", self.payload)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        event, = self.records()
        self.assertEqual(event["event"], "worker_session")
        self.assertEqual(event["session_id"], json.loads(self.payload)["session_id"])
        self.assertEqual(event["phase"], 3)
        self.assertEqual(event["stage"], "builder")
        self.assertEqual(event["detail"], "startup")
        self.assertTrue(event["ts"].endswith("Z"))

    def test_tab_stage_overrides_routing(self):
        self.hook("session-start.sh", self.payload, ORCH_TAB_STAGE="fix")
        self.assertEqual(self.records()[0]["stage"], "fix")

    def test_phaseless_worker(self):
        self.hook("session-start.sh", self.payload, ORCH_PHASE="")
        self.assertIsNone(self.records()[0]["phase"])

    def test_missing_session_is_noop(self):
        result = self.hook("session-start.sh", '{"source":"startup"}')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.records(), [])

    def test_unset_state_is_noop(self):
        result = subprocess.run(["bash", str(SKILL / "scripts/hooks/session-start.sh")],
                                input=self.payload, env=os.environ.copy(), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.records(), [])
        self.assertFalse((self.state / "hook-heartbeat.log").exists())


class WorkerSettings(Base):
    def test_every_stage_has_session_hook(self):
        for stage in ("planner", "builder", "reviewer", "e2e"):
            with self.subTest(stage=stage):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    orchestrator.cmd_worker_settings(argparse.Namespace(root=str(self.root), stage=stage,
                                                                         phase=2, artifact=None))
                settings = json.loads(Path(out.getvalue().strip()).read_text())
                command = settings["hooks"]["SessionStart"][0]["hooks"][0]["command"]
                self.assertIn("session-start.sh", command)
                self.assertIn(f"ORCH_STAGE={stage}", command)
                if stage == "planner":
                    self.assertNotIn("Stop", settings["hooks"])


class RunId(Base):
    def test_init_and_reused_run_id(self):
        with contextlib.redirect_stdout(io.StringIO()):
            orchestrator.cmd_init(argparse.Namespace(root=str(self.root), prd="x.md", force=False, gate="commit"))
        rid = orchestrator._run_field(str(self.root), "Run id")
        self.assertRegex(rid, orchestrator.RUN_ID_RE)
        self.assertEqual(self.log("run_start"), 0)
        self.assertEqual(self.records()[0]["run_id"], rid)
        self.assertEqual(self.log("run_start"), 0)
        second = self.records()[1]["run_id"]
        self.assertRegex(second, orchestrator.RUN_ID_RE)
        self.assertNotEqual(second, rid)

    def test_missing_run_file_gets_valid_id(self):
        self.log("run_start")
        self.assertRegex(self.records()[0]["run_id"], orchestrator.RUN_ID_RE)


class Log(Base):
    def test_run_end_uses_latest_run_start(self):
        self.log("run_start")
        self.log("run_start")
        self.log("run_end", detail="completed")
        records = self.records()
        self.assertEqual(records[-1]["run_id"], records[-2]["run_id"])
        self.assertNotEqual(records[-1]["run_id"], records[0]["run_id"])

    def test_old_run_id_matches_harvester(self):
        ts = "2026-10-08T10:04:28Z"
        self.events.write_text(json.dumps({"event": "run_start", "ts": ts}) + "\n")
        self.log("run_end", detail="completed")
        expected = hashlib.sha1((os.path.realpath(self.root) + ts).encode()).hexdigest()[:12]
        self.assertEqual(self.records()[-1]["run_id"], expected)

    def test_invalid_run_end_writes_nothing(self):
        self.assertEqual(self.log("run_end", detail="done"), 2)
        self.assertEqual(self.records(), [])

    def test_skip_preserves_null_phase(self):
        self.assertEqual(self.log("stage_skipped", stage="e2e", detail="Q2 option 4"), 0)
        event, = self.records()
        self.assertIn("phase", event)
        self.assertIsNone(event["phase"])

    def test_invalid_skip_writes_nothing(self):
        for stage, detail in (("build", "reason"), ("e2e", ""), ("e2e", "   ")):
            with self.subTest(stage=stage, detail=detail):
                self.assertEqual(self.log("stage_skipped", stage=stage, detail=detail), 2)
                self.assertEqual(self.records(), [])

    def test_existing_event_still_omits_nulls(self):
        self.assertEqual(self.log("verify_pass", phase=1), 0)
        event, = self.records()
        self.assertNotIn("run_id", event)
        self.assertEqual(event["phase"], 1)
        self.assertNotIn(None, event.values())


class CommitLandsPhase(Base):
    TABLE = ("# Orchestration run\n\n| # | phase | depends on | status | commit | note |\n"
             "|---|---|---|---|---|---|\n"
             "| 1 | One | - | committed | aaaaaaaaaa | done |\n"
             "| 2 | Two | 1 | pending | - | PRD 2 |\n"
             "| 3 | Three | 2 | pending | - | PRD 3 |\n\n"
             "## Parked\n- Parked: 2026-10-01\n\nResumed: 2026-10-02\n")

    def setUp(self):
        super().setUp()
        self.run = self.state / "RUN.md"
        self.run.write_text(self.TABLE)

    def test_agent_commit_marks_row_committed(self):
        self.assertEqual(orchestrator._active_phase(str(self.root)), 2)
        self.assertEqual(self.log("commit", phase=2, sha="bbbbbbbbbbbbbbbbbbbb"), 0)
        lines = self.run.read_text().splitlines()
        self.assertIn("| 2 | Two | 1 | committed | bbbbbbbbbb | PRD 2 |", lines)
        self.assertEqual(self.run.read_text(), self.TABLE.replace(
            "| 2 | Two | 1 | pending | - | PRD 2 |", "| 2 | Two | 1 | committed | bbbbbbbbbb | PRD 2 |"))
        self.assertEqual(orchestrator._active_phase(str(self.root)), 3)

    def test_hook_emit_and_shaless_commit_leave_table(self):
        orchestrator._emit(str(self.root), "commit", phase=2, sha="c" * 40, detail="auto-logged by post-commit hook")
        self.assertEqual(self.log("commit", phase=2), 0)
        self.assertEqual(self.run.read_text(), self.TABLE)


class Vocabulary(Base):
    def test_event_vocabulary(self):
        self.assertLessEqual({"run_end", "stage_skipped", "worker_start", "worker_session"}, orchestrator.VALID_EVENTS)
        self.assertNotIn("phase_committed", orchestrator.VALID_EVENTS)
        hooks = "\n".join(p.read_text() for p in (SKILL / "scripts/hooks").glob("*.sh"))
        for event in orchestrator.HOOK_EVENTS:
            self.assertIn(event, hooks)


class SchemaDoc(Base):
    def test_schema_covers_vocabulary_and_stages(self):
        text = (SKILL / "reference/ledger-schema.md").read_text()
        for name in orchestrator.VALID_EVENTS | orchestrator.HOOK_EVENTS | set(orchestrator.TELEMETRY_STAGES):
            self.assertIn(f"`{name}`", text)
        self.assertNotIn("`phase_start`", text)


if __name__ == "__main__":
    unittest.main()
