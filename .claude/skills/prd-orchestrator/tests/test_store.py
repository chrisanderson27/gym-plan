"""The wiki store: Store derivation (both layouts + legacy None), `init` writing the Store line,
`store path`, store-aware testing dir / testdocs, and worker additionalDirectories."""
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
    subprocess.run(["git", *argv], cwd=cwd, check=True, capture_output=True)


def make_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    git("init", "-q", cwd=path)
    git("config", "user.name", "Test", cwd=path)
    git("config", "user.email", "test@example.invalid", cwd=path)
    git("config", "commit.gpgsign", "false", cwd=path)
    return path


def quiet(fn, *a, **kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        rc = fn(*a, **kw)
    return rc, out.getvalue()


class StoreBase(unittest.TestCase):
    """A fake wiki (git repo with .planning/) and a fake team repo, with WORKBENCH_STORE_ROOT set."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(os.path.realpath(self.temp.name))
        self.wiki = make_repo(base / "wiki")
        self.planning = self.wiki / ".planning"
        self.planning.mkdir()
        self.team = make_repo(base / "team")
        (self.team / ".gitignore").write_text("/.agents/\n")
        env = mock.patch.dict(os.environ, {"WORKBENCH_STORE_ROOT": str(self.planning)})
        env.start()
        self.addCleanup(env.stop)

    def init(self, prd=None, store=None):
        args = argparse.Namespace(root=str(self.team), prd=prd, force=True, gate="commit", store=store)
        return quiet(orchestrator.cmd_init, args)


class Derivation(StoreBase):
    def test_ticket_layout(self):
        prd = self.planning / "isi" / "ISI-3056" / "prds" / "prd-1-x.md"
        self.assertEqual(str(self.planning / "isi" / "ISI-3056"), orchestrator._store_from_prd(str(prd)))

    def test_wiki_layout(self):
        prd = self.planning / "workbench-feedback" / "prds" / "prd-4-x.md"
        self.assertEqual(str(self.planning / "workbench-feedback"), orchestrator._store_from_prd(str(prd)))

    def test_legacy_and_odd_paths_are_none(self):
        for p in (self.team / "docs/ai/prds/prd-1.md",
                  self.planning / "a" / "b" / "c" / "prds" / "x.md",
                  self.planning / "isi" / "F" / "plans" / "x.md",
                  self.planning / "isi" / "F" / "prds" / "x.txt"):
            self.assertIsNone(orchestrator._store_from_prd(str(p)), p)

    def test_store_root_defaults_to_the_wiki_planning_dir(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WORKBENCH_STORE_ROOT")
            wiki = SCRIPT.resolve().parents[4]
            self.assertEqual(str(wiki / ".planning"), orchestrator._store_root())

    def test_disp_is_store_relative_outside_root(self):
        path = self.planning / "isi" / "F" / "testing" / "x.md"
        self.assertEqual(".planning/isi/F/testing/x.md", orchestrator._disp(str(path), str(self.team)))
        self.assertEqual("docs/a.md", orchestrator._disp(str(self.team / "docs/a.md"), str(self.team)))


class InitStore(StoreBase):
    def test_init_with_store_prd_writes_store_line(self):
        prd = self.planning / "rbcloud" / "F-1" / "prds" / "prd-1-thing.md"
        prd.parent.mkdir(parents=True)
        prd.write_text("# PRD\n")
        rc, out = self.init(prd=str(prd))
        self.assertIn("store", out)
        self.assertEqual(str(self.planning / "rbcloud" / "F-1"), orchestrator._store(str(self.team)))
        self.assertEqual(str(prd), orchestrator._run_field(str(self.team), "PRD"))

    def test_init_with_legacy_relative_prd_is_unchanged(self):
        self.init(prd="docs/ai/prds/prd-1-thing.md")
        self.assertIsNone(orchestrator._store(str(self.team)))
        run = (self.team / ".agents/orchestrator/RUN.md").read_text()
        self.assertNotIn("Store:", run)
        self.assertIn("PRD: docs/ai/prds/prd-1-thing.md", run)

    def test_explicit_store_overrides(self):
        target = self.planning / "isi" / "ISI-1"
        self.init(prd="docs/ai/prds/prd-1.md", store=str(target))
        self.assertEqual(str(target), orchestrator._store(str(self.team)))

    def test_legacy_mode_dirs_are_the_worktree_config(self):
        self.init(prd="docs/ai/prds/prd-1.md")
        cfg = orchestrator._deep_default({})
        self.assertEqual(str(self.team / "docs/ai/testing"), orchestrator._testing_dir(str(self.team), cfg))
        self.assertEqual(str(self.team / "docs/ai/plans"), orchestrator._plans_dir(str(self.team), cfg))

    def test_store_mode_dirs_are_in_the_store(self):
        target = self.planning / "isi" / "ISI-1"
        self.init(prd="docs/ai/prds/prd-1.md", store=str(target))
        cfg = orchestrator._deep_default({})
        self.assertEqual(str(target / "testing"), orchestrator._testing_dir(str(self.team), cfg))
        self.assertEqual(str(target / "plans"), orchestrator._plans_dir(str(self.team), cfg))


class StorePath(StoreBase):
    def run_path(self, ctx, feature, as_json=True):
        return quiet(orchestrator.cmd_store, argparse.Namespace(
            root=None, action="path", context=ctx, feature=feature, json=as_json))

    def test_creates_and_prints_dirs(self):
        rc, out = self.run_path("isi", "ISI-3056")
        self.assertEqual(0, rc)
        data = json.loads(out)
        base = self.planning / "isi" / "ISI-3056"
        self.assertEqual(str(base), data["store"])
        for key in ("prds", "plans", "testing"):
            self.assertTrue((base / key).is_dir())
            self.assertEqual(str(base / key), data[key])

    def test_rejects_unsafe_segments(self):
        for ctx, feature in (("isi", "../x"), ("isi", "a/b"), ("..", "F"), ("isi", ""),
                             ("isi", "."), ("is/i", "F"), ("isi", "a..b")):
            rc, _ = self.run_path(ctx, feature)
            self.assertEqual(2, rc, (ctx, feature))
        self.assertEqual([], list(self.planning.iterdir()))


class TestdocsStore(StoreBase):
    def test_testdocs_writes_into_the_store_and_points_at_store_commit(self):
        store = self.planning / "rbcloud" / "F-1"
        self.init(prd="docs/ai/prds/prd-1-thing.md", store=str(store))
        scen = store / "testing" / "scenarios" / "prd-1-thing" / "phase-1-scenario.md"
        scen.parent.mkdir(parents=True)
        scen.write_text("# scenario\n\n## Manual verification\n\nDo it.\n\n## Provenance\n\nx\n")
        rc, out = quiet(orchestrator.cmd_testdocs, argparse.Namespace(root=str(self.team), prd=None))
        self.assertEqual(0, rc)
        self.assertTrue((store / "testing" / "prd-1-thing-test-flow.md").is_file())
        self.assertTrue((store / "testing" / "prd-1-thing-manual-test.md").is_file())
        self.assertFalse((self.team / "docs").exists())
        self.assertIn("next: orchestrator.py store-commit", out)
        self.assertIn(".planning/rbcloud/F-1/testing/prd-1-thing-test-flow.md", out)
        self.assertNotIn("../", out)
        self.assertNotIn("git add", out)


class WorkerSettings(StoreBase):
    def settings(self):
        rc, out = quiet(orchestrator.cmd_worker_settings, argparse.Namespace(
            root=str(self.team), stage="builder", phase=1, artifact=None))
        self.assertEqual(0, rc)
        return json.loads(Path(out.strip().splitlines()[-1]).read_text())

    def test_store_mode_grants_the_store(self):
        store = self.planning / "isi" / "ISI-1"
        self.init(prd="docs/ai/prds/prd-1.md", store=str(store))
        s = self.settings()
        self.assertEqual([str(store)], s["permissions"]["additionalDirectories"])
        self.assertIn("PreToolUse", s["hooks"])

    def test_legacy_mode_grants_no_directories(self):
        self.init(prd="docs/ai/prds/prd-1.md")
        self.assertNotIn("additionalDirectories", self.settings()["permissions"])

    def test_worker_allow_has_cli_base_and_repo_entries(self):
        self.init(prd="docs/ai/prds/prd-1.md")
        cfg = self.team / ".claude" / "orchestrator.toml"
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text((cfg.read_text() if cfg.exists() else "")
                       + '\n[worker]\nallow = ["npm test", "Bash(dotnet test:*)"]\n')
        allow = self.settings()["permissions"]["allow"]
        self.assertIn(f"Bash(python3 {os.path.abspath(orchestrator.__file__)}:*)", allow)
        self.assertIn("Bash(git diff:*)", allow)
        self.assertIn("Bash(npm test:*)", allow)
        self.assertIn("Bash(dotnet test:*)", allow)
        self.assertFalse(any("sed -i" in a or "rm" == a[5:7] for a in allow))


class PreflightConfigStore(StoreBase):
    def test_preflight_fails_when_store_missing(self):
        self.init(prd="docs/ai/prds/prd-1.md", store=str(self.planning / "isi" / "NOPE"))
        with mock.patch.object(orchestrator, "trust_state", return_value=(True, "trusted")):
            rc, out = quiet(orchestrator.cmd_preflight, argparse.Namespace(root=str(self.team), trust=False))
        self.assertEqual(1, rc)
        self.assertIn("does not exist", out)

    def test_preflight_fails_when_store_not_in_git(self):
        loose = Path(self.temp.name) / "loose" / "isi" / "F"
        loose.mkdir(parents=True)
        self.init(prd="docs/ai/prds/prd-1.md", store=str(loose))
        with mock.patch.object(orchestrator, "trust_state", return_value=(True, "trusted")):
            rc, out = quiet(orchestrator.cmd_preflight, argparse.Namespace(root=str(self.team), trust=False))
        self.assertEqual(1, rc)
        self.assertIn("not inside a git repo", out)

    def test_preflight_warns_in_legacy_mode(self):
        self.init(prd="docs/ai/prds/prd-1.md")
        with mock.patch.object(orchestrator, "trust_state", return_value=(True, "trusted")):
            _, out = quiet(orchestrator.cmd_preflight, argparse.Namespace(root=str(self.team), trust=False))
        self.assertIn("legacy mode", out)

    def test_config_check_supersedes_toml_dirs_in_store_mode(self):
        (self.team / ".claude").mkdir()
        (self.team / ".claude/orchestrator.toml").write_text(
            '[validation]\nlevels = [{ name = "unit", cmd = "true" }]\n'
            '[plans]\ndir = "docs/ai/plans"\n[testing]\ndir = "docs/ai/testing"\n')
        store = self.planning / "isi" / "F"
        store.mkdir(parents=True)
        self.init(prd="docs/ai/prds/prd-1.md", store=str(store))
        rc, out = quiet(orchestrator.cmd_config, argparse.Namespace(root=str(self.team), check=True))
        self.assertEqual(0, rc, out)
        self.assertIn("superseded by Store", out)
        self.assertIn(".planning/isi/F/testing", out)


class DeviationWhere(StoreBase):
    def test_where_falls_back_to_the_store(self):
        store = self.planning / "isi" / "F"
        (store / "plans").mkdir(parents=True)
        (store / "plans" / "p.md").write_text("x\n")
        self.init(prd="docs/ai/prds/prd-1.md", store=str(store))
        rec = {"kind": "extends", "blast": "data", "prd_says": "x", "built": "b", "why": "w",
               "verify": "v", "where": ["plans/p.md"], "evidence": [str(store / "plans/p.md")]}
        self.assertNotIn("where does not resolve: plans/p.md",
                         orchestrator.validate_record(rec, str(self.team), None))


if __name__ == "__main__":
    unittest.main()
