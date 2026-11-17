import contextlib
import io
import json
from unittest import mock

from test_scope import Base
from test_gate import ns, orchestrator as orch


class Harvest(Base):
    def test_noticed_cap_and_dedupe(self):
        summary = '## Noticed, not done\n' + ''.join(f'- a.py:{n} — tangent {n}\n' for n in range(5))
        source = self.sd / 'phase-1/summary.md'
        source.write_text(summary)
        for _ in range(2):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(0, orch.cmd_ingest(ns(self.root, phase=1, stage='builder', source_file=str(source))))
        self.assertEqual(3, len(orch._harvest_records(str(self.root), 'noticed')))
        self.assertEqual('3 harvested, 2 dropped', self.events('noticed_ingest')[0]['detail'])

    def test_decisions_and_one_way(self):
        text = ('## DECISIONS\r\n### Decided for you\r\n- D1: choice\r\n- D2 — other\r\n'
                '### For Chris\r\n- Q1: one-way choice\r\n')
        self.assertEqual(3, orch.decisions_ingest(str(self.root), 1, text))
        self.assertEqual(0, orch.decisions_ingest(str(self.root), 1, text))
        records = orch._harvest_records(str(self.root), 'decided')
        self.assertEqual(['D1', 'D2', 'Q1'], [r['id'] for r in records])
        self.assertTrue(records[-1]['one_way'])
        self.assertEqual('for_chris', records[-1]['kind'])

    def test_owner_heading_and_legacy_heading_dedupe(self):
        current = '## DECISIONS\n### For the owner\n- Q1: one-way choice\n'
        legacy = current.replace('For the owner', 'For Chris')
        self.assertEqual(1, orch.decisions_ingest(str(self.root), 1, current))
        self.assertEqual(0, orch.decisions_ingest(str(self.root), 1, legacy))
        self.assertEqual(1, orch.decisions_ingest(str(self.root), 2, legacy))
        self.assertEqual(0, orch.decisions_ingest(str(self.root), 2, current))
        records = orch._harvest_records(str(self.root), 'decided')
        self.assertEqual(['Q1', 'Q1'], [r['id'] for r in records])
        self.assertTrue(all(r['one_way'] for r in records))

    def test_noticed_dash_heading_and_per_phase_cap(self):
        text = '## Noticed — not done\n- a.py:1 — detail\n'
        self.assertEqual((1, 0), orch.noticed_ingest(str(self.root), 1, text, 'builder'))
        self.assertEqual((0, 0), orch.noticed_ingest(str(self.root), 1, text, 'builder'))
        self.assertEqual((1, 0), orch.noticed_ingest(str(self.root), 2, text, 'builder'))


class ReportSections(Base):
    def report(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, orch.cmd_report(ns(self.root, prd='docs/prd/x.md', absorbed=0)))
        return (self.sd / 'deviations-x.md').read_text()

    def test_sections_last_and_in_order(self):
        orch.noticed_ingest(str(self.root), 1, '## Noticed, not done\n' + '- tangent\n' * 1 +
                            ''.join(f'- other {n}\n' for n in range(4)), 'builder')
        orch.decisions_ingest(str(self.root), 1,
                             '### Decided for you\n- D1: choice\n### For Chris\n- Q1: one-way choice\n')
        text = self.report()
        self.assertEqual(['## Noticed, not done', '## Decisions made for you'],
                         [line for line in text.splitlines() if line.startswith('## ')][-2:])
        self.assertIn('2 line(s) dropped', text)
        self.assertIn('**For the owner**', text)
        self.assertIn('⚠️ one-way', text)

    def test_empty_sections_omitted(self):
        text = self.report()
        self.assertNotIn('## Noticed, not done', text)
        self.assertNotIn('## Decisions made for you', text)


class Digest(Base):
    def test_decided_and_scope_lines(self):
        orch.decisions_ingest(str(self.root), 1, '### Decided for you\n- D1: first\n- D2: second\n')
        self.assertEqual(('Decided: 2 (D1 first, D2 second)', 'Scope:   no touch set'),
                         orch.digest_lines(str(self.root), 1))
        path = self.sd / 'phase-1/scope.json'
        path.write_text(json.dumps(dict(planned=['a.py'], out_of_plan=['b.py'])))
        self.assertEqual('Scope:   1 out-of-plan file(s) (b.py)', orch.digest_lines(str(self.root), 1)[1])
        path.write_text(json.dumps(dict(planned=[], out_of_plan=[])))
        self.assertEqual('Scope:   in plan', orch.digest_lines(str(self.root), 1)[1])
        self.assertEqual('Decided: 0', orch.digest_lines(str(self.root), 2)[0])


class FixPlan(Base):
    def fix(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = orch.cmd_fix_plan(ns(self.root, phase=1))
        return rc, output.getvalue().strip()

    def test_second_cycle_fresh_and_handoff_required_then_cap(self):
        (self.sd / 'phase-1/verify.json').write_text(json.dumps(dict(result='fail', levels=[
            dict(name='unit', result='fail', new_failures=['test_broken'])])))
        rc, out = self.fix()
        first = json.loads(out)
        self.assertEqual(0, rc)
        self.assertEqual('builder', first['worker'])
        self.assertEqual(orch.tab_label(str(self.root), 'builder', 1), first['label'])
        self.assertEqual(4, self.fix()[0])
        self.assertEqual('1', (self.sd / 'phase-1/fix-cycles').read_text())
        handoff = self.sd / 'phase-1/handoff.md'
        handoff.write_text('\n'.join(f'line {n}' for n in range(12)))
        with mock.patch.object(orch.sys, 'stderr'):
            rc, out = self.fix()
        second = json.loads(out)
        self.assertEqual(0, rc)
        self.assertEqual('fresh', second['worker'])
        self.assertNotEqual(first['label'], second['label'])
        self.assertEqual(orch.tab_label(str(self.root), 'fix', 1), second['label'])
        self.assertEqual(10, len(handoff.read_text().splitlines()))
        from pathlib import Path
        prompt = Path(second['prompt_file']).read_text()
        for required in ['handoff.md', 'unit', 'test_broken', '## Acceptance', 'verify-fix.md']:
            self.assertIn(required, prompt)
        self.assertEqual(2, self.fix()[0])
        self.assertEqual(2, len(self.events('fix_cycle')))

    def test_missing_or_green_nothing_to_fix(self):
        self.assertEqual(3, self.fix()[0])
        (self.sd / 'phase-1/verify.json').write_text('{"result":"pass"}')
        self.assertEqual(3, self.fix()[0])
        self.assertFalse((self.sd / 'phase-1/fix-cycles').exists())
