#!/bin/bash
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/_common.sh"
orch_heartbeat subagent-fence
PAYLOAD="$(cat)"
case "${ORCH_STAGE:-}" in builder|fix) ;; *) exit 0 ;; esac
RE='"tool_name"[[:space:]]*:[[:space:]]*"([^"]*)"'
[[ "$PAYLOAD" =~ $RE ]] || exit 0
TOOL="${BASH_REMATCH[1]}"
case "$TOOL" in Agent|Task) ;; *) exit 0 ;; esac
orch_event subagent_denied "denied: $TOOL"
printf '%s\n' "the builder and fix stages use no subagents (contract.md § Subagent policy); the plan carries the reading list — read those files directly" >&2
exit 2
