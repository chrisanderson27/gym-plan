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
o = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(o)

RUN = """# Orchestration run

PRD: docs/prd.md
Autonomy gate: commit

| # | phase | depends on | status | commit | artifact / note |
|---|-------|------------|--------|--------|-----------------|
| 1 | data model | - | pending | abc123 | - |
| 2 | drawer | 1 | pending | - | - |
| 3 | logout | - | pending | - | - |
"""
CONFIG = '''[validation]
levels = [{ name = "unit", cmd = "true" }]
[surface]
paths = [{name = "auth", globs = ["src/auth/", "*.sql"], risk = true}, {name = "docs", globs = ["docs/"], risk = false}]
'''


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sd = self.root / ".agents/orchestrator"
        self.sd.mkdir(parents=True)
        (self.sd / "RUN.md").write_text(RUN)
        (self.root / ".claude").mkdir()
        (self.root / ".claude/orchestrator.toml").write_text(CONFIG)
        self.cfg, _ = o.load_config(str(self.root))

    def ns(self, **kw):
        fields = dict(root=str(self.root), phase=3, plan=None, summary=False, action="write",
                      source_file=None, by=None, replace=False, stage="builder")
        return argparse.Namespace(**(fields | kw))

    def run_cmd(self, fn, stdin="", **kw):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch("sys.stdin", io.StringIO(stdin)):
            rc = fn(self.ns(**kw))
        return rc, out.getvalue(), err.getvalue()

    def plan(self, text="## TOUCH SET\n- src/auth/login.py (modify)\n"):
        path = self.root / "plan.md"
        path.write_text(text)
        return str(path)

    def rate(self, text=None):
        return o.compute_risk(str(self.root), self.cfg, 3, self.plan(text) if text is not None else None)

    def risk(self, phase=3, rating="high"):
        path = Path(o._risk_path(str(self.root), phase))
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"risk": rating, "source": ["surface"]}))
        return path

    def gaps(self, risks, **kw):
        return o.gaps_write(str(self.root), {"risk": risks}, **kw)

    def events(self):
        return [json.loads(line) for line in (self.sd / "events.jsonl").read_text().splitlines()]


class GapRisk(Base):
    def test_valid_risk_and_findings_count(self):
        kept, dropped = self.gaps([{"phase": 3, "risk": "high", "why": "auth"},
                                   {"phases": [2], "risk": "normal"}])
        self.assertEqual((kept, dropped), ([], []))
        data = o.load_gaps(str(self.root))
        self.assertEqual(data["risk"], {"3": {"risk": "high", "why": "auth", "source": "analyst"},
                                        "2": {"risk": "normal", "why": "", "source": "analyst"}})
        self.assertIn("## Risk\n\n- P3 high: auth", (self.sd / "gaps.md").read_text())
        self.assertIn("0 finding(s), 0 dropped; risk 1 high", self.events()[-1]["detail"])

    def test_malformed_are_dropped_and_reported(self):
        risks = [{"phase": 9, "risk": "high", "why": "auth"}, {"phase": 1, "risk": "bad"},
                 {"phase": 2, "risk": "high"}, {"phases": [1, 2], "risk": "normal"}, "bad"]
        rc, out, err = self.run_cmd(o.cmd_gaps, json.dumps({"risk": risks}))
        self.assertEqual(rc, 0)
        self.assertIn("0 finding(s) recorded, 5 dropped", out)
        self.assertIn("risk: 0 high, 0 normal", out)
        self.assertEqual(err.count("dropped:"), 5)
        for text in ("not in RUN.md", "high or normal", "why is empty", "exactly one phase"):
            self.assertIn(text, err)

    def test_omitted_preserves_empty_and_replace_clear(self):
        self.gaps([{"phase": 3, "risk": "high", "why": "auth"}])
        o.gaps_write(str(self.root), {"findings": []})
        self.assertEqual(o.gap_risk(str(self.root), 3)["risk"], "high")
        self.gaps([])
        self.assertEqual(o.load_gaps(str(self.root))["risk"], {})
        self.assertNotIn("## Risk", (self.sd / "gaps.md").read_text())
        self.gaps([{"phase": 3, "risk": "normal"}])
        o.gaps_write(str(self.root), {}, replace=True)
        self.assertNotIn("risk", o.load_gaps(str(self.root)))

    def test_new_risk_replaces_whole_map_and_high_wins_duplicates(self):
        self.gaps([{"phase": 1, "risk": "normal"}])
        for risks in ([{"phase": 3, "risk": "high", "why": "auth"}, {"phase": 3, "risk": "normal"}],
                      [{"phase": 3, "risk": "normal"}, {"phase": 3, "risk": "high", "why": "auth"}]):
            self.gaps(risks)
            self.assertEqual(list(o.load_gaps(str(self.root))["risk"]), ["3"])
            self.assertEqual(o.gap_risk(str(self.root), 3)["risk"], "high")

    def test_unknown_without_table_is_dropped(self):
        (self.sd / "RUN.md").write_text("")
        self.assertEqual(len(self.gaps([{"phase": 3, "risk": "normal"}])[1]), 1)


