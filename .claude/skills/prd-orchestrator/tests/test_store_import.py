"""store import: copies a team repo's committed docs/ai/{prds,plans,testing} (via git show, never the
working tree) or a loose dir into the store; frontmatter feature wins over the directory, flat files go
to _unfiled, testing docs follow their PRD by slug (ambiguous/unmatched -> _unfiled, reported), PRDs get
imported/context/repo stamped with the body byte-identical, dry-run writes nothing, re-runs are
idempotent, conflicts are kept and reported, and the one commit holds only store paths."""
import argparse
import contextlib
import importlib.util
import io
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
    git("init", "-q", "-b", "main", cwd=path)
    git("config", "user.name", "Test", cwd=path)
    git("config", "user.email", "test@example.invalid", cwd=path)
    git("config", "commit.gpgsign", "false", cwd=path)
    return path


PRD_BODY = "\n# Title\n\nBody line with trailing spaces   \n\n## Sources\n- x\n"


def prd(feature=None, extra=""):
    fm = "---\ntype: PRD\ntitle: T\n" + (f"feature: {feature}\n" if feature else "") + extra + "---\n"
    return fm + PRD_BODY


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(os.path.realpath(self.temp.name))
        self.wiki = make_repo(base / "wiki")
        (self.wiki / "notes.md").write_text("one\n")
        git("add", ".", cwd=self.wiki)
        git("commit", "-qm", "init", cwd=self.wiki)
        self.planning = self.wiki / ".planning"
        self.team = make_repo(base / "rbcloud")
        env = mock.patch.dict(os.environ, {"WORKBENCH_STORE_ROOT": str(self.planning)})
        env.start()
        self.addCleanup(env.stop)

    def write(self, root, rel, text):
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def commit_team(self):
        git("add", "-A", cwd=self.team)
        git("commit", "-qm", "docs", cwd=self.team)

    def run_import(self, **kw):
        ns = dict(root=None, action="import", context="rbcloud", feature=None, json=False,
                  repo=str(self.team), ref="main", from_dir=None, dry_run=False)
        ns.update(kw)
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = orchestrator.cmd_store(argparse.Namespace(**ns))
        return rc, out.getvalue() + err.getvalue()

    def wiki_commits(self):
        return git("log", "--format=%s", cwd=self.wiki).splitlines()

    def files_in_last_commit(self):
        return git("show", "--name-only", "--format=", "HEAD", cwd=self.wiki).split()


