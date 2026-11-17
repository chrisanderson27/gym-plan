import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_verify_integrity import Base


HOOK = Path(__file__).parents[1] / "scripts" / "hooks" / "stop-gate.sh"


class StopGateTests(unittest.TestCase):
    def test_e2e_marker_alone_does_not_release_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            phase = state / "phase-1"
            phase.mkdir()
            marker = phase / "e2e.md"
            marker.write_text("RESULT: pass\n")

            result = self._run(state, marker)

            self.assertIn('"decision":"block"', result.stdout)
            self.assertIn("capture.md", result.stdout)

    def test_pass_without_journey_is_not_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            phase = state / "phase-1"
            phase.mkdir()
            marker = phase / "e2e.md"
            marker.write_text("RESULT: pass\n")
            (phase / "capture.md").write_text("capture\n")
            (phase / "manual.md").write_text("manual\n")
            media = phase / "media"
            media.mkdir()
            (media / "index.md").write_text("screenshot.png — criterion 1\n")

            result = self._run(state, marker)

            self.assertEqual(result.returncode, 0)
            self.assertNotIn('"decision":"block"', result.stdout)

    def test_pass_requires_media_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            phase = state / "phase-1"
            phase.mkdir()
            marker = phase / "e2e.md"
            marker.write_text("RESULT: pass\n")
            (phase / "capture.md").write_text("capture\n")
            (phase / "manual.md").write_text("manual\n")

            result = self._run(state, marker)

            self.assertIn('"decision":"block"', result.stdout)
            self.assertIn("media/index.md", result.stdout)
            self.assertNotIn("run.zip", result.stdout)

    def test_blocked_before_browser_does_not_require_trace(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            phase = state / "phase-1"
            phase.mkdir()
            marker = phase / "e2e.md"
            marker.write_text("RESULT: blocked\n")
            (phase / "capture.md").write_text("capture\n")
            (phase / "manual.md").write_text("manual\n")

            result = self._run(state, marker)

            self.assertEqual(0, result.returncode)
            self.assertNotIn('"decision":"block"', result.stdout)

    def test_visual_only_worker_requires_only_its_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            marker = state / "figma-compare.md"
            result = self._run(state, marker, stage="figma")
            self.assertIn('"decision":"block"', result.stdout)
            marker.write_text("RESULT: pass\n")
            result = self._run(state, marker, stage="figma")
            self.assertEqual(0, result.returncode)
            self.assertNotIn('"decision":"block"', result.stdout)

    @staticmethod
    def _run(state, marker, stage="e2e"):
        env = os.environ.copy()
        env.pop("ORCH_ROOT", None)
        env.update({
            "ORCH_STATE_DIR": str(state),
            "ORCH_ARTIFACT": str(marker),
            "ORCH_STAGE": stage,
            "ORCH_PHASE": "1",
        })
        return subprocess.run(
            ["bash", str(HOOK)], env=env, text=True, capture_output=True, check=False
        )


class StopVerifyTests(Base):
    def summary(self):
        return self.write('.agents/orchestrator/phase-1/summary.md',
                          'Done\n## Acceptance\n| AC1 | met | test |\n')

    @staticmethod
    def _run_verify(root, marker, stage="builder", **overrides):
        env = os.environ.copy()
        env.update(ORCH_STATE_DIR=str(root / '.agents/orchestrator'), ORCH_ROOT=str(root),
                   ORCH_PHASE='1', ORCH_ARTIFACT=str(marker), ORCH_STAGE=stage)
        env.update(overrides)
        return subprocess.run(['bash', str(HOOK)], env=env, text=True, capture_output=True, check=False)

    def event_names(self):
        return [e['event'] for e in self.events('build_done') + self.events('stage_done')]

    def test_current_green_releases_and_emits_done(self):
        marker = self.summary()
        self.verify()
        result = self._run_verify(self.root, marker)
        self.assertEqual(0, result.returncode)
        self.assertEqual('', result.stdout)
        self.assertIn('build_done', self.event_names())

    def test_stale_red_missing_block_three_then_release_for_builder_and_fix(self):
        marker = self.summary()
        verify_path = self.sd / 'phase-1/verify.json'
        for stage in ('builder', 'fix'):
            for state in ('missing', 'red', 'stale'):
                with self.subTest(stage=stage, state=state):
                    tries = self.sd / f'.stop-gate-verify-{stage}-1.tries'
                    tries.unlink(missing_ok=True)
                    verify_path.unlink(missing_ok=True)
                    if state == 'red':
                        self.write_config('[validation]\nlevels=[{name="unit",cmd="false"}]\n')
                        self.verify()
                    elif state == 'stale':
                        self.write_config('[validation]\nlevels=[{name="unit",cmd="true"}]\n')
                        self.verify()
                        self.write('a.py', 'stale ' + stage)
                    for attempt in range(1, 4):
                        result = self._run_verify(self.root, marker, stage)
                        self.assertEqual(0, result.returncode, result.stderr)
                        decision = json.loads(result.stdout)
                        self.assertEqual('block', decision['decision'])
                        self.assertIn('verify --phase 1', decision['reason'])
                        self.assertIn(f'Attempt {attempt} of 3', decision['reason'])
                        self.assertIn(state if state != 'red' else 'fail', decision['reason'])
                    result = self._run_verify(self.root, marker, stage)
                    self.assertEqual('', result.stdout)
                    events = [json.loads(line)['event'] for line in (self.sd / 'events.jsonl').read_text().splitlines()]
                    self.assertEqual(['verify_red_at_stop', 'build_done' if stage == 'builder' else 'stage_done'], events[-2:])
                    self.assertEqual([], list(self.sd.glob('GATE-FAILED-*')))

    def test_artifact_attempts_leave_three_verify_attempts(self):
        marker = self.sd / 'phase-1/summary.md'
        for attempt in range(1, 4):
            decision = json.loads(self._run_verify(self.root, marker).stdout)
            self.assertIn(f'Attempt {attempt} of 3', decision['reason'])
        self.summary()
        for attempt in range(1, 4):
            decision = json.loads(self._run_verify(self.root, marker).stdout)
            self.assertIn('verify --phase 1', decision['reason'])
            self.assertIn(f'Attempt {attempt} of 3', decision['reason'])

    def test_acceptance_only_release_still_checks_verify_before_done(self):
        marker = self.write('.agents/orchestrator/phase-1/summary.md', 'No table\n')
        for _ in range(3):
            self.assertEqual('block', json.loads(self._run_verify(self.root, marker).stdout)['decision'])
        decision = json.loads(self._run_verify(self.root, marker).stdout)
        self.assertIn('verify --phase 1', decision['reason'])
        self.assertEqual([], self.events('build_done'))
        self.assertEqual(1, len(self.events('acceptance_missing')))

    def test_internal_error_unset_root_and_e2e_fail_open(self):
        marker = self.summary()
        # A broken/old Python entrypoint must never turn its exit 2 into a verify refusal.
        bin_dir = self.root / 'bin'
        broken = self.write('bin/python3', '#!/bin/sh\necho "broken entrypoint"\nexit 2\n')
        broken.chmod(0o755)
        result = self._run_verify(self.root, marker, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'])
        self.assertEqual('', result.stdout)
        result = StopGateTests._run(self.sd, marker, stage='builder')
        self.assertEqual('', result.stdout)
        result = self._run_verify(self.root, marker, ORCH_ROOT=str(self.root / 'missing'))
        self.assertEqual('', result.stdout)
        # If e2e invoked Python, this fake would leave a marker.
        broken.write_text('#!/bin/sh\ntouch "' + str(self.root / 'python-called') + '"\nexit 2\n')
        e2e = self.write('.agents/orchestrator/phase-1/e2e.md', 'RESULT: blocked\n')
        self.write('.agents/orchestrator/phase-1/capture.md')
        self.write('.agents/orchestrator/phase-1/manual.md')
        result = self._run_verify(self.root, e2e, stage='e2e',
                                  PATH=str(bin_dir) + os.pathsep + os.environ['PATH'])
        self.assertEqual('', result.stdout)
        self.assertFalse((self.root / 'python-called').exists())


if __name__ == "__main__":
    unittest.main()