class Rating(Base):
    def test_touch_set_matches_surface_only(self):
        for path in ("src/auth/login.py", "migration.sql", "src/", "./src/auth/login.py"):
            with self.subTest(path=path):
                rec = self.rate(f"## TOUCH SET\n- {path} (modify)\n")
                self.assertEqual(rec["risk"], "high")
                self.assertEqual(rec["source"], ["surface"])
        for path in ("docs/x.md", "tests/test_x.py", "unrelated.py"):
            with self.subTest(path=path):
                self.assertEqual(self.rate(f"## TOUCH SET\n- {path}\n")["risk"], "normal")

    def test_reading_paths_are_not_touch_set(self):
        rec = self.rate("## Read these files\n- src/auth/login.py\n## TOUCH SET\n- docs/x.md\n")
        self.assertEqual(rec["risk"], "normal")

    def test_directory_touch_set_matches_wildcard_led_globs(self):
        for entry, glob in (("src/migrations/", "**/migrations/**"),
                            ("./src/auth/", "*/auth/*"),
                            ("src/auth/", "?rc/auth/*"),
                            ("src/auth/", "[s]rc/auth")):
            with self.subTest(entry=entry, glob=glob):
                self.cfg["surface"]["paths"] = [{"name": "sensitive", "globs": [glob], "risk": True}]
                rec = self.rate(f"## TOUCH SET\n- {entry}\n")
                self.assertEqual(rec["risk"], "high")
                self.assertEqual(rec["surface"], [{"category": "sensitive", "path": entry}])
                self.assertEqual(self.rate("## TOUCH SET\n- other/unrelated.py\n")["risk"], "normal")

    def test_directory_touch_set_matches_possible_descendants(self):
        for entry, glob, risk in (
                ("db/migrations/", "db/migrations/*.sql", "high"),
                ("db/migrations/", "**/migrations/*.sql", "high"),
                ("src/auth/", "*/auth/*.py", "high"),
                ("src/", "src/auth/**", "high"),
                ("src/", "**/auth/**", "high"),
                ("other/", "*.sql", "normal"),
                ("src/", "other/auth/*.py", "normal"),
                ("src/auth/", "src/**/auth/*.py", "high"),
                ("src/app/auth/", "src/**/auth/*.py", "high"),
                ("src/auth/nested/", "src/*/", "high")):
            with self.subTest(entry=entry, glob=glob):
                self.cfg["surface"]["paths"] = [{"name": "sensitive", "globs": [glob], "risk": True}]
                rec = self.rate(f"## TOUCH SET\n- {entry}\n")
                self.assertEqual(rec["risk"], risk)
                self.assertEqual(rec["surface"], [{"category": "sensitive", "path": entry}]
                                 if risk == "high" else [])

    def test_gap_only_without_plan_or_touch_set(self):
        self.gaps([{"phase": 3, "risk": "high", "why": "auth"}])
        for text, note in ((None, "no plan (gap pass only)"),
                           ("## Read these files\n- src/auth/login.py", "no touch set (gap pass only)")):
            rec = self.rate(text)
            self.assertEqual(rec["source"], ["gap pass"])
            self.assertIn(note, rec["notes"])

    def test_absent_surface_and_gap_is_normal(self):
        self.cfg.pop("surface")
        rec = self.rate("## TOUCH SET\n- src/auth/login.py\n")
        self.assertEqual(rec["risk"], "normal")
        self.assertIn("[surface] absent", rec["notes"])
        self.assertIn("no gap-pass rating", rec["notes"])

    def test_gap_and_surface_sources(self):
        self.gaps([{"phase": 3, "risk": "high", "why": "auth"}])
        self.assertEqual(self.rate("## TOUCH SET\n- src/auth/login.py\n")["source"], ["gap pass", "surface"])

    def test_empty_paths_and_unreadable_plan(self):
        self.cfg["surface"]["paths"] = []
        self.assertEqual(self.rate("## TOUCH SET\n- src/auth/login.py\n")["risk"], "normal")
        rec = o.compute_risk(str(self.root), self.cfg, 3, str(self.root / "missing"))
        self.assertEqual(rec["risk"], "normal")
        self.assertTrue(any(n.startswith("plan unreadable:") for n in rec["notes"]))

    def test_deduplicated_and_capped(self):
        text = "## TOUCH SET\n" + "- src/auth/x.py\n" * 2
        self.assertEqual(len(o.plan_risk_hits(text, o._surface_cfg(self.cfg))), 1)
        text += "".join(f"- src/auth/{n}.py\n" for n in range(25))
        self.assertEqual(len(o.plan_risk_hits(text, o._surface_cfg(self.cfg))), 20)

    def test_matching_semantics_and_test_globs_ignored(self):
        self.assertTrue(o._touch_hits_globs("src/auth/", ["src/"]))
        self.assertTrue(o._touch_hits_globs("src/a/b.sql", ["*.sql"]))
        self.assertFalse(o._touch_hits_globs("other/", ["*.sql"]))
        self.cfg["surface"]["test_globs"] = ["src/auth/"]
        self.assertEqual(self.rate("## TOUCH SET\n- src/auth/x.py\n")["risk"], "high")


