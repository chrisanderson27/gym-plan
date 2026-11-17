#!/bin/bash
# H1 — the Stop artifact gate. THE highest-value hook in this design.
#
# A worker cannot end its turn without its artifact. Blocking the stop delivers
# `reason` as the worker's next instruction, so it goes back and finishes.
#
# This retires the two worst worker failures at once:
#   - the inter-batch false `idle` (the #1 cause of "the orchestrator went quiet")
#   - stopping mid-plan on context budget
#
# It canNOT retire the untrusted-folder / not-logged-in death: that agent never
# gets a turn, so no Stop ever fires. Preflight covers that. See
# reference/worker-preflight.md.
#
# Claude Code force-ends after 8 consecutive blocks, so we cap at 3 and write
# GATE-FAILED for missing artifacts; acceptance-only refusals release with an event.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/_common.sh"
orch_heartbeat stop-gate

ARTIFACT="${ORCH_ARTIFACT:-}"
[ -n "$ARTIFACT" ] || exit 0

# E2E completion is a bundle, not just the result marker. A pass/fail proves the
# browser ran and therefore requires a media manifest; journey.json is expected but
# never blocking (a missing one promotes as `Journey: incomplete`). Blocked-before-browser
# requires neither.
MISSING=""
if [ "${ORCH_STAGE:-}" = "e2e" ] && [ -s "$ARTIFACT" ]; then
  PHASE_DIR="$(dirname "$ARTIFACT")"
  for required in capture.md manual.md; do
    [ -s "$PHASE_DIR/$required" ] || MISSING="${MISSING}${MISSING:+, }$required"
  done
  RESULT=$(sed -n '1s/^RESULT:[[:space:]]*//p' "$ARTIFACT")
  case "$RESULT" in
    pass|fail)
      [ -s "$PHASE_DIR/media/index.md" ] || MISSING="${MISSING}${MISSING:+, }media/index.md"
      # A scheduled Figma check (ORCH_FIGMA=1, set only when Q5 is due alongside
      # this E2E run and it touches a Figma surface) must also produce the fidelity
      # comparison. Behaviour-only 'blocked' runs never reach here.
      if [ "${ORCH_FIGMA:-}" = "1" ]; then
        [ -s "$PHASE_DIR/figma-compare.md" ] || MISSING="${MISSING}${MISSING:+, }figma-compare.md"
      fi
      ;;
  esac
fi

# A builder's summary carries the acceptance-to-proof table (PRD harness-fixes-1 §12).
# Fix workers update existing rows; internal awk errors fail open.
ACCEPT_ONLY=""
if [ "${ORCH_STAGE:-}" = "builder" ] && [ -s "$ARTIFACT" ] && [ -z "$MISSING" ] && command -v awk >/dev/null 2>&1; then
  awk ' {sub(/\r$/,"")} /^## Acceptance[[:space:]]*$/{f=1;next} f&&/^## /{f=0} f&&/^\|[[:space:]]*AC[0-9]+/{n++} END{exit n?0:1}' "$ARTIFACT" 2>/dev/null
  ACCEPT_STATUS=$?
  if [ "$ACCEPT_STATUS" -eq 1 ]; then
    MISSING="an ## Acceptance table with one | ACn | Result | Proof | row per criterion"
    ACCEPT_ONLY=1
  fi
fi

# Verify has a separate allowance, even when artifact retries were spent first.
ARTIFACT_OK=""
if [ -s "$ARTIFACT" ] && [ -z "$MISSING" ]; then
  ARTIFACT_OK=1
