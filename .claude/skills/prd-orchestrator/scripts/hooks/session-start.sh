#!/bin/bash
# H4 — worker session → stage link. Emits `worker_session` with the Claude session_id so
# the Workbench telemetry harvester can attribute this transcript to its (phase, stage)
# exactly, instead of inferring it from timestamps.
#
# SessionStart stdout is INJECTED INTO THE WORKER'S CONTEXT — this hook must print nothing.
# It never blocks: every path exits 0.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/_common.sh"
orch_heartbeat session-start

PAYLOAD="$(cat)"      # SessionStart payload on stdin: session_id, source, cwd, …
re='"session_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9._-]+)"'
[[ $PAYLOAD =~ $re ]] || exit 0
SID="${BASH_REMATCH[1]}"
SRC=""
re='"source"[[:space:]]*:[[:space:]]*"([a-z]+)"'
[[ $PAYLOAD =~ $re ]] && SRC="${BASH_REMATCH[1]}"

# The tab's own stage (fix, coupling, figma…) beats the routing stage the settings file was
# generated for (builder, reviewer, e2e) — §12 pairs worker_session with worker_start on it.
ORCH_STAGE="${ORCH_TAB_STAGE:-${ORCH_STAGE:-?}}"
orch_event worker_session "$SRC" "\"session_id\":\"$SID\""
exit 0
