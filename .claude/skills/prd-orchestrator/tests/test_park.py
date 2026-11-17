"""State swaps preserve the parked run and refuse unsafe boundaries without writes."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

SKILL = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("orchestrator", SKILL / "scripts/orchestrator.py")
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)
FIXTURE = SKILL / "tests/fixtures/parked-prd-3"
SLUG = "prd-3-bench-reproducibility"
RID = "dfe8e1147d0d"


def git(*argv, cwd):
    return subprocess.run(["git", *argv], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def ns(root, **kw):
    return argparse.Namespace(root=str(root), **kw)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patch = mock.patch.dict(os.environ)
        patch.start()
        self.addCleanup(patch.stop)
        for key in list(os.environ):
            if key.startswith("ORCH_"):
                os.environ.pop(key)
        git("init", "-q", cwd=self.root)
        git("config", "user.name", "Test", cwd=self.root)
        git("config", "user.email", "test@example.invalid", cwd=self.root)
        git("config", "commit.gpgsign", "false", cwd=self.root)
        git("config", "core.hooksPath", str(self.root / "no-hooks"), cwd=self.root)
        (self.root / ".gitignore").write_text(".agents/\n.claude/\n")
        git("add", ".gitignore", cwd=self.root)
        git("commit", "-qm", "base", cwd=self.root)
        self.head = git("rev-parse", "HEAD", cwd=self.root)
        self.sd = self.root / ".agents/orchestrator"
        self.sd.mkdir(parents=True)
        self.parked = self.root / ".agents/orchestrator-parked" / SLUG
        self.write_run()

    def write_run(self, status="pending", commit="-", base=None):
        (self.sd / "RUN.md").write_text(
            f"PRD: {SLUG}.md\nRun id: {RID}\nBase commit: {base or self.head}\n"
            "| # | phase | depends on | status | commit | note |\n"
            "|---|---|---|---|---|---|\n"
            f"| 1 | first | - | committed | {commit} | - |\n"
            "| 2 | second | 1 | committed | - | - |\n"
            f"| 5 | last | 2 | {status} | - | - |\n")
        (self.sd / "events.jsonl").write_text(json.dumps(
            {"event": "run_start", "run_id": RID, "ts": "2026-01-01T00:00:00Z"}) + "\n")

    def call(self, fn, **kw):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = fn(ns(self.root, **kw))
        return rc, out.getvalue(), err.getvalue()

    def park(self, reason=None, force=False, allow_dirty=False):
        return self.call(orchestrator.cmd_park, reason=reason, force=force, allow_dirty=allow_dirty)

    def unpark(self, slug=SLUG, force=False):
        return self.call(orchestrator.cmd_unpark, slug=slug, force=force)

    def fixture(self, dest=None):
        dest = dest or self.sd
        dest.mkdir(parents=True, exist_ok=True)
        for name in ("RUN.md", "events.jsonl", "tabs.json"):
            shutil.copy2(FIXTURE / name, dest / name)

    def snapshot(self):
        return {str(p.relative_to(self.root / ".agents")): p.read_bytes()
                for p in (self.root / ".agents").rglob("*") if p.is_file()}

    def refused(self, action, **kw):
        before = self.snapshot()
        rc, out, err = action(**kw)
        self.assertEqual(rc, 1, out + err)
        self.assertTrue(err)
        self.assertEqual(self.snapshot(), before)
        return err


class ParkInstructionsTests(unittest.TestCase):
    def test_rewrites_preserve_all_park_and_resume_metadata(self):
        text = (SKILL / "SKILL.md").read_text()
        kickoff = (SKILL / "reference/kickoff.md").read_text().split("keep that line whenever you rewrite RUN.md.", 1)[1].split("Then log", 1)[0]
        advance = text.split("**7. Advance.**", 1)[1].split("**Usage is captured", 1)[0]
        for section in (kickoff, advance):
            with self.subTest(section=section):
                self.assertIn("every `## Parked` block", section)
                self.assertIn("every `Resumed:` line", section)
                self.assertIn("verbatim", section)

    def test_q4_records_committed_phase_before_park_check(self):
        text = (SKILL / "SKILL.md").read_text()
        q4 = text.split("**Q4 stop conditions.**", 1)[1].split("**7. Advance.**", 1)[0]
        before_check = q4.split("PARK-REQUESTED", 1)[0]
        self.assertIn("write RUN.md", before_check)
        self.assertIn("`committed`", before_check)
        self.assertIn("digest", before_check)
        self.assertNotIn("Otherwise write RUN.md", q4)


class ParkTests(Base):
    def test_fixture_shape_and_liveness(self):
        block = orchestrator._parked_block((FIXTURE / "RUN.md").read_text())
        self.assertEqual(block["parked"], "2026-10-19T13:58:00Z")
        self.assertEqual(block["parked_head"], "34ff52c2cb59d5cafba6c7c4ef5ed6b524fb350d")
        self.assertTrue(block["reason"].startswith("parked by hand"))
        self.fixture()
        self.assertEqual(orchestrator._run_events_state(str(self.sd)), "live")

    def test_round_trip_preserves_bytes_and_events(self):
        self.fixture()
        before = {name: (self.sd / name).read_bytes() for name in ("RUN.md", "events.jsonl", "tabs.json")}
        self.assertEqual(self.park(reason="pause\nfor later")[0], 0)
        self.assertEqual(self.unpark()[0], 0)
        run = (self.sd / "RUN.md").read_bytes()
        self.assertTrue(run.startswith(before["RUN.md"]))
        suffix = run[len(before["RUN.md"]):].decode()
        self.assertTrue(suffix.startswith("\n## Parked\n- Parked: "))
        self.assertIn(f"- Parked HEAD: {self.head}\n- Reason: pause for later\n", suffix)
        self.assertRegex(suffix, f"Resumed: {self.head} → {self.head} \\(\\d{{4}}-\\d{{2}}-\\d{{2}}\\)\n$")
        self.assertEqual(len(orchestrator._parked_blocks(run.decode())), 2)
        self.assertEqual(orchestrator._parked_block(run.decode())["parked_head"], self.head)
        events = (self.sd / "events.jsonl").read_bytes()
        self.assertTrue(events.startswith(before["events.jsonl"]))
        added = [json.loads(line) for line in events[len(before["events.jsonl"]):].splitlines()]
        self.assertEqual([e["event"] for e in added], ["run_end", "run_resumed"])
        self.assertEqual(added[0]["detail"], "parked")
        self.assertEqual(added[1]["run_id"], RID)
        self.assertEqual(added[1]["detail"], f"{self.head}..{self.head}")
        self.assertEqual((self.sd / "tabs.json").read_bytes(), before["tabs.json"])
        self.assertEqual(orchestrator._run_events_state(str(self.sd)), "live")

    def test_hand_parked_unpark(self):
        shutil.rmtree(self.sd)
        self.fixture(self.parked)
        self.assertEqual(self.unpark()[0], 0)
        self.assertIn("Resumed: 34ff52c2cb59", (self.sd / "RUN.md").read_text())

    def test_park_outputs_two_json_lines(self):
        self.fixture()
        rc, out, err = self.park()
        self.assertEqual(rc, 0, err)
        lines = out.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(json.loads(lines[0]), {"panes": ["w4Y:pV", "w4Y:pW"]})
        self.assertEqual(json.loads(lines[-1]), {"parked": SLUG, "dest": f".agents/orchestrator-parked/{SLUG}"})
        self.assertFalse((self.sd / "RUN.md").exists())

    def test_mid_phase_refused_force_allows_status_only(self):
        for status in ("building", "review", "held", "failed"):
            with self.subTest(status=status):
                self.write_run(status)
                self.assertIn(status, self.refused(self.park))
        self.assertEqual(self.park(force=True)[0], 0)

    def test_dirty_refused_even_with_force(self):
        (self.root / "x.txt").write_text("dirty")
        self.refused(self.park)
        self.refused(self.park, force=True)

    def test_allow_dirty_parks_and_records_unrelated_paths(self):
        (self.root / "x.txt").write_text("dirty")
        self.assertIn("--allow-dirty", self.refused(self.park))
        self.assertEqual(self.park(allow_dirty=True)[0], 0)
        self.assertIn("Dirty at park (1, not this run's): x.txt", (self.parked / "RUN.md").read_text())

    def test_allow_dirty_still_refuses_a_path_the_run_committed(self):
        (self.root / "lesson.md").write_text("v1")
        git("add", "lesson.md", cwd=self.root)
        git("commit", "-qm", "phase 1", cwd=self.root)
        self.write_run(commit=git("rev-parse", "--short=10", "HEAD", cwd=self.root))
        (self.root / "lesson.md").write_text("v2, uncommitted")
        self.assertIn("lesson.md", self.refused(self.park, allow_dirty=True))

    def test_baseline_untracked_allowed(self):
        (self.root / "x.txt").write_text("dirty")
        (self.sd / "baseline-dirty").mkdir()
        (self.sd / "baseline-dirty/untracked.txt").write_text("x.txt\n")
        self.assertEqual(self.park()[0], 0)

    def test_baseline_porcelain_directory_and_rename_destination(self):
        (self.root / "notes").mkdir()
        (self.root / "notes/new.txt").write_text("dirty")
        (self.root / "renamed.txt").write_text("dirty")
        (self.sd / "baseline-dirty").mkdir()
        (self.sd / "baseline-dirty/files.txt").write_text("?? notes/\nR  old.txt -> renamed.txt\n")
        self.assertEqual(self.park()[0], 0)

    def test_allow_daily_prefix(self):
        daily = self.root / "memory/daily/2026-10-20.md"
        daily.parent.mkdir(parents=True)
        daily.write_text("log")
        self.refused(self.park)
        (self.root / ".claude").mkdir()
        (self.root / ".claude/orchestrator.toml").write_text('[park]\nallow_dirty = ["memory/daily/"]\n')
        self.assertEqual(self.park()[0], 0)

    def test_gate_failure_uncommitted_and_noninteger_refused(self):
        for phase in ("5", "x"):
            marker = self.sd / f"GATE-FAILED-reviewer-{phase}"
            marker.write_text("failed")
            self.refused(self.park)
            self.refused(self.park, force=True)
            marker.unlink()

    def test_committed_gate_failure_allowed(self):
        (self.sd / "GATE-FAILED-reviewer-2").write_text("old")
        self.assertEqual(self.park()[0], 0)

    def test_slug_collision_refused(self):
        self.parked.mkdir(parents=True)
        self.refused(self.park)

    def test_no_run_refused(self):
        (self.sd / "RUN.md").unlink()
        self.assertIn("no run", self.refused(self.park))

    def test_ended_run_refused(self):
        orchestrator._emit(str(self.root), "run_end", detail="completed")
        self.assertIn("ended", self.refused(self.park))

    def test_liveness_none_then_resumed_after_end(self):
        (self.sd / "events.jsonl").write_text('bad json\n{}\n')
        self.assertEqual(orchestrator._run_events_state(str(self.sd)), "none")
        orchestrator._emit(str(self.root), "run_end", detail="parked")
        self.assertEqual(orchestrator._run_events_state(str(self.sd)), "ended")
        orchestrator._emit(str(self.root), "run_resumed")
        self.assertEqual(orchestrator._run_events_state(str(self.sd)), "live")

    def test_unpark_live_refused_force_archives(self):
        self.fixture(self.parked)
        self.refused(self.unpark)
        self.assertEqual(self.unpark(force=True)[0], 0)
        self.assertTrue((self.root / ".agents/orchestrator-archive" / SLUG / "RUN.md").exists())

    def test_unpark_finished_archives_leftovers(self):
        self.fixture(self.parked)
        orchestrator._emit(str(self.root), "run_end", detail="completed")
        (self.sd / "routing.json").write_text('{}')
        self.assertEqual(self.unpark()[0], 0)
        self.assertTrue((self.root / ".agents/orchestrator-archive" / SLUG / "routing.json").exists())

    def test_unpark_invalid_and_unknown_slugs(self):
        for slug in ("../x", "..", "unknown"):
            with self.subTest(slug=slug):
                self.refused(self.unpark, slug=slug)

    def test_unpark_unarchived_files_refused(self):
        self.fixture(self.parked)
        (self.sd / "RUN.md").unlink()
        self.assertIn("unexpected files", self.refused(self.unpark))

    def test_learnings_union(self):
        (self.sd / "learnings.jsonl").write_text('{"class":"one"}\n')
        self.assertEqual(self.park()[0], 0)
        self.assertEqual(sorted(p.name for p in self.sd.iterdir()), ["learnings.jsonl"])
        with (self.sd / "learnings.jsonl").open('a') as stream:
            stream.write('{"class":"two"}\n')
        self.assertEqual(self.unpark()[0], 0)
        self.assertEqual((self.sd / "learnings.jsonl").read_text(), '{"class":"one"}\n{"class":"two"}\n')

    def test_request_reason_and_park_unpark_cleanup(self):
        request = self.sd / "PARK-REQUESTED"
        request.write_text('{"reason":"switch work","at":"today"}')
        self.assertEqual(self.park()[0], 0)
        self.assertFalse((self.parked / request.name).exists())
        self.assertEqual(orchestrator._parked_block((self.parked / "RUN.md").read_text())["reason"], "switch work")
        (self.parked / request.name).write_text("stale")
        self.assertEqual(self.unpark()[0], 0)
        self.assertFalse(request.exists())

    def test_plain_text_request_reason(self):
        (self.sd / "PARK-REQUESTED").write_text("\nplain reason\nignored\n")
        self.assertEqual(self.park()[0], 0)
        self.assertEqual(orchestrator._parked_block((self.parked / "RUN.md").read_text())["reason"], "plain reason")

    def test_archive_clears_all_per_run_state(self):
        for name in ("PARK-REQUESTED", "GATE-FAILED-reviewer-5"):
            (self.sd / name).write_text("old")
        for name in ("baseline-dirty", "known-failures"):
            (self.sd / name).mkdir()
            (self.sd / name / "files.txt").write_text("old")
        dest = Path(orchestrator._archive_run(str(self.sd)))
        for name in ("PARK-REQUESTED", "GATE-FAILED-reviewer-5", "baseline-dirty", "known-failures"):
            self.assertFalse((self.sd / name).exists())
            self.assertTrue((dest / name).exists())

    def test_init_clears_request_with_or_without_run_and_snapshots(self):
        for prior in (True, False):
            with self.subTest(prior=prior):
                if not prior:
                    (self.sd / "RUN.md").unlink()
                (self.sd / "PARK-REQUESTED").write_text("stale")
                (self.root / "x.txt").write_text("dirty")
                rc, out, err = self.call(orchestrator.cmd_init, prd="new.md", gate="commit", force=True)
                self.assertFalse((self.sd / "PARK-REQUESTED").exists())
                self.assertIn("baseline-dirty", out)
                self.assertIn("x.txt", (self.sd / "baseline-dirty/files.txt").read_text())
                self.assertEqual((self.sd / "baseline-dirty/untracked.txt").read_text(), "x.txt\n")
                self.assertEqual((self.sd / "baseline-dirty/preexisting.patch").read_bytes(), b"")

    def test_resume_shows_latest_marker_request_and_parked_runs(self):
        with (self.sd / "RUN.md").open('a') as stream:
            stream.write("Resumed: old\nResumed: latest\n")
        (self.sd / "PARK-REQUESTED").write_text("pause later")
        self.parked.mkdir(parents=True)
        rc, out, _ = self.call(orchestrator.cmd_resume)
        self.assertEqual(rc, 0)
        self.assertIn("Resumed: latest", out)
        self.assertNotIn("Resumed: old", out)
        self.assertIn("!! PARK-REQUESTED: pause later", out)
        self.assertIn(f"parked runs: {SLUG}", out)

    def test_resume_lists_parked_runs_without_live_state(self):
        self.assertEqual(self.park()[0], 0)
        rc, out, _ = self.call(orchestrator.cmd_resume)
        self.assertEqual(rc, 3)
        self.assertIn(f"parked runs: {SLUG}", out)

    def test_log_parked_is_legal(self):
        rc, _, _ = self.call(orchestrator.cmd_log, event="run_end", detail="parked",
                             phase=None, stage=None, sha=None)
        self.assertEqual(rc, 0)
        self.assertEqual(orchestrator._run_events_state(str(self.sd)), "ended")


if __name__ == "__main__":
    unittest.main()
