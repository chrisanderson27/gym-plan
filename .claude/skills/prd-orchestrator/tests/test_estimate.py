import argparse
import contextlib
import io
import json
from test_events import Base, orchestrator


class Estimate(Base):
    def setUp(self):
        super().setUp()
        self.run = self.state / 'RUN.md'
        self.run.write_text('Run id: abcdefabcdef\nBase commit: abc123\nHuman estimate:    # x\n')
        self.log('run_start')

    def estimate(self, **values):
        args = argparse.Namespace(root=str(self.root), low=12., likely=20., high=32., basis='reading, coding and validation')
        for key, value in values.items():
            setattr(args, key, value)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return orchestrator.cmd_estimate(args)

    def test_kickoff_writes_line_and_utc_event(self):
        self.assertEqual(self.estimate(), 0)
        value = orchestrator._run_field(str(self.root), 'Human estimate')
        self.assertTrue(value.startswith('low 12h · likely 20h · high 32h'))
        event = self.records()[-1]
        self.assertEqual(event['source'], 'kickoff')
        self.assertTrue(event['ts'].endswith('Z'))
        self.assertIn(event['ts'], value)
        self.assertIsInstance(event['likely'], int)

    def test_revision_preserves_kickoff_bytes(self):
        self.estimate()
        before = self.run.read_bytes()
        self.assertEqual(self.estimate(likely=24.), 0)
        self.assertEqual(self.run.read_bytes(), before)
        self.assertEqual(self.records()[-1]['source'], 'revised')

    def test_invalid_inputs_emit_nothing(self):
        before = self.events.read_bytes()
        for values in ({'low': 21.}, {'high': 19.}, {'low': -1.}, {'likely': float('nan')}, {'high': float('inf')}, {'basis': '  '}):
            with self.subTest(values=values):
                self.assertEqual(self.estimate(**values), 2)
                self.assertEqual(self.events.read_bytes(), before)

    def test_missing_or_other_run_start_is_rejected(self):
        for content in ('', json.dumps({'event': 'run_start', 'run_id': '111111111111'}) + '\n'):
            self.events.write_text(content)
            self.assertEqual(self.estimate(), 2)
            self.assertEqual(self.events.read_text(), content)

    def test_missing_run_is_rejected(self):
        self.run.unlink()
        before = self.events.read_bytes()
        self.assertEqual(self.estimate(), 2)
        self.assertEqual(self.events.read_bytes(), before)

    def test_line_cleans_basis_but_event_keeps_it(self):
        basis = '  design #1\nvalidation\rreview  '
        self.assertEqual(self.estimate(basis=basis), 0)
        self.assertNotIn('#', self.run.read_text())
        self.assertEqual(self.records()[-1]['basis'], basis)

    def test_inserts_missing_line_after_base_commit(self):
        self.run.write_text('Run id: abcdefabcdef\nBase commit: abc123\n\n## Phases\n')
        self.estimate()
        self.assertIn('Base commit: abc123\nHuman estimate: low', self.run.read_text())

    def test_vocabulary(self):
        self.assertIn('human_estimate', orchestrator.VALID_EVENTS)
