import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_telemetry import orchestrator

HOOK = Path(__file__).parents[1] / 'scripts/hooks/subagent-fence.sh'


class FenceTests(unittest.TestCase):
    def test_payloads(self):
        with tempfile.TemporaryDirectory() as sd:
            env = {**os.environ, 'ORCH_STATE_DIR': sd, 'ORCH_PHASE': '5'}
            for stage in ('builder', 'fix', 'planner', 'reviewer', 'e2e'):
                for tool in ('Agent', 'Task', 'Bash', None):
                    with self.subTest(stage=stage, tool=tool):
                        events = Path(sd, 'events.jsonl')
                        events.unlink(missing_ok=True)
                        result = subprocess.run(['bash', str(HOOK)],
                            input=json.dumps({'tool_name': tool, 'tool_input': {}}),
                            text=True, capture_output=True, env={**env, 'ORCH_STAGE': stage})
                        denied = stage in ('builder', 'fix') and tool in ('Agent', 'Task')
                        self.assertEqual(2 if denied else 0, result.returncode)
                        self.assertEqual(denied, events.exists())
                        if denied:
                            event = json.loads(events.read_text())
                            self.assertEqual('subagent_denied', event['event'])
                            self.assertEqual(stage, event['stage'])
                            self.assertEqual(5, event['phase'])
                            self.assertEqual('denied: ' + tool, event['detail'])
            for payload in ('', '{broken', '{}'):
                self.assertEqual(0, subprocess.run(['bash', str(HOOK)], input=payload,
                    text=True, capture_output=True, env={**env, 'ORCH_STAGE': 'builder'}).returncode)
            env.pop('ORCH_STATE_DIR')
            self.assertEqual(0, subprocess.run(['bash', str(HOOK)], input='{"tool_name":"Agent"}',
                text=True, capture_output=True, env={**env, 'ORCH_STAGE': 'builder'}).returncode)


class SettingsTests(unittest.TestCase):
    def test_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, '.git').mkdir()
            for stage in ('builder', 'fix', 'planner', 'reviewer', 'e2e'):
                with self.subTest(stage=stage):
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        orchestrator.cmd_worker_settings(argparse.Namespace(
                            root=tmp, stage=stage, phase=5, artifact=None))
                    settings = json.loads(Path(out.getvalue().strip()).read_text())
                    hooks = [h for h in settings['hooks']['PreToolUse'] if h['matcher'] == '^(Agent|Task)$']
                    self.assertEqual(1 if stage in ('builder', 'fix') else 0, len(hooks))
                    if hooks:
                        command = hooks[0]['hooks'][0]['command']
                        self.assertIn('subagent-fence.sh', command)
                        self.assertIn('ORCH_STAGE=' + stage, command)
