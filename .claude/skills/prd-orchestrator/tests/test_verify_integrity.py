import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest import mock

from test_gate import Base as GateBase, ns, orchestrator as orch


class Base(GateBase):
    def setUp(self):
        super().setUp()
        self.git('init', '-q')
        self.write_config('[validation]\nlevels = [{name="unit", cmd="true"}]\n')
        self.write('.gitignore', '/.agents/\nignored/\n')
        self.write('a.py', 'old\n')
        self.write_run()
        self.commit_fixture('.gitignore', '.claude/orchestrator.toml', 'a.py')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True,
                              capture_output=True, text=True).stdout

    def commit_fixture(self, *paths):
        for path in paths:
            blob = self.git('hash-object', '-w', path).strip()
            self.git('update-index', '--add', '--cacheinfo', '100644', blob, path)
        tree = self.git('write-tree').strip()
        head = self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
                        'commit-tree', tree, '-m', 'fixture').strip()
        self.git('update-ref', 'HEAD', head)

    def write(self, path, text='new\n'):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return target

    def cfg(self):
        return orch.load_config(str(self.root))[0]

    def verify(self, **kw):
        with contextlib.redirect_stdout(io.StringIO()):
            rc = orch.cmd_verify(ns(self.root, phase=1, keep_going=False, **kw))
        return rc, self.record()

    def record(self):
        return json.loads((self.sd / 'phase-1/verify.json').read_text())

    def check(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = orch.cmd_verify(ns(self.root, phase=1, check=True))
        return rc, output.getvalue()

    def gate(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return orch.cmd_gate(ns(self.root, phase=1, prd=None))

    def events(self, event):
        return orch._events(str(self.root), {event})


class Integrity(Base):
    def test_verify_records_tree(self):
        rc, rec = self.verify()
        self.assertEqual(0, rc)
        self.assertRegex(rec['tree'], r'^[0-9a-f]{40}$')
        self.assertEqual((0, 'verify-check: current pass\n'), self.check())

    def test_tracked_edit_reruns_once_and_binds_new_tree(self):
        with mock.patch.object(orch, '_utc_now_iso', return_value='2000-01-01T00:00:00Z'):
            _, old = self.verify()
        self.write('a.py')
        self.assertEqual(3, self.check()[0])
        with mock.patch.object(orch.subprocess, 'run', wraps=subprocess.run) as commands:
            self.assertEqual(0, self.gate())
        reruns = [call for call in commands.call_args_list
                  if call.args[0][:2] == [sys.executable, os.path.abspath(orch.__file__)]]
        self.assertEqual(1, len(reruns))
        self.assertNotEqual(old['tree'], self.record()['tree'])
        self.assertNotEqual(old['ts'], self.record()['ts'])
        self.assertTrue((self.sd / 'phase-1/.gate-pass').exists())
        events = self.events('verify_stale')
        self.assertEqual(1, len(events))
        self.assertEqual(['a.py'], events[0]['paths'])
        self.assertEqual(['unit'], events[0]['levels'])
        self.assertEqual('pass', events[0]['result'])

    def test_untracked_add_and_tracked_delete_are_stale(self):
        for action in ('add', 'delete'):
            with self.subTest(action=action):
                self.verify()
                if action == 'add':
                    self.write('new.txt')
                else:
                    (self.root / 'a.py').unlink()
                self.assertEqual(3, self.check()[0])
                self.assertEqual(0, self.gate())
        self.assertEqual(2, len(self.events('verify_stale')))

    def test_ignore_globs_do_not_rerun(self):
        self.write_config('[validation]\nignore = ["scratch/", "*.log"]\n'
                          'levels = [{name="unit", cmd="true"}]\n')
        # Exercise removal of a tracked excluded file as well as untracked paths.
        self.write('scratch/tracked')
        self.commit_fixture('scratch/tracked')
        self.verify()
        self.write('scratch/tracked', 'changed\n')
        self.write('scratch/nested/x')
        self.write('a.log')
        self.assertEqual(0, self.check()[0])
        self.assertEqual(0, self.gate())
        self.assertEqual([], self.events('verify_stale'))

    def test_gitignored_change_is_current(self):
        self.verify()
        self.write('ignored/x')
        self.assertEqual(0, self.check()[0])
        self.assertEqual(0, self.gate())
        self.assertEqual([], self.events('verify_stale'))

    def test_legacy_green_record_reruns(self):
        self.write('.agents/orchestrator/phase-1/verify.json', '{"result":"pass"}')
        self.assertIn('no tree recorded', self.check()[1])
        self.assertEqual(3, self.check()[0])
        self.assertEqual(0, self.gate())
        self.assertRegex(self.record()['tree'], r'^[0-9a-f]{40}$')
        self.assertEqual(1, len(self.events('verify_stale')))

    def test_level_output_is_in_recorded_tree(self):
        self.write_config('[validation]\nlevels = [{name="unit", cmd="touch made-by-level.txt"}]\n')
        self.assertEqual(0, self.verify()[0])
        self.assertTrue((self.root / 'made-by-level.txt').exists())
        self.assertEqual(0, self.check()[0])

    def test_red_rerun_removes_gate_pass(self):
        self.write_config('[validation]\nlevels = [{name="unit", cmd="test ! -e broken"}]\n')
        self.verify()
        self.assertEqual(0, self.gate())
        self.write('broken')
        self.assertEqual(2, self.gate())
        self.assertFalse((self.sd / 'phase-1/.gate-pass').exists())
        self.assertEqual('fail', self.record()['result'])
        self.assertTrue(self.events('verify_stale')[0]['detail'].endswith('-> fail'))

    def test_legacy_dirs_and_unignored_agents_are_excluded(self):
        self.write('.gitignore', 'ignored/\n')
        self.commit_fixture('.gitignore')
        self.verify()
        self.write('docs/ai/plans/plan.md')
        self.write('docs/ai/testing/scenario.md')
        self.write('.agents/extra')
        self.assertEqual(0, self.check()[0])

    def test_real_index_and_working_tree_untouched(self):
        self.write('a.py')
        self.write('untracked')
        blob = self.git('hash-object', '-w', 'a.py').strip()
        self.git('update-index', '--cacheinfo', '100644', blob, 'a.py')
        self.write('a.py', 'partially staged\n')
        index = self.root / self.git('rev-parse', '--git-path', 'index').strip()
        before = (self.git('diff', '--cached', '--name-only'), self.git('status', '--porcelain'))
        index_bytes = index.read_bytes()
        with mock.patch.object(orch.shutil, 'copyfile', wraps=orch.shutil.copyfile) as copied:
            self.assertIsNotNone(orch.tree_hash(str(self.root), self.cfg()))
        self.assertEqual(str(index), copied.call_args.args[0])
        self.assertEqual(index_bytes, index.read_bytes())
        self.assertEqual(before, (self.git('diff', '--cached', '--name-only'), self.git('status', '--porcelain')))
        self.assertEqual('partially staged\n', (self.root / 'a.py').read_text())
        self.assertEqual('new\n', (self.root / 'untracked').read_text())

    def test_no_levels_does_not_hash(self):
        self.write_config('[validation]\nlevels = []\n')
        with mock.patch.object(orch, 'tree_hash', side_effect=AssertionError('must not hash')) as hashed:
            self.assertEqual((0, 'verify-check: n/a (no levels)\n'), self.check())
            self.assertEqual(0, self.gate())
        hashed.assert_not_called()

    def test_racy_index_still_detects_same_stat_edit(self):
        self.git('config', 'core.trustctime', 'false')
        self.git('config', 'core.checkStat', 'minimal')
        index = self.root / '.git/index'
        path = self.root / 'a.py'
        stamp = (index.stat().st_mtime_ns // 1_000_000_000 - 2) * 1_000_000_000
        os.utime(path, ns=(stamp, stamp))
        self.git('update-index', '--refresh')
        os.utime(index, ns=(stamp, stamp))
        before = orch.tree_hash(str(self.root), self.cfg())
        path.write_text('new\n')
        os.utime(path, ns=(stamp, stamp))
        self.assertIsNotNone(before)
        self.assertNotEqual(before, orch.tree_hash(str(self.root), self.cfg()))

    def test_write_tree_failure_is_unbound(self):
        run = subprocess.run
        def fail_write_tree(args, **kw):
            if args[:2] == ['git', 'write-tree']:
                return subprocess.CompletedProcess(args, 128, b'', b'unmerged')
            return run(args, **kw)
        with mock.patch.object(orch.subprocess, 'run', side_effect=fail_write_tree):
            self.assertIsNone(orch.tree_hash(str(self.root), self.cfg()))

    def test_malformed_exclusions_do_not_become_unbound(self):
        for section, key in (('scope', 'exclude'), ('park', 'allow_dirty')):
            with self.subTest(section=section):
                cfg = self.cfg()
                cfg.setdefault(section, {})[key] = 'x/'
                with self.assertRaises(TypeError):
                    orch.tree_hash(str(self.root), cfg)

    def test_gate_rerun_keeps_level_output_off_gate_streams(self):
        _, old = self.verify()
        cmd = 'echo LEVEL_STDOUT; echo LEVEL_STDERR >&2'
        self.write_config('[validation]\nlevels = [{name="unit", cmd=' + json.dumps(cmd) + '}]\n')
        result = subprocess.run([sys.executable, orch.__file__, '--root', str(self.root),
                                 'gate', '--phase', '1'], capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(cmd, self.record()['levels'][0]['cmd'])
        self.assertNotEqual(old['ts'], self.record()['ts'])
        self.assertIn('re-running verify once', result.stderr)
        self.assertNotIn('LEVEL_STDOUT', result.stdout)
        self.assertNotIn('LEVEL_STDERR', result.stderr)

    def test_gate_rerun_crash_or_unchanged_timestamp_fails_closed(self):
        run = subprocess.run
        for returncode, rewrite in ((1, False), (1, True), (-9, False), (0, False), (2, False)):
            with self.subTest(returncode=returncode, rewrite=rewrite):
                _, old = self.verify()
                self.assertEqual(0, self.gate())
                self.write('a.py', f'{returncode} {rewrite}\n')
                current_tree = orch.tree_hash(str(self.root), self.cfg())
                reruns = []

                def failed_rerun(command, **kw):
                    if command[:2] == [sys.executable, os.path.abspath(orch.__file__)]:
                        reruns.append(command)
                        if rewrite:
                            self.write('.agents/orchestrator/phase-1/verify.json',
                                       json.dumps({**old, 'ts': 'new timestamp', 'tree': current_tree}))
                        return subprocess.CompletedProcess(command, returncode, None,
                                                           'DISCARDED_PREFIX' + 'x' * 3000 + '\nCHILD_ERROR_TAIL\n')
                    return run(command, **kw)

                out, err = io.StringIO(), io.StringIO()
                with mock.patch.object(orch.subprocess, 'run', side_effect=failed_rerun), \
                        contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    rc = orch.cmd_gate(ns(self.root, phase=1, prd=None))
                self.assertEqual(2, rc, err.getvalue())
                self.assertEqual(1, len(reruns))
                self.assertFalse((self.sd / 'phase-1/.gate-pass').exists())
                self.assertIn('gate: FAIL', err.getvalue())
                self.assertIn('CHILD_ERROR_TAIL', err.getvalue())
                self.assertNotIn('DISCARDED_PREFIX', err.getvalue())
                self.assertNotIn('CHILD_ERROR_TAIL', out.getvalue())
                self.assertIn('re-run', self.events('gate_fail')[-1]['detail'])
                self.assertEqual([], self.events('verify_stale'))

    def test_wiki_journey_edits_invalidate_verify(self):
        wiki = Path(orch.__file__).parents[4]
        cfg, _ = orch.load_config(str(wiki))
        journey = '.claude/e2e/journeys/workbench/example/journey.json'
        level = next(lv for lv in cfg['validation']['levels'] if lv['name'] == 'journey-tests')
        self.assertTrue(orch._level_in_scope(level, [journey], False))
        self.write(journey, '{}\n')
        self.commit_fixture(journey)
        with mock.patch.object(orch, 'load_config', return_value=(cfg, [])), \
                mock.patch.object(orch, '_verify_level', return_value=dict(name='unit', result='pass')):
            self.verify()
            self.write(journey, '{"changed": true}\n')
            self.assertEqual(3, self.check()[0])

    def test_gate_rerun_preserves_explicit_base(self):
        self.write_config('[validation]\nlevels = [{name="unit", cmd="true"}, '
                          '{name="web", paths=["web/"], cmd="true"}]\n')
        self.commit_fixture('.claude/orchestrator.toml')
        base = self.git('rev-parse', 'HEAD').strip()
        self.verify(base=base)
        self.write('web/page.html')
        self.commit_fixture('web/page.html')
        self.write('a.py')
        self.assertEqual(0, self.gate())
        self.assertEqual(base, self.record()['base'])
        self.assertEqual(['unit', 'web'], self.events('verify_stale')[-1]['levels'])

    def test_pruned_and_null_trees_are_stale(self):
        for tree in ('f' * 40, None):
            with self.subTest(tree=tree):
                self.write('.agents/orchestrator/phase-1/verify.json', json.dumps(dict(result='pass', tree=tree)))
                fresh = orch.verify_freshness(str(self.root), self.cfg(), 1)
                self.assertEqual('stale', fresh['state'])
                self.assertEqual([], fresh['changed'])

    def test_missing_unreadable_record_and_pure_check(self):
        for content in (None, '{', '[]'):
            with self.subTest(content=content):
                if content is not None:
                    self.write('.agents/orchestrator/phase-1/verify.json', content)
                with mock.patch.object(orch, 'tree_hash') as hashed, mock.patch.object(orch, '_emit') as emitted:
                    self.assertEqual(3, self.check()[0])
                hashed.assert_not_called()
                emitted.assert_not_called()

    def test_gate_rerun_preserves_scoping_and_full_flag(self):
        self.write_config('[validation]\nlevels = [{name="unit", cmd="true"}, '
                          '{name="web", paths=["web/"], cmd="true"}]\n')
        self.commit_fixture('.claude/orchestrator.toml')
        self.verify()
        self.write('a.py')
        self.assertEqual(0, self.gate())
        self.assertFalse(self.record()['full'])
        self.assertEqual(['unit'], self.events('verify_stale')[-1]['levels'])
        self.verify(full=True)
        self.write('a.py', 'again\n')
        self.assertEqual(0, self.gate())
        self.assertTrue(self.record()['full'])
        self.assertEqual(['unit', 'web'], self.events('verify_stale')[-1]['levels'])

    def test_exclusion_sources_and_escaping_legacy_dirs(self):
        cfg = self.cfg()
        cfg['scope']['exclude'] = ['generated/']
        cfg.setdefault('park', {})['allow_dirty'] = ['runtime/']
        cfg['plans']['dir'] = '../outside'
        cfg['testing']['dir'] = '/outside'
        cfg['validation']['ignore'] = ['nested/*.log', 'cache/', 42]
        globs, prefixes = orch._tree_excludes(str(self.root), cfg)
        self.assertEqual(['.agents/', 'generated/', 'runtime/'], prefixes)
        self.assertEqual(['nested/*.log', 'cache/'], globs)
        for path in ('generated/x', 'runtime/x', 'nested/a/b.log', 'cache/x'):
            self.assertTrue(orch._tree_excluded(path, globs, prefixes))
        self.assertFalse(orch._tree_excluded('nested/a/b.LOG', globs, prefixes))

    def test_index_missing_falls_back_to_head(self):
        (self.root / self.git('rev-parse', '--git-path', 'index').strip()).unlink()
        self.assertIsNotNone(orch.tree_hash(str(self.root), self.cfg()))
        self.assertFalse((self.root / '.git/index').exists())


class NonGit(GateBase):
    def test_null_tree_and_result_only_checks_without_rerun(self):
        self.write_config('[validation]\nlevels = [{name="unit", cmd="true"}]\n')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, orch.cmd_verify(ns(self.root, phase=1, keep_going=False)))
        path = self.sd / 'phase-1/verify.json'
        self.assertIsNone(json.loads(path.read_text())['tree'])
        for result, expected in (('pass', 0), ('fail', 2)):
            path.write_text(json.dumps(dict(result=result, tree=None, levels=[dict(name='unit', result=result)])))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(expected, orch.cmd_verify(ns(self.root, phase=1, check=True)))
            self.assertIn('tree unverifiable' if result == 'pass' else 'unit', out.getvalue())
        self.write_config('[validation]\nlevels = [{name="unit", cmd="false"}]\n')
        path.write_text('{"result":"pass", "tree":null}')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, orch.cmd_gate(ns(self.root, phase=1, prd=None)))
        self.assertEqual(1, len(orch._events(str(self.root), {'verify_unbound'})))
        self.assertEqual('pass', json.loads(path.read_text())['result'])

    def test_no_head_is_unbound(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True, capture_output=True)
        self.assertIsNone(orch.tree_hash(str(self.root), orch.load_config(str(self.root))[0]))

    def test_worker_and_fix_cycle_reset_verify_counters(self):
        for stage in ('builder', 'fix', 'e2e', 'reviewer', 'planner'):
            counter = self.sd / f'.stop-gate-verify-{stage}-1.tries'
            counter.write_text('4')
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                orch.cmd_worker_settings(ns(self.root, phase=1, stage=stage, artifact='summary.md'))
            self.assertFalse(counter.exists())
            settings = json.loads((self.sd / f'worker-hooks/phase-1-{stage}.json').read_text())
            if stage == 'planner':
                self.assertNotIn('Stop', settings['hooks'])
            else:
                self.assertEqual(30 if stage in ('builder', 'fix') else 10,
                                 settings['hooks']['Stop'][0]['hooks'][0]['timeout'])
        for stage in ('builder', 'fix'):
            (self.sd / f'.stop-gate-verify-{stage}-1.tries').write_text('4')
        (self.sd / 'phase-1/verify.json').write_text('{"result":"fail", "levels":[]}')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, orch.cmd_fix_plan(ns(self.root, phase=1)))
        for stage in ('builder', 'fix'):
            self.assertFalse((self.sd / f'.stop-gate-verify-{stage}-1.tries').exists())

    def config_check(self, extra):
        self.write_config('[validation]\nlevels = [{name="unit", cmd="true"}]\n' + extra +
                          '\n[testing]\ncapture="off"\n')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = orch.cmd_config(ns(self.root, check=True))
        return rc, out.getvalue()

    def test_config_rejects_invalid_ignore(self):
        for value in ('"x"', '[""]', '["/x"]', '["a/../x"]', '[1]'):
            with self.subTest(value=value):
                rc, out = self.config_check('ignore=' + value)
                self.assertEqual(1, rc)
                self.assertIn('[validation] ignore must be a list of repo-relative globs', out)

    def test_config_warns_only_for_uncovered_legacy_dirs(self):
        rc, out = self.config_check('')
        self.assertEqual(0, rc)
        self.assertIn('warning: plans.dir docs/ai/plans is in-tree', out)
        self.assertIn('config OK', out)
        rc, out = self.config_check('ignore=["docs/ai/"]')
        self.assertEqual(0, rc)
        self.assertNotIn('is in-tree', out)
