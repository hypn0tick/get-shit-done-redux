'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execTool, execGit } = require('./shell-command-projection.cjs');

// ─── Reason Enum (CJS-01, WSL-04) ──────────────────────────────────────────

const GITNEXUS_REASON = Object.freeze({
  OK: 'ok',
  DISABLED: 'disabled',
  ENOENT: 'gitnexus_not_found',
  TIMEOUT: 'gitnexus_timed_out',
  CLI_ERROR: 'gitnexus_cli_error',
  WSL_NOT_AVAILABLE: 'wsl_not_available',
  WSL_COMMAND_FAILED: 'wsl_command_failed',
  WSL_DISTRO_MISSING: 'wsl_distro_missing',
  NO_INDEX: 'no_index',
});

// ─── Config Gate (CONF-01, CJS-03, D-02) ───────────────────────────────────

/**
 * Check whether GitNexus is enabled in the project config.
 * Reads config.json directly via fs. Returns false by default
 * (when no config, no gitnexus key, or on error).
 * Mirrors isGraphifyEnabled() pattern exactly.
 *
 * @param {string} planningDir - Path to .planning directory
 * @returns {boolean}
 */
function isGitNexusEnabled(planningDir) {
  try {
    const configPath = path.join(planningDir, 'config.json');
    if (!fs.existsSync(configPath)) return false;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config && config.gitnexus && config.gitnexus.enabled === true) return true;
    return false;
  } catch (_e) {
    return false;
  }
}

/**
 * Return the standard disabled response object.
 * @returns {{ disabled: true, reason: string, message: string }}
 */
function disabledResponse() {
  return {
    disabled: true,
    reason: GITNEXUS_REASON.DISABLED,
    message: 'GitNexus is not enabled. Enable with: gsd-tools config-set gitnexus.enabled true',
  };
}

// ─── Config Reader ──────────────────────────────────────────────────────────

/**
 * Read the gitnexus section from .planning/config.json.
 * Returns empty object on missing file, malformed JSON, or missing gitnexus key.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory (contains .planning/)
 * @returns {object}
 */
function readGitNexusConfig(cwd) {
  try {
    const configPath = path.join(cwd, '.planning', 'config.json');
    if (!fs.existsSync(configPath)) return {};
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config && config.gitnexus && typeof config.gitnexus === 'object') {
      return config.gitnexus;
    }
    return {};
  } catch (_e) {
    return {};
  }
}

// ─── WSL Helpers (WSL-02, WSL-03, D-12) ────────────────────────────────────

/**
 * Translate a Windows path to a WSL mount path.
 * C:\Projects\X -> /mnt/c/Projects/X
 * Untranslatable paths pass through unchanged (WSL-03).
 *
 * @param {string} windowsPath - Windows path to translate
 * @returns {string} WSL-compatible path
 */
