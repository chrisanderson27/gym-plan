import argparse
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import orchestrator


class SecretFence(unittest.TestCase):
    def check_text(self, text, override=False):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args, data=None):
                return subprocess.run(['git', '-C', tmp, *args], input=data, text=True,
                                      check=True, capture_output=True).stdout.strip()
            git('init', '-q')
            blob = git('hash-object', '-w', '--stdin', data=text)
            git('update-index', '--add', '--cacheinfo', '100644', blob, 'sample.py')
            err = io.StringIO()
            with patch.dict(os.environ, {'WORKBENCH_ALLOW_SECRETS': '1' if override else '0'}), contextlib.redirect_stderr(err):
                code = orchestrator.cmd_hook_pre_commit(argparse.Namespace(root=tmp))
            return code, err.getvalue()

    def test_secrets(self):
        values = ['gh' + 'p_' + 'a' * 36, 's' + 'k-' + 'a' * 24,
                  'xo' + 'xb-' + 'a' * 12, 'AK' + 'IA' + 'A' * 16,
                  '-----BEGIN ' + 'RSA PRIVATE ' + 'KEY-----']
        values.append('API_' + 'TOKEN = "' + 'secretvalue' * 3 + '"')
        for value in values:
            with self.subTest(prefix=value[:3]):
                code, stderr = self.check_text(value + '\n')
                self.assertEqual(1, code)
                self.assertIn('sample.py:1', stderr)
                self.assertNotIn(value, stderr)
                self.assertEqual(0, self.check_text(value, override=True)[0])

    def test_near_misses(self):
        for value in ('value = os.environ["API_' + 'TOKEN"]',
                      'API_' + 'TOKEN = "' + 'a' * 15 + '"',
                      'gh' + 'p_', 'task-something', 'X_' + 'KEY = value_from_env',
                      'X_' + 'KEY = "${VAR}"'):
            with self.subTest(value=value):
                self.assertEqual(0, self.check_text(value)[0])

    def test_fail_open(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(0, orchestrator._secret_fence(tmp))
