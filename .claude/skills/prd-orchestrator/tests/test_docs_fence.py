"""The docs guard: `guard install|status`, hook bodies with an absolute orchestrator path (upgrade in
place, never clobber a foreign hook), the pre-commit docs fence (real git commits, main checkout and
linked worktree), the git-fence.sh `add -f` deny, and preflight's store-mode guard check."""
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

SCRIPTS = Path(__file__).parents[1] / "scripts"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPTS / "orchestrator.py")
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)
GIT_FENCE = SCRIPTS / "hooks" / "git-fence.sh"


def git(*argv, cwd, env=None, check=True):
    return subprocess.run(["git", *argv], cwd=cwd, check=check, capture_output=True, text=True,
                          env={**os.environ, **(env or {})})


def make_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    git("init", "-q", "-b", "main", cwd=path)
    git("config", "user.name", "Test", cwd=path)
    git("config", "user.email", "test@example.invalid", cwd=path)
    git("config", "commit.gpgsign", "false", cwd=path)
    return path


def quiet(fn, *a, **kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        rc = fn(*a, **kw)
    return rc, out.getvalue()


def guard(root, action="install", testing_dir=None):
    return quiet(orchestrator.cmd_guard, argparse.Namespace(root=str(root), action=action, testing_dir=testing_dir))


class FenceBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(os.path.realpath(self.temp.name))
        self.team = make_repo(self.base / "team")
        (self.team / ".gitignore").write_text("/.agents/\n")
        (self.team / "src").mkdir()
        (self.team / "src" / "a.txt").write_text("a\n")
        (self.team / "docs/ai/prds").mkdir(parents=True)
        (self.team / "docs/ai/prds/prd-1-old.md").write_text("# tracked before the store\n")
        git("add", "-A", cwd=self.team)
        git("commit", "-qm", "init", cwd=self.team)
        env = mock.patch.dict(os.environ, {"WORKBENCH_STORE_ROOT": str(self.base / "wiki" / ".planning")})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("WORKBENCH_ALLOW_DOCS", None)

    def head(self, repo=None):
        return git("rev-parse", "HEAD", cwd=repo or self.team).stdout.strip()

    def commit(self, repo=None, env=None):
        return git("commit", "-qm", "x", cwd=repo or self.team, env=env, check=False)

    def hook(self, name="pre-commit"):
        return Path(orchestrator._hook_script_path(str(self.team), name))

    def exclude(self):
        return Path(orchestrator._exclude_path(str(self.team)))


class GuardInstall(FenceBase):
    def test_install_twice_is_idempotent(self):
        rc1, out1 = guard(self.team)
        rc2, out2 = guard(self.team)
        self.assertEqual((0, 0), (rc1, rc2), out1 + out2)
        lines = self.exclude().read_text().splitlines()
        for p in ("docs/ai/prds/", "docs/ai/plans/", "docs/ai/testing/", ".workbench/"):
            self.assertEqual(1, lines.count(p), p)
        self.assertEqual(1, lines.count(orchestrator._GUARD_COMMENT))
        self.assertIn("already has every guarded path", out2)
        self.assertEqual("true", git("config", "--get", "workbench.docsFence", cwd=self.team).stdout.strip())
        hook = self.hook().read_text()
        self.assertIn(orchestrator._HOOK_MARKER, hook)
        self.assertIn(f'orch="{orchestrator._ORCH_ABS}"', hook)
        self.assertTrue(os.path.isabs(orchestrator._ORCH_ABS))
        self.assertIn(orchestrator._ORCH_ABS, self.hook("post-commit").read_text())
        self.assertTrue(os.access(self.hook(), os.X_OK))

    def test_existing_exclude_content_is_kept(self):
        self.exclude().parent.mkdir(parents=True, exist_ok=True)
        self.exclude().write_text("*.log\n/docs/ai/plans/")      # no trailing newline, one pattern anchored
        guard(self.team)
        lines = self.exclude().read_text().splitlines()
        self.assertEqual("*.log", lines[0])
        self.assertIn("/docs/ai/plans/", lines)
        self.assertNotIn("docs/ai/plans/", lines)             # the anchored form already counts
        self.assertIn("docs/ai/prds/", lines)

    def test_toml_testing_dir_is_guarded(self):
        (self.team / ".claude").mkdir()
        (self.team / ".claude/orchestrator.toml").write_text('[testing]\ndir = "docs/testing"\n')
        guard(self.team)
        self.assertIn("docs/testing/", self.exclude().read_text().splitlines())
        paths = git("config", "--get", "workbench.docsFencePaths", cwd=self.team).stdout
        self.assertIn("docs/testing/", paths)

    def test_testing_dir_flag_and_out_of_repo_dir_ignored(self):
        guard(self.team, testing_dir="qa/scenarios")
        self.assertIn("qa/scenarios/", self.exclude().read_text().splitlines())
        self.assertNotIn("../x/", orchestrator._guard_patterns(str(self.team), "../x"))

    def test_status_reports_and_is_read_only(self):
        rc, out = guard(self.team, "status")
        self.assertEqual(1, rc)
        self.assertIn("MISSING", out)
        self.assertIn("NOT installed", out)
        self.assertFalse(self.hook().exists())
        self.assertIsNone(orchestrator._git_out(str(self.team), "config", "--get", "workbench.docsFence"))
        guard(self.team)
        rc, out = guard(self.team, "status")
        self.assertEqual(0, rc, out)
        self.assertIn("guard: installed", out)
        git("config", "core.hooksPath", ".husky", cwd=self.team)
        _, out = guard(self.team, "status")
        self.assertIn("fence is bypassed", out)

    def test_foreign_hook_is_not_clobbered(self):
        foreign = "#!/bin/sh\necho mine\nexit 0\n"
        self.hook().parent.mkdir(parents=True, exist_ok=True)
        self.hook().write_text(foreign)
        rc, out = guard(self.team)
        self.assertEqual(1, rc)
        self.assertIn("NOT written by this skill", out)
        self.assertEqual(foreign, self.hook().read_text())
        _, out = guard(self.team, "status")
        self.assertIn("FOREIGN", out)

    def test_marker_hook_with_old_body_is_upgraded(self):
        old = (f"#!/bin/sh\n{orchestrator._HOOK_MARKER}\n"
               'root="$(git rev-parse --show-toplevel)"\n'
               'orch="$root/.claude/skills/prd-orchestrator/scripts/orchestrator.py"\n'
               '[ -f "$orch" ] || exit 0\npython3 "$orch" hook-pre-commit\nexit $?\n')
        self.hook().parent.mkdir(parents=True, exist_ok=True)
        self.hook().write_text(old)
        rc, out = guard(self.team)
        self.assertEqual(0, rc, out)
        self.assertIn("upgraded at", out)
        self.assertEqual(orchestrator._hook_text(orchestrator._PRE_COMMIT_BODY), self.hook().read_text())
        _, out = guard(self.team)
        self.assertIn("already installed at", out)

    def test_hook_body_quotes_awkward_paths(self):
        body = orchestrator._pre_commit_body('/tmp/a "b" $c/orchestrator.py')
        self.assertIn(r'orch="/tmp/a \"b\" \$c/orchestrator.py"', body)


class PreCommitFence(FenceBase):
    def setUp(self):
        super().setUp()
        rc, out = guard(self.team)
        self.assertEqual(0, rc, out)

    def assert_blocked(self, repo=None):
        before = self.head(repo)
        r = self.commit(repo)
        self.assertNotEqual(0, r.returncode, r.stdout + r.stderr)
        self.assertIn("docs fence", r.stderr)
        self.assertIn("WORKBENCH_ALLOW_DOCS=1", r.stderr)
        self.assertEqual(before, self.head(repo))
        return r

    def test_blocks_a_staged_add(self):
        (self.team / "docs/ai/prds/prd-2-new.md").write_text("new\n")
        self.assertNotEqual(0, git("add", "docs/ai/prds/prd-2-new.md", cwd=self.team, check=False).returncode)
        git("add", "-f", "docs/ai/prds/prd-2-new.md", cwd=self.team)
        r = self.assert_blocked()
        self.assertIn("docs/ai/prds/prd-2-new.md", r.stderr)
        self.assertIn("<wiki>/.planning", r.stderr)

    def test_blocks_a_staged_modification(self):
        (self.team / "docs/ai/prds/prd-1-old.md").write_text("edited\n")
        git("add", "-u", cwd=self.team)                       # what `git add -A` does to a tracked file
        self.assertIn("docs/ai/prds/prd-1-old.md", self.assert_blocked().stderr)

    def test_blocks_a_staged_deletion(self):
        git("rm", "-q", "docs/ai/prds/prd-1-old.md", cwd=self.team)
        self.assertIn("docs/ai/prds/prd-1-old.md", self.assert_blocked().stderr)
        self.assertIn("docs/ai/prds/prd-1-old.md",
                      git("ls-tree", "-r", "--name-only", "HEAD", cwd=self.team).stdout)

    def test_blocks_workbench_state_and_testing_dir(self):
        for rel in (".workbench/state.json", "docs/ai/testing/scenarios/p/phase-1-scenario.md",
                    "docs/ai/plans/plan.md"):
            with self.subTest(rel=rel):
                f = self.team / rel
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text("x\n")
                git("add", "-f", rel, cwd=self.team)
                self.assertIn(rel, self.assert_blocked().stderr)
                git("rm", "-q", "--cached", rel, cwd=self.team)

    def test_blocks_the_toml_testing_dir(self):
        (self.team / ".claude").mkdir()
        (self.team / ".claude/orchestrator.toml").write_text('[testing]\ndir = "docs/testing"\n')
        guard(self.team)
        (self.team / "docs/testing").mkdir(parents=True)
        (self.team / "docs/testing/flow.md").write_text("x\n")
        git("add", "-f", "docs/testing/flow.md", cwd=self.team)
        self.assertIn("docs/testing/flow.md", self.assert_blocked().stderr)

    def test_allows_a_code_only_commit(self):
        (self.team / "src/a.txt").write_text("changed\n")
        (self.team / "docs/ai/prds-notes.md").write_text("not under the guarded dir\n")
        git("add", "src/a.txt", "docs/ai/prds-notes.md", cwd=self.team)
        before = self.head()
        r = self.commit()
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertNotEqual(before, self.head())

    def test_env_bypass(self):
        (self.team / "docs/ai/prds/prd-1-old.md").write_text("deliberate human edit\n")
        git("add", "-u", cwd=self.team)
        before = self.head()
        r = self.commit(env={"WORKBENCH_ALLOW_DOCS": "1"})
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertNotEqual(before, self.head())

    def test_inactive_when_docs_fence_unset(self):
        git("config", "--unset", "workbench.docsFence", cwd=self.team)
        git("rm", "-q", "docs/ai/prds/prd-1-old.md", cwd=self.team)
        r = self.commit()
        self.assertEqual(0, r.returncode, r.stderr)

    def test_works_from_a_linked_worktree(self):
        wt = self.base / "wt"
        git("worktree", "add", "-q", "-b", "feature", str(wt), cwd=self.team)
        (wt / "docs/ai/plans").mkdir(parents=True)
        (wt / "docs/ai/plans/p.md").write_text("x\n")
        self.assertIn("!! docs/ai/plans/",                       # the shared exclude applies here too
                      git("status", "--porcelain", "--ignored", cwd=wt).stdout)
        self.assertNotIn("?? docs/ai/plans", git("status", "--porcelain", cwd=wt).stdout)
        git("add", "-f", "docs/ai/plans/p.md", cwd=wt)
        self.assert_blocked(wt)
        git("rm", "-q", "--cached", "docs/ai/plans/p.md", cwd=wt)
        (wt / "src/a.txt").write_text("wt\n")
        git("add", "src/a.txt", cwd=wt)
        self.assertEqual(0, self.commit(wt).returncode)
        # guard install run FROM the worktree targets the same common-dir files
        rc, out = guard(wt)
        self.assertEqual(0, rc, out)
        self.assertIn("already has every guarded path", out)
        self.assertEqual(str(self.exclude()), orchestrator._exclude_path(str(wt)))

    def test_broken_orchestrator_path_fails_open(self):
        self.hook().write_text(orchestrator._hook_text(orchestrator._pre_commit_body("/nonexistent/orchestrator.py")))
        git("rm", "-q", "docs/ai/prds/prd-1-old.md", cwd=self.team)
        r = self.commit()
        self.assertEqual(0, r.returncode, r.stderr)

    def test_falls_back_to_the_repo_copy(self):
        copy = self.team / ".claude/skills/prd-orchestrator/scripts/orchestrator.py"
        copy.parent.mkdir(parents=True)
        copy.write_text(Path(orchestrator._ORCH_ABS).read_text())
        self.hook().write_text(orchestrator._hook_text(orchestrator._pre_commit_body("/nonexistent/orchestrator.py")))
        git("rm", "-q", "docs/ai/prds/prd-1-old.md", cwd=self.team)
        self.assert_blocked()

    def test_internal_error_fails_open(self):
        git("rm", "-q", "docs/ai/prds/prd-1-old.md", cwd=self.team)
        err = io.StringIO()
        real_run = subprocess.run

        def boom(argv, *a, **kw):
            if "diff" in argv:
                raise OSError("simulated")
            return real_run(argv, *a, **kw)
        with mock.patch.object(orchestrator.subprocess, "run", side_effect=boom), contextlib.redirect_stderr(err):
            self.assertEqual(0, orchestrator._docs_fence(str(self.team)))
        self.assertIn("fail open", err.getvalue())

    def test_emits_docs_fence_block_when_a_run_exists(self):
        sd = self.team / ".agents/orchestrator"
        sd.mkdir(parents=True)
        (sd / "RUN.md").write_text("PRD: x\n\n| # | Phase | Plan | Status |\n|---|---|---|---|\n| 1 | a | - | building |\n")
        git("rm", "-q", "docs/ai/prds/prd-1-old.md", cwd=self.team)
        self.assert_blocked()
        events = [json.loads(l) for l in (sd / "events.jsonl").read_text().splitlines()]
        block = [e for e in events if e["event"] == "docs_fence_block"]
        self.assertEqual(1, len(block))
        self.assertEqual(1, block[0]["phase"])
        self.assertIn("docs/ai/prds/prd-1-old.md", block[0]["detail"])


class GitFenceAddForce(unittest.TestCase):
    def run_fence(self, command):
        with tempfile.TemporaryDirectory() as sd:
            payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
            r = subprocess.run(["bash", str(GIT_FENCE)], input=payload, capture_output=True, text=True,
                               env={**os.environ, "ORCH_STATE_DIR": sd, "ORCH_STAGE": "builder", "ORCH_PHASE": "1"})
            events = Path(sd, "events.jsonl")
            return r, events.read_text() if events.exists() else ""

    def test_denies_add_force(self):
        for cmd in ("git add -f docs/ai/prds/x.md", "git add --force x"):
            with self.subTest(cmd=cmd):
                r, events = self.run_fence(cmd)
                self.assertEqual(2, r.returncode)
                self.assertIn("not available to you", r.stderr)
                self.assertIn('"git_fence"', events)

    def test_allows_plain_add_and_still_denies_commit(self):
        self.assertEqual(0, self.run_fence("git add src/a.txt")[0].returncode)
        self.assertEqual(2, self.run_fence("git commit -m x")[0].returncode)


class PreflightGuard(FenceBase):
    def preflight(self):
        with mock.patch.object(orchestrator, "trust_state", return_value=(True, "trusted")):
            return quiet(orchestrator.cmd_preflight, argparse.Namespace(root=str(self.team), trust=False))

    def init(self, store=None):
        quiet(orchestrator.cmd_init, argparse.Namespace(root=str(self.team), prd="docs/ai/prds/prd-1.md",
                                                       force=True, gate="commit", store=store))

    def test_store_mode_fails_without_guard_and_passes_after(self):
        wiki = make_repo(self.base / "wiki")
        store = wiki / ".planning" / "isi" / "F"
        store.mkdir(parents=True)
        self.init(store=str(store))
        rc, out = self.preflight()
        self.assertEqual(1, rc, out)
        self.assertIn("docs guard not installed", out)
        self.assertIn("guard install", out)
        self.assertIn("workbench.docsFence is unset", out)
        guard(self.team)
        rc, out = self.preflight()
        self.assertEqual(0, rc, out)
        self.assertIn("guard:      installed", out)
        git("config", "core.hooksPath", ".husky", cwd=self.team)
        rc, out = self.preflight()
        self.assertEqual(0, rc, out)
        self.assertIn("core.hooksPath is set", out)

    def test_store_mode_fails_when_only_the_hook_is_missing(self):
        wiki = make_repo(self.base / "wiki")
        store = wiki / ".planning" / "isi" / "F"
        store.mkdir(parents=True)
        self.init(store=str(store))
        guard(self.team)
        self.hook().unlink()
        rc, out = self.preflight()
        self.assertEqual(1, rc, out)
        self.assertIn("no orchestrator pre-commit hook", out)

    def test_legacy_mode_only_warns(self):
        self.init()
        rc, out = self.preflight()
        self.assertIn("warn: docs guard not installed", out)
        self.assertNotIn("- docs guard not installed", out)


if __name__ == "__main__":
    unittest.main()