function windowsToWslPath(windowsPath) {
  if (typeof windowsPath !== 'string') return windowsPath;
  const match = windowsPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return windowsPath;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

/**
 * Resolve whether WSL should be used for GitNexus invocation.
 * - use_wsl: true -> always use WSL
 * - use_wsl: false -> never use WSL
 * - use_wsl: "auto" (default) -> use WSL on win32 if available
 *
 * @param {object} config - gitnexus config object
 * @param {string} [platform] - Override for process.platform (for testing)
 * @returns {boolean}
 */
function resolveWslSetting(config, platform) {
  const plat = platform || process.platform;
  const useWsl = config && config.use_wsl;

  if (useWsl === true) return true;
  if (useWsl === false) return false;

  // Default "auto" behavior: use WSL on Windows if available
  if (plat === 'win32') {
    try {
      const result = execTool('wsl', ['--list', '--quiet'], { timeout: 5000 });
      // If wsl command succeeds (exit code 0), WSL is available
      if (result.exitCode === 0 && !result.error) {
        return true;
      }
      return false;
    } catch (_e) {
      return false;
    }
  }

  // On non-Windows, no WSL needed
  return false;
}

// ─── Output Parsing (D-13, RESEARCH Pitfall 2) ─────────────────────────────

/**
 * Parse GitNexus CLI stdout/stderr, handling mixed pino+JSON output.
 * Tries full stdout JSON.parse first. If that fails, scans lines
 * from bottom up for the last valid JSON line (skipping pino log lines
 * that have level+time but not result fields). Falls back to stderr
 * parsing.
 *
 * @param {string} stdout - Raw stdout from gitnexus CLI
 * @param {string} stderr - Raw stderr from gitnexus CLI
 * @returns {{ ok: boolean, data: object }}
 */
function _isPinoLogLine(parsed) {
  // Pino log lines have "level" and "time" but not result data fields.
  // Skip them so we find the actual response JSON.
  return typeof parsed === 'object' && parsed !== null &&
    'level' in parsed && 'time' in parsed &&
    !('processes' in parsed) && !('error' in parsed) &&
    !('symbols' in parsed) && !('query' in parsed) &&
    !('name' in parsed) && !('result' in parsed) &&
    !('exists' in parsed) && !('nodes' in parsed);
}

function parseGitNexusOutput(stdout, stderr) {
  // Try full stdout first
  if (stdout && stdout.trim()) {
    try {
      const parsed = JSON.parse(stdout.trim());
      // Skip if the entire stdout is just a pino log line
      if (_isPinoLogLine(parsed)) {
        // Fall through to stderr or empty response
      } else {
        return { ok: true, data: parsed };
      }
    } catch (_e) {
      // stdout has mixed content; scan line by line
    }

    // Split by newlines, try each line from bottom up
    const lines = stdout.split('\n').filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (_isPinoLogLine(parsed)) {
          continue;
        }
        return { ok: true, data: parsed };
      } catch (_e) {
        continue;
      }
    }
  }

  // No valid JSON found in stdout; check stderr
  if (stderr && stderr.trim()) {
    try {
      const parsed = JSON.parse(stderr.trim());
      return { ok: false, data: parsed };
    } catch (_e) {
      return {
        ok: false,
        data: { reason: GITNEXUS_REASON.CLI_ERROR, message: stderr.trim() },
      };
    }
  }

  return {
    ok: false,
    data: { reason: GITNEXUS_REASON.CLI_ERROR, message: 'No valid JSON output from gitnexus' },
  };
}

// ─── Subprocess Invocation (D-11, D-12, D-14, WSL-01) ─────────────────────

/**
 * Execute gitnexus CLI as a subprocess with proper env, timeout, and WSL routing.
 *
 * @param {string} cwd - Working directory
 * @param {string[]} args - Arguments to pass to gitnexus
 * @param {{ timeout?: number, config?: object, platform?: string }} [options={}]
 * @returns {{ exitCode: number, stdout: string, stderr: string, reason: string, timeout_ms?: number }}
 */
