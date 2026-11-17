"""Surface reporting uses committed phase sets and never participates in gates."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from test_park import git, ns, orchestrator


SKIP = "@unittest." + "skip"


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
        (self.root / ".gitignore").write_text(".agents/\n")
        self.clock = 1700000000
        self.head = self.commit(".gitignore")
        self.sd = self.root / ".agents/orchestrator"
        self.sd.mkdir(parents=True)
        self.write_run()
        (self.sd / "events.jsonl").write_text(json.dumps(
            {"event": "run_start", "run_id": "dfe8e1147d0d"}) + "\n")

    def commit(self, *paths):
        git("add", "--", *(":(literal)" + p for p in paths), cwd=self.root)
        self.clock += 1
        with mock.patch.dict(os.environ, GIT_AUTHOR_DATE=f"{self.clock} +0000",
                             GIT_COMMITTER_DATE=f"{self.clock} +0000"):
            git("commit", "-qm", "fixture", cwd=self.root)
        return git("rev-parse", "HEAD", cwd=self.root)

    def commit_file(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return self.commit(name)

    def delete_file(self, name):
        (self.root / name).unlink()
        return self.commit(name)

    def config(self, surface=True, levels=None, extra=""):
        levels = levels if levels is not None else [{"name": "t", "cmd": "true"}]
        text = "[validation]\nlevels = [" + ",".join(
            '{name=' + json.dumps(lv['name']) + ',cmd=' + json.dumps(lv['cmd']) + '}' for lv in levels) + "]\n"
        if surface:
            text += ('[surface]\npaths = [{name="dependency manifest", globs=["deps/package.json"]}, '
                     '{name="ci", globs=["ci/"], risk=false}]\n' + extra)
        return text

    def setup(self, surface=True, levels=None):
        self.head = self.commit_file(".claude/orchestrator.toml", self.config(surface, levels))
        self.write_run()

    def write_run(self, rows=(), base=None):
        (self.sd / "RUN.md").write_text(
            f"PRD: x.md\nRun id: dfe8e1147d0d\nBase commit: {base or self.head}\n"
            "| # | phase | depends on | status | commit | note |\n"
            "|---|---|---|---|---|---|\n" + "".join(
                f"| {n} | phase | - | committed | {sha} | - |\n" for n, sha in rows))

    def emit_commit(self, sha, phase=1, hook=False):
        orchestrator._emit(str(self.root), "commit", sha=sha, phase=phase,
                           detail="auto-logged by post-commit hook" if hook else "explicit")

    def call(self, fn, **kw):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = fn(ns(self.root, **kw))
        return rc, out.getvalue(), err.getvalue()

    def surface(self, phase=1, sha=None, final=False):
        return self.call(orchestrator.cmd_surface, phase=None if final else phase, sha=sha, final=final)

    def record(self, phase=1):
        return json.loads((self.sd / ("surface-final.json" if phase == "final" else f"phase-{phase}/surface.json")).read_text())

    def events(self):
        return [e for e in orchestrator._run_events(str(self.sd)) if e.get("event") == "surface_hit"]

    def report(self):
        rc, out, _ = self.call(orchestrator.cmd_report, prd="x.md", absorbed=0)
        self.assertEqual(0, rc)
        return (self.sd / "deviations-x.md").read_text(), out

    def scan(self, shas, cfg=None):
        return orchestrator.surface_scan(str(self.root), cfg or orchestrator._surface_cfg(
            orchestrator.load_config(str(self.root))[0]), shas)


class SurfaceTests(Base):
    def test_skill_scans_after_commit_log_before_q4_and_park(self):
        text = (Path(__file__).resolve().parents[1] / "SKILL.md").read_text()
        logged = text.index("log --event commit --phase N --sha <sha>")
        surface = text.index("orchestrator.py surface --phase N")
        self.assertLess(logged, surface)
        self.assertLess(surface, text.index("**Q4 stop conditions.**"))
        self.assertLess(surface, text.index("**Park check.**"))

    def test_no_touch_set_claims_only_newest_phase_hook_before_explicit_log(self):
        self.setup()
        older = self.commit_file("ci/older.yml", "older")
        self.emit_commit(older, hook=True)
        newest = self.commit_file("ci/newest.yml", "phase")
        self.emit_commit(newest, hook=True)
        store = self.commit_file("deps/package.json", "store")
        self.emit_commit(store, hook=True)
        orchestrator._emit(str(self.root), "store_commit", sha=store)
        other = self.commit_file("ci/other.yml", "other phase")
        self.emit_commit(other, phase=2, hook=True)
        for mode in ("plan_skipped", "no_touch_set"):
            with self.subTest(mode=mode):
                if mode == "plan_skipped":
                    orchestrator._emit(str(self.root), "plan_skipped", phase=1)
                else:
                    plan = self.root / "phase-plan.md"
                    plan.write_text("## Plan\nNo touch set.\n")
                    orchestrator._emit(str(self.root), "plan_done", phase=1, detail=str(plan))
                self.assertEqual(0, self.surface()[0])
                self.assertEqual([newest], self.record()["commits"])
                self.assertEqual([], self.record()["notes"])
                self.assertEqual(["ci/newest.yml"], [h["path"] for h in self.record()["hits"]])
        self.write_run([(1, newest)])
        self.emit_commit(newest)
        self.surface()
        self.surface(final=True)
        self.assertEqual([other], self.record("final")["commits"])
        self.assertEqual(["ci/other.yml"], [h["path"] for h in self.record("final")["hits"]])
        text, _ = self.report()
        self.assertNotIn("Phase 1: surface not run", text)
        self.assertIn("Phase 1 touched ci: ci/newest.yml", text)

    def test_unconfigured_notes_only_report_stays_byte_identical(self):
        self.setup(surface=False)
        with mock.patch.object(orchestrator.datetime, "datetime") as clock:
            clock.now.return_value.isoformat.return_value = "2026-11-12T12:00:00"
            before, before_out = self.report()
            pd = self.sd / "phase-1"
            pd.mkdir()
            (pd / "surface.json").write_text(json.dumps(
                {"commits": [], "hits": [], "notes": ["no commits recorded for phase 1"]}))
            (self.sd / "surface-final.json").write_text(json.dumps(
                {"commits": [], "hits": [], "notes": ["scan failed: unavailable"]}))
            after, after_out = self.report()
        self.assertEqual(before.encode(), after.encode())
        self.assertEqual(before_out, after_out)

    def test_missing_scans_sort_by_phase_number_before_final(self):
        self.setup()
        self.write_run([(10, self.head), (2, self.head), (1, self.head)])
        pd = self.sd / "phase-10"
        pd.mkdir()
        (pd / "surface.json").write_text(json.dumps(
            {"commits": [], "hits": [], "notes": ["scan failed: unavailable"]}))
        text, _ = self.report()
        labels = [line for line in text.splitlines() if line.endswith(": surface not run")]
        self.assertEqual(["- Phase 1: surface not run", "- Phase 2: surface not run",
                          "- Phase 10: surface not run", "- Post-phase commits: surface not run"], labels)

    def test_report_renders_scan_notes_and_failed_scan_as_not_run(self):
        self.setup()
        sha = self.commit_file("deps/package.json", "phase")
        self.write_run([(1, sha)])
        with mock.patch.object(orchestrator, "phase_commits", side_effect=RuntimeError("unavailable")):
            self.surface()
        text, out = self.report()
        self.assertIn("Phase 1: scan failed: unavailable", text)
        self.assertIn("Phase 1: surface not run", text)
        self.assertNotIn("Surface hits: none", text)
        self.assertIn("Surface: 0 hit(s), 2 phase(s) not scanned", out)
        record = self.record()
        record["notes"] = ["surface hits truncated at 200", "unparseable TOML", "commit bad not found",
                           "no commits recorded for phase 1"]
        (self.sd / "phase-1/surface.json").write_text(json.dumps(record))
        text, _ = self.report()
        for note in record["notes"]:
            self.assertIn(note, text)

    def test_shared_commit_sources_filter_phase_and_classify_hook_events(self):
        self.setup()
        anchor = self.commit_file("ci/anchor.yml", "anchor")
        explicit = self.commit_file("ci/explicit.yml", "explicit")
        hooked = self.commit_file("ci/hook.yml", "hook")
        other = self.commit_file("ci/other.yml", "other")
        self.write_run([(1, anchor[:7]), (2, other)])
        self.emit_commit(explicit)
        self.emit_commit(hooked, hook=True)
        self.emit_commit(other, phase=2)
        orchestrator._emit(str(self.root), "store_commit", sha=hooked)
        window = orchestrator._run_window(str(self.root))
        anchors, recorded, hooks, store = orchestrator._commit_sources(str(self.root), window, phase=1)
        self.assertEqual({anchor}, anchors)
        self.assertEqual({explicit}, recorded)
        self.assertEqual({hooked}, hooks)
        self.assertEqual({hooked}, store)
        anchors, recorded, _, _ = orchestrator._commit_sources(str(self.root), window)
        self.assertEqual({anchor, other}, anchors)
        self.assertEqual({explicit, other}, recorded)

    def test_config_check_and_runtime_share_surface_validation(self):
        self.setup()
        (self.root / ".claude/orchestrator.toml").write_text(
            '[validation]\nlevels=[{cmd="true"}]\n[surface]\n'
            'paths=[{name="x",globs=["/absolute"]}]\nskip_patterns=[""]\n')
        cfg = orchestrator.load_config(str(self.root))[0]
        problems = []
        normalized = orchestrator._surface_cfg(cfg, problems)
        self.assertEqual([], normalized["paths"])
        self.assertEqual(list(orchestrator.SURFACE_SKIP_PATTERNS), normalized["skip_patterns"])
        rc, out, _ = self.call(orchestrator.cmd_config, check=True)
        self.assertEqual(1, rc)
        self.assertEqual(2, len(problems))
        for problem in problems:
            self.assertIn(problem, out)

    def test_level_read_failure_is_not_a_removed_level(self):
        self.setup()
        sha = self.commit_file(".claude/orchestrator.toml", self.config(levels=[]))
        real_run = orchestrator.subprocess.run

        def unreadable(argv, **kwargs):
            if argv[:2] == ["git", "show"] and argv[-1] == f"{sha}:.claude/orchestrator.toml":
                return orchestrator.subprocess.CompletedProcess(argv, 128, "", "object unreadable")
            return real_run(argv, **kwargs)

        with mock.patch.object(orchestrator.subprocess, "run", side_effect=unreadable):
            hits, notes = self.scan([sha])
        self.assertEqual([], [h for h in hits if h["kind"].startswith("level_")])
        self.assertTrue(any("validation levels skipped" in n for n in notes))
        removed = self.delete_file(".claude/orchestrator.toml")
        self.assertEqual({}, orchestrator._levels_at(str(self.root), removed))
        self.assertIsNone(orchestrator._levels_at(str(self.root), "bad-revision"))

    def test_report_counts_hits_without_parsing_markdown(self):
        self.setup()
        sha = self.commit_file("ci/surface not run.yml", "phase")
        self.write_run([(1, sha)])
        self.surface()
        self.surface(final=True)
        text, out = self.report()
        self.assertIn("ci/surface not run.yml", text)
        self.assertIn("Surface: 1 hit(s), 0 phase(s) not scanned", out)

    def test_hook_only_phase_uses_plan_and_discards_previously_claimed_foreign(self):
        self.setup()
        plan = self.root / "phase-plan.md"
        plan.write_text("## Touch set\n- `ci/phase.yml`\n")
        orchestrator._emit(str(self.root), "plan_done", phase=1, detail=str(plan))
        own = self.commit_file("ci/phase.yml", "phase")
        foreign = self.commit_file("deps/package.json", "foreign")
        self.emit_commit(own, hook=True)
        self.emit_commit(foreign, hook=True)
        pd = self.sd / "phase-1"
        pd.mkdir()
        (pd / "surface.json").write_text(json.dumps({"commits": [foreign], "hits": []}))
        self.surface()
        self.assertEqual([own], self.record()["commits"])
        self.assertEqual(["ci/phase.yml"], [h["path"] for h in self.record()["hits"]])
        plan.write_text("## Touch set\n- `ci/missing.yml`\n")
        self.surface()
        self.assertEqual([], self.record()["commits"])
        self.emit_commit(own)
        self.surface()
        self.assertEqual([own], self.record()["commits"])

    def test_final_scans_attributed_fixes_and_excludes_foreign_even_with_hooks(self):
        self.setup()
        phase = self.commit_file("ci/phase.yml", "phase")
        self.write_run([(1, phase)])
        self.surface()
        plan = self.root / "phase-plan.md"
        plan.write_text("## Touch set\n- `ci/phase.yml`\n")
        orchestrator._emit(str(self.root), "plan_done", phase=1, detail=str(plan))
        fix = self.commit_file("ci/phase.yml", "fix")
        self.emit_commit(fix, hook=True)
        explicit = self.commit_file("ci/final.yml", "explicit final fix")
        self.emit_commit(explicit, phase=None)
        foreign = self.commit_file("deps/package.json", "foreign")
        self.emit_commit(foreign, hook=True)
        for resumed in (False, True):
            with self.subTest(resumed=resumed):
                if resumed:
                    with (self.sd / "RUN.md").open("a") as stream:
                        stream.write("\nResumed: now\n")
                self.surface(final=True)
                self.assertEqual({fix, explicit}, set(self.record("final")["commits"]))
                self.assertNotIn(foreign, self.record("final")["commits"])

    def test_absent_config_and_report_identical(self):
        self.setup(surface=False)
        self.assertEqual(3, self.surface()[0])
        self.assertFalse((self.sd / "phase-1/surface.json").exists())
        self.assertEqual([], self.events())
        first, out = self.report()
        (self.root / ".claude/orchestrator.toml").unlink()
        second, other_out = self.report()
        clean = lambda s: "\n".join(l for l in s.splitlines() if not l.startswith("_Generated"))
        self.assertEqual(clean(first), clean(second))
        self.assertNotIn("Surface", first)
        self.assertNotIn("Surface:", out + other_out)

    def test_path_hit_and_risk_false(self):
        self.setup()
        sha = self.commit_file("deps/package.json", "{}")
        self.write_run([(1, sha[:7])])
        self.emit_commit(sha)
        rc, out, _ = self.surface()
        self.assertEqual(0, rc)
        self.assertEqual("surface: Phase 1 touched dependency manifest: deps/package.json\n", out)
        self.assertTrue(self.record()["hits"][0]["risk"])
        self.assertEqual(1, len(self.events()))
        self.assertEqual(1, self.events()[0]["hits"])
        ci = self.commit_file("ci/x.yml", "ci")
        self.surface(sha=[ci])
        self.assertFalse(self.record()["hits"][-1]["risk"])

    def test_foreign_store_and_unrelated_hooks_excluded(self):
        self.setup()
        foreign = self.commit_file("deps/package.json", "foreign")
        anchor = self.commit_file("ci/phase.yml", "phase")
        store = self.commit_file("deps/package.json", "store")
        self.emit_commit(store, hook=True)
        orchestrator._emit(str(self.root), "store_commit", sha=store)
        unrelated = self.commit_file("notes/x.md", "notes")
        self.emit_commit(unrelated, hook=True)
        self.write_run([(1, anchor)])
        self.emit_commit(anchor)
        self.surface()
        self.assertEqual([anchor], self.record()["commits"])
        self.assertEqual(["ci/phase.yml"], [h["path"] for h in self.record()["hits"]])
        self.assertTrue({foreign, store, unrelated}.isdisjoint(self.record()["commits"]))

    def test_hook_overlap_extra_fix_and_rerun(self):
        self.setup()
        anchor = self.commit_file("deps/package.json", "phase")
        hook = self.commit_file("deps/package.json", "hook fix")
        self.write_run([(1, anchor)])
        plan = self.root / "phase-plan.md"
        plan.write_text("## Touch set\n- `deps/package.json`\n")
        orchestrator._emit(str(self.root), "plan_done", phase=1, detail=str(plan))
        self.emit_commit(hook, hook=True)
        self.surface()
        fix = self.commit_file("ci/a.yml", "fix")
        self.emit_commit(fix, hook=True)
        self.assertEqual(0, self.surface(sha=[fix])[0])
        self.assertEqual({anchor, hook, fix}, set(self.record()["commits"]))
        before = len(self.events())
        rc, out, _ = self.surface()
        self.assertEqual(0, rc)
        self.assertIn("no new hits", out)
        self.assertEqual(before, len(self.events()))
        self.assertIn(fix, self.record()["commits"])
        self.assertIn(anchor, (self.sd / "RUN.md").read_text())

    def test_tests_deleted_skipped_renamed_and_restored(self):
        self.setup()
        self.commit_file("tests/test_a.py", "a\n")
        self.commit_file("tests/test_c.py", "c\n")
        self.commit_file("tests/test_restore.py", "restore\n")
        deleted = self.delete_file("tests/test_a.py")
        skip = self.commit_file("tests/test_b.py", SKIP + "('reason')\n")
        source = self.commit_file("src/a.py", SKIP + "('reason')\n")
        git("mv", "tests/test_c.py", "tests/test_d.py", cwd=self.root)
        renamed = self.commit("tests/test_d.py")
        removed = self.delete_file("tests/test_restore.py")
        restored = self.commit_file("tests/test_restore.py", "restore\n")
        hits, notes = self.scan([deleted, skip, source, renamed, removed, restored])
        self.assertEqual([], notes)
        self.assertEqual({("test_deleted", "tests/test_a.py"), ("test_skipped", "tests/test_b.py")},
                         {(h["kind"], h["path"]) for h in hits})

    def test_equal_timestamps_keep_restore_after_deletion(self):
        self.setup()
        added = self.commit_file("tests/test_equal.py", "original")
        self.clock -= 1
        deleted = self.delete_file("tests/test_equal.py")
        self.clock -= 1
        restored = self.commit_file("tests/test_equal.py", "restored")
        for input_order in ([added, deleted, restored], [restored, deleted, added]):
            shas = orchestrator._surface_order(str(self.root), input_order)
            self.assertEqual([added, deleted, restored], shas)
            self.assertEqual([], self.scan(shas)[0])

    def test_validation_changes_only_in_own_phase(self):
        levels = [{"name": "t", "cmd": "true"}, {"name": "u", "cmd": "echo old"}]
        self.setup(levels=levels)
        changed = self.commit_file(".claude/orchestrator.toml", self.config(levels=[{"name": "u", "cmd": "true"}]))
        added = self.commit_file(".claude/orchestrator.toml", self.config(levels=[{"name": "u", "cmd": "true"}, {"name": "v", "cmd": "true"}]))
        hits, notes = self.scan([changed, added])
        self.assertEqual([], notes)
        self.assertEqual({("level_removed", "t"), ("level_changed", "u")}, {(h["kind"], h["level"]) for h in hits})
        self.write_run([(1, changed)])
        self.emit_commit(added)
        self.surface()
        self.assertEqual(2, len(self.record()["hits"]))
        edited = self.commit_file(".claude/orchestrator.toml", (self.root / ".claude/orchestrator.toml").read_text().replace('ci/','ci-new/'))
        self.emit_commit(edited, phase=2)
        self.write_run([(1, changed), (2, edited)])
        self.surface(phase=2)
        self.assertEqual([], self.record(2)["hits"])
        broken = self.commit_file(".claude/orchestrator.toml", "invalid = [")
        hits, notes = self.scan([broken], cfg=orchestrator._surface_cfg({"surface": {}}))
        self.assertEqual([], hits)
        self.assertIn("unparseable TOML", notes[0])

    def test_unknown_base_and_missing_sha(self):
        self.setup()
        self.write_run(base="(unknown)")
        self.assertEqual(0, self.surface(sha=["deadbee"])[0])
        self.assertEqual([], self.record()["hits"])
        self.assertIn("no base recorded", self.record()["notes"])
        self.assertIn("commit deadbee not found", self.record()["notes"])

    def test_defaults_and_custom_skip_patterns(self):
        self.setup()
        cfg = orchestrator._surface_cfg({"surface": {}})
        self.assertEqual([], cfg["paths"])
        self.assertEqual(list(orchestrator.SURFACE_TEST_GLOBS), cfg["test_globs"])
        sha = self.commit_file("tests/test_default.py", SKIP + "('reason')")
        self.assertEqual("test_skipped", self.scan([sha], cfg)[0][0]["kind"])
        cfg = orchestrator._surface_cfg({"surface": {"skip_patterns": ["SKIPME"]}})
        self.assertEqual([], self.scan([sha], cfg)[0])
        other = self.commit_file("tests/test_custom.py", "SKIPME")
        self.assertEqual("SKIPME", self.scan([other], cfg)[0][0]["pattern"])

    def test_report_order_none_and_missing_scans(self):
        self.setup()
        text, out = self.report()
        self.assertIn("Surface hits: none", text)
        self.assertIn("Surface: 0 hit(s), 0 phase(s) not scanned", out)
        sha = self.commit_file("deps/package.json", "{}")
        self.write_run([(1, sha)])
        text, _ = self.report()
        self.assertIn("Phase 1: surface not run", text)
        self.surface()
        text, _ = self.report()
        self.assertLess(text.index("## Surface hits"), text.index("_No reportable deviations"))
        self.assertIn("Phase 1 touched dependency manifest: deps/package.json", text)
        self.assertIn("Post-phase commits: surface not run", text)
        self.surface(final=True)
        self.assertNotIn("surface not run", self.report()[0])
        (self.root / ".claude/orchestrator.toml").unlink()
        self.assertIn("## Surface hits", self.report()[0])

    def test_final_excludes_phase_and_store_shas(self):
        self.setup()
        phase = self.commit_file("deps/package.json", "phase")
        self.write_run([(1, phase)])
        self.surface()
        store = self.commit_file("ci/store.yml", "store")
        orchestrator._emit(str(self.root), "store_commit", sha=store)
        fix = self.commit_file("deps/package.json", "final fix")
        self.emit_commit(fix, phase=None)
        rc, out, _ = self.surface(final=True, sha=["ignored"])
        self.assertEqual(0, rc)
        self.assertIn("--sha ignored", out)
        self.assertIn("Post-phase commits touched dependency manifest", out)
        self.assertEqual([fix], self.record("final")["commits"])
        self.assertIsNone(self.events()[-1]["phase"])
        self.assertIn("surface-final.json", orchestrator._PER_RUN)
        self.assertIn("no new hits", self.surface(final=True)[1])

    def test_never_holds_or_modifies_gate_and_verify(self):
        self.setup()
        sha = self.commit_file("deps/package.json", "{}")
        self.write_run([(1, sha)])
        pd = self.sd / "phase-1"
        pd.mkdir()
        (pd / ".gate-pass").write_text("pass")
        (pd / "verify.json").write_text('{"result":"pass"}')
        snapshot = lambda: {p.relative_to(self.sd).as_posix(): p.read_bytes() for p in self.sd.rglob("*")
                            if p.is_file() and p.name not in ("surface.json", "events.jsonl")}
        before = snapshot()
        self.assertEqual(0, self.surface()[0])
        self.assertEqual(before, snapshot())
        with mock.patch.object(orchestrator, "_active_phase", return_value=1):
            self.assertEqual(0, self.call(orchestrator.cmd_hook_pre_commit)[0])
        import inspect
        for fn in (orchestrator.cmd_gate, orchestrator.cmd_hook_pre_commit):
            self.assertNotIn("surface", inspect.getsource(fn))

    def test_config_validation(self):
        self.setup()
        original = self.config()
        invalid = ['paths="x"', 'paths=[{globs=["x"]}]', 'paths=[{name="x",globs=["/abs"]}]',
                   'paths=[{name="x",globs=["x"],risk="yes"}]',
                   'paths=[{name="x",globs=["x"]},{name="x",globs=["y"]}]',
                   'test_globs=["a/../x"]', 'skip_patterns=[""]']
        for value in invalid:
            with self.subTest(value=value):
                (self.root / ".claude/orchestrator.toml").write_text('[validation]\nlevels=[{cmd="true"}]\n[surface]\n' + value)
                rc, out, _ = self.call(orchestrator.cmd_config, check=True)
                self.assertEqual(1, rc)
                self.assertIn("[surface]", out)
        (self.root / ".claude/orchestrator.toml").write_text(original)
        rc, out, _ = self.call(orchestrator.cmd_config, check=True)
        self.assertEqual(0, rc, out)
        self.assertIn("surface        ok", out)
        self.assertIn("config OK", out)

    def test_root_merge_and_rename_paths(self):
        self.setup()
        cfg = orchestrator._surface_cfg({"surface": {"paths": [{"name": "all", "globs": ["*"]}]}})
        root = git("rev-list", "--max-parents=0", "HEAD", cwd=self.root)
        self.assertEqual(".gitignore", self.scan([root], cfg)[0][0]["path"])
        sha = self.commit_file("tests/test_name [x]\t.py", SKIP)
        self.assertEqual("test_skipped", self.scan([sha])[0][0]["kind"])
        git("mv", "tests/test_name [x]\t.py", "tests/test_new.py", cwd=self.root)
        rename = self.commit("tests/test_new.py")
        self.assertEqual({"tests/test_name [x]\t.py", "tests/test_new.py"},
                         {h["path"] for h in self.scan([rename], cfg)[0] if h["kind"] == "path"})
        main = git("branch", "--show-current", cwd=self.root)
        git("switch", "-qc", "side", cwd=self.root)
        side = self.commit_file("ci/side.yml", "side")
        git("switch", "-q", main, cwd=self.root)
        self.commit_file("ci/main.yml", "main")
        git("merge", "--no-ff", "-qm", "merge", "side", cwd=self.root)
        merge = git("rev-parse", "HEAD", cwd=self.root)
        self.assertEqual(["ci/side.yml"], [h["path"] for h in self.scan([merge])[0]])
        self.assertEqual(side, git("rev-parse", "HEAD^2", cwd=self.root))

    def test_missing_state_and_usage(self):
        self.setup()
        self.assertEqual(2, self.call(orchestrator.cmd_surface)[0])
        shutil.rmtree(self.sd)
        self.assertEqual(3, self.surface()[0])
        self.assertFalse(self.sd.exists())

    def test_run_window_and_hook_fallback(self):
        self.setup()
        old = self.commit_file("deps/package.json", "old run")
        events = self.sd / "events.jsonl"
        events.write_text(json.dumps({"event": "run_start", "run_id": "aaaaaaaaaaaa"}) + "\n" +
                          json.dumps({"event": "commit", "phase": 1, "sha": old}) + "\n" + events.read_text())
        hook = self.commit_file("ci/hook.yml", "hook only")
        self.emit_commit(hook, hook=True)
        self.surface()
        self.assertEqual([hook], self.record()["commits"])
        plan = self.root / "phase-plan.md"
        plan.write_text("## Touch set\n- `ci/`\n")
        orchestrator._emit(str(self.root), "plan_done", phase=1, detail=str(plan))
        self.surface()
        self.assertEqual([hook], self.record()["commits"])

    def test_scan_failure_truncation_and_malformed_entries(self):
        self.setup()
        sha = self.commit_file("deps/package.json", "{}")
        hits, notes = self.scan(["bad-sha", sha])
        self.assertEqual(1, len(hits))
        self.assertIn("scan failed for bad-sha", notes[0])
        cfg = orchestrator._surface_cfg({"surface": {"paths": [None, {"name": "bad", "globs": "/abs"}]}})
        self.assertEqual([], cfg["paths"])
        cfg["paths"] = [{"name": str(n), "globs": ["*"], "risk": True} for n in range(201)]
        hits, notes = self.scan([sha], cfg)
        self.assertEqual(200, len(hits))
        self.assertIn("surface hits truncated at 200", notes)


if __name__ == "__main__":
    unittest.main()
