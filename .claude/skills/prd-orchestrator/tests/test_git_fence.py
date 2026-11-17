import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import orchestrator

HOOK = Path(os.environ.get('GIT_FENCE_TEST_HOOK', Path(__file__).parents[1] / 'scripts/hooks/git-fence.sh'))


class GitFence(unittest.TestCase):
    def run_hook(self, command, stage='builder', app='cd workbench && npm start'):
        with tempfile.TemporaryDirectory() as sd:
            r = subprocess.run(['bash', str(HOOK)], input=json.dumps({'tool_input': {'command': command}}),
                capture_output=True, text=True, env={**os.environ, 'ORCH_STATE_DIR': sd,
                'ORCH_STAGE': stage, 'ORCH_PHASE': '1', 'ORCH_APP_START': app})
            events = Path(sd, 'events.jsonl')
            if r.returncode == 2:
                self.assertIn('git_fence', events.read_text())
            return r

    def test_denied(self):
        for cmd in ('git commit -m x', 'git -C x commit -am wip', 'git -c k=v push',
                    'git --git-dir=x rebase main', 'git --work-tree x reset --hard',
                    'git -P clean -xfd', 'git add -A', 'git add .', 'git add -- .',
                    'git -C x add --all', 'git -c k=v add -Af', 'git -C x add --force x',
                    'git -C "$PWD" commit -am wip', 'cd workbench && npm start',
                    'npm start', 'bash x/app-run.sh kill', 'bash x/app-run.sh start-cmd'):
            with self.subTest(cmd=cmd):
                self.assertEqual(2, self.run_hook(cmd).returncode)

    def test_git_executable_forms(self):
        for executable in ('/usr/bin/git', '"git"', "'git'", '"/usr/bin/git"'):
            for action in ('commit -m x', 'push', '-C x commit -m x'):
                with self.subTest(executable=executable, action=action):
                    self.assertEqual(2, self.run_hook(executable + ' ' + action).returncode)
            self.assertEqual(0, self.run_hook(executable + ' status').returncode)

    def test_blanket_staging(self):
        for command in ('git add -u', 'git add --update', 'git add :/', 'git add *',
                        'git -C x add -u', 'git add -- *'):
            with self.subTest(command=command):
                self.assertEqual(2, self.run_hook(command).returncode)
        for command in ('git add -u -- workbench/x.mjs', 'git add --update workbench/x.mjs'):
            self.assertEqual(0, self.run_hook(command).returncode)

    def test_allowed(self):
        for cmd in ('git add -- workbench/x.mjs', 'git add ./foo', 'git status',
                    'git -C x status', 'git log -p', 'legit commit', 'app-run.sh wait-ready'):
            with self.subTest(cmd=cmd):
                self.assertEqual(0, self.run_hook(cmd).returncode)
        self.assertEqual(0, self.run_hook('npm start', stage='app').returncode)
        self.assertEqual(2, self.run_hook('app-run.sh kill', stage='fix').returncode)
        self.assertEqual(2, self.run_hook('echo "x" && npm start', app='echo "x" && npm start').returncode)

    def test_malformed(self):
        with tempfile.TemporaryDirectory() as sd:
            for payload in ('', '{broken'):
                r = subprocess.run(['bash', str(HOOK)], input=payload, text=True,
                    capture_output=True, env={**os.environ, 'ORCH_STATE_DIR': sd})
                self.assertEqual(0, r.returncode)

    def test_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / '.git').mkdir()
            (root / '.claude').mkdir()
            (root / '.claude/orchestrator.toml').write_text('[app]\nstart="cd workbench && npm start"\n[knowledge]\nalways_loaded=["memory/MEMORY.md"]\n')
            for stage in ('builder', 'fix', 'planner', 'app'):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    orchestrator.cmd_worker_settings(argparse.Namespace(root=tmp, stage=stage, phase=1, artifact=None))
                settings = json.loads(Path(out.getvalue().strip()).read_text())
                command = settings['hooks']['PreToolUse'][0]['hooks'][0]['command']
                self.assertEqual(stage in ('builder', 'fix'), 'ORCH_APP_START=' in command)
                self.assertIn('ORCH_ROOT=', command)
                self.assertIn('ORCH_INSTRUCTION_FILES=', command)
                self.assertEqual('^(Write|Edit|MultiEdit)$', settings['hooks']['PreToolUse'][1]['matcher'])