function execGitNexus(cwd, args, options = {}) {
  const config = options.config || readGitNexusConfig(cwd);
  const platform = options.platform || process.platform;
  const useWsl = resolveWslSetting(config, platform);
  const timeout = options.timeout ?? 30000;

  if (useWsl) {
    // Route through WSL on Windows
    const wslCwd = windowsToWslPath(cwd);
    const wslArgs = args.map(a => {
      // Translate file path arguments (heuristic: starts with drive letter)
      if (/^[A-Za-z]:[\\/]/.test(a)) return windowsToWslPath(a);
      return a;
    });

    const result = execTool('wsl', ['gitnexus', ...wslArgs], {
      cwd: wslCwd,
      timeout,
    });

    // Handle WSL-specific errors
    if (result.error && result.error.code === 'ENOENT') {
      return {
        exitCode: 127,
        stdout: '',
        stderr: 'wsl not found on PATH',
        reason: GITNEXUS_REASON.WSL_NOT_AVAILABLE,
      };
    }

    if (result.signal === 'SIGTERM') {
      return {
        exitCode: 124,
        stdout: result.stdout || '',
        stderr: 'gitnexus timed out via WSL after ' + timeout + 'ms',
        reason: GITNEXUS_REASON.TIMEOUT,
        timeout_ms: timeout,
      };
    }

    if (result.exitCode !== 0 && result.stderr) {
      // Check for WSL distro errors
      const stderrLower = result.stderr.toLowerCase();
      if (stderrLower.includes('no installed') || stderrLower.includes('no distributions')) {
        return {
          ...result,
          reason: GITNEXUS_REASON.WSL_DISTRO_MISSING,
          suggestion: 'Configure gitnexus.use_wsl: false or install a WSL distro',
        };
      }
    }

    // Parse output for multi-repo detection
    const parsed = parseGitNexusOutput(result.stdout || '', result.stderr || '');
    if (parsed.ok) {
      const data = parsed.data;
      if (data && typeof data === 'object' && data.error &&
          typeof data.error === 'string' && data.error.includes('Multiple repositories indexed')) {
        // Retry with --repo flag using project directory basename
        const repoName = path.basename(cwd);
        return execGitNexus(cwd, ['--repo', repoName, ...args], { ...options, config });
      }
    }

    if (result.exitCode !== 0) {
      // WSL command executed but failed with a non-zero exit code
      // (not ENOENT, not distro-missing, not timeout) — produce WSL_COMMAND_FAILED
      return {
        ...result,
        reason: GITNEXUS_REASON.WSL_COMMAND_FAILED,
        stderr: result.stderr || 'WSL command failed with exit code ' + result.exitCode,
      };
    }

    return {
      exitCode: result.exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      reason: GITNEXUS_REASON.OK,
    };
  }

  // Direct CLI invocation (non-WSL)
  const cliPath = (config && config.cli_path) || 'gitnexus';
  const result = execTool(cliPath, args, { cwd, timeout });

  // ENOENT — CLI not found
  if (result.error && result.error.code === 'ENOENT') {
    return {
      exitCode: 127,
      stdout: '',
      stderr: 'gitnexus not found on PATH',
      reason: GITNEXUS_REASON.ENOENT,
    };
  }

  // Timeout
  if (result.signal === 'SIGTERM') {
    return {
      exitCode: 124,
      stdout: result.stdout || '',
      stderr: 'gitnexus timed out after ' + timeout + 'ms',
      reason: GITNEXUS_REASON.TIMEOUT,
      timeout_ms: timeout,
    };
  }

  // Parse output for multi-repo detection
  const parsed = parseGitNexusOutput(result.stdout || '', result.stderr || '');
  if (parsed.ok) {
    const data = parsed.data;
    if (data && typeof data === 'object' && data.error &&
        typeof data.error === 'string' && data.error.includes('Multiple repositories indexed')) {
      const repoName = path.basename(cwd);
      return execGitNexus(cwd, ['--repo', repoName, ...args], { ...options, config });
    }
  }

  if (result.exitCode !== 0) {
    return {
      ...result,
      reason: GITNEXUS_REASON.CLI_ERROR,
    };
  }

  return {
    exitCode: result.exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    reason: GITNEXUS_REASON.OK,
  };
}

// ─── Budget Truncation (D-06, D-07, D-08, TB-01) ───────────────────────────

/**
 * Apply token budget caps to GitNexus response data.
 * Uses character-count estimation: Math.ceil(JSON.stringify(obj).length / 4).
 * Field priority for removal (drop from bottom up):
 * - query/context/impact: edges, definitions, symbols, processes (processes highest)
 * - detect_changes: risk_summary, affected_processes, changed_symbols (changed_symbols highest)
 * - rename: confidence, text_search_edits, graph_edits (graph_edits highest)
 * - cypher: markdown, rows (rows highest)
 *
 * Returns data with no truncation metadata when under budget.
 * Returns { ...prunedData, truncated: true, budget_used: N, budget_limit: M } when truncated.
 *
 * @param {object} data - Response data to truncate
 * @param {number|null} budgetTokens - Token budget limit, or null/falsy for unlimited
 * @param {string} operationType - Operation type for field priority (query, context, impact, detect_changes, rename, cypher)
 * @returns {object}
 */
