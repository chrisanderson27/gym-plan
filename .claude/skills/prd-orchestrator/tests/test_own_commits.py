"""Resumed review scope drops both parked-gap commits and unrelated logged commits."""
import contextlib
import io
import json

from test_park import Base, RID, git, ns, orchestrator


class OwnCommitsTests(Base):
    def commit_file(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        git("add", name, cwd=self.root)
        git("commit", "-qm", text, cwd=self.root)
        return git("rev-parse", "HEAD", cwd=self.root)

    def scenario(self, logged=True, anchors=True, pre_foreign=False):
        self.before_base = self.head
        git("commit", "--allow-empty", "-qm", "run base", cwd=self.root)
        self.base = git("rev-parse", "HEAD", cwd=self.root)
        self.p1 = self.commit_file("app/a.py", "phase one")
        self.write_run(commit=self.p1[:7] if anchors else "-", base=self.base)
        if not anchors:
            run = self.sd / "RUN.md"
            run.write_text(run.read_text().replace("| committed |", "| pending |"))
        # Prior runs are intentionally outside the selected run-id window.
        events = self.sd / "events.jsonl"
        events.write_text(json.dumps({"event": "run_start", "run_id": "aaaaaaaaaaaa"}) + "\n" +
                          json.dumps({"event": "commit", "sha": self.base}) + "\n" + events.read_text())
        if logged:
            orchestrator._emit(str(self.root), "commit", sha=self.p1, phase=1)
        self.pre_foreign = self.commit_file("other/pre.txt", "pre foreign") if pre_foreign else None
        self.assertEqual(self.park()[0], 0)
        self.f = self.commit_file("other/z.txt", "parked gap")
        self.assertEqual(self.unpark()[0], 0)
        self.p2 = self.commit_file("app/a.py", "phase two")
        orchestrator._emit(str(self.root), "commit", sha=self.p2, phase=5)
        self.u = self.commit_file("notes/n.md", "unrelated logged")
        orchestrator._emit(str(self.root), "commit", sha=self.u, phase=5,
                           detail="auto-logged by post-commit hook")
        orchestrator._emit(str(self.root), "commit", sha=self.p2, phase=5)

    def test_own_and_foreign_in_repository_order(self):
        self.scenario()
        result = orchestrator.own_commits(str(self.root))
        self.assertEqual(result["mode"], "own")
        self.assertEqual(result["own"], [self.p1, self.p2])
        self.assertEqual(result["foreign"], [self.f, self.u])
        self.assertEqual(result["files"], ["app/a.py"])

    def test_explicit_wip_and_fix_commits_expand_phase_paths(self):
        self.base = self.head
        anchor = self.commit_file("app/a.py", "phase one")
        self.write_run(commit=anchor[:7], base=self.base)
        orchestrator._emit(str(self.root), "commit", sha=anchor, phase=1)
        wip = self.commit_file("app/wip.py", "phase WIP")
        orchestrator._emit(str(self.root), "commit", sha=wip, phase=1)
        self.assertEqual(self.park()[0], 0)
        foreign = self.commit_file("other/gap.txt", "parked gap")
        self.assertEqual(self.unpark()[0], 0)
        fix = self.commit_file("app/fix.py", "phase fix")
        orchestrator._emit(str(self.root), "commit", sha=fix, phase=5)
        followup = self.commit_file("app/fix.py", "fix followup")
        orchestrator._emit(str(self.root), "commit", sha=followup, phase=5,
                           detail="auto-logged by post-commit hook")
        unrelated = self.commit_file("notes/unrelated.md", "unrelated logged")
        orchestrator._emit(str(self.root), "commit", sha=unrelated, phase=5,
                           detail="auto-logged by post-commit hook")
        result = orchestrator.own_commits(str(self.root))
        self.assertEqual(result["own"], [anchor, wip, fix, followup])
        self.assertEqual(result["foreign"], [foreign, unrelated])
        self.assertEqual(result["files"], ["app/a.py", "app/fix.py", "app/wip.py"])
        self.assertIn("1 generated doc(s) invalidated", self.drift_doc("app/fix.py", self.base))

    def test_no_resume_retains_base_diff(self):
        self.scenario()
        run = self.sd / "RUN.md"
        run.write_text("\n".join(line for line in run.read_text().splitlines()
                                 if not line.startswith("Resumed:")) + "\n")
        result = orchestrator.own_commits(str(self.root))
        self.assertEqual(result["mode"], "base")
        self.assertIsNone(result["own"])
        self.assertIsNone(result["foreign"])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(orchestrator.cmd_drift(ns(self.root, base=None, head=None)), 0)
        self.assertIn(f"run diff: {self.base[:8]}..HEAD", out.getvalue())

    def test_prepark_fallback_filters_foreign(self):
        self.scenario(logged=False, pre_foreign=True)
        result = orchestrator.own_commits(str(self.root))
        self.assertEqual(result["own"], [self.p1, self.p2])
        self.assertEqual(result["foreign"], [self.pre_foreign, self.f, self.u])

    def test_handpark_timestamp_fallback_uses_first_block(self):
        self.scenario(logged=False, pre_foreign=True)
        events = self.sd / "events.jsonl"
        events.write_text("\n".join(line for line in events.read_text().splitlines()
                                     if json.loads(line).get("event") != "run_end") + "\n")
        with (self.sd / "RUN.md").open('a') as stream:
            stream.write(orchestrator._render_parked_block("2099-01-01T00:00:00Z", self.u, "second"))
        result = orchestrator.own_commits(str(self.root))
        self.assertEqual(result["own"], [self.p1, self.p2])
        self.assertIn(self.pre_foreign, result["foreign"])

    def test_no_anchors_keeps_all_candidates(self):
        self.scenario(anchors=False)
        result = orchestrator.own_commits(str(self.root))
        self.assertEqual(result["own"], [self.p1, self.p2, self.u])
        self.assertEqual(result["foreign"], [self.f])
        self.assertEqual(result["filter"], "none (no committed phase yet)")

    def test_missing_runid_start_falls_back_to_last_start(self):
        self.scenario()
        run = self.sd / "RUN.md"
        run.write_text(run.read_text().replace(RID, "bbbbbbbbbbbb"))
        self.assertEqual(orchestrator.own_commits(str(self.root))["own"], [self.p1, self.p2])

    def drift_doc(self, paths, verified, explicit=False):
        config = self.root / ".claude/orchestrator.toml"
        config.parent.mkdir(exist_ok=True)
        config.write_text('[knowledge]\ngenerated = [".agents/generated.md"]\n')
        (self.root / ".agents/generated.md").write_text(
            f'---\npaths: ["{paths}"]\nlast_verified: {verified}\n---\nGenerated\n')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = orchestrator.cmd_drift(ns(self.root, base=self.base if explicit else None, head=None))
        self.assertEqual(rc, 0)
        return out.getvalue()

    def test_drift_filters_foreign_files_and_preserves_freshness(self):
        self.scenario()
        foreign = self.drift_doc("other/*", self.base)
        self.assertIn("no generated doc was invalidated", foreign)
        own = self.drift_doc("app/*", self.base)
        self.assertIn("1 generated doc(s) invalidated", own)
        self.assertIn("2 foreign ignored", own)
        fresh = self.drift_doc("app/*", self.p2)
        self.assertIn("no generated doc was invalidated", fresh)
        explicit = self.drift_doc("other/*", self.base, explicit=True)
        self.assertIn("1 generated doc(s) invalidated", explicit)
        self.assertIn(f"run diff: {self.base[:8]}..HEAD", explicit)

    def test_review_range_json_and_human_output(self):
        self.scenario()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(orchestrator.cmd_review_range(ns(self.root, json=True)), 0)
        self.assertEqual(json.loads(out.getvalue()), orchestrator.own_commits(str(self.root)))
        with contextlib.redirect_stdout(out):
            self.assertEqual(orchestrator.cmd_review_range(ns(self.root, json=False)), 0)
        self.assertIn("foreign 2", out.getvalue())
        self.assertIn("unrelated logged", out.getvalue())

    def test_review_range_missing_base_returns_three(self):
        (self.sd / "RUN.md").write_text("PRD: x\n")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(orchestrator.cmd_review_range(ns(self.root, json=True)), 3)