class RiskRouting(Base):
    def route(self, stage="builder", phase=3):
        rc, out, err = self.run_cmd(o.cmd_routing, stage=stage, phase=phase)
        self.assertEqual(rc, 0, err)
        return json.loads(out)

    def test_high_raises_default_builder(self):
        self.risk()
        route = self.route()
        self.assertEqual(route["argv"], ["--model", "sonnet", "--effort", "medium"])
        self.assertTrue(route["risk"]["applied"])
        self.assertEqual(route["agent_args"][:4], route["argv"])
        self.assertTrue(Path(route["agent_args"][-1]).is_file())

    def test_normal_missing_and_phaseless_equal_old_route(self):
        for phase, risk in ((3, "normal"), (None, "high"), (2, "high")):
            self.risk(rating=risk)
            route = self.route(phase=phase)
            expected = o.stage_route(str(self.root), "builder")
            self.assertEqual({k: route[k] for k in expected}, expected)
            self.assertNotIn("risk", route)

    def test_explicit_builder_untouched_at_every_effort(self):
        self.risk()
        for effort in ("low", "medium", "high", "max"):
            entry = {"kind": "claude", "model": "custom", "effort": effort,
                     "argv": ["--model", "custom", "--effort", effort]}
            (self.sd / "routing.json").write_text(json.dumps({"stages": {"builder": entry}}))
            route = self.route()
            self.assertEqual(route["argv"], entry["argv"])
            self.assertEqual(route["effort"], effort)
            self.assertFalse(route["risk"]["applied"])
            self.assertIn("routing.json", route["risk"]["reason"])

    def test_other_stages_and_corrupt_record_unchanged(self):
        path = self.risk()
        for stage in ("planner", "reviewer", "e2e"):
            route = self.route(stage)
            self.assertNotIn("risk", route)
            self.assertEqual(route["argv"], o.stage_route(str(self.root), stage)["argv"])
        for content in ("{", "[]"):
            path.write_text(content)
            self.assertNotIn("risk", self.route())

    def test_effort_never_lowers_and_non_claude_guard(self):
        for cur, expected in (("low", "medium"), ("medium", "medium"), ("high", "high"),
                              ("max", "max"), ("unknown", "unknown"), (None, None)):
            self.assertEqual(o._raise_effort(cur), expected)
        self.risk()
        with mock.patch.dict(o.DEFAULT_ROUTING, {"builder": {"kind": "codex", "model": "x", "effort": "low"}}):
            route = o.stage_route(str(self.root), "builder", 3)
        self.assertFalse(route["risk"]["applied"])
        self.assertEqual(route["effort"], "low")

    def test_fix_tab_worker_start_records_medium(self):
        self.risk()
        args = self.ns(action="open", stage="fix", suffix=None, fresh=False, cwd=None, env=None, wait_ms=1)
        result = {"result": {"tab": {"tab_id": "t1"}, "root_pane": {"pane_id": "p1"}}}
        with mock.patch.dict(o.os.environ, {"HERDR_WORKSPACE_ID": "ws"}), \
                mock.patch.object(o, "_herdr", return_value=(0, json.dumps(result), "")):
            rc, _, err = self.run_cmd(o.cmd_tab, **vars(args))
        self.assertEqual(rc, 0, err)
        event = next(e for e in self.events() if e["event"] == "worker_start")
        self.assertEqual((event["stage"], event["phase"], event["effort"]), ("fix", 3, "medium"))


