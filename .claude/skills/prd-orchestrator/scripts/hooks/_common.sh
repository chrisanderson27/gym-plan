#!/bin/bash
# Shared prelude for every orchestrator worker hook. Sourced, never run directly.
#
# HARD RULES (each one is a verified footgun):
#   - `exit 1` does NOTHING. Only exit 2, or a decision object on stdout, blocks.
#   - A bad path is a silent no-op (exit 127 -> non-blocking). So the FIRST thing
#     every hook does is touch the heartbeat: the orchestrator asserts it exists
#     after the first worker settles, which is how you learn the gate is live.
#   - A timed-out hook discards its output. Stay under ~200ms: pure bash, no
#     interpreter start-up in the hot path.
#   - Hooks run in a different process than the pane you are reading, so every
#     hook writes to events.jsonl or it is invisible in the post-mortem.

# Refuse to act unless this is genuinely an orchestrator worker. Protects the day
# someone copies this JSON into project settings.
[ -n "${ORCH_STATE_DIR:-}" ] || exit 0
[ -d "$ORCH_STATE_DIR" ] || exit 0

orch_heartbeat() {
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "${1:-hook}" "${ORCH_STAGE:-?}/${ORCH_PHASE:-?}" \
    >> "$ORCH_STATE_DIR/hook-heartbeat.log" 2>/dev/null
}

# Append one event. Hand-rolled JSON: spawning python here would blow the budget.
# $3 (optional) = extra JSON members, pre-escaped, no leading comma: '"session_id":"abc"'.
# Timestamps are UTC with a Z suffix, the same as _emit() in orchestrator.py.
orch_event() {
  local ev="$1" detail="${2:-}" extra="${3:-}"
  detail=${detail//\\/\\\\}; detail=${detail//\"/\\\"}; detail=${detail//$'\n'/ }
  printf '{"ts":"%s","event":"%s","phase":%s,"stage":"%s","source":"hook","detail":"%s"%s}\n' \
    "$(date -u +%FT%TZ)" "$ev" "${ORCH_PHASE:-null}" "${ORCH_STAGE:-?}" "$detail" "${extra:+,$extra}" \
    >> "$ORCH_STATE_DIR/events.jsonl" 2>/dev/null
}
