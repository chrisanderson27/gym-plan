#!/bin/bash
# App lifecycle primitive for the e2e gate. Generic: every fact comes from
# [app] in <root>/.claude/orchestrator.toml. Nothing about any one stack lives here.
#
#   app-run.sh kill                  free the app's port, reap its process tree (idempotent)
#   app-run.sh wait-ready [timeout]  poll until the ready-probe matches, then warm up [app].warmup_url
#                                    if set; exit 1 on timeout (or a required warm-up that never renders)
#   app-run.sh start-cmd             print the configured start command (for `herdr pane run`)
#
# The ORCHESTRATOR owns this lifecycle. A builder or e2e worker must never call it
# (see reference/contract.md).
set -uo pipefail

ROOT="${ORCH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CFG="$ROOT/.claude/orchestrator.toml"

# Read one key ([app] unless a section is given) without a TOML parser dependency in the hot path.
cfg() {
  python3 - "$CFG" "$1" "${2:-app}" <<'PY' 2>/dev/null
import sys
try:
    import tomllib
    with open(sys.argv[1], "rb") as f:
        print(tomllib.load(f).get(sys.argv[3], {}).get(sys.argv[2], "") or "")
except Exception:
    print("")
PY
}

APP_URL="$(cfg url)"
START_CMD="$(cfg start)"
PROBE="$(cfg ready_probe)"
TIMEOUT_CFG="$(cfg timeout_s)"
WARMUP_URL="$(cfg warmup_url)"
WARMUP_TIMEOUT="$(cfg warmup_timeout_s)"
WARMUP_REQUIRED="$(cfg warmup_required)"
SESSION_PREFIX="$(cfg session_prefix e2e)"

# macOS daemons that also bind app ports (the AirPlay Receiver holds *:5000). Never ours to kill.
SYSTEM_PROCS='^(ControlCenter|ControlCe|AirPlayXPCHelper|rapportd)$'

case "$APP_URL" in
  TODO*|*"TODO"*)
    echo "app-run: [app].url is still a TODO in $CFG — run the \`orchestrator-setup\` skill." >&2
    exit 3 ;;
esac

if [ -z "$APP_URL" ]; then
  echo "app-run: no [app].url in $CFG — this repo declares no runnable app." >&2
  echo "app-run: the e2e gate should record N/A for every phase." >&2
  exit 3
fi

PORT="$(printf '%s' "$APP_URL" | sed -nE 's#.*:([0-9]+).*#\1#p')"
[ -n "$PORT" ] || PORT=80

# The port's PIDs minus macOS system processes; sets OURS and SYSTEM (their names).
port_pids() {
  OURS=""; SYSTEM=""
  local pid name
  for pid in $(lsof -ti "tcp:$PORT" 2>/dev/null); do
    name="$(ps -o comm= -p "$pid" 2>/dev/null)"; name="${name##*/}"
    if printf '%s' "$name" | grep -Eq "$SYSTEM_PROCS"; then
      case " $SYSTEM " in *" $name "*) ;; *) SYSTEM="${SYSTEM:+$SYSTEM }$name" ;; esac
    else
      OURS="${OURS:+$OURS }$pid"
    fi
  done
}

# Run a command, killing it after $1 seconds (agent-browser can hang; macOS has no `timeout`).
bounded() {
  local secs="$1" pid guard rc; shift
  "$@" & pid=$!
  # The guard must not hold the caller's stdout, or a `bounded … | grep` waits out its sleep.
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) >/dev/null 2>&1 & guard=$!
  wait "$pid"; rc=$?
  kill "$guard" 2>/dev/null; wait "$guard" 2>/dev/null
  return $rc
}