class RiskCommand(Base):
    def test_record_token_event_and_byte_preservation(self):
        plan = self.plan()
        rc, out, _ = self.run_cmd(o.cmd_risk, plan=plan)
        self.assertEqual(rc, 0)
        token = "risk: high (surface: auth) · builder effort medium"
        self.assertIn(token, out)
        expected = RUN.replace("| 3 | logout | - | pending | - | - |", f"| 3 | logout | - | pending | - | {token} |")
        self.assertEqual((self.sd / "RUN.md").read_text(), expected)
        rec = o.load_risk(str(self.root), 3)
        self.assertEqual(rec["source"], ["surface"])
        self.assertTrue(rec["route"]["applied"])
        event = self.events()[-1]
        self.assertEqual((event["event"], event["risk"], event["source"], event["applied"]),
                         ("phase_risk", "high", ["surface"], True))
        self.run_cmd(o.cmd_risk, plan=plan)
        self.assertEqual((self.sd / "RUN.md").read_text(), expected)
        self.run_cmd(o.cmd_risk, plan=self.plan("## TOUCH SET\n- docs/x.md\n"))
        self.assertEqual((self.sd / "RUN.md").read_text(), RUN.replace("| 3 | logout | - | pending | - | - |", "| 3 | logout | - | pending | - | risk: normal |"))

    def test_explicit_entry_explained_in_run_note(self):
        (self.sd / "routing.json").write_text(json.dumps({"stages": {"builder": {"kind": "claude", "effort": "low"}}}))
        rc, _, _ = self.run_cmd(o.cmd_risk, plan=self.plan())
        self.assertEqual(rc, 0)
        self.assertIn("effort not raised (explicit routing.json builder entry)", (self.sd / "RUN.md").read_text())

    def test_default_plan_path_and_plan_skipped(self):
        o._emit(str(self.root), "plan_done", phase=3, detail=self.plan())
        self.assertEqual(self.run_cmd(o.cmd_risk)[0], 0)
        self.assertEqual(o.load_risk(str(self.root), 3)["risk"], "high")
        self.gaps([{"phase": 3, "risk": "high", "why": "auth"}])
        o._emit(str(self.root), "plan_skipped", phase=3)
        self.run_cmd(o.cmd_risk)
        self.assertEqual(o.load_risk(str(self.root), 3)["source"], ["gap pass"])

    def test_summary_surface_commits_then_run_fallback(self):
        self.risk(1)
        self.risk(2, "normal")
        surface = self.sd / "phase-1/surface.json"
        surface.write_text(json.dumps({"commits": ["c1", "c2"]}))
        rc, out, _ = self.run_cmd(o.cmd_risk, summary=True)
        self.assertEqual(rc, 0)
        self.assertIn("P1 high surface commits: c1, c2", out)
        self.assertTrue(out.endswith("high-risk phases: 1\n"))
        self.assertNotIn("P2", out)
        surface.unlink()
        self.assertIn("commits: abc123", self.run_cmd(o.cmd_risk, summary=True)[1])

    def test_no_state_and_no_high(self):
        self.assertEqual(self.run_cmd(o.cmd_risk, summary=True)[1], "high-risk phases: 0\n")
        self.assertEqual(self.run_cmd(o.cmd_risk)[0], 0)
        self.assertEqual(o.load_risk(str(self.root), 3)["risk"], "normal")
        self.assertEqual(self.run_cmd(o.cmd_risk, root=str(self.root / "missing"))[0], 3)

    def test_compute_failure_records_normal_and_emits(self):
        with mock.patch.object(o, "compute_risk", side_effect=RuntimeError("boom")):
            rc, out, _ = self.run_cmd(o.cmd_risk)
        self.assertEqual(rc, 0)
        self.assertIn("risk: normal", out)
        self.assertIn("rating failed: boom", out)
        self.assertIn("rating failed: boom", o.load_risk(str(self.root), 3)["notes"])
        self.assertEqual(self.events()[-1]["event"], "phase_risk")

    def test_rating_failure_preserves_gap_high_across_rating_steps(self):
        gap = {"risk": "high", "why": "auth", "source": "analyst"}
        self.gaps([{"phase": 3, **gap}])
        for step in ("load_config", "_phase_plan_path", "plan_risk_hits"):
            with self.subTest(step=step), \
                    mock.patch.object(o, step, side_effect=RuntimeError("boom")):
                kwargs = {"plan": self.plan()} if step == "plan_risk_hits" else {}
                rc, out, _ = self.run_cmd(o.cmd_risk, **kwargs)
                self.assertEqual(rc, 0)
                rec = o.load_risk(str(self.root), 3)
                self.assertEqual((rec["risk"], rec["source"], rec["gap"]), ("high", ["gap pass"], gap))
                self.assertTrue(rec["route"]["applied"])
                self.assertIn("risk: high (gap pass)", out)
                self.assertIn("rating failed: boom", out)
                self.assertIn("risk: high (gap pass)", (self.sd / "RUN.md").read_text())
                self.assertEqual((self.events()[-1]["risk"], self.events()[-1]["source"]),
                                 ("high", ["gap pass"]))
                self.assertEqual(o.stage_route(str(self.root), "builder", 3)["effort"], "medium")

    def test_rating_failure_with_unreadable_gap_remains_normal(self):
        (self.sd / "gaps.json").write_text("[]")
        rc, out, _ = self.run_cmd(o.cmd_risk)
        self.assertEqual(rc, 0)
        rec = o.load_risk(str(self.root), 3)
        self.assertEqual((rec["risk"], rec["source"], rec["gap"]), ("normal", [], None))
        self.assertIn("rating failed:", out)

    def test_note_handles_six_cells_without_closing_pipe_and_crlf(self):
        path = self.sd / "RUN.md"
        before = b"| 3 | logout | - | pending | - | -\r\n"
        path.write_bytes(before)
        self.assertTrue(o._set_phase_note(str(self.root), 3, "risk: normal"))
        self.assertEqual(path.read_bytes(), before.replace(b"| -\r\n", b"| risk: normal\r\n"))
        self.assertFalse(o._set_phase_note(str(self.root), 3, "risk: normal"))

    def test_note_preserves_existing_text_and_short_rows(self):
        path = self.sd / "RUN.md"
        path.write_text(RUN.replace("| 3 | logout | - | pending | - | - |", "| 3 | logout | - | pending | - | plan: skipped (trivial) |"))
        o._set_phase_note(str(self.root), 3, "risk: normal")
        self.assertIn("plan: skipped (trivial) · risk: normal", path.read_text())
        path.write_bytes(b"| 3 | short | - | pending | - |\r\n")
        before = path.read_bytes()
        self.assertFalse(o._set_phase_note(str(self.root), 3, "risk: normal"))
        self.assertEqual(path.read_bytes(), before)


