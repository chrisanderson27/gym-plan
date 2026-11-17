import importlib.util
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


PRD = """# PRD

## 7. Design contract

| Surface | node-id | Screen | Today | Target | States |
|---|---|---|---|---|---|
| Schedule Settings | `14527:184997` | /scheduling | proto | reworked | popover |
| Roster | `14639:223385` | drawer | new | greenfield | edit form |
| Save Layout | (none) | header | new | new | button only |

## 8. Architecture

Not a design row: 14639:141985 lives here but must be ignored.
"""

ENABLED = {"figma": {"enabled": True, "checks": "per-phase", "file_key": "ABC123", "bundle_dir": ".agents/figma"}}


class FigmaFrameParseTests(unittest.TestCase):
    def test_parses_surface_and_node_id_skipping_rows_without_one(self):
        self.assertTrue(hasattr(orchestrator, "_figma_frames_from_prd"))
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
            handle.write(PRD)
            path = handle.name
        try:
            frames = orchestrator._figma_frames_from_prd(path)
        finally:
            os.unlink(path)
        self.assertEqual(
            frames,
            [("Schedule Settings", "14527:184997"), ("Roster", "14639:223385")],
        )

    def test_no_design_contract_returns_empty(self):
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
            handle.write("# PRD\n\n## 6. Scope\n\nNo design here.\n")
            path = handle.name
        try:
            self.assertEqual(orchestrator._figma_frames_from_prd(path), [])
        finally:
            os.unlink(path)


class FigmaCompareResultTests(unittest.TestCase):
    def _write(self, body):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "figma-compare.md")
        Path(path).write_text(body)
        return path

    def test_malformed_first_line_raises(self):
        with self.assertRaisesRegex(ValueError, "RESULT"):
            orchestrator._figma_compare_result(self._write("no result line\n"))

    def test_counts_only_unresolved_regressions(self):
        path = self._write(
            "RESULT: fail\n\n"
            "| Settings | title casing | regression |\n"
            "| Settings | reset style | regression (fixed) |\n"
            "| Roster | dot | confirm |\n"
            "| Roster | summary | deferred |\n"
        )
        self.assertEqual(orchestrator._figma_compare_result(path), ("fail", 1))

    def test_clean_pass(self):
        path = self._write("RESULT: pass\n\n| Roster | chips | confirm |\n")
        self.assertEqual(orchestrator._figma_compare_result(path), ("pass", 0))


class ValidateFigmaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        (self.root / ".gitignore").write_text("/.agents/\n")
        self.phase = self.root / ".agents" / "orchestrator" / "phase-1"
        self.phase.mkdir(parents=True)

    def test_end_mode_defers_until_final_check(self):
        cfg = {"figma": {**ENABLED["figma"], "checks": "end"}}
        ok, reason = orchestrator.validate_figma(str(self.root), cfg, "p.md", 1)
        self.assertTrue(ok, reason)
        self.assertIn("deferred", reason)
        ok, reason = orchestrator.validate_figma(str(self.root), cfg, "p.md", 1, final=True)
        self.assertFalse(ok)
        self.assertIn("missing", reason)
        (self.phase / "figma-compare.md").write_text("RESULT: pass\n")
        self.assertTrue(orchestrator.validate_figma(str(self.root), cfg, "p.md", 1, final=True)[0])

    def test_kickoff_skip_overrides_config_without_a_comparison(self):
        (self.phase.parent / "RUN.md").write_text("Figma checks: skip\n")
        ok, reason = orchestrator.validate_figma(str(self.root), ENABLED, "p.md", 1, final=True)
        self.assertTrue(ok, reason)
        self.assertIn("skipped", reason)

    def test_invalid_kickoff_choice_fails(self):
        (self.phase.parent / "RUN.md").write_text("Figma checks: sometimes\n")
        ok, reason = orchestrator.validate_figma(str(self.root), ENABLED, "p.md", 1)
        self.assertFalse(ok)
        self.assertIn("skip, per-phase, or end", reason)

    def test_disabled_passes_trivially(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, reason = orchestrator.validate_figma(tmp, {"figma": {"enabled": False}}, "p.md", 1)
            self.assertTrue(ok)
            self.assertIn("N/A", reason)

    def test_missing_compare_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["git", "init", "-q", tmp], check=True)
            (Path(tmp) / ".gitignore").write_text("/.agents/\n")
            ok, reason = orchestrator.validate_figma(tmp, ENABLED, "p.md", 1)
            self.assertFalse(ok)
            self.assertIn("missing", reason)

    def test_unresolved_regression_fails_then_passes_when_resolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["git", "init", "-q", tmp], check=True)
            (Path(tmp) / ".gitignore").write_text("/.agents/\n")
            phase = Path(tmp) / ".agents" / "orchestrator" / "phase-1"
            phase.mkdir(parents=True)
            compare = phase / "figma-compare.md"

            compare.write_text("RESULT: fail\n\n| Settings | casing | regression |\n")
            ok, reason = orchestrator.validate_figma(tmp, ENABLED, "p.md", 1)
            self.assertFalse(ok)
            self.assertIn("regression", reason)

            compare.write_text("RESULT: pass\n\n| Settings | casing | regression (fixed) |\n")
            ok, reason = orchestrator.validate_figma(tmp, ENABLED, "p.md", 1)
            self.assertTrue(ok, reason)

    def test_na_result_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["git", "init", "-q", tmp], check=True)
            (Path(tmp) / ".gitignore").write_text("/.agents/\n")
            phase = Path(tmp) / ".agents" / "orchestrator" / "phase-3"
            phase.mkdir(parents=True)
            (phase / "figma-compare.md").write_text("RESULT: na\n\nNo Figma surface in this phase.\n")
            ok, _ = orchestrator.validate_figma(tmp, ENABLED, "p.md", 3)
            self.assertTrue(ok)

    def test_committed_flag_still_requires_local_untracked_bundle(self):
        (self.phase / "figma-compare.md").write_text("RESULT: pass\n")
        bundle = self.root / ".agents" / "figma" / "p"
        bundle.mkdir(parents=True)
        (bundle / "roster.png").write_bytes(b"\x89PNG\r\n")
        ok, reason = orchestrator.validate_figma(str(self.root), ENABLED, "p.md", 1, committed=True)
        self.assertTrue(ok, reason)

        subprocess.run(["git", "-C", str(self.root), "add", "-f", ".agents/figma"], check=True)
        ok, reason = orchestrator.validate_figma(str(self.root), ENABLED, "p.md", 1, committed=True)
        self.assertFalse(ok)
        self.assertIn("never be tracked", reason)

    def test_unignored_storage_is_rejected(self):
        cfg = {"figma": {**ENABLED["figma"], "bundle_dir": "docs/ai/figma"}}
        ok, reason = orchestrator.validate_figma(str(self.root), cfg, "p.md", 1)
        self.assertFalse(ok)
        self.assertIn("gitignored", reason)

    def test_pull_writes_ignored_snapshot_and_reuses_it(self):
        api = self.root / orchestrator.FIGMA_API_REL
        api.parent.mkdir(parents=True)
        api.touch()
        real_run = subprocess.run
        downloads = []

        def extract(args, **kwargs):
            if args[0] == "git":
                return real_run(args, **kwargs)
            downloads.append(args[2])
            if args[2] == "image":
                (Path(args[-1]) / "frame.png").write_bytes(b"PNG")
            return subprocess.CompletedProcess(args, 0, stdout='{"nodes": {}}')

        with mock.patch.object(orchestrator.subprocess, "run", side_effect=extract):
            bundle, pulled, skipped = orchestrator.figma_pull(str(self.root), ENABLED, "p.md", [("Roster", "123:456")])
            self.assertEqual(["roster"], pulled)
            self.assertEqual([], skipped)
            self.assertTrue((Path(bundle) / "roster.tokens.json").exists())
            _, pulled, skipped = orchestrator.figma_pull(str(self.root), ENABLED, "p.md", [("Roster", "123:456")])
            self.assertEqual([], pulled)
            self.assertEqual(["roster"], skipped)
        self.assertEqual(["image", "nodes"], downloads)
        result = real_run(["git", "ls-files", "--others", "--exclude-standard", ".agents/figma"],
                          cwd=self.root, capture_output=True, text=True, check=True)
        self.assertEqual("", result.stdout)

    def test_figma_pull_reads_frames_from_the_root_not_the_cwd(self):
        (self.root / "docs").mkdir(exist_ok=True)
        (self.root / "docs" / "prd.md").write_text(PRD)
        seen = []

        def fake_pull(root, cfg, prd, frames, force=False):
            seen.extend(frames)
            return os.path.join(root, ".agents", "figma", "prd"), [], []

        elsewhere = tempfile.TemporaryDirectory()
        self.addCleanup(elsewhere.cleanup)
        cwd = os.getcwd()
        os.chdir(elsewhere.name)
        self.addCleanup(os.chdir, cwd)
        with mock.patch.object(orchestrator, "load_config", return_value=(ENABLED, [])), \
                mock.patch.object(orchestrator, "figma_pull", side_effect=fake_pull), \
                mock.patch("sys.stdout"):
            rc = orchestrator.cmd_figma_pull(orchestrator.argparse.Namespace(
                root=str(self.root), prd="docs/prd.md", force=False))
        self.assertEqual(0, rc)
        self.assertEqual([("Schedule Settings", "14527:184997"), ("Roster", "14639:223385")], seen)

    def test_pull_rejects_unignored_destination_before_download(self):
        api = self.root / orchestrator.FIGMA_API_REL
        api.parent.mkdir(parents=True)
        api.touch()
        cfg = {"figma": {**ENABLED["figma"], "bundle_dir": "docs/ai/figma"}}
        with self.assertRaisesRegex(ValueError, "gitignored"):
            orchestrator.figma_pull(str(self.root), cfg, "p.md", [("Roster", "123:456")])
        self.assertFalse((self.root / "docs" / "ai" / "figma").exists())


if __name__ == "__main__":
    unittest.main()
