---
name: gsd:gitnexus
description: "Query code intelligence via GitNexus -- status, query, context, impact, detect-changes, diff, build, rename, cypher"
argument-hint: "[build|query <term>|status|diff|context <symbol>|impact <target>|detect-changes|rename <old> <new>|cypher <query>]"
allowed-tools:
  - Read
  - Bash
requires: [config, fast, phase, update]
---

**STOP -- DO NOT READ THIS FILE. You are already reading it. This prompt was injected into your context by Claude Code's command system. Using the Read tool on this file wastes tokens. Begin executing Step 0 immediately.**

**CJS-only (gitnexus):** `gitnexus` subcommands are not registered on `gsd-sdk query`. Use `node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus …` as documented in this command and in `docs/CLI-TOOLS.md`. Other tooling may still use `gsd-sdk query` where a handler exists.

## Step 0 -- Banner

**Before ANY tool calls**, display this banner:

```
GSD > GITNEXUS
```

Then proceed to Step 1.

## Step 1 -- Config Gate

Check if GitNexus is enabled by reading `.planning/config.json` directly using the Read tool.

**DO NOT use the gsd-tools config get-value command** -- it hard-exits on missing keys.

1. Read `.planning/config.json` using the Read tool
2. If the file does not exist: display the disabled message below and **STOP**
3. Parse the JSON content. Check if `config.gitnexus && config.gitnexus.enabled === true`
4. If `gitnexus.enabled` is NOT explicitly `true`: display the disabled message below and **STOP**
5. If `gitnexus.enabled` is `true`: proceed to Step 2

**Disabled message:**

```
GSD > GITNEXUS

Code intelligence is disabled. To activate:

  node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs config-set gitnexus.enabled true

Then run /gsd:gitnexus build to create the initial index.
```

---

## Step 2 -- Parse Argument

Parse `$ARGUMENTS` to determine the operation mode:

| Argument | Action |
|----------|--------|
| `build` | Run inline build (Step 3) |
| `query <term>` | Run inline query (Step 4) |
| `status` | Run inline status (Step 5) |
| `diff` | Run inline diff view (Step 6) |
| `context <symbol>` | Run inline context (Step 7) |
| `impact <target>` | Run inline impact (Step 8) |
| `detect-changes` | Run inline detect-changes (Step 9) |
| `rename <old> <new>` | Run inline rename (Step 10) |
| `cypher <query>` | Run inline cypher (Step 11) |
| No argument or unknown | Show usage message |

**Usage message** (shown when no argument or unrecognized argument):

```
GSD > GITNEXUS

Usage: /gsd:gitnexus <mode>

Modes:
  build              Build or rebuild the GitNexus index
  query <term>       Search for execution flows related to a term
  status             Show index information and staleness
  diff               Show changes since last build (readable view)
  context <symbol>   360-degree view of a code symbol
  impact <target>    Blast radius analysis for a symbol
  detect-changes     Show changed symbols and affected processes
  rename <old> <new> Stub: displays MCP tool suggestion (CLI lacks rename)
  cypher <query>     Execute a raw Cypher query against the graph
```

### Step 3 -- Build (Inline)

Run the pre-flight check:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus build
```

Parse the JSON output:
- If `disabled: true`: display the disabled message from Step 1 and **STOP**
- If `reason` field present (error): display the error message and **STOP**
- If `action: "spawn_agent"`: pre-flight passed -- proceed with the inline build below

Display:

```text
GSD > Building GitNexus index...
```

Run the build in the foreground with a 600000 ms (10 minute) timeout:

```bash
npx gitnexus analyze
```

DO NOT pass `run_in_background: true` -- the operation must complete in the foreground.

If the build fails (non-zero exit code):
- Display: `## GITNEXUS BUILD FAILED` followed by the captured stderr
- Do NOT delete `.gitnexus/` -- the prior valid index remains available
- **STOP**

If the build succeeds:
- Run: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus status`
- Parse the status output and display:

```
## GITNEXUS BUILD COMPLETE

