import contextlib
import io
import json
from pathlib import Path
import subprocess
import tomllib
from unittest import mock

from test_gate import Base as GateBase, ns, orchestrator as orch


class Base(GateBase):
    def setUp(self):
        super().setUp()
        self.git('init', '-q')
        self.write_config('[validation]\nlevels = [{name="always", cmd="true"}]\n')
        self.write('.gitignore', '/.agents/\nignored/\n')
        self.write('a.py', 'old\n')
        self.write('rename me.py', 'rename\n')
        self.write_run()
        # Plumbing makes fixture commits without invoking the repo's commit hooks.
        for path in ('.gitignore', '.claude/orchestrator.toml', 'a.py', 'rename me.py'):
            blob = self.git('hash-object', '-w', path).strip()
            self.git('update-index', '--add', '--cacheinfo', '100644', blob, path)
        tree = self.git('write-tree').strip()
        head = self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
                        'commit-tree', tree, '-m', 'fixture').strip()
        self.git('update-ref', 'HEAD', head)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True,
                              capture_output=True, text=True).stdout

    def write(self, path, text='new\n'):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return target

    def cfg(self):
        return orch.load_config(str(self.root))[0]

    def verify(self, phase=1, full=False):
        with contextlib.redirect_stdout(io.StringIO()):
            rc = orch.cmd_verify(ns(self.root, phase=phase, full=full, base=None, keep_going=True))
        return rc, json.loads((self.sd / f'phase-{phase}/verify.json').read_text())

    def snapshot(self):
        directory = self.sd / 'baseline-dirty'
        directory.mkdir()
        for name, args in [('files.txt', ('status', '--porcelain')),
                           ('untracked.txt', ('ls-files', '--others', '--exclude-standard')),
                           ('preexisting.patch', ('diff', 'HEAD'))]:
            (directory / name).write_text(self.git(*args))

    def events(self, event):
        return orch._events(str(self.root), {event})


class Touched(Base):
    def touched(self, cfg=None):
        return orch.phase_touched(str(self.root), cfg or self.cfg(), 1)[1]

    def test_tracked_and_untracked_and_spaces(self):
        self.write('a.py')
        self.write('new file.py')
        self.assertEqual(['a.py', 'new file.py'], self.touched())

    def test_rename_lists_both_and_deleted_file(self):
        self.git('mv', 'rename me.py', 'renamed.py')
        (self.root / 'a.py').unlink()
        self.assertEqual(['a.py', 'rename me.py', 'renamed.py'], self.touched())

    def test_exclusions_and_generated(self):
        for path in ['dist/x', 'daily/x', 'generated/x.md', 'ignored/x', 'keep.py']:
            self.write(path)
        cfg = self.cfg()
        cfg.update(scope={'exclude': ['dist/']}, park={'allow_dirty': ['daily/']})
        cfg['knowledge']['generated'] = [{'paths': 'generated/*.md'}]
        self.assertEqual(['keep.py'], self.touched(cfg))
        cfg['knowledge']['generated'] = ['generated/*.md']
        self.assertEqual(['keep.py'], self.touched(cfg))

    def test_baseline_unchanged_and_further_edit(self):
        self.write('a.py', 'Chris\n')
        self.write('Chris file.py')
        self.write('Chris dir/nested.py')
        self.snapshot()
        self.assertEqual([], self.touched())
        self.write('a.py', 'Chris plus phase\n')
        self.write('Chris file.py', 'changed again\n')
        self.assertEqual(['a.py'], self.touched())

    def test_missing_baseline_is_empty(self):
        self.assertEqual(({}, set()), orch._baseline_excluded(str(self.root)))

    def test_base_committed_and_invalid_sha(self):
        head = self.git('rev-parse', 'HEAD').strip()
        for value, expected in [(head, head + '^'), ('-', head), ('garbage', head)]:
            (self.sd / 'RUN.md').write_text(f'| 1 | title | plan | committed | {value} |\n')
            self.assertEqual(expected, orch._phase_base(str(self.root), 1))

    def test_empty_repo_raises(self):
        empty = self.root / 'empty'
        empty.mkdir()
        subprocess.run(['git', 'init', '-q', str(empty)], check=True)
        with self.assertRaises(RuntimeError):
            orch.phase_touched(str(empty), self.cfg(), 1)


class VerifyScope(Base):
    def setUp(self):
        super().setUp()
        # Keep the fixture config clean so only the web path triggers selection.
        self.levels = [{'name': 'always', 'cmd': 'true'},
                       {'name': 'comms-tests', 'cmd': 'false', 'paths': ['.claude/scripts/']}]
        self.config = self.cfg()
        self.config['validation']['levels'] = self.levels
        self.patcher = mock.patch.object(orch, 'load_config', return_value=(self.config, []))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.write('workbench/web/x.tsx')

    def test_skip_recorded_and_validate_only_names_failures(self):
        rc, rec = self.verify()
        self.assertEqual(0, rc)
        self.assertFalse(rec['full'])
        self.assertEqual(2, len(rec['levels']))
        self.assertEqual('skipped (out of scope)', rec['levels'][1]['result'])
        self.assertTrue(orch.validate_verify(str(self.root), self.config, 1)[0])
        rec['result'] = 'fail'
        rec['levels'][0]['result'] = 'fail'
        (self.sd / 'phase-1/verify.json').write_text(json.dumps(rec))
        self.assertEqual('build/test not green (failed: always)',
                         orch.validate_verify(str(self.root), self.config, 1)[1])

    def test_full_runs_all(self):
        rc, rec = self.verify(full=True)
        self.assertEqual(2, rc)
        self.assertTrue(rec['full'])
        self.assertEqual('fail', rec['levels'][1]['result'])

    def test_phase_zero_runs_all(self):
        self.assertEqual(2, self.verify(phase=0)[0])

    def test_config_change_runs_all(self):
        with (self.root / '.claude/orchestrator.toml').open('a') as stream:
            stream.write('# changed\n')
        rc, rec = self.verify()
        self.assertEqual(2, rc)
        self.assertTrue(rec['full'])

    def test_touched_failure_runs_all(self):
        with mock.patch.object(orch, 'phase_touched', side_effect=RuntimeError('unavailable')):
            self.assertEqual(2, self.verify()[0])


