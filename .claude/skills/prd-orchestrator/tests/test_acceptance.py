import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

SKILL = Path(__file__).parents[1]
HOOK = SKILL / 'scripts/hooks/stop-gate.sh'
SPEC = importlib.util.spec_from_file_location('orchestrator', SKILL / 'scripts/orchestrator.py')
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class StopGateAcceptance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.marker = self.state / 'summary.md'

    def run_hook(self, text=None, stage='builder'):
        if text is not None:
            self.marker.write_text(text)
        env = {**os.environ, 'ORCH_STATE_DIR': str(self.state),
               'ORCH_ARTIFACT': str(self.marker), 'ORCH_STAGE': stage, 'ORCH_PHASE': '1'}
        result = subprocess.run(['bash', str(HOOK)], env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_prose_blocks(self):
        out = self.run_hook('Built it.\n')
        self.assertIn('"decision":"block"', out)
        self.assertIn('## Acceptance', out)

    def test_header_without_rows_blocks(self):
        self.assertIn('"decision":"block"', self.run_hook(
            '## Acceptance\n| AC | Result | Proof |\n|---|---|---|\n'))

    def test_table_passes_without_plan(self):
        self.assertNotIn('"decision":"block"', self.run_hook(
            '## Acceptance\n| AC1 | met | verify.json level tests |\n'))
        self.assertIn('build_done', (self.state / 'events.jsonl').read_text())

    def test_row_under_other_heading_blocks(self):
        self.assertIn('"decision":"block"', self.run_hook(
            '## Acceptance\n## New facts\n| AC1 | met | proof |\n'))

    def test_fix_is_exempt(self):
        self.assertNotIn('"decision":"block"', self.run_hook('Fixed.\n', stage='fix'))

    def test_fourth_attempt_releases_without_gate_failed(self):
        for _ in range(3):
            self.assertIn('"decision":"block"', self.run_hook('Built.\n'))
        self.assertNotIn('"decision":"block"', self.run_hook())
        self.assertFalse((self.state / 'GATE-FAILED-builder-1').exists())
        events = [json.loads(line)['event'] for line in (self.state / 'events.jsonl').read_text().splitlines()]
        self.assertIn('acceptance_missing', events)
        self.assertIn('build_done', events)

    def test_missing_summary_still_blocks_and_fails_after_retries(self):
        for _ in range(3):
            self.assertIn('"decision":"block"', self.run_hook())
        self.run_hook()
        self.assertTrue((self.state / 'GATE-FAILED-builder-1').exists())

    def test_crlf_and_heading_whitespace(self):
        self.assertNotIn('"decision":"block"', self.run_hook(
            '## Acceptance  \r\n| AC1 | met | proof |\r\n'))


class ReportAcceptance(unittest.TestCase):
    def test_decorated_and_qualified_results_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            phase = Path(tmp) / 'phase-1'
            phase.mkdir()
            for result, expected in [('**not met**', 'not met'), ('❌ not met', 'not met'),
                                     ('not proven (needs e2e)', 'not proven'),
                                     ('NOT PROVEN', 'not proven'), ('met', None)]:
                with self.subTest(result=result):
                    (phase / 'summary.md').write_text(
                        f'## Acceptance\n| AC1 | {result} | proof |\n')
                    rows = orchestrator._acceptance_rows(tmp)
                    self.assertEqual(rows, [(1, 'AC1', expected, 'proof')] if expected else [])

    def test_gap_updates_the_existing_criterion_row(self):
        contract = (SKILL.parent / 'execute/SKILL.md').read_text()
        self.assertIn("each affected criterion's existing row", contract)
        with tempfile.TemporaryDirectory() as tmp:
            phase = Path(tmp) / 'phase-1'
            phase.mkdir()
            summary = phase / 'summary.md'
            summary.write_text('## Acceptance\n| AC2 | met | test passes |\n')
            summary.write_text(summary.read_text().replace(
                '| AC2 | met | test passes |',
                '| AC2 | not proven | gap: needs browser evidence |'))
            self.assertEqual(orchestrator._acceptance_rows(tmp),
                             [(1, 'AC2', 'not proven', 'gap: needs browser evidence')])
            summary.write_text(summary.read_text().replace(
                '| AC2 | not proven | gap: needs browser evidence |',
                '| AC2 | met | browser evidence captured |'))
            self.assertEqual(orchestrator._acceptance_rows(tmp), [])

    def test_portable_gate_instructions_use_config_instead_of_wiki_paths(self):
        contract = (SKILL / 'SKILL.md').read_text()
        contract += ''.join((SKILL / 'reference' / name).read_text()
                            for name in ('kickoff.md', 'final-review.md', 'close-out.md'))
        self.assertNotIn('workbench/scripts/e2e-scratch.sh', contract)
        self.assertNotIn('5180/5181', contract)

    def test_report_lists_only_non_met_rows_and_missing_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / '.gitignore').write_text('/.agents/\n')
            state = root / '.agents/orchestrator'
            for n, text in [(2, '## Acceptance\n| AC1 | met | success |\n| AC2 text | not proven | needs e2e |\n## New facts\n| AC9 | not met | ignored |\n'),
                            (10, '## Acceptance\n| AC3 | not met | failing test |\n')]:
                phase = state / f'phase-{n}'
                phase.mkdir(parents=True)
                (phase / 'summary.md').write_text(text)
            orchestrator._emit(str(root), 'acceptance_missing', phase=3, detail='summary.md')
            orchestrator._emit(str(root), 'acceptance_missing', phase=3, detail='summary.md')
            with mock.patch.object(orchestrator.sys, 'stdout') as stdout:
                rc = orchestrator.cmd_report(orchestrator.argparse.Namespace(
                    root=str(root), prd='docs/prd/x.md', absorbed=False))
            self.assertEqual(rc, 0)
            text = (state / 'deviations-x.md').read_text()
            self.assertIn('## Acceptance not met or not proven', text)
            self.assertIn('- phase 2 · AC2 text · not proven — needs e2e', text)
            self.assertIn('- phase 10 · AC3 · not met — failing test', text)
            self.assertEqual(text.count('- phase 3: no ## Acceptance table (acceptance_missing)'), 1)
            self.assertNotIn('success', text)
            self.assertNotIn('— ignored', text)
            self.assertLess(text.index('phase 2 ·'), text.index('phase 10 ·'))
            self.assertTrue(any('2 not met or not proven' in str(c) for c in stdout.write.call_args_list))

    def test_unreadable_summary_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            phase = Path(tmp) / 'phase-1'
            phase.mkdir()
            (phase / 'summary.md').mkdir()
            self.assertEqual(orchestrator._acceptance_rows(tmp), [])


if __name__ == '__main__':
    unittest.main()