- Symbols: <symbols count>
- Edges: <edges count>
- Processes: <processes count>
- Communities: <communities count>
- Index age: <stale ? "STALE" : "FRESH">
```

**STOP** after displaying the build result. Do not spawn an agent.

### Step 4 -- Query

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus query "<term>"
```

Parse the JSON output and display:
- If the output contains `disabled: true` or `reason: 'disabled'`, display the disabled message from Step 1 and **STOP**
- If the output contains `reason` field (error), display the error message and **STOP**
- If no processes found: display `No execution flows found for '<term>'. Try /gsd:gitnexus build to update the index.` and **STOP**
- Otherwise, display processes with symbols and definitions, grouped by execution flow. Show budget truncation notice if `truncated: true`.

**STOP** after displaying results. Do not spawn an agent.

### Step 5 -- Status

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus status
```

Parse the JSON output and display:
- If `exists: false`, display the message field
- Otherwise, show symbols, edges, processes, communities counts, and STALE/FRESH indicator
- If `commit_stale: true`, display: `Index commit: <indexed_commit> (behind HEAD <current_commit>)`
- If `commit_stale: false`, display: `Index commit: <indexed_commit> (current)`
- If `commit_stale` is null, display: `Index commit: <indexed_commit> (freshness unknown)`
- If `indexed_commit` is null, omit the source-commit line entirely

**STOP** after displaying status. Do not spawn an agent.

### Step 6 -- Diff

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus detect-changes all
```

Parse the JSON output and display:
- If no changes: display `No changes detected.`
- Otherwise, render as a readable diff view:
  - Group `changed_symbols` by file
  - List `affected_processes` by name
  - Show `risk_summary` level
- This is the human-readable rendering of detect-changes data, NOT raw JSON.

**STOP** after displaying the diff view. Do not spawn an agent.

### Step 7 -- Context

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus context "<symbol>"
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display callers, callees, process participation, and file location
- Show budget truncation notice if `truncated: true`

**STOP** after displaying results. Do not spawn an agent.

### Step 8 -- Impact

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus impact "<target>" --direction upstream
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display risk level (LOW/MEDIUM/HIGH/CRITICAL), summary, affected processes/modules, and depth analysis
- Show budget truncation notice if `truncated: true`

**STOP** after displaying results. Do not spawn an agent.

### Step 9 -- Detect-Changes

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus detect-changes --scope unstaged
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display changed symbols and affected processes as raw JSON (unlike diff mode which renders human-readable)

**STOP** after displaying results. Do not spawn an agent.

### Step 10 -- Rename

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus rename "<old>" "<new>"
```

The CJS function returns a structured error because the `gitnexus rename` CLI subcommand does not exist (RESEARCH A7). This mode is a stub in Phase 1.

Display the error message explaining that rename is available via the `gitnexus_rename` MCP tool directly, and suggest using that instead. Full rename functionality (MCP tool invocation) is deferred to Phase 2 SDK integration.

**STOP** after displaying the message. Do not spawn an agent.

### Step 11 -- Cypher

Run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus cypher "<query>"
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display markdown table results and row_count
- Show budget truncation notice if `truncated: true`

**STOP** after displaying results. Do not spawn an agent.

---

## Multi-Repo Handling

If the GitNexus CLI returns "Multiple repositories indexed", the CJS module automatically retries with the `--repo` flag using the project directory basename. The skill command does not need to handle this; it's transparent.

---

## Anti-Patterns

1. DO NOT spawn an agent for any operation -- build, query, status, diff, context, impact, detect-changes, rename, and cypher all run inline via Bash tool. Sub-agent isolation terminates background bash when the agent exits.
2. DO NOT pass `run_in_background: true` for the build -- the operation must complete in the foreground.
3. DO NOT modify graph files directly -- always go through gitnexus CLI.
4. DO NOT skip the config gate check.
5. DO NOT use `gsd-tools config get-value` for the config gate -- it exits on missing keys.