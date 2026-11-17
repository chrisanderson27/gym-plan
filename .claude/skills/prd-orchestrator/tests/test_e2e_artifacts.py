import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "orchestrator.py"
SPEC = importlib.util.spec_from_file_location("orchestrator", SCRIPT)
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


class E2EArtifactTests(unittest.TestCase):
    def test_promote_exports_cataloged_journey(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = {"schema": 1, "journey": "complete", "catalog": ".claude/e2e/journeys/app/x",
                    "steps": [{"n": 1, "action": "open", "url": "/home"}]}
            _, cfg = self._promote_fixture(root, journey=data)
            catalog = root / data["catalog"]
            catalog.mkdir(parents=True)
            (catalog / "journey.json").write_text(json.dumps(data))
            output = io.StringIO()
            with mock.patch.object(orchestrator, "load_config", return_value=(cfg, None)), \
                    mock.patch.object(orchestrator, "repo_root", return_value=str(root)), \
                    mock.patch.object(orchestrator, "CATALOG_ROOT", str(root)), \
                    contextlib.redirect_stdout(output):
                rc = orchestrator.cmd_promote_e2e(
                    orchestrator.argparse.Namespace(root=str(root), prd="docs/prd/checkout.md", phase=1))
            self.assertEqual(0, rc)
            self.assertTrue((catalog / "spec.ts").is_file())
            self.assertIn("spec: ", output.getvalue())
            self.assertNotIn("not exported", output.getvalue())

    def test_promote_without_catalog_does_not_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, cfg = self._promote_fixture(root)
            output = io.StringIO()
            with mock.patch.object(orchestrator, "load_config", return_value=(cfg, None)), \
                    mock.patch.object(orchestrator, "repo_root", return_value=str(root)), \
                    contextlib.redirect_stdout(output):
                rc = orchestrator.cmd_promote_e2e(
                    orchestrator.argparse.Namespace(root=str(root), prd="docs/prd/checkout.md", phase=1))
            self.assertEqual(0, rc)
            self.assertIn("spec: not exported", output.getvalue())

    def test_no_assertion_journey_keeps_steps_and_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, cfg = self._promote_fixture(root, journey={
                "schema": 1, "journey": "incomplete", "reason": "no-assertion",
                "steps": [{"n": 1, "action": "open", "url": "/home"}], "assertions": []})
            output = orchestrator.promote_e2e(str(root), cfg, "docs/prd/checkout.md", 1)
            text = Path(output).read_text()
            self.assertIn("Journey: incomplete — no-assertion.", text)
            self.assertIn("| 1 |", text)
            ok, reason = orchestrator.validate_promoted_e2e(str(root), cfg, "docs/prd/checkout.md", 1)
            self.assertTrue(ok, reason)

    def test_export_failure_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = {"schema": 1, "journey": "complete", "catalog": ".claude/e2e/journeys/app/x",
                    "steps": [{"action": "open"}]}
            phase, _ = self._promote_fixture(root, journey=data)
            catalog = root / data["catalog"]
            catalog.mkdir(parents=True)
            (catalog / "journey.json").write_text(json.dumps(data))
            with mock.patch.object(orchestrator, "CATALOG_ROOT", str(root)), \
                    mock.patch.object(orchestrator.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "detail\nboom\n")):
                self.assertEqual((None, "boom"), orchestrator.export_journey_spec(str(phase)))

    def test_trace_input_is_redacted_by_default(self):
        self.assertTrue(
            hasattr(orchestrator, "redact_trace_value"),
            "redact_trace_value must protect trace-derived input before rendering",
        )
        self.assertEqual(
            "[REDACTED: unclassified input]",
            orchestrator.redact_trace_value(
                "ordinary-looking-value",
                "getByRole('textbox', { name: 'Customer name' })",
                {},
                set(),
            ),
        )

    def test_known_environment_secret_becomes_symbolic_reference(self):
        self.assertTrue(hasattr(orchestrator, "redact_trace_value"))
        self.assertEqual(
            "${E2E_PASS}",
            orchestrator.redact_trace_value(
                "do-not-commit-me",
                "getByLabel('Password')",
                {"E2E_PASS": "do-not-commit-me"},
                set(),
            ),
        )

    def test_safe_literal_must_be_explicitly_classified(self):
        self.assertTrue(hasattr(orchestrator, "redact_trace_value"))
        self.assertEqual(
            "Test Customer 4092",
            orchestrator.redact_trace_value(
                "Test Customer 4092",
                "getByLabel('Customer name')",
                {},
                {"Test Customer 4092"},
            ),
        )

    def _promote_fixture(self, root, journey="valid"):
        """A pass-phase bundle in a git'd tmp root; `journey` is valid / None / a raw string / a dict."""
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        phase = root / ".agents" / "orchestrator" / "phase-1"
        phase.mkdir(parents=True)
        (phase / "e2e.md").write_text("RESULT: pass\nCheckout completed.\n")
        (phase / "capture.md").write_text(
            "# Checkout\n\n"
            "## Intent\nBuy one item.\n\n"
            "## Acceptance criteria\nOrder confirmation appears.\n\n"
            "## Prerequisites\n- Role: cashier\n\n"
            "## Safe literals\n- `Test Customer 4092`\n\n"
            "## Steps\n"
            "| # | screen / url | action | locator | input | wait / trigger | assertion | evidence |\n"
            "|---|---|---|---|---|---|---|---|\n"
            "| 1 | /login | fill | Password | `${E2E_PASS}` | enabled | — | — |\n\n"
            "## Outcome\nOrder confirmation appeared.\n\n"
            "## Cleanup\nDelete the test order.\n\n"
            "## Stability\nNone.\n"
        )
        (phase / "manual.md").write_text(
            "**Before:** no order\n**Now:** order exists\n\n1. Sign in.\n"
            "**You should see:** an order confirmation.\n"
        )
        if journey == "valid":
            self._write_journey(phase / "journey.json", "do-not-commit-me")
        elif isinstance(journey, dict):
            (phase / "journey.json").write_text(json.dumps(journey))
        elif isinstance(journey, str):
            (phase / "journey.json").write_text(journey)
        (phase / "media").mkdir()
        (phase / "media" / "index.md").write_text("01-checkout.png — criterion 1\n")
        profile = root / ".claude" / "e2e" / "profile.md"
        profile.parent.mkdir(parents=True)
        profile.write_text("password from `$E2E_PASS`\n")
        return phase, {
            "testing": {"dir": "docs/testing", "capture": "on"},
            "e2e": {"profile": ".claude/e2e/profile.md"},
        }

    def test_promote_e2e_writes_tracked_redacted_scenario(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, cfg = self._promote_fixture(root)
            with mock.patch.dict(os.environ, {"E2E_PASS": "do-not-commit-me"}):
                output = orchestrator.promote_e2e(str(root), cfg, "docs/prd/checkout.md", 1)
                ok, reason = orchestrator.validate_promoted_e2e(str(root), cfg, "docs/prd/checkout.md", 1)

            self.assertTrue(ok, reason)
            document = Path(output).read_text()
            self.assertNotIn("do-not-commit-me", document)
            self.assertIn("## Steps", document)
            self.assertRegex(document, r"(?m)^\| 1 \| /login \| open \|")
            self.assertIn("${E2E_PASS}", document)
            self.assertIn("Test Customer 4092", document)
            self.assertIn("getByRole('textbox', { name: 'Password' })", document)
            self.assertIn("Journey: `complete`", document)
            self.assertIn("Result: `pass`", document)
            self.assertNotIn("No browser interaction", document)

    def test_missing_journey_still_promotes_and_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, cfg = self._promote_fixture(root, journey=None)
            output = orchestrator.promote_e2e(str(root), cfg, "docs/prd/checkout.md", 1)
            document = Path(output).read_text()
            self.assertIn("Journey: `incomplete`", document)
            self.assertIn("Journey: incomplete — no journey.json.", document)
            self.assertNotIn("No browser interaction", document)

            with mock.patch.object(orchestrator, "load_config", return_value=(cfg, None)), \
                    mock.patch.object(orchestrator, "repo_root", return_value=str(root)):
                rc = orchestrator.cmd_promote_e2e(
                    orchestrator.argparse.Namespace(root=str(root), prd="docs/prd/checkout.md", phase=1))
            self.assertEqual(rc, 0)
            events = (root / ".agents" / "orchestrator" / "events.jsonl").read_text().splitlines()
            kinds = [json.loads(line)["event"] for line in events]
            self.assertIn("journey_incomplete", kinds)

            lines = []
            for line in events:
                record = json.loads(line)
                if record["event"] == "journey_incomplete":
                    lines.append(record)
            self.assertEqual("no journey.json", lines[0]["detail"])
            report = orchestrator._events(str(root), {"journey_incomplete"})
            self.assertEqual(1, len(report))

    def test_report_lists_incomplete_journeys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / ".gitignore").write_text("/.agents/\n")
            state = root / ".agents" / "orchestrator"
            state.mkdir(parents=True)
            orchestrator._emit(str(root), "journey_incomplete", phase=2, detail="no acting steps")
            orchestrator._emit(str(root), "journey_incomplete", phase=2, detail="no acting steps")
            with mock.patch.object(orchestrator.sys, "stdout"):
                rc = orchestrator.cmd_report(
                    orchestrator.argparse.Namespace(root=str(root), prd="docs/prd/x.md", absorbed=False))
            self.assertEqual(0, rc)
            text = (state / "deviations-x.md").read_text()
            self.assertIn("## Journeys incomplete", text)
            self.assertEqual(1, text.count("- phase 2: no acting steps"))

    def test_zero_acting_step_journey_is_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            phase, cfg = self._promote_fixture(root, journey={
                "schema": 1, "journey": "complete",
                "steps": [{"n": 1, "action": "screenshot", "shot": "a.png"},
                          {"n": 2, "action": "wait", "wait": "idle"}]})
            self.assertEqual("no acting steps", orchestrator._phase_journey(str(phase))[2])
            output = orchestrator.promote_e2e(str(root), cfg, "docs/prd/checkout.md", 1)
            self.assertIn("Journey: incomplete — no acting steps.", Path(output).read_text())

    def test_persisted_acting_steps_wins_over_a_recount(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            phase, _ = self._promote_fixture(root, journey={
                "schema": 1, "journey": "complete", "actingSteps": 0,
                "steps": [{"n": 1, "action": "click", "locator": "x"}]})
            self.assertEqual("no acting steps", orchestrator._phase_journey(str(phase))[2])

    def test_invalid_journey_is_incomplete_and_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            phase, cfg = self._promote_fixture(root, journey="{not json")
            self.assertEqual((None, "incomplete", "invalid journey.json"),
                             orchestrator._phase_journey(str(phase)))
            output = orchestrator.promote_e2e(str(root), cfg, "docs/prd/checkout.md", 1)
            self.assertIn("Journey: `incomplete`", Path(output).read_text())

    def test_checksum_covers_journey(self):
        with tempfile.TemporaryDirectory() as tmp:
            phase = Path(tmp)
            (phase / "e2e.md").write_text("RESULT: pass\n")
            (phase / "journey.json").write_text('{"schema": 1, "steps": []}')
            old_checksum = orchestrator.e2e_evidence_checksum(str(phase))
            (phase / "journey.json").write_text('{"schema": 1, "steps": [{"n": 1}]}')
            self.assertNotEqual(old_checksum, orchestrator.e2e_evidence_checksum(str(phase)))

    def test_trace_extract_is_gone(self):
        self.assertFalse(hasattr(orchestrator, "parse_" + "trace"))
        self.assertFalse(hasattr(orchestrator, "cmd_trace_extract"))
        with mock.patch.object(orchestrator.sys, "argv", ["orchestrator.py", "trace-extract", "x"]), \
                mock.patch.object(orchestrator.sys, "stderr"):
            with self.assertRaises(SystemExit) as raised:
                orchestrator.main()
        self.assertNotEqual(0, raised.exception.code)

    def test_validate_promoted_e2e_rejects_missing_document(self):
        self.assertTrue(hasattr(orchestrator, "validate_promoted_e2e"))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            phase = root / ".agents" / "orchestrator" / "phase-2"
            phase.mkdir(parents=True)
            (phase / "e2e.md").write_text("RESULT: fail\nExpected confirmation.\n")
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}

            ok, reason = orchestrator.validate_promoted_e2e(
                str(root), cfg, "docs/prd/checkout.md", 2
            )

            self.assertFalse(ok)
            self.assertIn("missing", reason)

    def test_observed_trace_value_is_redacted_unless_classified_safe(self):
        self.assertTrue(hasattr(orchestrator, "redact_observed_value"))
        self.assertEqual(
            "[REDACTED: unclassified observation]",
            orchestrator.redact_observed_value("Customer Jane Doe", {}, set()),
        )
        self.assertEqual(
            "Order confirmed",
            orchestrator.redact_observed_value("Order confirmed", {}, {"Order confirmed"}),
        )

    def test_capture_rejects_literal_in_sensitive_input_row(self):
        self.assertTrue(hasattr(orchestrator, "validate_capture_safety"))
        with self.assertRaisesRegex(ValueError, "sensitive input") as error:
            orchestrator.validate_capture_safety(
                "| 1 | /login | fill | Password | literal-password | enabled | — | — |"
            )
        self.assertNotIn("literal-password", str(error.exception))

    def test_capture_requires_structured_journey_sections(self):
        self.assertTrue(hasattr(orchestrator, "validate_capture_contract"))
        with self.assertRaisesRegex(ValueError, "missing capture section"):
            orchestrator.validate_capture_contract("# Unstructured notes\nClicked checkout.\n")

    def test_committed_validation_rejects_uncommitted_scenario(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            phase = root / ".agents" / "orchestrator" / "phase-1"
            phase.mkdir(parents=True)
            (phase / "e2e.md").write_text("RESULT: blocked\nPrerequisite unavailable.\n")
            self._write_capture(phase / "capture.md")
            (phase / "manual.md").write_text(
                "**Before:** prerequisite unavailable\n**Now:** run is blocked\n\n"
                "1. Sign in.\n**You should see:** the required prerequisite.\n"
            )
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}
            scenario = Path(orchestrator.promote_e2e(str(root), cfg, "checkout.md", 1))

            ok, reason = orchestrator.validate_promoted_e2e(
                str(root), cfg, "checkout.md", 1, committed=True
            )

            self.assertFalse(ok)
            self.assertIn("not committed", reason)

            subprocess.run(["git", "-C", str(root), "config", "user.name", "Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "docs/testing"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "Add scenario"], check=True)

            ok, reason = orchestrator.validate_promoted_e2e(
                str(root), cfg, "checkout.md", 1, committed=True
            )
            self.assertTrue(ok, reason)

    def test_store_mode_scenario_lands_in_the_wiki_and_commits_there(self):
        """Store mode: promote writes <Store>/testing in the wiki, gate passes without a commit,
        --committed fails until store-commit records it at the WIKI's HEAD, then passes."""
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(os.path.realpath(tmp))
            team, wiki = base / "team", base / "wiki"
            team.mkdir()
            _, cfg = self._promote_fixture(team)
            (team / ".gitignore").write_text("/.agents/\n")
            subprocess.run(["git", "init", "-q", str(wiki)], check=True)
            for key, val in (("user.name", "Test"), ("user.email", "t@example.invalid"),
                             ("commit.gpgsign", "false")):
                subprocess.run(["git", "-C", str(wiki), "config", key, val], check=True)
            store = wiki / ".planning" / "rbcloud" / "F-1"
            prd = store / "prds" / "prd-1-checkout.md"
            prd.parent.mkdir(parents=True)
            prd.write_text("# PRD\n")
            state = team / ".agents" / "orchestrator"
            (state / "RUN.md").write_text(f"PRD: {prd}\nStore: {store}\n")
            with mock.patch.dict(os.environ, {"WORKBENCH_STORE_ROOT": str(wiki / ".planning")}):
                output = Path(orchestrator.promote_e2e(str(team), cfg, str(prd), 1))
                self.assertEqual(store / "testing" / "scenarios" / "prd-1-checkout" / "phase-1-scenario.md",
                                 output)
                self.assertFalse((team / "docs").exists())
                ok, reason = orchestrator.validate_promoted_e2e(str(team), cfg, str(prd), 1)
                self.assertTrue(ok, reason)
                gate_cfg = orchestrator._deep_default(cfg)          # no [validation] levels: verify N/A
                with mock.patch.object(orchestrator, "load_config", return_value=(gate_cfg, None)), \
                        mock.patch.object(orchestrator, "repo_root", return_value=str(team)), \
                        contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(0, orchestrator.cmd_gate(
                        orchestrator.argparse.Namespace(root=str(team), phase=1, prd=None)))

                ok, reason = orchestrator.validate_promoted_e2e(str(team), cfg, str(prd), 1, committed=True)
                self.assertFalse(ok)
                self.assertIn("not committed in the wiki", reason)
                self.assertIn(".planning/rbcloud/F-1/testing/", reason)
                self.assertNotIn("../", reason)
                # committing it in the TEAM repo would not count -- only the wiki's HEAD does
                with contextlib.redirect_stdout(io.StringIO()):
                    rc = orchestrator.cmd_store_commit(orchestrator.argparse.Namespace(
                        root=str(team), phase=1, reason=None, store=None, path=None))
                self.assertEqual(0, rc)
                ok, reason = orchestrator.validate_promoted_e2e(str(team), cfg, str(prd), 1, committed=True)
                self.assertTrue(ok, reason)
                output.write_text(output.read_text() + "edited\n")
                ok, _ = orchestrator.validate_promoted_e2e(str(team), cfg, str(prd), 1, committed=True)
                self.assertFalse(ok)

    def test_validation_rejects_a_modified_generated_scenario(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            phase = root / ".agents" / "orchestrator" / "phase-1"
            phase.mkdir(parents=True)
            (phase / "e2e.md").write_text("RESULT: blocked\nPrerequisite unavailable.\n")
            self._write_capture(phase / "capture.md")
            (phase / "manual.md").write_text(
                "**Before:** prerequisite unavailable\n**Now:** run is blocked\n\n"
                "1. Sign in.\n**You should see:** the required prerequisite.\n"
            )
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}
            scenario = Path(orchestrator.promote_e2e(str(root), cfg, "checkout.md", 1))
            scenario.write_text(scenario.read_text() + "\nPassword: hunter2\n")

            ok, reason = orchestrator.validate_promoted_e2e(
                str(root), cfg, "checkout.md", 1
            )

            self.assertFalse(ok)
            self.assertIn("generated", reason)

    def test_resolved_element_drops_runtime_value_attributes(self):
        self.assertTrue(hasattr(orchestrator, "sanitize_resolved_element"))
        element = (
            '<input id="password" data-testid="login-password" type="password" '
            'value="do-not-commit-me" aria-label="Password">'
        )

        sanitized = orchestrator.sanitize_resolved_element(element, {})

        self.assertIn('data-testid="login-password"', sanitized)
        self.assertNotIn('aria-label=', sanitized)
        self.assertNotIn("do-not-commit-me", sanitized)
        self.assertNotIn(" value=", sanitized)

    def test_profile_recognizes_backticked_environment_names_without_dollar(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = root / ".claude" / "e2e" / "profile.md"
            profile.parent.mkdir(parents=True)
            profile.write_text("| login password | `E2E_PASS` | login form |\n")
            old = os.environ.get("E2E_PASS")
            os.environ["E2E_PASS"] = "profile-secret"
            try:
                values = orchestrator._profile_secret_values(
                    str(root), {"e2e": {"profile": ".claude/e2e/profile.md"}}
                )
            finally:
                if old is None:
                    os.environ.pop("E2E_PASS", None)
                else:
                    os.environ["E2E_PASS"] = old
            self.assertEqual({"E2E_PASS": "profile-secret"}, values)

    def test_profile_rejects_a_referenced_environment_secret_literal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = root / ".claude" / "e2e" / "profile.md"
            profile.parent.mkdir(parents=True)
            profile.write_text(
                "| login password | `E2E_PASS` | login form |\n"
                "Accidentally pasted: profile-secret\n"
            )
            old = os.environ.get("E2E_PASS")
            os.environ["E2E_PASS"] = "profile-secret"
            try:
                with self.assertRaisesRegex(ValueError, "environment secret") as error:
                    orchestrator._profile_secret_values(
                        str(root), {"e2e": {"profile": ".claude/e2e/profile.md"}}
                    )
            finally:
                if old is None:
                    os.environ.pop("E2E_PASS", None)
                else:
                    os.environ["E2E_PASS"] = old
            self.assertNotIn("profile-secret", str(error.exception))

    def test_freeform_markdown_rejects_literal_password_without_echoing_it(self):
        self.assertTrue(hasattr(orchestrator, "validate_document_safety"))
        with self.assertRaisesRegex(ValueError, "sensitive value") as error:
            orchestrator.validate_document_safety("Password: literal-password")
        self.assertNotIn("literal-password", str(error.exception))

    def test_sensitive_url_query_values_are_redacted(self):
        self.assertTrue(hasattr(orchestrator, "sanitize_url"))
        sanitized = orchestrator.sanitize_url(
            "https://example.test/callback?token=abc123&order=4092", {}, {"4092"}
        )
        self.assertNotIn("abc123", sanitized)
        self.assertIn("token=%5BREDACTED%5D", sanitized)
        self.assertIn("order=4092", sanitized)

    def test_url_userinfo_and_sensitive_fragment_are_redacted(self):
        sanitized = orchestrator.sanitize_url(
            "https://user:SECRET123@example.test/callback#access_token=SECRET123", {}, set()
        )
        self.assertNotIn("user", sanitized)
        self.assertNotIn("SECRET123", sanitized)
        self.assertIn("[REDACTED", sanitized)

    def test_url_secret_shaped_path_segment_is_redacted(self):
        sanitized = orchestrator.sanitize_url(
            "https://example.test/reset/SECRET123", {}, set()
        )
        self.assertNotIn("SECRET123", sanitized)
        self.assertIn("[REDACTED", sanitized)

    def test_url_redacts_reset_tokens_and_fragment_query_values(self):
        for url, secret in (
            ("https://example.test/reset/huntersecret", "huntersecret"),
            ("https://example.test/#/callback?code=hunter2", "hunter2"),
            ("https://example.test/#/callback?auth=qwerty", "qwerty"),
        ):
            with self.subTest(url=url):
                sanitized = orchestrator.sanitize_url(url, {}, set())
                self.assertNotIn(secret, sanitized)
                self.assertIn("[REDACTED", sanitized)

    def test_safe_literals_reject_secret_categories(self):
        with self.assertRaisesRegex(ValueError, "safe literal"):
            orchestrator._safe_literals("## Safe literals\n\n- `OTP 123456`\n\n## Steps\n")

    def test_safe_literals_reject_opaque_secret_shaped_values(self):
        for value in ("hunter2", "481516", "abcDEF123456token", "hunter", "abc-xyz"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "safe literal"):
                    orchestrator._safe_literals(
                        f"## Safe literals\n\n- `{value}`\n\n## Steps\n"
                    )

    def test_capture_sections_must_have_content_and_a_step(self):
        capture = "\n".join(f"## {heading}\n" for heading in orchestrator._CAPTURE_SECTIONS)
        with self.assertRaisesRegex(ValueError, "empty capture section"):
            orchestrator.validate_capture_contract(capture)

    def test_manual_contract_requires_before_now_steps_and_outcome(self):
        self.assertTrue(hasattr(orchestrator, "validate_manual_contract"))
        with self.assertRaisesRegex(ValueError, "manual.md"):
            orchestrator.validate_manual_contract("Signed in and checked out.\n")

    def test_evidence_checksum_rejects_stale_scenario(self):
        self.assertTrue(hasattr(orchestrator, "e2e_evidence_checksum"))
        with tempfile.TemporaryDirectory() as tmp:
            phase = Path(tmp)
            (phase / "e2e.md").write_text("RESULT: fail\nold\n")
            (phase / "capture.md").write_text("capture\n")
            (phase / "manual.md").write_text("manual\n")
            old_checksum = orchestrator.e2e_evidence_checksum(str(phase))
            (phase / "e2e.md").write_text("RESULT: fail\nnew observation\n")
            new_checksum = orchestrator.e2e_evidence_checksum(str(phase))
            self.assertNotEqual(old_checksum, new_checksum)

    def test_evidence_checksum_includes_media_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            phase = Path(tmp)
            (phase / "e2e.md").write_text("RESULT: pass\n")
            (phase / "media").mkdir()
            (phase / "media" / "index.md").write_text("01.png — criterion 1\n")
            old_checksum = orchestrator.e2e_evidence_checksum(str(phase))
            (phase / "media" / "index.md").write_text("02.png — criterion 1\n")
            new_checksum = orchestrator.e2e_evidence_checksum(str(phase))
            self.assertNotEqual(old_checksum, new_checksum)

    def test_usage_gate_rejects_unpromoted_terminal_e2e_result(self):
        self.assertTrue(hasattr(orchestrator, "validate_e2e_before_usage"))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            phase = root / ".agents" / "orchestrator" / "phase-3"
            phase.mkdir(parents=True)
            (phase / "e2e.md").write_text("RESULT: fail\n")
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}

            ok, reason = orchestrator.validate_e2e_before_usage(str(root), cfg, "checkout.md", 3)

            self.assertFalse(ok)
            self.assertIn("missing durable scenario", reason)

    def test_usage_gate_rejects_a_missing_e2e_decision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}

            ok, reason = orchestrator.validate_e2e_before_usage(str(root), cfg, "checkout.md", 3)

            self.assertFalse(ok)
            self.assertIn("missing E2E decision", reason)

    def test_usage_gate_accepts_an_explicit_e2e_na_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            state = root / ".agents" / "orchestrator"
            state.mkdir(parents=True)
            (state / "events.jsonl").write_text(
                json.dumps({"ts": "2026-09-11T12:00:00Z", "event": "run_start"}) + "\n" +
                json.dumps({"ts": "2026-09-11T12:01:00Z", "event": "e2e_na", "phase": 3,
                            "detail": "docs-only phase"}) + "\n"
            )
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}

            ok, reason = orchestrator.validate_e2e_before_usage(str(root), cfg, "checkout.md", 3)

            self.assertTrue(ok, reason)

    def test_usage_gate_rejects_an_e2e_na_from_a_prior_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            state = root / ".agents" / "orchestrator"
            state.mkdir(parents=True)
            (state / "events.jsonl").write_text(
                json.dumps({"ts": "2026-09-10T12:00:00Z", "event": "run_start"}) + "\n" +
                json.dumps({"ts": "2026-09-10T12:01:00Z", "event": "e2e_na", "phase": 3,
                            "detail": "old docs-only phase"}) + "\n" +
                json.dumps({"ts": "2026-09-11T12:00:00Z", "event": "run_start"}) + "\n"
            )
            cfg = {"testing": {"dir": "docs/testing", "capture": "on"}}

            ok, reason = orchestrator.validate_e2e_before_usage(str(root), cfg, "new-prd.md", 3)

            self.assertFalse(ok)
            self.assertIn("missing E2E decision", reason)

    def test_cost_window_uses_the_latest_run_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / ".agents" / "orchestrator"
            state.mkdir(parents=True)
            (state / "events.jsonl").write_text(
                json.dumps({"ts": "2026-09-10T12:00:00Z", "event": "run_start"}) + "\n" +
                json.dumps({"ts": "2026-09-11T12:00:00Z", "event": "run_start"}) + "\n"
            )

            self.assertEqual("2026-09-11T12:00:00Z", orchestrator._run_start_ts(str(root)))

    def test_freeform_markdown_rejects_sensitive_value_phrasings(self):
        for text in (
            "Enter hunter2 in the password field.",
            "Use access code 481516 to continue.",
            "Use code 481516 to continue.",
            "The credential is hunter2.",
            "Sign in with hunter2.",
            "Sign in using hunter2.",
            "When prompted, provide 481516.",
            "Enter hunter2.",
        ):
            with self.subTest(text=text):
                with self.assertRaisesRegex(ValueError, "sensitive value"):
                    orchestrator.validate_document_safety(text)

    def test_resolved_element_redacts_unclassified_runtime_attributes(self):
        element = (
            '<button id="customer-Jane-Doe" data-testid="checkout-4815162342" '
            'aria-label="Checkout for Jane Doe" class="customer Jane-Doe">Pay</button>'
        )

        sanitized = orchestrator.sanitize_resolved_element(element, {}, set())

        self.assertNotIn("Jane", sanitized)
        self.assertNotIn("4815162342", sanitized)

    def test_locator_redacts_unclassified_accessible_name(self):
        locator = "getByRole('option', { name: 'Account SECRET123' })"

        sanitized = orchestrator.sanitize_locator(locator, {}, set())

        self.assertNotIn("SECRET123", sanitized)
        self.assertIn("[REDACTED", sanitized)

    @staticmethod
    def _write_journey(path, password):
        def step(n, action, url, role=None, name=None, value=None):
            loc = None
            if role:
                loc = {"role": role, "name": name, "inIframe": False,
                       "playwright": f"getByRole('{role}', {{ name: '{name}' }})"}
            return {"n": n, "action": action, "url": url, "locator": loc, "input": value,
                    "picked": None, "wait": None, "assert": None, "shot": None, "ok": True, "note": None}
        journey = {
            "schema": 1, "id": None, "app": "rbcloud", "source": "prd-phase",
            "ref": {"prd": "checkout", "phase": 1}, "story": "Checkout", "criteria": [],
            "engine": "worker", "baseUrl": "http://localhost:5000", "result": "pass",
            "journey": "complete", "assertions": [], "notes": "",
            "steps": [
                step(1, "open", "http://localhost:5000/login"),
                step(2, "fill", "/login", "textbox", "Password", "${E2E_PASS}"),
                step(3, "fill", "/checkout", "textbox", "Customer", "Test Customer 4092"),
                step(4, "click", "/checkout", "button", "Sign in"),
                # A value the shim missed: the repo copy must still redact it.
                step(5, "fill", "/checkout", "textbox", "Notes", password),
            ],
        }
        path.write_text(json.dumps(journey))

    @staticmethod
    def _write_capture(path):
        path.write_text(
            "# Blocked journey\n\n"
            "## Intent\nValidate the user journey.\n\n"
            "## Acceptance criteria\n- The journey completes.\n\n"
            "## Prerequisites\n- Required fixture exists.\n\n"
            "## Safe literals\n- `Sign in`\n\n"
            "## Steps\n"
            "| # | screen / url | action | locator | input | wait / trigger | assertion | evidence |\n"
            "|---|---|---|---|---|---|---|---|\n"
            "| 1 | `/login` | click | `getByRole('button', { name: 'Sign in' })` | — | navigation | home appears | — |\n\n"
            "## Outcome\nBlocked before completion.\n\n"
            "## Cleanup\nNone required.\n\n"
            "## Stability\nNo stability findings.\n"
        )


if __name__ == "__main__":
    unittest.main()
