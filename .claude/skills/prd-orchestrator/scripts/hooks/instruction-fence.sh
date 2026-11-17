#!/bin/bash
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/_common.sh"
orch_heartbeat instruction-fence
CMD="$(cat)"
# Resolve lexical aliases and symlinks, including paths not created yet. Python
# also decodes JSON escapes; any parser/runtime error leaves the hook open.
REL="$(python3 -c '
import json, os, sys
from pathlib import Path
try:
    data = json.load(sys.stdin)
    root = Path(os.environ.get("ORCH_ROOT") or Path.cwd()).resolve()
    cwd = Path(data.get("cwd") or root)
    raw = data.get("tool_input", data).get("file_path")
    if not raw:
        sys.exit(0)
    def normal(path, base=cwd):
        return os.path.relpath((base / path).resolve(), root).casefold()
    rel = normal(raw)
    configured = {normal(path, root) for path in os.environ.get("ORCH_INSTRUCTION_FILES", "").split(":") if path}
    if (Path(rel).name in ("agents.md", "claude.md")
            or rel.startswith(".claude/standards/") or rel in configured):
        print(rel)
except Exception:
    pass
' <<< "$CMD")" || exit 0
BLOCKED="$REL"
[ -n "$BLOCKED" ] || exit 0
orch_event instruction_fence "denied: $REL"
printf '%s\n' "instruction files are Chris's to change; propose the diff in your summary instead" >&2
exit 2
