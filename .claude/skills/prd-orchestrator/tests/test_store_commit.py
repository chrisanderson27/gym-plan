"""store-commit: commits ONLY store paths in the wiki (unrelated staged + unstaged work untouched),
retries a held index.lock, refuses paths outside .planning/, defers mid-merge, never pushes."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


def git(*argv, cwd):
    return subprocess.run(["git", *argv], cwd=cwd, check=True, capture_output=True, text=True).stdout


def make_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    git("init", "-q", cwd=path)
    git("config", "user.name", "Test", cwd=path)
    git("config", "user.email", "test@example.invalid", cwd=path)
    git("config", "commit.gpgsign", "false", cwd=path)
    return path


class StoreCommit(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(os.path.realpath(self.temp.name))
        self.wiki = make_repo(base / "wiki")
        self.planning = self.wiki / ".planning"
        (self.wiki / "notes.md").write_text("one\n")
        (self.wiki / "other.md").write_text("one\n")
        git("add", ".", cwd=self.wiki)
        git("commit", "-qm", "init", cwd=self.wiki)
        self.store = self.planning / "isi" / "ISI-1"
        (self.store / "prds").mkdir(parents=True)
        (self.store / "prds" / "prd-1-x.md").write_text("# PRD\n")
        self.team = make_repo(base / "team")
        (self.team / ".gitignore").write_text("/.agents/\n")
        self.sd = self.team / ".agents" / "orchestrator"
        self.sd.mkdir(parents=True)
        (self.sd / "RUN.md").write_text(f"PRD: {self.store}/prds/prd-1-x.md\nStore: {self.store}\n")
        env = mock.patch.dict(os.environ, {"WORKBENCH_STORE_ROOT": str(self.planning)})
        env.start()
        self.addCleanup(env.stop)

    def commit(self, **kw):
        args = argparse.Namespace(root=str(self.team), phase=kw.get("phase"), reason=kw.get("reason"),
                                  store=kw.get("store"), path=kw.get("path"))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return orchestrator.cmd_store_commit(args)

    def events(self):
        p = self.sd / "events.jsonl"
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []

    def test_commits_only_the_store_leaving_other_work_alone(self):
        (self.wiki / "notes.md").write_text("staged\n")
        git("add", "notes.md", cwd=self.wiki)
        (self.wiki / "other.md").write_text("unstaged\n")
        (self.planning / "elsewhere").mkdir()
        (self.planning / "elsewhere" / "x.md").write_text("untracked\n")

        self.assertEqual(0, self.commit(phase=2, reason="failed"))

        files = git("show", "--name-only", "--format=%s", "HEAD", cwd=self.wiki).split()
        self.assertEqual("planning(isi/ISI-1): phase 2 failed",
                         git("log", "-1", "--format=%s", cwd=self.wiki).strip())
        self.assertIn(".planning/isi/ISI-1/prds/prd-1-x.md", files)
        self.assertNotIn("notes.md", files)
        self.assertNotIn("other.md", files)
        status = git("status", "--porcelain", cwd=self.wiki).splitlines()
        self.assertIn("M  notes.md", status)           # still staged, not committed
        self.assertIn(" M other.md", status)           # still unstaged
        self.assertIn("?? .planning/elsewhere/", status)
        self.assertEqual("staged\n", (self.wiki / "notes.md").read_text())
        ev = [e for e in self.events() if e["event"] == "store_commit"]
        self.assertEqual(1, len(ev))
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.wiki).strip(), ev[0]["sha"])

    def test_nothing_to_commit_is_success(self):
        self.assertEqual(0, self.commit())
        head = git("rev-parse", "HEAD", cwd=self.wiki)
        self.assertEqual(0, self.commit())
        self.assertEqual(head, git("rev-parse", "HEAD", cwd=self.wiki))

    def test_retries_a_held_index_lock(self):
        lock = self.wiki / ".git" / "index.lock"
        lock.write_text("")
        calls = []

        def release(seconds):
            calls.append(seconds)
            if lock.exists():
                lock.unlink()

        with mock.patch.object(orchestrator.time, "sleep", side_effect=release):
            self.assertEqual(0, self.commit(reason="close-out"))
        self.assertTrue(calls)
        self.assertIn(".planning/isi/ISI-1/prds/prd-1-x.md",
                      git("show", "--name-only", "--format=", "HEAD", cwd=self.wiki))

    def test_gives_up_after_bounded_retries(self):
        (self.wiki / ".git" / "index.lock").write_text("")
        with mock.patch.object(orchestrator.time, "sleep") as sleep:
            self.assertEqual(1, self.commit())
        self.assertEqual(orchestrator.STORE_COMMIT_TRIES - 1, sleep.call_count)

    def test_refuses_paths_outside_planning(self):
        head = git("rev-parse", "HEAD", cwd=self.wiki)
        for bad in ([str(self.wiki / "notes.md")], [str(self.planning)],
                    [str(self.store), str(self.wiki / "other.md")],
                    [str(self.planning / ".." / "notes.md")]):
            self.assertEqual(2, self.commit(path=bad), bad)
        self.assertEqual(head, git("rev-parse", "HEAD", cwd=self.wiki))
        self.assertEqual("", git("diff", "--cached", "--name-only", cwd=self.wiki))

    def test_refuses_mid_merge(self):
        sha = git("rev-parse", "HEAD", cwd=self.wiki).strip()
        (self.wiki / ".git" / "MERGE_HEAD").write_text(sha + "\n")
        self.assertEqual(3, self.commit())
        self.assertEqual("", git("diff", "--cached", "--name-only", cwd=self.wiki))
        self.assertIn("store_commit_deferred", [e["event"] for e in self.events()])

    def test_refuses_mid_rebase(self):
        (self.wiki / ".git" / "rebase-merge").mkdir()
        self.assertEqual(3, self.commit())

    def test_explicit_path_commits_just_that_path(self):
        plan = self.store / "plans" / "prd-1-phase-1-x.md"
        plan.parent.mkdir()
        plan.write_text("plan\n")
        self.assertEqual(0, self.commit(path=[str(plan)], phase=1))
        files = git("show", "--name-only", "--format=", "HEAD", cwd=self.wiki).split()
        self.assertEqual([".planning/isi/ISI-1/plans/prd-1-phase-1-x.md"], files)

    def test_a_path_outside_the_run_store_takes_its_own_scope_and_logs_nothing(self):
        other = self.planning / "workbench-feedback" / "prds" / "prd-21-x.md"
        other.parent.mkdir(parents=True)
        other.write_text("# PRD\n")
        self.assertEqual(0, self.commit(path=[str(other)]))
        self.assertEqual("planning(workbench-feedback): update",
                         git("log", "-1", "--format=%s", cwd=self.wiki).strip())
        self.assertEqual([], self.events())

    def test_a_path_inside_the_run_store_still_logs_to_the_run(self):
        plan = self.store / "plans" / "p.md"
        plan.parent.mkdir()
        plan.write_text("plan\n")
        self.assertEqual(0, self.commit(path=[str(plan)], phase=2))
        self.assertEqual("planning(isi/ISI-1): phase 2", git("log", "-1", "--format=%s", cwd=self.wiki).strip())
        self.assertEqual(["store_commit"], [e["event"] for e in self.events()])

    def test_no_store_in_legacy_mode_is_refused(self):
        (self.sd / "RUN.md").write_text("PRD: docs/ai/prds/prd-1.md\n")
        self.assertEqual(2, self.commit())

    def test_never_pushes(self):
        with mock.patch.object(orchestrator.subprocess, "run", wraps=subprocess.run) as run:
            self.assertEqual(0, self.commit())
        self.assertFalse(any("push" in c.args[0] for c in run.call_args_list))


if __name__ == "__main__":
    unittest.main()


class PrdAnchorWarnings(unittest.TestCase):
    """A context-store PRD with no ticket and no branch is committed but warned about: My Work can't list it."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.wiki = Path(os.path.realpath(self.temp.name))

    def prd(self, rel, **fm):
        p = self.wiki / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("---\n" + "".join(f"{k}: {v}\n" for k, v in {"type": "PRD", **fm}.items()) + "---\n# x\n")
        return rel

    def warnings(self, *rels):
        return orchestrator._prd_anchor_warnings(str(self.wiki), list(rels))

    def test_no_ticket_no_branch_warns_with_the_fix(self):
        rel = self.prd(".planning/isi/lse-review-standard/prds/prd-1-x.md", feature="lse-review-standard", prd=1)
        w = self.warnings(rel)
        self.assertEqual(len(w), 1)
        self.assertIn("WARNING", w[0])
        self.assertIn("work_item: or branch:", w[0])
        self.assertIn(".planning/<feature>/prds/", w[0])

    def test_branch_prd_gets_the_worktree_note(self):
        rel = self.prd(".planning/isi/lse-review-standard/prds/prd-2-y.md", feature="lse-review-standard", branch="chris/lse-arch-gates")
        w = self.warnings(rel)
        self.assertEqual(len(w), 1)
        self.assertIn("NOTE", w[0])
        self.assertIn("chris/lse-arch-gates", w[0])

    def test_anchored_wiki_and_non_prd_files_are_silent(self):
        rels = [
            self.prd(".planning/isi/ISI-1/prds/prd-1-a.md", work_item="ISI-1"),
            self.prd(".planning/isi/ISI-2/prds/prd-1-b.md", feature="ISI-2"),             # tracker-key feature
            self.prd(".planning/rbcloud/2700/prds/prd-1-c.md", stories="[27001, 27002]"),
            self.prd(".planning/lse-review-standard/prds/prd-1-wiki.md", feature="lse-review-standard"),   # wiki PRD
            self.prd(".planning/isi/ISI-3/plans/prd-1-phase-1.md", feature="x"),         # a plan, not a PRD
        ]
        self.assertEqual(self.warnings(*rels), [])

    def test_a_committed_directory_is_walked(self):
        self.prd(".planning/isi/feat/prds/prd-1-x.md", feature="feat")
        self.assertEqual(len(self.warnings(".planning/isi/feat")), 1)