# Optional first-page warm-up after the probe passes. A dev server (Vite) can answer the probe
# long before the first page renders — it transforms every module on the first request — so a
# test's first load would sit on a blank page. Exit 1 only if [app].warmup_required is true.
warmup() {
  [ -n "$WARMUP_URL" ] || return 0
  local url="${APP_URL%/}/${WARMUP_URL#/}" limit="${WARMUP_TIMEOUT:-120}" began rendered=1 how
  began=$(date +%s)
  if command -v agent-browser >/dev/null 2>&1; then
    how="browser"
    local s="${SESSION_PREFIX:-app}-warmup"
    bounded 90 agent-browser --session "$s" open "$url" >/dev/null 2>&1
    while [ $(( $(date +%s) - began )) -lt "$limit" ]; do
      if bounded 30 agent-browser --session "$s" snapshot -i 2>/dev/null | grep -q '\[ref='; then
        rendered=0; break
      fi
      sleep 2
    done
    bounded 30 agent-browser --session "$s" close >/dev/null 2>&1
  else
    # Best effort without a browser: request the page and the modules it loads, so the dev
    # server has transformed them before the first real load. Cannot prove a render.
    how="curl"
    local html src
    if html="$(curl -sS -L --max-time "$limit" "$url" 2>/dev/null)"; then
      rendered=0
      for src in /@vite/client $(printf '%s' "$html" | sed -nE 's#.*<script[^>]*type="module"[^>]*src="(/[^"]+)".*#\1#p'); do
        curl -sS -o /dev/null --max-time "$limit" "${APP_URL%/}$src" 2>/dev/null
      done
    fi
  fi
  if [ "$rendered" -eq 0 ]; then
    if [ "$how" = "browser" ]; then
      echo "app-run: warm-up rendered $url after $(( $(date +%s) - began ))s"
    else
      echo "app-run: warm-up fetched $url and its modules after $(( $(date +%s) - began ))s" \
        "(no agent-browser — render not checked)"
    fi
    return 0
  fi
  echo "app-run: warm-up ($how) — $url did not render within ${limit}s" >&2
  case "$WARMUP_REQUIRED" in
    [Tt]rue|1|yes) return 1 ;;
  esac
  return 0
}

case "${1:-}" in
  start-cmd)
    [ -n "$START_CMD" ] || { echo "app-run: no [app].start configured" >&2; exit 3; }
    printf '%s\n' "$START_CMD"
    ;;

  kill)
    # Destructive by design: a hands-off run must own the port. The orchestrator
    # announces this first, because it also kills a human's dev instance.
    port_pids
    if [ -n "$OURS" ]; then
      # shellcheck disable=SC2086
      kill $OURS 2>/dev/null
      sleep 2
      port_pids
      # shellcheck disable=SC2086
      [ -n "$OURS" ] && kill -9 $OURS 2>/dev/null
      echo "app-run: freed port $PORT"
    else
      echo "app-run: port $PORT already free"
    fi
    [ -n "$SYSTEM" ] && echo "app-run: port $PORT also held by macOS AirPlay ($SYSTEM) — left alone"
    exit 0
    ;;

  wait-ready)
    TIMEOUT="${2:-${TIMEOUT_CFG:-300}}"
    # A 200 is NOT proof the app is up — another process may hold the port
    # (on macOS the AirPlay Receiver binds *:5000). That is why ready_probe
    # matches something only THIS app emits.
    KIND="${PROBE%%:*}"; VALUE="${PROBE#*:}"
    START=$(date +%s)
    ready() { echo "app-run: ready ($1) after $(( $(date +%s) - START ))s"; warmup; exit $?; }
    while :; do
      case "$KIND" in
        path)
          # 2xx on an app-authored path (e.g. /health) — the cleanest readiness
          # signal there is: a bare port response can come from anything, but a
          # health endpoint returning 200 is the app saying it is actually up.
          code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "${APP_URL%/}${VALUE}" 2>/dev/null)
          if [ "${code:-0}" -ge 200 ] && [ "${code:-0}" -lt 300 ]; then
            ready "${VALUE} -> ${code}"
          fi ;;
        cmd)
          # Arbitrary command; exit 0 = ready. The ultimate escape hatch for an app
          # whose readiness cannot be expressed as a header/path.
          if sh -c "$VALUE" >/dev/null 2>&1; then
            ready "cmd"
          fi ;;
        header)
          if curl -sS -I --max-time 5 "$APP_URL" 2>/dev/null | grep -qi "^${VALUE%%=*}:.*${VALUE#*=}"; then
            ready "header ${VALUE}"
          fi ;;
        text)
          if curl -sS --max-time 5 "$APP_URL" 2>/dev/null | grep -qF "$VALUE"; then
            ready "text match"
          fi ;;
        *)
          # No probe configured: fall back to "any response", and say so —
          # this is weaker than it looks.
          if curl -sS -o /dev/null --max-time 5 "$APP_URL" 2>/dev/null; then
            echo "app-run: responding after $(( $(date +%s) - START ))s"
            echo "app-run: WARNING no [app].ready_probe — 'responding' is not proof this is your app" >&2
            warmup; exit $?
          fi ;;
      esac
      if [ $(( $(date +%s) - START )) -ge "$TIMEOUT" ]; then
        echo "app-run: TIMEOUT after ${TIMEOUT}s waiting for $APP_URL" >&2
        echo "app-run: read the app pane for the startup error — this is a typed failure," >&2
        echo "app-run: not an infra stall. A phase that will not boot is not shippable." >&2
        exit 1
      fi
      sleep 3
    done
    ;;

  *)
    echo "usage: app-run.sh kill | wait-ready [timeout] | start-cmd" >&2
    exit 2
    ;;
esac
