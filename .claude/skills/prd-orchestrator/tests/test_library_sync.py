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


class LibrarySync(unittest.TestCase):
    """Close-out commits what the e2e runs taught the pilot's flow library."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sd = self.root / ".agents" / "orchestrator"
        self.sd.mkdir(parents=True)
        (self.sd / "RUN.md").write_text("# run\nPRD: .planning/x/prds/prd-7-widgets.md\n")

    def run_sync(self, results):
        calls = []

        def fake(command, *extra):
            calls.append((command, extra))
            return results[command]

        out = io.StringIO()
        with mock.patch.object(orchestrator, "pilot_library", side_effect=fake), \
                contextlib.redirect_stdout(out):
            rc = orchestrator.cmd_library_sync(argparse.Namespace(root=str(self.root), prd=None))
        return rc, out.getvalue(), calls

    def test_source_names_the_prd_and_repo(self):
        rc, out, calls = self.run_sync({"sync": (0, "library sync: committed 3 file(s) as abc123"),
                                        "health": (0, "library rbcloud: 4 flows")})
        self.assertEqual(rc, 0)
        sync = next(c for c in calls if c[0] == "sync")
        self.assertEqual(sync[1], ("--source", f"prd-7-widgets ({self.root.name})"))
        self.assertIn("committed 3 file(s)", out)
        self.assertIn("4 flows", out)

    def test_event_logged_and_valid(self):
        self.assertIn("library_sync", orchestrator.VALID_EVENTS)
        self.run_sync({"sync": (0, "library sync: nothing new"), "health": (0, "")})
        events = [json.loads(l) for l in (self.sd / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events[-1]["event"], "library_sync")

    def test_failure_is_reported_not_swallowed(self):
        rc, out, _ = self.run_sync({"sync": (1, "library sync: commit failed — hook"),
                                    "health": (0, "")})
        self.assertEqual(rc, 1)
        self.assertIn("commit failed", out)


if __name__ == "__main__":
    unittest.main()
