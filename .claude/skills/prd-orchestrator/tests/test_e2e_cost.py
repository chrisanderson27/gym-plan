"""`e2e-cost` and telemetry's E2E engine cost section, on fixture transcripts in a temp HOME."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)

PHASE_PROMPT = ("You are validating **one** phase of this feature against the **live app**. "
                "Do only this. Phase {n} — Something, of docs/ai/prds/x.md")
ITEM_PROMPT = "You are executing **one** item of an RBCloud e2e test plan. Item 1.1"


def worker_lines(prompt, cwd, session, input_tokens, start="2026-09-12T10:00:00Z",
                 end="2026-09-12T10:10:00Z", model="claude-sonnet-5"):
    """A worker transcript: its first prompt, then one message whose usage is repeated on a
    second content block (same message.id + requestId — must count once)."""
    usage = {"input_tokens": input_tokens, "output_tokens": 0,
             "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    first = {"type": "user", "cwd": str(cwd), "sessionId": session, "timestamp": start,
             "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}}
    reply = {"type": "assistant", "cwd": str(cwd), "sessionId": session, "timestamp": end,
             "requestId": "req-1", "message": {"id": "msg-1", "model": model, "usage": usage}}
    return [first, reply, dict(reply)]


class Base(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory(); self.addCleanup(self.home.cleanup)
        self.repo = tempfile.TemporaryDirectory(); self.addCleanup(self.repo.cleanup)
        self.lib = tempfile.TemporaryDirectory(); self.addCleanup(self.lib.cleanup)
        self.root = Path(self.repo.name)
        self.sd = self.root / ".agents" / "orchestrator"
        self.sd.mkdir(parents=True)
        keys = ("HOME", "CLAUDE_CONFIG_DIR", "PILOT_LIBRARY_ROOT")
        self._env = {k: os.environ.get(k) for k in keys}
        os.environ["HOME"] = self.home.name
        os.environ["PILOT_LIBRARY_ROOT"] = self.lib.name
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        self.addCleanup(self._restore_env)
        self.ledger = Path(self.lib.name) / orchestrator.PILOT_APP / "usage.jsonl"
        self.ledger.parent.mkdir(parents=True)

    def _restore_env(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def transcript(self, name, lines, config_dir=".claude"):
        d = Path(self.home.name) / config_dir / "projects" / "enc"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))

    def history(self):
        """Three past phase workers ($2, $4, $6 at sonnet-5's $2/MTok input) and one plan item."""
        for i, mtok in enumerate((1, 2, 3)):
            self.transcript(f"past{i}", worker_lines(PHASE_PROMPT.format(n=1), "/elsewhere", f"p{i}",
                                                     mtok * 1_000_000, start=f"2026-09-0{i + 1}T10:00:00Z",
                                                     end=f"2026-09-0{i + 1}T10:30:00Z"))
        self.transcript("item", worker_lines(ITEM_PROMPT, "/elsewhere", "it", 500_000,
                                             start="2026-09-05T10:00:00Z"), config_dir=".claude-personal2")
        self.transcript("other", [{"type": "user", "sessionId": "o", "timestamp": "2026-09-05T10:00:00Z",
                                   "message": {"content": "Build phase 1."}}])


class ScanTests(Base):
    def test_finds_workers_dedupes_usage_prices_and_reads_the_phase(self):
        self.history()
        rows = orchestrator.e2e_worker_sessions()
        self.assertEqual([r["kind"] for r in rows], ["prd-e2e-phase"] * 3 + ["plan-item"])
        self.assertEqual([r["usd"] for r in rows], [2.0, 4.0, 6.0, 1.0])   # repeated block counted once
        self.assertEqual(rows[0]["turns"], 1)
        self.assertEqual(rows[0]["phase"], 1)
        self.assertEqual(rows[0]["mins"], 30.0)
        base = orchestrator.e2e_baseline(rows)
        self.assertEqual((base["n"], base["median"], base["from"], base["to"]),
                         (3, 4.0, "2026-09-01", "2026-09-03"))

    def test_scan_is_cached_by_mtime_and_size(self):
        self.history()
        first = orchestrator.e2e_worker_sessions()
        self.assertTrue((Path(self.lib.name) / orchestrator.PILOT_APP / orchestrator.E2E_COST_CACHE).exists())
        with mock.patch.object(orchestrator, "_scan_e2e_transcript", side_effect=AssertionError("rescanned")):
            self.assertEqual(orchestrator.e2e_worker_sessions(), first)

    def test_e2e_cost_json_has_both_sides(self):
        self.history()
        with open(self.ledger, "w") as f:
            for result, usd in (("pass", 0.10), ("pass", 0.30), ("blocked", 0.05)):
                f.write(json.dumps({"ts": "2026-09-10T10:00:00+0000", "result": result,
                                    "total_cost_usd": usd, "local": {"decisions": 10}}) + "\n")
            f.write(json.dumps({"ts": "2026-09-10T09:00:00+0000", "result": "compiled",
                                "total_cost_usd": 0.20}) + "\n")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = orchestrator.cmd_e2e_cost(argparse.Namespace(root=str(self.root), json=True, since=None))
        doc = json.loads(out.getvalue())
        self.assertEqual(rc, 0)
        self.assertEqual(doc["claude_summary"]["prd-e2e-phase"]["median"], 4.0)
        self.assertEqual(doc["claude_summary"]["prd-e2e-phase"]["p90"], 6.0)
        self.assertEqual(doc["nimble"]["runs"], 3)
        self.assertEqual(doc["nimble"]["results"], {"pass": 2, "fail": 0, "blocked": 1})
        self.assertEqual(doc["nimble"]["per_run"]["median"], 0.1)
        self.assertEqual(doc["nimble"]["total_usd"], 0.65)            # compile-only spend counts in the total
        self.assertNotIn("per_model", doc["claude"][0])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            orchestrator.cmd_e2e_cost(argparse.Namespace(root=str(self.root), json=False, since="2026-09-03"))
        text = out.getvalue()
        self.assertIn("prd-e2e-phase: n=1  median $6.00", text)
        self.assertIn("Nimble runs — 3 run(s): 2 pass / 0 fail / 1 blocked", text)


class TelemetrySavingsTests(Base):
    def test_savings_line_and_fallback_note(self):
        self.history()
        with open(self.sd / "events.jsonl", "w") as f:
            f.write(json.dumps({"ts": "2026-09-12T09:00:00Z", "event": "run_start"}) + "\n")
            f.write(json.dumps({"ts": "2026-09-12T12:00:00Z", "event": "phase_committed", "phase": 1}) + "\n")
        # phase 1: Nimble passed for $0.50. phase 2: Nimble blocked ($0.25), a fallback worker ran ($8).
        p1 = self.sd / "phase-1"; p1.mkdir()
        (p1 / "nimble-usage.json").write_text(json.dumps(
            {"ts": "2026-09-12T10:00:00+0000", "result": "pass", "total_cost_usd": 0.5, "dir": str(p1)}))
        attempt = self.sd / "phase-2" / "nimble-attempt"; attempt.mkdir(parents=True)
        (attempt / "nimble-usage.json").write_text(json.dumps(
            {"ts": "2026-09-12T10:30:00+0000", "result": "blocked", "total_cost_usd": 0.25,
             "dir": str(self.sd / "phase-2")}))
        self.transcript("fallback", worker_lines(PHASE_PROMPT.format(n=2), self.root, "fb", 4_000_000,
                                                 start="2026-09-12T11:00:00Z", end="2026-09-12T11:20:00Z"))
        # an earlier fail→fix re-run of phase 1 that only the pooled ledger kept
        self.ledger.write_text(json.dumps({"ts": "2026-09-12T09:30:00+0000", "result": "fail",
                                           "total_cost_usd": 0.5, "dir": str(p1)}) + "\n")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = orchestrator.cmd_telemetry(argparse.Namespace(root=str(self.root)))
        md = (self.sd / "telemetry.md").read_text()
        self.assertEqual(rc, 0)
        # baseline = median of the 3 workers before the run start ($4), not this run's own fallback
        self.assertIn("**Nimble saved ≈ $3.00 vs an all-Claude e2e** (baseline: median of 3 past "
                      "Claude e2e workers, $4.00 each, 2026-09-01..2026-09-03)", md)
        self.assertIn("| 1 | Nimble (fail/pass) | 1.00 | 0.00 | 4.00 | 3.00 |", md)
        self.assertIn("| 2 | Nimble → fallback | 0.25 | 8.00 | 4.00 | 0.00 |", md)
        self.assertIn("Phase 2: Nimble blocked and fell back to a Claude worker ($8.00) — no savings "
                      "for this phase, and the Nimble attempt's $0.25 was wasted.", md)
        self.assertIn("An estimate", md)
        self.assertIn("Nimble saved ≈ $3.00", out.getvalue())

    def test_no_e2e_spend_says_so(self):
        (self.sd / "events.jsonl").write_text(json.dumps({"ts": "2026-09-12T09:00:00Z", "event": "run_start"}) + "\n")
        (self.sd / "phase-1").mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            orchestrator.cmd_telemetry(argparse.Namespace(root=str(self.root)))
        self.assertIn("No e2e spend recorded", (self.sd / "telemetry.md").read_text())


if __name__ == "__main__":
    unittest.main()
