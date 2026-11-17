import argparse
import contextlib
import io
import importlib.util
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

KEYS = orchestrator._USAGE_KEYS


def usage_line(cwd, session, input_tokens, model="claude-sonnet-5", ts="2026-09-12T10:00:00Z"):
    return json.dumps({
        "cwd": str(cwd), "timestamp": ts, "sessionId": session,
        "message": {"model": model, "usage": {
            "input_tokens": input_tokens, "output_tokens": 0,
            "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}},
    })


class Base(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory(); self.addCleanup(self.home.cleanup)
        self.repo = tempfile.TemporaryDirectory(); self.addCleanup(self.repo.cleanup)
        self.root = Path(self.repo.name)
        (self.root / ".agents" / "orchestrator").mkdir(parents=True)
        self._env = {k: os.environ.get(k) for k in ("HOME", "CLAUDE_CONFIG_DIR")}
        os.environ["HOME"] = self.home.name
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def transcript(self, config_dir, session, tokens, cwd=None, **kw):
        d = Path(self.home.name) / config_dir / "projects" / "enc"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{session}.jsonl").write_text(usage_line(cwd or self.root, session, tokens, **kw) + "\n")

    def run_start(self, ts="2026-09-12T09:00:00Z"):
        ev = self.root / ".agents" / "orchestrator" / "events.jsonl"
        with open(ev, "a") as f:
            f.write(json.dumps({"ts": ts, "event": "run_start"}) + "\n")


class TranscriptRootsTests(Base):
    def test_counts_worker_dir_that_hardcoded_root_missed(self):
        # orchestrator under ~/.claude, worker under ~/.claude-personal2 (ccp2)
        self.transcript(".claude", "orch", 100)
        self.transcript(".claude-personal2", "worker", 250)
        totals, meta = orchestrator.transcript_usage(str(self.root))
        self.assertEqual(350, totals["input_tokens"])   # both dirs counted
        self.assertEqual(2, meta["sessions"])
        self.assertGreaterEqual(meta["roots"], 2)

    def test_config_dir_env_does_not_double_count(self):
        self.transcript(".claude", "orch", 100)
        os.environ["CLAUDE_CONFIG_DIR"] = str(Path(self.home.name) / ".claude")
        totals, _ = orchestrator.transcript_usage(str(self.root))
        self.assertEqual(100, totals["input_tokens"])   # deduped, not 200

    def test_other_cwd_is_excluded(self):
        self.transcript(".claude", "orch", 100, cwd="/somewhere/else")
        totals, meta = orchestrator.transcript_usage(str(self.root))
        self.assertEqual(0, totals["input_tokens"])
        self.assertEqual(0, meta["sessions"])


class BudgetTests(Base):
    def test_no_budget_configured_is_a_noop(self):
        over, cost, mx = orchestrator.check_budget(str(self.root), {"budget": {}})
        self.assertFalse(over)
        self.assertIsNone(mx)
        self.assertFalse((self.root / ".agents" / "orchestrator" / "BUDGET-EXCEEDED").exists())

    def test_overage_writes_sentinel_and_emits(self):
        self.run_start()
        self.transcript(".claude", "worker", 5_000_000)          # lots of tokens
        cfg = {"budget": {"max_cost_usd": 0.01}}                 # tiny budget -> over
        over, cost, mx = orchestrator.check_budget(str(self.root), cfg, phase=1)
        self.assertTrue(over)
        self.assertGreater(cost, 0.01)
        self.assertTrue((self.root / ".agents" / "orchestrator" / "BUDGET-EXCEEDED").exists())
        events = (self.root / ".agents" / "orchestrator" / "events.jsonl").read_text()
        self.assertIn("budget_exceeded", events)

    def test_under_budget_writes_no_sentinel(self):
        self.run_start()
        self.transcript(".claude", "worker", 10)
        over, _, _ = orchestrator.check_budget(str(self.root), {"budget": {"max_cost_usd": 1000.0}}, phase=1)
        self.assertFalse(over)
        self.assertFalse((self.root / ".agents" / "orchestrator" / "BUDGET-EXCEEDED").exists())


class AutoUsageTests(Base):
    def test_auto_usage_emits_a_usage_event(self):
        self.run_start()
        self.transcript(".claude", "orch", 100)
        self.transcript(".claude-personal2", "worker", 900)
        orchestrator._auto_usage(str(self.root), phase=2)
        events = [json.loads(l) for l in
                  (self.root / ".agents" / "orchestrator" / "events.jsonl").read_text().splitlines()]
        usage = [e for e in events if e.get("event") == "usage"]
        self.assertEqual(1, len(usage))
        self.assertEqual(1000, usage[0]["total_tokens"])        # both dirs, one event
        self.assertEqual(2, usage[0]["phase"])


if __name__ == "__main__":
    unittest.main()


class TelemetryCountsTests(Base):
    def telemetry(self, events):
        (self.root / ".agents/orchestrator/events.jsonl").write_text(
            "".join(json.dumps(event) + "\n" for event in events))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(orchestrator.cmd_telemetry(argparse.Namespace(root=str(self.root))), 0)
        return (self.root / ".agents/orchestrator/telemetry.md").read_text(), out.getvalue()

    def commits(self):
        return [
            {"ts": "2026-10-07T10:00:00Z", "event": "run_start"},
            {"ts": "2026-10-07T10:01:00Z", "event": "plan_done", "phase": 1},
            {"ts": "2026-10-07T10:11:00Z", "event": "commit", "phase": 1},
            {"ts": "2026-10-07T10:20:00Z", "event": "commit", "phase": 3},
            {"ts": "2026-10-07T11:11:00Z", "event": "commit", "phase": 1},
            {"ts": "2026-10-07T11:20:00Z", "event": "commit", "phase": 4},
            {"ts": "2026-10-07T11:30:00Z", "event": "commit", "phase": 2},
            {"ts": "2026-10-07T15:00:00", "event": "build_done", "phase": 4, "source": "hook"},
        ]

    def test_commits_are_counted(self):
        text, out = self.telemetry(self.commits())
        self.assertIn("- phases committed: 5", text)
        self.assertIn("5 phases committed", out)

    def test_first_commit_ends_phase_window(self):
        text, _ = self.telemetry(self.commits())
        self.assertIn("| 1 | 10m00s | yes |", text)

    def test_only_latest_run_counts(self):
        events = self.commits()[:4] + [
            {"ts": "2026-10-08T10:00:00Z", "event": "run_start"},
            {"ts": "2026-10-08T10:10:00Z", "event": "commit", "phase": 1},
        ]
        text, out = self.telemetry(events)
        self.assertIn("- phases committed: 1", text)
        self.assertIn("_Run window 2026-10-08T10:00:00Z →", text)
        self.assertIn("1 phases committed", out)

    def test_gate_failed_counts_as_fix_cycle(self):
        text, _ = self.telemetry([
            {"ts": "2026-10-08T10:00:00Z", "event": "run_start"},
            {"ts": "2026-10-08T10:01:00Z", "event": "verify_fail", "phase": 1},
            {"ts": "2026-10-08T10:02:00Z", "event": "gate_failed", "phase": 1},
        ])
        self.assertIn("fix cycles (verify/e2e/gate failures): 2", text)


class SubagentUsageTests(Base):
    def subagent(self, config_dir, session, agent, tokens, cwd=None, **kw):
        directory = Path(self.home.name) / config_dir / 'projects/enc' / session / 'subagents'
        directory.mkdir(parents=True, exist_ok=True)
        data = json.loads(usage_line(cwd or self.root, session, tokens, **kw))
        data['isSidechain'] = True
        path = directory / f'agent-{agent}.jsonl'
        path.write_text(json.dumps(data) + '\n')
        (directory / f'agent-{agent}.meta.json').write_text(json.dumps(data))
        return path

    def test_separate_main_and_subagent_totals(self):
        self.transcript('.claude', 'S1', 100)
        before, before_meta = orchestrator.transcript_usage(str(self.root))
        self.subagent('.claude', 'S1', 'a', 40)
        after, meta = orchestrator.transcript_usage(str(self.root), stages={'S1': 'reviewer'})
        self.assertEqual(before, after)
        self.assertEqual(before_meta['per_model'], meta['per_model'])
        self.assertEqual(before_meta['sessions'], meta['sessions'])
        self.assertEqual(before_meta['messages'], meta['messages'])
        sub = meta['subagent']
        self.assertEqual(40, sub['totals']['input_tokens'])
        self.assertEqual(1, sub['agents'])
        self.assertEqual(1, sub['messages'])
        self.assertEqual({'reviewer'}, set(sub['by_stage']))
        self.assertEqual(sub['totals'], sub['by_stage']['reviewer']['totals'])
        self.assertEqual(1, sub['by_session']['S1']['agents'])
        _, meta = orchestrator.transcript_usage(str(self.root))
        self.assertEqual({'unattributed'}, set(meta['subagent']['by_stage']))

    def test_filters_and_session_fallback(self):
        self.subagent('.claude', 'S1', 'other', 500, cwd='/other')
        self.subagent('.claude', 'S1', 'early', 500, ts='2026-09-11T10:00:00Z')
        self.subagent('.claude', 'S1', 'late', 500, ts='2026-09-13T10:00:00Z')
        path = self.subagent('.claude', 'S1', 'valid', 40)
        data = json.loads(path.read_text())
        data.pop('sessionId')
        path.write_text(json.dumps(data) + '\n' + json.dumps(data) + '\n')
        _, meta = orchestrator.transcript_usage(str(self.root), since='2026-09-12T09:00:00Z',
            until='2026-09-12T11:00:00Z', stages={'S1': 'reviewer'})
        self.assertEqual(80, meta['subagent']['totals']['input_tokens'])
        self.assertEqual(1, meta['subagent']['agents'])
        self.assertEqual(1, meta['subagent']['by_stage']['reviewer']['agents'])

    def test_mtime_skip_and_meta_only(self):
        path = self.subagent('.claude', 'S1', 'a', 40)
        os.utime(path, (1, 1))
        _, meta = orchestrator.transcript_usage(str(self.root), since='2026-09-12T09:00:00Z')
        self.assertEqual(0, meta['subagent']['messages'])
        path.unlink()
        _, meta = orchestrator.transcript_usage(str(self.root))
        self.assertEqual(0, meta['subagent']['agents'])

    def test_no_roots(self):
        _, meta = orchestrator.transcript_usage(str(self.root))
        self.assertEqual(0, meta['subagent']['agents'])
        self.assertEqual({}, meta['subagent']['by_stage'])


class SubagentTelemetryTests(Base):
    subagent = SubagentUsageTests.subagent

    def events(self):
        return [
            {'event': 'run_start', 'ts': '2026-09-12T09:00:00Z'},
            {'event': 'worker_session', 'ts': '2026-09-12T09:01:00Z',
             'session_id': 'S1', 'stage': 'reviewer', 'phase': 1},
            {'event': 'commit', 'ts': '2026-09-12T11:00:00Z', 'phase': 1},
        ]

    def report(self, archived=False):
        sd = self.root / ('.agents/copied' if archived else '.agents/orchestrator')
        sd.mkdir(parents=True, exist_ok=True)
        (sd / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in self.events()))
        out = io.StringIO()
        args = argparse.Namespace(root=str(self.root), state_dir=str(sd) if archived else None)
        with contextlib.redirect_stdout(out):
            self.assertEqual(0, orchestrator.cmd_telemetry(args))
        return sd, out.getvalue()

    def test_subagent_report(self):
        self.subagent('.claude', 'S1', 'a', 40)
        sd, out = self.report()
        text = (sd / 'telemetry.md').read_text()
        self.assertIn('## Subagents', text)
        self.assertIn('| reviewer | 1 | 40 |', text)
        self.assertIn('subagents: reviewer 1', out)

    def test_none_found(self):
        sd, out = self.report()
        self.assertIn('- subagent: none found', (sd / 'telemetry.md').read_text())
        self.assertIn('subagent: none found', out)

    def test_archived_read_only(self):
        sd, out = self.report(archived=True)
        self.assertIn('## Subagents', out)
        self.assertIn('- subagent: none found', out)
        self.assertIn('n/a (archived run)', out)
        self.assertFalse((sd / 'telemetry.md').exists())
        (sd / 'telemetry.md').write_text('preserved')
        self.report(archived=True)
        self.assertEqual('preserved', (sd / 'telemetry.md').read_text())

    def test_decisions_validation_matches_in_live_and_archived_reports(self):
        for archived in (False, True):
            with self.subTest(archived=archived):
                sd, _ = self.report(archived=archived)
                decisions = sd / 'decisions.jsonl'
                decisions.write_text('\n{"one_way": true}\n\n{"one_way": false}\n')
                sd, out = self.report(archived=archived)
                text = out if archived else (sd / 'telemetry.md').read_text()
                self.assertIn('- deviations recorded: 2 (1 one-way)', text)
                decisions.write_text('\n{"one_way": true}\ninvalid\n')
                err = io.StringIO()
                with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as raised:
                    self.report(archived=archived)
                self.assertEqual(2, raised.exception.code)
                self.assertIn('decisions.jsonl:3: bad JSON:', err.getvalue())

    def test_archived_report_never_reads_live_only_inputs(self):
        with mock.patch.object(orchestrator, '_run_field', side_effect=AssertionError('live run')), \
             mock.patch.object(orchestrator, 'e2e_cost_section', side_effect=AssertionError('live cost')), \
             mock.patch.object(orchestrator, '_phases_missing_e2e', side_effect=AssertionError('live phases')):
            _, out = self.report(archived=True)
        self.assertIn('**your estimate by hand:** n/a (archived run)', out)
        self.assertIn('## E2E engine cost\n\nn/a (archived run)', out)
        self.assertIn('e2e missing for committed phase(s): n/a (archived run)', out)
        self.assertNotIn('not computed', out)

    def test_live_report_keeps_live_inputs_and_cost_error_fallback(self):
        with mock.patch.object(orchestrator, '_run_field', return_value='2 days'), \
             mock.patch.object(orchestrator, 'e2e_cost_section', return_value=['## fixture cost']), \
             mock.patch.object(orchestrator, '_phases_missing_e2e', return_value=['2', '4']):
            sd, out = self.report()
        text = (sd / 'telemetry.md').read_text()
        self.assertIn('**your estimate by hand:** 2 days', text)
        self.assertIn('## fixture cost', text)
        self.assertIn('e2e missing for committed phase(s): 2, 4', text)
        self.assertIn('vs your estimate 2 days', out)
        with mock.patch.object(orchestrator, 'e2e_cost_section', side_effect=ValueError('bad cost')):
            sd, _ = self.report()
        self.assertIn('_not computed: ValueError: bad cost_', (sd / 'telemetry.md').read_text())