function applyGitNexusBudget(data, budgetTokens, operationType = 'query') {
  if (!budgetTokens) return data;

  const estimate = (obj) => Math.ceil(JSON.stringify(obj).length / 4);

  let current = { ...data };
  const budgetUsed = estimate(current);

  if (budgetUsed <= budgetTokens) {
    return current;
  }

  // Field priority: first item removed first (lowest priority), last item kept longest (highest priority)
  const FIELD_PRIORITY = {
    query: ['edges', 'definitions', 'symbols', 'processes'],
    context: ['edges', 'definitions', 'callees', 'callers', 'processes'],
    impact: ['byDepth', 'affected_modules', 'affected_processes', 'risk'],
    detect_changes: ['risk_summary', 'affected_processes', 'changed_symbols'],
    rename: ['confidence', 'text_search_edits', 'graph_edits'],
    cypher: ['markdown', 'rows'],
  };

  const priority = FIELD_PRIORITY[operationType] || FIELD_PRIORITY.query;

  // Drop fields by priority (lowest priority first) until under budget
  for (const field of priority) {
    if (estimate(current) <= budgetTokens) break;
    if (field in current) {
      const { [field]: _removed, ...rest } = current;
      current = rest;
    }
  }

  const finalBudget = estimate(current);
  return {
    ...current,
    truncated: true,
    budget_used: finalBudget,
    budget_limit: budgetTokens,
  };
}

// ─── Status (CJS-04, SPEC item 7) ──────────────────────────────────────────

/**
 * Return status information about the GitNexus index.
 * Reads .gitnexus/meta.json directly (NOT the CLI, since `gitnexus status`
 * outputs human-readable text, not JSON).
 *
 * @param {string} cwd - Working directory
 * @returns {object}
 */
function gitNexusStatus(cwd) {
  const planningDir = path.join(cwd, '.planning');
  if (!isGitNexusEnabled(planningDir)) return disabledResponse();

  const metaPath = path.join(cwd, '.gitnexus', 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return {
      exists: false,
      reason: GITNEXUS_REASON.NO_INDEX,
      message: 'No GitNexus index found. Run gitnexus analyze to create one.',
    };
  }

  let meta;
  try {
    const metaContent = fs.readFileSync(metaPath, 'utf8');
    meta = JSON.parse(metaContent);
  } catch (_e) {
    return {
      exists: false,
      reason: GITNEXUS_REASON.CLI_ERROR,
      message: 'Failed to read or parse .gitnexus/meta.json',
    };
  }

  const stats = meta.stats || {};
  const indexedAt = meta.indexedAt ? new Date(meta.indexedAt) : null;
  const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
  const stale = indexedAt ? ((Date.now() - indexedAt.getTime()) > STALE_MS) : true;

  // Commit-staleness: compare indexedCommit to git HEAD
  const indexedCommit = (meta.lastCommit || '').toString().trim();
  const COMMIT_HASH_RE = /^[0-9a-f]{4,40}$/i;
  const validCommit = COMMIT_HASH_RE.test(indexedCommit) ? indexedCommit : null;

  let commitStale = null;
  let currentCommit = null;
  if (validCommit) {
    const headResult = execGit(['rev-parse', 'HEAD'], { cwd });
    if (headResult.exitCode === 0) {
      currentCommit = headResult.stdout.trim().slice(0, 7);
      const indexedShort = validCommit.slice(0, 7);
      commitStale = indexedShort !== currentCommit;
    }
  }

  // Auto-update: read config for gitnexus.auto_update (default false)
  const config = readGitNexusConfig(cwd);
  const autoUpdate = config.auto_update === true;

  return {
    exists: true,
    symbols: stats.nodes || stats.symbols || 0,
    edges: stats.edges || 0,
    processes: stats.processes || 0,
    communities: stats.communities || 0,
    stale,
    commit_stale: commitStale,
    indexed_at: indexedAt ? indexedAt.toISOString() : null,
    indexed_commit: validCommit ? validCommit.slice(0, 7) : null,
    current_commit: currentCommit,
    auto_update: autoUpdate,
  };
}