class Telemetry(Base):
    def test_rollup_counts_high_phases(self):
        for event, phase, risk in (("phase_risk", 1, "high"), ("run_start", None, None),
                                   ("phase_risk", 2, "normal"), ("phase_risk", 2, "high"),
                                   ("phase_risk", 3, "normal")):
            o._emit(str(self.root), event, phase=phase, risk=risk)
        rc, _, err = self.run_cmd(o.cmd_telemetry)
        self.assertEqual(rc, 0, err)
        self.assertIn("- high-risk phases: 1 (P2)", (self.sd / "telemetry.md").read_text())


class Docs(unittest.TestCase):
    def test_high_risk_review_policy_under_q3_options_2_3_and_4(self):
        base = SCRIPT.parents[1]
        skill = (base / "SKILL.md").read_text()
        kickoff = (base / "reference/kickoff.md").read_text().split("Then log one `stage_skipped`", 1)[1].split("Also write", 1)[0]
        self.assertNotIn("Q3 option 2", kickoff)
        self.assertIn("Q3 option 3", kickoff)
        step5 = skill.split("**5. Coupling check", 1)[1].split("**6.", 1)[0]
        self.assertIn("[risk-routing.md](reference/risk-routing.md)", step5)
        self.assertNotIn("Q3 option 1,", step5)
        self.assertIn("Q3 option 2: high-risk only (trigger 4)", step5)
        policy = (base / "reference/risk-routing.md").read_text().split("## Review timing", 1)[1].split("##", 1)[0]
        self.assertIn("Q3 option 2", policy)
        self.assertIn("high phases still run the step-5 architecture check", policy)
        self.assertIn("Normal phases skip step 5 regardless of coupling signals", policy)
        self.assertIn("Q3 option 3", policy)
        self.assertIn("full per-phase two-axis review subsumes the architecture check", policy)
        option4 = policy.split("**Q3 option 4:**", 1)[1].split("\n\n", 1)[0]
        self.assertIn("high phases still run the step-5 architecture check", option4)
        self.assertIn("after verify and before commit", option4)
        self.assertIn("even with no coupling signal", option4)
        self.assertIn("midpoint and final full reviews", option4)
        self.assertIn("For high phases under options 1, 2, 3 and 4, record `review: forced (high risk)`", policy)
        self.assertIn("On options 1, 2 and 4 use the existing step-5 worker and R2 triage", policy)
        self.assertIn("On option 3 the token records intent; the per-phase review entry is the evidence", policy)
        self.assertIn("review: forced (high risk)", policy)
        self.assertIn("stage_skipped", policy)

    def test_forced_check_and_final_security_axis(self):
        base = SCRIPT.parents[1]
        skill = (base / "SKILL.md").read_text()
        step5 = skill.split("**5. Coupling check", 1)[1].split("**6.", 1)[0]
        self.assertIn("risk.json", step5)
        self.assertIn("forced (high risk)", step5)
        final = (base / "reference/final-review.md").read_text().split("**R1.", 1)[1].split("**R2.", 1)[0]
        for text in ("risk --summary", "review-security.md"):
            self.assertIn(text, final)
        risk = (base / "reference/risk-routing.md").read_text()
        for text in ("critical/high/medium/low", "review-security.md", "verify-before-fix", "sonnet", "medium"):
            self.assertIn(text, risk)

    def test_gap_pass_documents_risk(self):
        text = (SCRIPT.parents[1] / "reference/gap-pass.md").read_text()
        self.assertIn('"risk"', text)
        self.assertIn("risk-routing.md", text)


if __name__ == "__main__":
    unittest.main()