else
  TRIES_FILE="$ORCH_STATE_DIR/.stop-gate-${ORCH_STAGE:-x}-${ORCH_PHASE:-x}.tries"
  TRIES=$(cat "$TRIES_FILE" 2>/dev/null || echo 0)
  TRIES=$((TRIES + 1))
  echo "$TRIES" > "$TRIES_FILE"

  if [ "$TRIES" -gt 3 ]; then
    if [ -n "$ACCEPT_ONLY" ]; then
      orch_event acceptance_missing "$ARTIFACT"
      ARTIFACT_OK=1
    else
      printf 'gate failed after %s attempts: required artifact missing (%s%s)\n' \
      "$((TRIES - 1))" "$ARTIFACT" "${MISSING:+; $MISSING}" \
      > "$ORCH_STATE_DIR/GATE-FAILED-${ORCH_STAGE:-x}-${ORCH_PHASE:-x}"
      orch_event gate_failed "$ARTIFACT${MISSING:+; $MISSING} missing after $((TRIES - 1)) attempts"
      exit 0            # stop being obstinate; the orchestrator now has a TYPED failure
    fi
  else

    REQUIRED="$ARTIFACT${MISSING:+ plus $MISSING}"
    orch_event gate_block "attempt $TRIES: $REQUIRED missing"
    # stdout JSON + exit 0 is the documented block form. `reason` becomes the worker's
    # next instruction, so it must say exactly what to do.
    if [ "${ORCH_STAGE:-}" = "builder" ]; then
      cat <<JSON
{"decision":"block","reason":"Add ## Acceptance to $ARTIFACT: one row per acceptance criterion (| AC1 | met / not met / not proven | proof |), after asking what would make it not work. Finish the required summary if missing. Attempt $TRIES of 3."}
JSON
      exit 0
    fi
    cat <<JSON
{"decision":"block","reason":"You have not written your complete required artifact bundle yet: $REQUIRED\n\nDo NOT stop. Finish the missing E2E evidence, then stop. A pass/fail requires e2e.md, capture.md, manual.md and media/index.md; a scheduled Figma check also requires figma-compare.md (the screenshot-vs-Figma checklist per reference/figma-gate.md); blocked-before-browser requires the three Markdown files. Attempt $TRIES of 3."}
JSON
    exit 0
  fi
fi

if [ -n "$ARTIFACT_OK" ] && { [ "${ORCH_STAGE:-}" = "builder" ] || [ "${ORCH_STAGE:-}" = "fix" ]; } && [ -n "${ORCH_ROOT:-}" ] && [ -n "${ORCH_PHASE:-}" ]; then
  CHECK_OUT=$(python3 "$DIR/../orchestrator.py" --root "$ORCH_ROOT" verify --check --phase "$ORCH_PHASE" 2>/dev/null); RC=$?
  FIRST=${CHECK_OUT%%$'\n'*}
  case "$FIRST" in verify-check:*) ;; *) RC=0 ;; esac
  if [ "$RC" -eq 2 ] || [ "$RC" -eq 3 ]; then
    VTRIES_FILE="$ORCH_STATE_DIR/.stop-gate-verify-${ORCH_STAGE}-${ORCH_PHASE}.tries"
    VTRIES=$(cat "$VTRIES_FILE" 2>/dev/null || echo 0)
    VTRIES=$((VTRIES + 1))
    echo "$VTRIES" > "$VTRIES_FILE"
    if [ "$VTRIES" -gt 3 ]; then
      orch_event verify_red_at_stop "$FIRST"
    else
      orch_event gate_block "verify attempt $VTRIES: $FIRST"
      FIRST_ESCAPED=${FIRST//\\/\\\\}; FIRST_ESCAPED=${FIRST_ESCAPED//\"/\\\"}
      SCRIPT_ABS="$(cd "$DIR/.." && pwd)/orchestrator.py"
      SCRIPT_ESCAPED=${SCRIPT_ABS//\\/\\\\}; SCRIPT_ESCAPED=${SCRIPT_ESCAPED//\"/\\\"}
      cat <<JSON
{"decision":"block","reason":"verify is not current and green ($FIRST_ESCAPED). Run: python3 $SCRIPT_ESCAPED verify --phase $ORCH_PHASE  -- fix what it reports, then stop. Attempt $VTRIES of 3."}
JSON
      exit 0
    fi
  fi
fi

case "${ORCH_STAGE:-}" in
  e2e)     orch_event e2e_done "$ARTIFACT" ;;
  builder) orch_event build_done "$ARTIFACT" ;;
  *)       orch_event stage_done "$ARTIFACT" ;;
esac
exit 0