// ─── Query Functions (CJS-05 through CJS-09, SPEC items 8-14) ────────────────

/**
 * Query GitNexus for process-grouped results matching a search term.
 * Invokes `gitnexus query <term>` via execGitNexus with budget caps.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @param {string} term - Search term
 * @param {{ budget?: number|null }} [options={}] - Options
 * @returns {object}
 */
function gitNexusQuery(cwd, term, options = {}) {
  try {
    const planningDir = path.join(cwd, '.planning');
    if (!isGitNexusEnabled(planningDir)) return disabledResponse();

    if (!term) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: 'query term required' };
    }

    const config = readGitNexusConfig(cwd);
    const repoName = path.basename(cwd);
    const result = execGitNexus(cwd, ['query', term, '--limit', '5', '--repo', repoName], { config });

    if (result.reason !== GITNEXUS_REASON.OK) {
      return { reason: result.reason, message: result.stderr || 'gitnexus query failed' };
    }

    const parsed = parseGitNexusOutput(result.stdout, result.stderr);
    if (!parsed.ok) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: parsed.data.message || 'Failed to parse gitnexus query output' };
    }

    const budget = options.budget || (config.budget && config.budget.query) || 2000;
    return applyGitNexusBudget(parsed.data, budget, 'query');
  } catch (e) {
    return { reason: GITNEXUS_REASON.CLI_ERROR, message: e.message };
  }
}

/**
 * Get 360-degree context for a symbol name.
 * Invokes `gitnexus context <name>` via execGitNexus with budget caps.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @param {string} name - Symbol name
 * @param {{ budget?: number|null }} [options={}] - Options
 * @returns {object}
 */
function gitNexusContext(cwd, name, options = {}) {
  try {
    const planningDir = path.join(cwd, '.planning');
    if (!isGitNexusEnabled(planningDir)) return disabledResponse();

    if (!name) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: 'symbol name required' };
    }

    const config = readGitNexusConfig(cwd);
    const repoName = path.basename(cwd);
    const result = execGitNexus(cwd, ['context', name, '--repo', repoName], { config });

    if (result.reason !== GITNEXUS_REASON.OK) {
      return { reason: result.reason, message: result.stderr || 'gitnexus context failed' };
    }

    const parsed = parseGitNexusOutput(result.stdout, result.stderr);
    if (!parsed.ok) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: parsed.data.message || 'Failed to parse gitnexus context output' };
    }

    const budget = options.budget || (config.budget && config.budget.context) || 1500;
    return applyGitNexusBudget(parsed.data, budget, 'context');
  } catch (e) {
    return { reason: GITNEXUS_REASON.CLI_ERROR, message: e.message };
  }
}

/**
 * Get blast radius for a target symbol in the given direction.
 * Invokes `gitnexus impact <target>` via execGitNexus with budget caps.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @param {string} target - Target symbol name
 * @param {string} [direction='upstream'] - Impact direction (upstream or downstream)
 * @param {{ budget?: number|null }} [options={}] - Options
 * @returns {object}
 */
