#!/usr/bin/env bash
# gsd-hook-version: {{GSD_VERSION}}
# gsd-gitnexus-update.sh - PostToolUse hook that auto-rebuilds the GitNexus
# index after configured commit or GitNexus MCP tool events.
#
# Returns 0 in all cases. Failed gates are silent no-ops.

set -uo pipefail

INPUT=$(cat 2>/dev/null || true)
[ -n "$INPUT" ] || exit 0

TOOL_INFO=$(printf '%s' "$INPUT" | node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(d);
    const failed = Boolean(
      p.error ||
      p.tool_response?.is_error === true ||
      p.tool_response?.error
    );
    process.stdout.write([
      p.tool_name || "",
      p.tool_input?.command || "",
      failed ? "1" : "0"
    ].join("\n"));
  } catch {
    process.stdout.write("\n\n0");
  }
});
' 2>/dev/null || printf '\n\n0')

TOOL_NAME=$(printf '%s\n' "$TOOL_INFO" | sed -n '1p')
COMMAND=$(printf '%s\n' "$TOOL_INFO" | sed -n '2p')
MCP_FAILED=$(printf '%s\n' "$TOOL_INFO" | sed -n '3p')

[ -n "$TOOL_NAME" ] || exit 0

TRIGGER_KIND=""
case "$TOOL_NAME" in
  Bash)
    TRIGGER_KIND=$(GSD_COMMAND="$COMMAND" node -e '
const command = String(process.env.GSD_COMMAND || "").trim();
const tokens = command.match(/"[^"]*"|'\''[^'\'']*'\''|\S+/g) || [];
const clean = (value) => String(value || "").replace(/^["'\'']|["'\'']$/g, "");
if (tokens[0] === "git") {
  const op = tokens[1] || "";
  const args = tokens.slice(2).map(clean);
  if (args.includes("--help") || args.includes("-h") || args.includes("--dry-run")) process.exit(0);
  if (["commit", "merge", "pull", "cherry-pick"].includes(op)) process.stdout.write("commit");
  else if (op === "rebase" && args.includes("--continue")) process.stdout.write("commit");
} else {
  const offset = tokens[0] === "npx" ? 1 : 0;
  if (tokens[offset] === "gsd-sdk" && tokens[offset + 1] === "query" && tokens[offset + 2] === "commit") {
    process.stdout.write("commit");
  }
}
' 2>/dev/null || true)
    [ "$TRIGGER_KIND" = "commit" ] || exit 0
    ;;
  mcp__gitnexus__query) TRIGGER_KIND="mcp_query" ;;
  mcp__gitnexus__context) TRIGGER_KIND="mcp_context" ;;
  mcp__gitnexus__impact) TRIGGER_KIND="mcp_impact" ;;
  mcp__gitnexus__detect_changes) TRIGGER_KIND="mcp_detect_changes" ;;
  *) exit 0 ;;
esac

if [ "$TRIGGER_KIND" != "commit" ] && [ "$MCP_FAILED" = "1" ]; then
  exit 0
fi

[ -z "${CI:-}" ] || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

[ -f .planning/config.json ] || exit 0
CONFIG_INFO=$(node -e '
try {
  const c = require("./.planning/config.json");
  const gates = c.gitnexus?.enabled === true && c.gitnexus?.auto_update === true;
  const allowed = new Set(["commit", "mcp_query", "mcp_context", "mcp_impact", "mcp_detect_changes"]);
  const raw = c.gitnexus?.auto_update_triggers;
  const triggers = Array.isArray(raw) ? raw.filter(v => allowed.has(v)) : ["commit"];
  process.stdout.write([
    gates ? "1" : "0",
    c.git?.base_branch || "",
    triggers.join(",")
  ].join("\n"));
} catch {
  process.stdout.write("0\n\n");
}
' 2>/dev/null || printf '0\n\n')

GATES=$(printf '%s\n' "$CONFIG_INFO" | sed -n '1p')
DEFAULT_BRANCH=$(printf '%s\n' "$CONFIG_INFO" | sed -n '2p')
TRIGGERS_CSV=$(printf '%s\n' "$CONFIG_INFO" | sed -n '3p')

[ "$GATES" = "1" ] || exit 0

case ",$TRIGGERS_CSV," in
  *",$TRIGGER_KIND,"*) ;;
  *) exit 0 ;;
esac

if [ "$TRIGGER_KIND" = "commit" ]; then
  if [ -z "$DEFAULT_BRANCH" ]; then
    for cand in main master trunk; do
      if git rev-parse --verify "$cand" >/dev/null 2>&1; then
        DEFAULT_BRANCH="$cand"
        break
      fi
    done
  fi
  [ -n "$DEFAULT_BRANCH" ] || exit 0

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ] || exit 0
fi

GITNEXUS_BIN=$(command -v gitnexus 2>/dev/null || true)
[ -n "$GITNEXUS_BIN" ] || exit 0

mkdir -p .gitnexus
LOCK_FILE=".gitnexus/.rebuild.lock"
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    exit 0
  fi
  LOCK_AGE_MS=$(GSD_LOCK_FILE="$LOCK_FILE" node -e '
try {
  const fs = require("node:fs");
  const age = Date.now() - fs.statSync(process.env.GSD_LOCK_FILE).mtimeMs;
  process.stdout.write(String(Math.max(0, Math.floor(age))));
} catch {
  process.stdout.write("999999");
}
' 2>/dev/null || echo "999999")
  case "$LOCK_AGE_MS" in
    ''|*[!0-9]*) LOCK_AGE_MS=999999 ;;
  esac
  if [ "$LOCK_AGE_MS" -lt 30000 ]; then
    exit 0
  fi
  rm -f "$LOCK_FILE" 2>/dev/null || true
fi

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
REBUILD_SCRIPT="$HOOK_DIR/lib/gsd-gitnexus-rebuild.sh"
[ -f "$REBUILD_SCRIPT" ] || exit 0

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
STATUS_FILE=".gitnexus/.last-build-status.json"
TS_START=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
MS_START=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null || echo "0")

GSD_TS="$TS_START" \
GSD_HEAD="$HEAD_SHA" \
GSD_STATUS_FILE="$STATUS_FILE" \
node -e '
  const fs = require("node:fs");
  const status = {
    ts: process.env.GSD_TS,
    status: "running",
    exit_code: null,
    duration_ms: null,
    head_at_build: process.env.GSD_HEAD,
  };
  fs.writeFileSync(process.env.GSD_STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
' 2>/dev/null || true

bash "$REBUILD_SCRIPT" \
  "$STATUS_FILE" \
  "$LOCK_FILE" \
  "$HEAD_SHA" \
  "$MS_START" \
  </dev/null >/dev/null 2>&1 &
REBUILD_PID=$!
echo "$REBUILD_PID" > "$LOCK_FILE"
disown "$REBUILD_PID" 2>/dev/null || true

exit 0
