import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HOOK = Path(__file__).parents[1] / 'scripts/hooks/instruction-fence.sh'


class InstructionFence(unittest.TestCase):
    def test_paths(self):
        with tempfile.TemporaryDirectory() as sd:
            env = {**os.environ, 'ORCH_STATE_DIR': sd, 'ORCH_ROOT': '/tmp/wiki',
                   'ORCH_INSTRUCTION_FILES': 'CLAUDE.md:memory/MEMORY.md', 'ORCH_PHASE': '1'}
            for path, code in [('CLAUDE.md', 2), ('claude.md', 2), ('./.claude/standards/x.md', 2),
                               ('./memory/MEMORY.md', 2), ('/tmp/wiki/./CLAUDE.md', 2),
                               ('memory/../memory/memory.md', 2), ('./workbench/README.md', 0), ('workbench/README.md', 0), ('memory/MEMORY.md', 2),
                               ('.claude/standards/x.md', 2), ('workbench/AGENTS.md', 2),
                               ('/tmp/wiki/CLAUDE.md', 2), ('.claude/settings.json', 0),
                               ('.claude/skills/execute/SKILL.md', 0), ('.claude/orchestrator.toml', 0)]:
                with self.subTest(path=path):
                    result = subprocess.run(['bash', str(HOOK)], input=json.dumps({'tool_input': {'file_path': path}}),
                                            capture_output=True, text=True, env=env)
                    self.assertEqual(code, result.returncode)
            result = subprocess.run(['bash', str(HOOK)], input=json.dumps({
                'cwd': '/tmp/wiki/subdir', 'tool_input': {'file_path': '../memory/MEMORY.md'}}),
                capture_output=True, text=True, env=env)
            self.assertEqual(2, result.returncode)
            self.assertIn('"instruction_fence"', Path(sd, 'events.jsonl').read_text())
            for payload in ('', '{broken'):
                self.assertEqual(0, subprocess.run(['bash', str(HOOK)], input=payload, text=True, env=env).returncode)
            env.pop('ORCH_STATE_DIR')
            self.assertEqual(0, subprocess.run(['bash', str(HOOK)], input='{"file_path":"CLAUDE.md"}', text=True, env=env).returncode)
