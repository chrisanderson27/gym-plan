import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)

RUN = """# Orchestration run

PRD: docs/prd.md
Autonomy gate: commit

| # | phase | depends on | status | commit | artifact / note |
|---|-------|------------|--------|--------|-----------------|
| 1 | data model | - | pending | - | - |
| 2 | drawer | 1 | pending | - | - |
| 3 | logout | - | pending | - | - |
"""

ANALYST = {
    "conflicts": [{"whats": ["P1", "P2"], "description": "P1 returns a nullable id; P2 reads it as required",
                   "resolution": "Make the id non-null in P1", "resolution_introduces_gaps": ["P1 needs a default"]}],
    "gaps": [{"phase": 3, "step": 2, "description": "Nothing says what logout does with an open drawer",
              "resolution": "Close it"},
             {"phase": 9, "description": "names a phase that does not exist", "resolution": "x"},
             {"phase": 1, "description": "", "resolution": "empty description"}],
    "ambiguities": [],
}


class GapsAndFacts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sd = self.root / ".agents" / "orchestrator"
        self.sd.mkdir(parents=True)
        (self.sd / "RUN.md").write_text(RUN)
        (self.root / "src").mkdir()
        (self.root / "src" / "Mediator.cs").write_text("// x")

    def ns(self, **kw):
        base = dict(root=str(self.root), action=None, source_file=None, phase=None, open=False, id=None,
                    how=None, by=None, absorb=False, replace=False, partition=None, stage=None)
        base.update(kw)
        return argparse.Namespace(**base)

    def run_cmd(self, fn, stdin="", **kw):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                contextlib.ExitStack() as stack:
            if stdin is not None:
                stack.enter_context(mock.patch("sys.stdin", io.StringIO(stdin)))
            rc = fn(self.ns(**kw))
        return rc, out.getvalue(), err.getvalue()

    # ---- gaps ---------------------------------------------------------------

    def test_write_validates_phases_and_fields_and_drops_rather_than_blocks(self):
        rc, out, err = self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        self.assertEqual(rc, 0)
        self.assertIn("2 finding(s) recorded, 2 dropped", out)
        self.assertIn("not in RUN.md's table", err)
        self.assertIn("description is empty", err)
        data = json.loads((self.sd / "gaps.json").read_text())
        ids = [g["id"] for g in data["findings"]]
        self.assertEqual(ids, ["g1", "g2"])
        self.assertEqual(data["findings"][0]["kind"], "conflict")
        self.assertEqual(data["findings"][0]["phases"], [1, 2])
        self.assertEqual(data["findings"][0]["introduces"], ["P1 needs a default"])
        self.assertEqual(data["findings"][1]["step"], 2)
        self.assertTrue((self.sd / "gaps.md").exists())
        events = [json.loads(l) for l in (self.sd / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events[-1]["event"], "gap_pass")
        self.assertIn("gap_pass", orchestrator.VALID_EVENTS)

    def test_write_refuses_until_the_phase_table_is_transcribed(self):
        (self.sd / "RUN.md").write_text("# run\nPRD: x\n| 1 | TODO | - | pending | - | - |\n")
        rc, out, err = self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        self.assertEqual(rc, 0)
        self.assertIn("0 finding(s) recorded", out)
        self.assertIn("transcribe the PRD's phase table first", err)

    def test_show_phase_emits_the_planner_block_and_resolve_clears_it(self):
        self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        rc, out, _ = self.run_cmd(orchestrator.cmd_gaps, action="show", phase=2)
        self.assertIn("Known gaps for phase 2", out)
        self.assertIn("g1 [conflict] (shared with P1)", out)
        self.assertNotIn("g2", out)
        rc, out, _ = self.run_cmd(orchestrator.cmd_gaps, action="show", phase=3)
        self.assertIn("g2 [gap]", out)
        rc, out, _ = self.run_cmd(orchestrator.cmd_gaps, action="resolve", id="g2", how="drawer closes on logout",
                                  by="human", phase=3)
        self.assertEqual(rc, 0)
        rc, out, _ = self.run_cmd(orchestrator.cmd_gaps, action="show", phase=3)
        self.assertIn("(no open gaps for phase 3)", out)
        rc, out, _ = self.run_cmd(orchestrator.cmd_gaps, action="resolve", id="g9", how="x")
        self.assertEqual(rc, 2)

    def test_ingest_marks_the_plans_gaps_addressed_lines(self):
        self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        plan = self.root / "plan.md"
        plan.write_text("# Plan\n\n## Gaps addressed\n\n- g1: id made non-null in the model\n- `g7`: not a real id\n\n"
                        "## Next\n- g2: this is under another heading and must be ignored\n")
        rc, out, _ = self.run_cmd(orchestrator.cmd_gaps, action="ingest", phase=1, source_file=str(plan))
        self.assertEqual(rc, 0)
        self.assertIn("1 resolved (g1)", out)
        self.assertIn("unknown ids: g7", out)
        data = json.loads((self.sd / "gaps.json").read_text())
        g1 = next(g for g in data["findings"] if g["id"] == "g1")
        self.assertEqual((g1["status"], g1["resolved_by"], g1["resolved_phase"]), ("resolved", "planner", 1))
        self.assertEqual(next(g for g in data["findings"] if g["id"] == "g2")["status"], "open")

    def test_report_lists_open_gaps(self):
        self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        (self.root / "docs").mkdir()
        (self.root / "docs" / "prd.md").write_text("# PRD\n")
        with mock.patch.object(orchestrator.subprocess, "call", return_value=0):
            rc, out, _ = self.run_cmd(orchestrator.cmd_report, stdin=None, prd=None, absorbed=None)
        self.assertEqual(rc, 0)
        report = next(self.sd.glob("deviations-*.md")).read_text()
        self.assertIn("## Gap pass", report)
        self.assertIn("2 still open", report)
        self.assertIn("**g1** [conflict] P1,P2", report)

    # ---- facts --------------------------------------------------------------

    def test_add_requires_a_resolving_cite_and_deduplicates(self):
        rc, out, err = self.run_cmd(
            orchestrator.cmd_facts, action="add", partition="patterns", phase=1, stage="planner",
            stdin="- The mediator is hand-written in src/Mediator.cs:12 and takes one parameter\n"
                  "The mediator is hand-written in src/Mediator.cs:12 and takes one parameter\n"
                  "Handlers live somewhere under Commands and take no token\n"
                  "See src/Missing.cs for the shape\n")
        self.assertEqual(rc, 0)
        self.assertIn("1 added, 3 dropped", out)
        self.assertIn("duplicate", err)
        self.assertIn("cites no path", err)
        text = (self.sd / "facts" / "patterns.md").read_text()
        self.assertIn("- The mediator is hand-written in src/Mediator.cs:12", text)
        self.assertIn("_(p1 planner)_", text)

    def test_show_renders_the_prompt_block_and_unknown_partitions_are_rejected(self):
        rc, out, _ = self.run_cmd(orchestrator.cmd_facts, action="show")
        self.assertIn("(no facts recorded yet)", out)
        self.run_cmd(orchestrator.cmd_facts, action="add", partition="domain",
                     stdin="A 'revenue center' is the Store row in src/Mediator.cs\n")
        rc, out, _ = self.run_cmd(orchestrator.cmd_facts, action="show")
        self.assertIn("Facts already discovered this run", out)
        self.assertIn("### domain", out)
        added, dropped = orchestrator.facts_add(str(self.root), "streams", ["x src/Mediator.cs"])
        self.assertEqual(added, [])
        self.assertIn("unknown partition", dropped[0][1])

    def test_ingest_harvests_both_sections_from_one_artifact(self):
        self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        summary = self.sd / "phase-1" / "summary.md"
        summary.parent.mkdir()
        summary.write_text(
            "# Phase 1\nBuilt the model.\n\n## New facts\n- patterns: handlers implement IRequestHandler, see src/Mediator.cs\n"
            "- tests: every test class carries the Unit trait (src/Mediator.cs:1)\n- nope: unknown partition src/Mediator.cs\n"
            "- bare line without a colon\n\n## Gaps addressed\n- g1: id is non-null\n")
        rc, out, err = self.run_cmd(orchestrator.cmd_ingest, stdin=None, phase=1, source_file=str(summary))
        self.assertEqual(rc, 0)
        self.assertIn("(builder): 2 fact(s) added, 2 dropped; 1 gap(s) resolved", out)
        self.assertIn("unknown partition", err)
        facts = orchestrator.load_facts(str(self.root))
        self.assertEqual(sorted(facts), ["patterns", "tests"])
        self.assertIn("_(p1 builder)_", facts["patterns"][0])
        events = [json.loads(l)["event"] for l in (self.sd / "events.jsonl").read_text().splitlines()]
        self.assertIn("facts_ingest", events)
        self.assertIn("gap_resolved", events)
        # idempotent: a second ingest adds nothing
        rc, out, _ = self.run_cmd(orchestrator.cmd_ingest, stdin=None, phase=1, source_file=str(summary))
        self.assertIn("0 fact(s) added", out)

    def test_resume_shows_gap_and_fact_counts(self):
        self.run_cmd(orchestrator.cmd_gaps, stdin=json.dumps(ANALYST), action="write")
        orchestrator.facts_add(str(self.root), "domain", ["x lives in src/Mediator.cs"])
        rc, out, _ = self.run_cmd(orchestrator.cmd_resume, stdin=None)
        self.assertIn("gap pass:       2 finding(s), 2 open", out)
        self.assertIn("facts:          1 recorded", out)


if __name__ == "__main__":
    unittest.main()