class RepoImport(Base):
    def seed(self):
        w = lambda rel, text: self.write(self.team, rel, text)
        w("docs/ai/prds/26425/prd-1-alpha.md", prd())                     # dir feature
        w("docs/ai/prds/26425/prd-2-beta.md", prd("'27000'"))              # frontmatter beats dir
        w("docs/ai/prds/flat-one.md", prd())                               # flat, no feature
        w("docs/ai/prds/flat-two.md", prd('"26563"'))                      # flat, frontmatter feature
        w("docs/ai/plans/26425/prd-1-phase-1-alpha.md", "plan 1\n")
        w("docs/ai/plans/loose-plan.md", "loose\n")
        w("docs/ai/testing/scenarios/prd-1-alpha/phase-1-scenario.md", "scenario\n")
        w("docs/ai/testing/prd-2-beta-test-flow.md", "flow\n")
        w("docs/ai/testing/prd-2-beta-manual-test.md", "manual\n")
        w("docs/ai/testing/26686-orphan-test-plan.md", "orphan\n")
        w("src/app.py", "code\n")
        self.commit_team()

    def test_mapping_stamping_and_commit(self):
        self.seed()
        # an uncommitted working-tree edit must be ignored and left in place
        self.write(self.team, "docs/ai/prds/26425/prd-1-alpha.md", "WORKING TREE\n")
        (self.wiki / "notes.md").write_text("unstaged wiki work\n")
        rc, out = self.run_import()
        self.assertEqual(rc, 0, out)
        P = self.planning / "rbcloud"
        alpha = (P / "26425/prds/prd-1-alpha.md").read_text()
        self.assertTrue((P / "27000/prds/prd-2-beta.md").exists())
        self.assertFalse((P / "26425/prds/prd-2-beta.md").exists())
        self.assertTrue((P / "_unfiled/prds/flat-one.md").exists())
        self.assertTrue((P / "26563/prds/flat-two.md").exists())
        self.assertEqual((P / "26425/plans/prd-1-phase-1-alpha.md").read_text(), "plan 1\n")
        self.assertEqual((P / "_unfiled/plans/loose-plan.md").read_text(), "loose\n")
        self.assertEqual((P / "26425/testing/scenarios/prd-1-alpha/phase-1-scenario.md").read_text(), "scenario\n")
        self.assertTrue((P / "27000/testing/prd-2-beta-test-flow.md").exists())
        self.assertTrue((P / "27000/testing/prd-2-beta-manual-test.md").exists())
        self.assertTrue((P / "_unfiled/testing/26686-orphan-test-plan.md").exists())
        self.assertIn("UNMATCHED", out)
        self.assertIn("26686-orphan-test-plan.md", out)
        # stamping: added inside the frontmatter, body byte-identical
        self.assertTrue(alpha.startswith("---\ntype: PRD\ntitle: T\nimported: true\ncontext: rbcloud\n"
                                         "repo: rbcloud\n---\n"))
        self.assertTrue(alpha.endswith(PRD_BODY))
        self.assertEqual(alpha.split("---\n", 2)[2], PRD_BODY)
        # source untouched: working tree edit still there, nothing staged, no new commit
        self.assertEqual((self.team / "docs/ai/prds/26425/prd-1-alpha.md").read_text(), "WORKING TREE\n")
        self.assertEqual(git("log", "--format=%s", cwd=self.team).splitlines(), ["docs"])
        self.assertEqual(git("diff", "--cached", "--name-only", cwd=self.team), "")
        # one commit, store paths only; unrelated wiki work untouched
        self.assertEqual(self.wiki_commits()[0], "planning(rbcloud): import from rbcloud@main")
        files = self.files_in_last_commit()
        self.assertEqual(len(files), 10)
        self.assertTrue(all(f.startswith(".planning/rbcloud/") for f in files), files)
        self.assertIn("notes.md", git("status", "--porcelain", cwd=self.wiki))

    def test_rerun_is_idempotent(self):
        self.seed()
        self.assertEqual(self.run_import()[0], 0)
        n = len(self.wiki_commits())
        rc, out = self.run_import()
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.wiki_commits()), n)
        self.assertIn("prds:     0 imported, 4 identical", out)
        self.assertIn("nothing new to commit", out)

    def test_dry_run_writes_nothing(self):
        self.seed()
        rc, out = self.run_import(dry_run=True)
        self.assertEqual(rc, 0, out)
        self.assertFalse(self.planning.exists())
        self.assertEqual(self.wiki_commits(), ["init"])
        self.assertIn("dry run", out)
        self.assertIn("prds:     4 would import", out)

    def test_conflict_is_kept_and_reported(self):
        self.seed()
        mine = self.write(self.planning, "rbcloud/26425/plans/prd-1-phase-1-alpha.md", "edited in store\n")
        rc, out = self.run_import()
        self.assertEqual(rc, 0, out)
        self.assertEqual(mine.read_text(), "edited in store\n")
        self.assertIn("CONFLICTS", out)
        self.assertIn("prd-1-phase-1-alpha.md", out)
        self.assertNotIn(".planning/rbcloud/26425/plans/prd-1-phase-1-alpha.md", self.files_in_last_commit())

    def test_two_sources_one_dest_is_a_conflict(self):
        self.write(self.team, "docs/ai/plans/111/p.md", "---\nfeature: 222\n---\nA\n")
        self.write(self.team, "docs/ai/plans/222/p.md", "B\n")
        self.commit_team()
        rc, out = self.run_import()
        self.assertEqual(rc, 0, out)
        self.assertEqual((self.planning / "rbcloud/222/plans/p.md").read_text(), "---\nfeature: 222\n---\nA\n")
        self.assertIn("another imported file has that path", out)

    def test_ambiguous_testing_slug(self):
        self.write(self.team, "docs/ai/prds/111/prd-1-same.md", prd())
        self.write(self.team, "docs/ai/prds/222/prd-1-same.md", prd())
        self.write(self.team, "docs/ai/testing/scenarios/prd-1-same/phase-1-scenario.md", "s\n")
        self.write(self.team, "docs/ai/testing/prd-1-same-test-flow.md", "f\n")
        self.commit_team()
        rc, out = self.run_import()
        self.assertEqual(rc, 0, out)
        P = self.planning / "rbcloud"
        self.assertTrue((P / "_unfiled/testing/scenarios/prd-1-same/phase-1-scenario.md").exists())
        self.assertTrue((P / "_unfiled/testing/prd-1-same-test-flow.md").exists())
        self.assertFalse((P / "111/testing").exists())
        self.assertIn("AMBIGUOUS testing docs (in _unfiled/, not guessed): 2", out)

    def test_longest_prd_slug_wins_for_flat_testing(self):
        self.write(self.team, "docs/ai/prds/111/prd-1-x.md", prd())
        self.write(self.team, "docs/ai/prds/222/prd-1-x-y.md", prd())
        self.write(self.team, "docs/ai/testing/prd-1-x-y-test-flow.md", "f\n")
        self.commit_team()
        self.assertEqual(self.run_import()[0], 0)
        self.assertTrue((self.planning / "rbcloud/222/testing/prd-1-x-y-test-flow.md").exists())

    def test_existing_keys_and_crlf_and_no_frontmatter(self):
        self.write(self.team, "docs/ai/prds/1/a.md", "---\r\ntype: PRD\r\ncontext: other\r\n---\r\nBody\r\n")
        self.write(self.team, "docs/ai/prds/1/b.md", "# no frontmatter\n")
        self.commit_team()
        self.assertEqual(self.run_import()[0], 0)
        a = (self.planning / "rbcloud/1/prds/a.md").read_bytes()
        self.assertEqual(a, b"---\r\ntype: PRD\r\ncontext: other\r\nimported: true\r\nrepo: rbcloud\r\n---\r\nBody\r\n")
        b = (self.planning / "rbcloud/1/prds/b.md").read_text()
        self.assertEqual(b, "---\nimported: true\ncontext: rbcloud\nrepo: rbcloud\n---\n# no frontmatter\n")

    def test_unsafe_context_refused(self):
        rc, out = self.run_import(context="../x")
        self.assertEqual(rc, 2)
        self.assertIn("not a safe path segment", out)

    def test_bad_ref(self):
        self.seed()
        rc, out = self.run_import(ref="nope")
        self.assertEqual(rc, 1)
        self.assertFalse(self.planning.exists())