function gitNexusImpact(cwd, target, direction = 'upstream', options = {}) {
  try {
    const planningDir = path.join(cwd, '.planning');
    if (!isGitNexusEnabled(planningDir)) return disabledResponse();

    if (!target) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: 'target symbol required' };
    }

    const config = readGitNexusConfig(cwd);
    const repoName = path.basename(cwd);
    const result = execGitNexus(cwd, ['impact', target, '--direction', direction, '--repo', repoName], { config });

    if (result.reason !== GITNEXUS_REASON.OK) {
      return { reason: result.reason, message: result.stderr || 'gitnexus impact failed' };
    }

    const parsed = parseGitNexusOutput(result.stdout, result.stderr);
    if (!parsed.ok) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: parsed.data.message || 'Failed to parse gitnexus impact output' };
    }

    const budget = options.budget || (config.budget && config.budget.impact) || 1000;
    return applyGitNexusBudget(parsed.data, budget, 'impact');
  } catch (e) {
    return { reason: GITNEXUS_REASON.CLI_ERROR, message: e.message };
  }
}

/**
 * Detect changed symbols and affected processes.
 * Invokes `gitnexus detect-changes --scope <scope>` via execGitNexus.
 * Handles both JSON and plain text output ("No changes detected.").
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @param {string} [scope='unstaged'] - Change scope (unstaged, staged, all, compare)
 * @param {{ budget?: number|null }} [options={}] - Options
 * @returns {object}
 */
function gitNexusDetectChanges(cwd, scope = 'unstaged', options = {}) {
  try {
    const planningDir = path.join(cwd, '.planning');
    if (!isGitNexusEnabled(planningDir)) return disabledResponse();

    const config = readGitNexusConfig(cwd);
    const repoName = path.basename(cwd);
    const result = execGitNexus(cwd, ['detect-changes', '--scope', scope, '--repo', repoName], { config });

    if (result.reason !== GITNEXUS_REASON.OK) {
      return { reason: result.reason, message: result.stderr || 'gitnexus detect-changes failed' };
    }

    // Try to parse JSON output first
    const parsed = parseGitNexusOutput(result.stdout, result.stderr);

    if (parsed.ok) {
      const budget = options.budget || (config.budget && config.budget.detect_changes) || 500;
      return applyGitNexusBudget(parsed.data, budget, 'detect_changes');
    }

    // Handle plain text "No changes detected." output
    const stdout = (result.stdout || '').trim().toLowerCase();
    if (stdout.includes('no changes detected') || stdout.includes('no changes')) {
      return { changed_symbols: [], affected_processes: [], risk_summary: 'none' };
    }

    // Unknown non-JSON output -- treat as no changes detected
    return { changed_symbols: [], affected_processes: [], risk_summary: 'none' };
  } catch (e) {
    return { reason: GITNEXUS_REASON.CLI_ERROR, message: e.message };
  }
}

/**
 * Pre-flight check for GitNexus build (CJS-09, D-17).
 * Checks CLI availability and version. Returns spawn_agent hint on success.
 * Does NOT execute the build itself.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @returns {object}
 */
function gitNexusBuild(cwd) {
  try {
    const planningDir = path.join(cwd, '.planning');
    if (!isGitNexusEnabled(planningDir)) return disabledResponse();

    // Check if CLI is available
    const checkResult = execGitNexus(cwd, ['--version'], { timeout: 10000 });
    if (checkResult.reason === GITNEXUS_REASON.ENOENT) {
      return { reason: GITNEXUS_REASON.ENOENT, message: 'gitnexus not found on PATH' };
    }
    if (checkResult.reason === GITNEXUS_REASON.WSL_NOT_AVAILABLE) {
      return { reason: checkResult.reason, message: checkResult.stderr || 'WSL not available', suggestion: 'Configure gitnexus.use_wsl: false or install WSL' };
    }
    if (checkResult.reason === GITNEXUS_REASON.WSL_DISTRO_MISSING) {
      return { reason: checkResult.reason, message: checkResult.stderr || 'No WSL distro installed', suggestion: 'Configure gitnexus.use_wsl: false or install a WSL distro' };
    }

    // Extract version info if available
    let version = null;
    let versionWarning = null;
    if (checkResult.reason === GITNEXUS_REASON.OK && checkResult.stdout) {
      // Parse version from stdout (may include pino log lines)
      const lines = checkResult.stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const versionMatch = line.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (versionMatch) {
          version = versionMatch[1];
          break;
        }
      }
    }

    // Build timeout from config -- default 600s (10 minutes) per D-17
    const config = readGitNexusConfig(cwd);
    const timeoutSec = (config.build_timeout) || 600;

    // .gitnexus directory path (will be created by gitnexus analyze)
    const gitnexusDir = path.join(cwd, '.gitnexus');

    return {
      action: 'spawn_agent',
      graphs_dir: gitnexusDir,
      timeout_seconds: timeoutSec,
      version,
      version_warning: versionWarning,
    };
  } catch (e) {
    return { reason: GITNEXUS_REASON.CLI_ERROR, message: e.message };
  }
}