class GateScope(Base):
    def setUp(self):
        super().setUp()
        (self.sd / 'phase-1/verify.json').write_text('{"result":"pass"}')

    def gate(self, text=None):
        plan = self.sd / 'plan.md'
        if text is not None:
            plan.write_text(text)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = orch.cmd_gate(ns(self.root, phase=1, prd=None,
                                  plan=str(plan) if text is not None else None))
        self.assertTrue((self.sd / 'phase-1/.gate-pass').exists())
        return rc, json.loads((self.sd / 'phase-1/scope.json').read_text())

    def test_extra_file_reports_without_blocking(self):
        for path in ['a.py', 'test_a.py', 'b.py']:
            self.write(path)
        rc, rec = self.gate('## TOUCH SET\n- a.py (modify)\n')
        self.assertEqual(0, rc)
        self.assertEqual(['b.py'], rec['out_of_plan'])
        self.assertEqual(1, len(self.events('scope_flag')))

    def test_missing_touch_set_and_plan_skipped(self):
        self.write('b.py')
        for text in ['## Other\n', None]:
            orch._emit(str(self.root), 'plan_skipped', phase=1)
            rc, rec = self.gate(text)
            self.assertEqual(0, rc)
            self.assertIsNone(rec['planned'])
        self.assertEqual([], self.events('scope_flag'))

    def test_scope_exception_does_not_block(self):
        with mock.patch.object(orch, '_write_scope', side_effect=RuntimeError('oops')):
            rc, rec = self.gate()
        self.assertEqual(0, rc)
        self.assertEqual('oops', rec['error'])

    def test_directory_and_blast(self):
        self.write('lib/x/y.py')
        rc, rec = self.gate('## TOUCH SET\r\n- `lib/`\r\n## BLAST RADIUS\r\ndeep — neighbours\r\n')
        self.assertEqual([], rec['out_of_plan'])
        self.assertEqual('deep', rec['blast'])
        self.assertEqual('normal', orch.plan_blast(''))
        self.assertEqual('normal', orch.plan_blast('## BLAST RADIUS\nunknown\n'))
        self.assertEqual([], orch.plan_touch_set('## TOUCH SET\n'))

    def test_plan_lookup_store_legacy_latest_and_override(self):
        plan = self.write('docs/ai/plans/plan.md', '## TOUCH SET\n- a.py\n')
        orch._emit(str(self.root), 'plan_done', phase=1, detail='plan.md')
        self.assertEqual(str(plan), orch._phase_plan_path(str(self.root), self.cfg(), 1))
        store = self.root / 'store'
        stored = self.write('store/plans/plan.md')
        with (self.sd / 'RUN.md').open('a') as stream:
            stream.write(f'\nStore: {store}\n')
        self.assertEqual(str(stored), orch._phase_plan_path(str(self.root), self.cfg(), 1))
        orch._emit(str(self.root), 'plan_skipped', phase=1)
        self.assertIsNone(orch._phase_plan_path(str(self.root), self.cfg(), 1))

    def test_test_mirrors(self):
        for path in ['other/a.test.ts', 'a.spec.ts', 'tests/test_a.py', 'a_test.py']:
            self.assertTrue(orch._mirrors_planned(path, ['a.ts']))
        self.assertFalse(orch._mirrors_planned('b_test.py', ['a.ts']))
        self.assertFalse(orch._mirrors_planned('lib_test.py', ['lib/']))


class RealConfig(Base):
    def test_paths_and_always_run_contract(self):
        repo = Path(__file__).parents[4]
        cfg = tomllib.loads((repo / '.claude/orchestrator.toml').read_text())
        levels = {lv['name']: lv for lv in cfg['validation']['levels']}
        for name in ('tests', 'orchestrator-tests'):
            self.assertNotIn('paths', levels[name])
        for lv in levels.values():
            for prefix in lv.get('paths', []):
                self.assertTrue((repo / prefix).exists(), prefix)
        for path, name in [('workbench/skills/review/SKILL.md', 'tests'),
                           ('workbench/contexts/isi/skills/review/SKILL.md', 'tests'),
                           ('.claude/skills/execute/SKILL.md', 'orchestrator-tests')]:
            self.assertTrue(orch._level_in_scope(levels[name], [path], False))
        touched = ['workbench/web/src/x.tsx']
        self.assertFalse(orch._level_in_scope(levels['comms-tests'], touched, False))
        for name in ['build', 'web-tests']:
            self.assertTrue(orch._level_in_scope(levels[name], touched, False))
        config = self.cfg()
        config['validation']['levels'] = list(levels.values())
        with mock.patch.object(orch, 'load_config', return_value=(config, [])), \
             mock.patch.object(orch, 'phase_touched', return_value=('HEAD', touched)), \
             mock.patch.object(orch, '_verify_level', side_effect=lambda root, lv, name, cmd:
                               dict(name=name, result='pass')):
            rc, rec = self.verify()
        self.assertEqual(0, rc)
        self.assertEqual(len(levels), len(rec['levels']))
        for record in rec['levels']:
            if not orch._level_in_scope(levels[record['name']], touched, False):
                self.assertEqual('skipped (out of scope)', record['result'])
