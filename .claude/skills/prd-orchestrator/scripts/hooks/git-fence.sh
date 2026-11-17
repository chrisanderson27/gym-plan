#!/bin/bash
# H3 — the git fence. What makes `autonomy: autonomous` structurally safe.
#
# "The builder must not commit" used to be a sentence in a prompt, and prompts are
# advice. This is enforcement: the orchestrator owns commit (reference/contract.md).
#
# Bypass mode does NOT bypass hooks — verified: PreToolUse exit 2 blocks a Bash
# call at permission_mode: bypassPermissions. That is exactly what makes this work.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/_common.sh"
orch_heartbeat git-fence

CMD="$(cat)"          # PreToolUse payload on stdin
case "$CMD" in
  *'"command"'*) : ;;
  *) exit 0 ;;
esac

# Deliberately substring-based on the raw payload: cheap, and a worker has no
# legitimate reason to name any of these at all.
BLOCKED=""
GIT="(^|[^[:alnum:]_.-])git(\\\\?[\"'])?"
PLAIN="${GIT}[[:space:]]+(commit|push|rebase)"
case "$CMD" in
  *"git commit"*)      if [[ $CMD =~ $PLAIN ]]; then BLOCKED="git commit"; fi ;;
  *"git push"*)        if [[ $CMD =~ $PLAIN ]]; then BLOCKED="git push"; fi ;;
  *"reset --hard"*)    BLOCKED="git reset --hard" ;;
  *"git rebase"*)      if [[ $CMD =~ $PLAIN ]]; then BLOCKED="git rebase"; fi ;;
  *"clean -fd"*)       BLOCKED="git clean -fd" ;;
  # Force-adding is how an ignored PRD/plan/testing doc gets staged past info/exclude.
  *"add -f"*)          BLOCKED="git add -f" ;;
  *"add --force"*)     BLOCKED="git add --force" ;;
esac

# Global-option arguments containing quoted spaces are deliberately not tokenised.
GOPT='([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+|[[:space:]]+--(git-dir|work-tree|namespace|exec-path|super-prefix)(=[^[:space:]]+|[[:space:]]+[^[:space:]]+)|[[:space:]]+--(no-pager|paginate|bare|literal-pathspecs|no-replace-objects)|[[:space:]]+-[pP])'
PRE="${GIT}(${GOPT})*[[:space:]]+"
if [ -z "$BLOCKED" ]; then
  RE="${PRE}(commit|push|rebase)([[:space:]]|\\\\|\\\"|$)"
  if [[ $CMD =~ $RE ]]; then BLOCKED="git history rewrite"; fi
  RE="${PRE}reset[[:space:]]+([^;&|]*[[:space:]])?--hard"
  if [[ $CMD =~ $RE ]]; then BLOCKED="git reset --hard"; fi
  RE="${PRE}clean[[:space:]]+-[a-z]*f"
  if [[ $CMD =~ $RE ]]; then BLOCKED="git clean -f"; fi
  RE="${PRE}add([[:space:]]+[^[:space:];&|]+)*[[:space:]]+(-[a-zA-Z]*A[a-zA-Z]*|--all|:/|\\*|\\.)([[:space:];&|]|\\\\|\\\"|$)"
  if [[ $CMD =~ $RE ]]; then BLOCKED="git add -A/./--all"; fi
  # -u/--update are blanket staging only when no explicit path follows.
  RE="${PRE}add[[:space:]]+(-u|--update)([[:space:]]+--)?[[:space:]]*(;|&|[|]|\\\\|\\\"|$)"
  if [[ $CMD =~ $RE ]]; then BLOCKED="git add --update (all tracked files)"; fi
  RE="${PRE}add([[:space:]]+[^[:space:];&|]+)*[[:space:]]+(-[a-zA-Z]*f[a-zA-Z]*|--force)([[:space:];&|]|\\\\|\\\"|$)"
  if [[ $CMD =~ $RE ]]; then BLOCKED="git add -f"; fi
fi
if [[ ${ORCH_STAGE:-} = builder || ${ORCH_STAGE:-} = fix ]] && [ -n "${ORCH_APP_START:-}" ]; then
  START=${ORCH_APP_START//\\/\\\\}; START=${START//\"/\\\"}
  LAST=${START##*&&}; LAST="${LAST#"${LAST%%[![:space:]]*}"}"; LAST="${LAST%"${LAST##*[![:space:]]}"}"
  RE='app-run\.sh[[:space:]]+(kill|start-cmd)'
  if [[ $CMD = *"$START"* || ( -n "$LAST" && $CMD = *"$LAST"* ) || $CMD =~ $RE ]]; then
    BLOCKED="the app start command (the orchestrator owns app lifecycle)"
  fi
fi

[ -n "$BLOCKED" ] || exit 0

orch_event git_fence "denied: $BLOCKED"
# exit 2 = block, and stderr is shown to the model. exit 1 would be a silent no-op.
printf '%s is not available to you. The orchestrator owns commit, push and history rewriting (see reference/contract.md). Finish your work in the working tree and write your artifact; the orchestrator will commit it.\n' "$BLOCKED" >&2
exit 2
