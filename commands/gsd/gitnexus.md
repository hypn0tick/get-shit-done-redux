---
name: gsd:gitnexus
description: "Query code intelligence via GitNexus -- status, query, context, impact, detect-changes, build, rename, cypher"
argument-hint: "[build|query <term>|status|context <symbol>|impact <target>|detect-changes|rename <old> <new>|cypher <query>]"
allowed-tools:
  - Read
  - Bash
requires: [config, fast, phase, update]
---

**STOP -- DO NOT READ THIS FILE. You are already reading it. This prompt was injected into your context by Claude Code's command system. Using the Read tool on this file wastes tokens. Begin executing Step 0 immediately.**

**CJS-only (gitnexus):** `gitnexus` subcommands are not registered on `gsd-sdk query`. Use `node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus …` as documented in this command. Other tooling may still use `gsd-sdk query` where a handler exists.

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
| `build` | Run inline build (Step 2a) |
| `query <term>` | Run inline query (Step 2b) |
| `status` | Run inline status check (Step 2c) |
| `context <symbol>` | Run inline context lookup (Step 2d) |
| `impact <target>` | Run inline impact analysis (Step 2e) |
| `detect-changes` | Run inline detect-changes (Step 2f) |
| `rename <old> <new>` | Run inline rename preview (Step 2g) |
| `cypher <query>` | Run inline Cypher query (Step 2h) |
| No argument or unknown | Show usage message |

**Usage message** (shown when no argument or unrecognized argument):

```
GSD > GITNEXUS

Usage: /gsd:gitnexus <mode>

Modes:
  build                Run pre-flight check for GitNexus build
  query <term>         Search the knowledge graph for a term
  status               Show index freshness and statistics
  context <symbol>     Show 360-degree context for a symbol
  impact <target>      Show blast radius and risk for a target
  detect-changes       Show changed symbols and affected processes
  rename <old> <new>   Preview rename edits for a symbol
  cypher <query>       Run a Cypher query against the knowledge graph
```

### Step 2a -- Build

Run the pre-flight check:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" gitnexus build
```

Parse the JSON output:
- If `disabled: true`: display the disabled message from Step 1 and **STOP**
- If `exists: false` or `reason: 'no_index'`: display instructions to build the index
- If `exists: true`: display index information and suggest running `gitnexus analyze` if stale

**STOP** after displaying results. Do not spawn an agent.

### Step 2b -- Query

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus query <term>
```

Parse the JSON output and display:
- If the output contains `disabled: true` or `reason: 'disabled'`, display the disabled message from Step 1 and **STOP**
- If the output contains `reason` field (error), display the error message and **STOP**
- Otherwise, display process-grouped results with nodes, edges, and total counts

**STOP** after displaying results. Do not spawn an agent.

### Step 2c -- Status

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus status
```

Parse the JSON output and display:
- If `exists: false`, display the message field
- Otherwise show symbols, edges, processes, communities counts, and STALE/FRESH indicator
- If `commit_stale: true`, display: `Index commit: <indexed_commit> (behind HEAD <current_commit>)`
- If `commit_stale: false`, display: `Index commit: <indexed_commit> (current)`

**STOP** after displaying status. Do not spawn an agent.

### Step 2d -- Context

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus context <symbol>
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display callers, callees, process participation, and file location

**STOP** after displaying results. Do not spawn an agent.

### Step 2e -- Impact

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus impact <target> <direction>
```

Where `<direction>` is `upstream` (default) or `downstream`.

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display risk level, summary, affected processes/modules, and depth analysis

**STOP** after displaying results. Do not spawn an agent.

### Step 2f -- Detect Changes

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus detect-changes
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display changed symbols and affected processes

**STOP** after displaying results. Do not spawn an agent.

### Step 2g -- Rename

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus rename <old> <new>
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display graph-backed high-confidence edits and text-search lower-confidence edits with confidence levels

**STOP** after displaying results. Do not spawn an agent.

### Step 2h -- Cypher

Run:

```bash
node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs gitnexus cypher <query>
```

Parse the JSON output and display:
- If error, display the error message and **STOP**
- Otherwise, display structured query results

**STOP** after displaying results. Do not spawn an agent.

---

## Anti-Patterns

1. DO NOT spawn an agent for any operation -- status, query, context, impact, detect-changes, build, rename, and cypher all run inline. Sub-agent isolation terminates background bash when the agent exits.
2. DO NOT pass `run_in_background: true` for any gitnexus operation -- all operations run in the foreground.
3. DO NOT skip the config gate check.
4. DO NOT use `gsd-tools config get-value` for the config gate -- it exits on missing keys.