/**
 * Rename a symbol across the codebase using graph-backed edits.
 * STUB: gitnexus rename is not available via CLI (RESEARCH A7).
 * Returns a structured error directing callers to the MCP tool.
 * Full rename functionality deferred to Phase 2 SDK integration.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @param {string} symbolName - Current symbol name
 * @param {string} newSymbolName - New symbol name
 * @param {{ budget?: number|null }} [options={}] - Options (unused in stub)
 * @returns {object}
 */
function gitNexusRename(cwd, symbolName, newSymbolName, options = {}) {
  // STUB: rename is not available via CLI; use gitnexus_rename MCP tool directly
  // Full rename functionality (via MCP tool invocation) deferred to Phase 2
  return {
    reason: GITNEXUS_REASON.CLI_ERROR,
    message: 'rename is not available via CLI; use gitnexus_rename MCP tool directly',
  };
}

/**
 * Execute a Cypher query against the GitNexus knowledge graph.
 * Invokes `gitnexus cypher <query>` via execGitNexus with budget caps.
 * Never throws (CJS-02).
 *
 * @param {string} cwd - Working directory
 * @param {string} query - Cypher query string
 * @param {{ budget?: number|null }} [options={}] - Options
 * @returns {object}
 */
function gitNexusCypher(cwd, query, options = {}) {
  try {
    const planningDir = path.join(cwd, '.planning');
    if (!isGitNexusEnabled(planningDir)) return disabledResponse();

    if (!query) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: 'cypher query required' };
    }

    const config = readGitNexusConfig(cwd);
    const repoName = path.basename(cwd);
    const result = execGitNexus(cwd, ['cypher', query, '--repo', repoName], { config });

    if (result.reason !== GITNEXUS_REASON.OK) {
      return { reason: result.reason, message: result.stderr || 'gitnexus cypher failed' };
    }

    const parsed = parseGitNexusOutput(result.stdout, result.stderr);
    if (!parsed.ok) {
      return { reason: GITNEXUS_REASON.CLI_ERROR, message: parsed.data.message || 'Failed to parse gitnexus cypher output' };
    }

    const budget = options.budget || (config.budget && config.budget.cypher) || 2000;
    return applyGitNexusBudget(parsed.data, budget, 'cypher');
  } catch (e) {
    return { reason: GITNEXUS_REASON.CLI_ERROR, message: e.message };
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Config gate
  isGitNexusEnabled,
  disabledResponse,
  // Reason enum
  GITNEXUS_REASON,
  // Config reader
  readGitNexusConfig,
  // WSL helpers
  resolveWslSetting,
  windowsToWslPath,
  // Output parsing
  parseGitNexusOutput,
  // Subprocess invocation
  execGitNexus,
  // Budget truncation
  applyGitNexusBudget,
  // Status
  gitNexusStatus,
  // Query functions
  gitNexusQuery,
  gitNexusContext,
  gitNexusImpact,
  gitNexusDetectChanges,
  gitNexusBuild,
  gitNexusRename,
  gitNexusCypher,
};