class DirImport(Base):
    def test_docs_ai_shaped_dir(self):
        src = self.team / "docs/ai"
        self.write(src, "prds/ISI-3056/prd-1-presence.md", prd("ISI-3056"))
        self.write(src, "plans/ISI-3056/prd-1-phase-1-presence.md", "plan\n")
        self.write(src, "testing/scenarios/prd-1-presence/phase-1-scenario.md", "s\n")
        self.write(src, "research/notes.md", "ignored\n")
        before = {p: p.read_bytes() for p in src.rglob("*") if p.is_file()}
        rc, out = self.run_import(repo=None, from_dir=str(src), context="isi", feature="ISI-3056")
        self.assertEqual(rc, 0, out)
        S = self.planning / "isi/ISI-3056"
        text = (S / "prds/prd-1-presence.md").read_text()
        self.assertIn("imported: true\ncontext: isi\nrepo: rbcloud\n---\n", text)
        self.assertTrue(text.endswith(PRD_BODY))
        self.assertEqual((S / "plans/prd-1-phase-1-presence.md").read_text(), "plan\n")
        self.assertTrue((S / "testing/scenarios/prd-1-presence/phase-1-scenario.md").exists())
        self.assertIn("research/notes.md", out)
        self.assertEqual({p: p.read_bytes() for p in src.rglob("*") if p.is_file()}, before)  # copy-only
        self.assertEqual(self.wiki_commits()[0], f"planning(isi): import from {src}")
        self.assertTrue(all(f.startswith(".planning/isi/ISI-3056/") for f in self.files_in_last_commit()))
        rc, out = self.run_import(repo=None, from_dir=str(src), context="isi", feature="ISI-3056")
        self.assertIn("nothing new to commit", out)

    def test_store_shaped_dir_and_feature_required(self):
        src = self.temp.name + "/loose"
        self.write(Path(src), "prds/prd-1-a.md", prd())
        self.write(Path(src), "plans/prd-1-phase-1-a.md", "p\n")
        rc, out = self.run_import(repo=None, from_dir=src, context="isi")
        self.assertEqual(rc, 2)
        rc, out = self.run_import(repo=None, from_dir=src, context="isi", feature="F-1", dry_run=True)
        self.assertEqual(rc, 0, out)
        self.assertFalse(self.planning.exists())
        rc, out = self.run_import(repo=None, from_dir=src, context="isi", feature="F-1")
        self.assertEqual(rc, 0, out)
        self.assertTrue((self.planning / "isi/F-1/prds/prd-1-a.md").exists())
        self.assertTrue((self.planning / "isi/F-1/plans/prd-1-phase-1-a.md").exists())
        self.assertNotIn("repo:", (self.planning / "isi/F-1/prds/prd-1-a.md").read_text())

    def test_unsafe_feature_refused(self):
        rc, out = self.run_import(repo=None, from_dir=self.temp.name, context="isi", feature="a/b")
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
