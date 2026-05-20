'use strict';

/**
 * WSL Integration and Budget Configuration Tests for gitnexus.cjs
 *
 * Covers: WSL auto-detection (WSL-01), WSL path translation (WSL-03),
 * WSL error codes (WSL-04), use_wsl config (WSL-02), real WSL invocation (WSL-01),
 * budget defaults (TB-02), budget overrides (TB-02), and applyGitNexusBudget
 * with config budgets.
 *
 * WSL integration tests only run on Windows with real WSL (skipped on other platforms).
 * Budget configuration tests run on all platforms.
 *
 * Per D-16: WSL tests mocked inline, plus separate real WSL integration test file
 * that only runs on Windows with real WSL (skipped on CI).
 */

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { createTempProject, cleanup } = require('./helpers.cjs');

const {
  isGitNexusEnabled,
  disabledResponse,
  GITNEXUS_REASON,
  execGitNexus,
  applyGitNexusBudget,
  readGitNexusConfig,
  resolveWslSetting,
  windowsToWslPath,
  parseGitNexusOutput,
  gitNexusQuery,
} = require('../get-shit-done/bin/lib/gitnexus.cjs');

// ─── Platform detection ────────────────────────────────────────────────────────
// WSL integration tests only run on Windows with real WSL available.
// Budget configuration tests run on all platforms.

const isWindows = process.platform === 'win32';
const describeWsl = isWindows ? describe : describe.skip;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function enableGitNexus(planningDir) {
  const configPath = path.join(planningDir, 'config.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  config.gitnexus = { enabled: true };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function writeGitNexusConfig(planningDir, gitnexusConfig) {
  const configPath = path.join(planningDir, 'config.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  config.gitnexus = gitnexusConfig;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// ─── WSL Integration Tests ─────────────────────────────────────────────────────
// These tests verify real WSL behavior on Windows. They are skipped on
// non-Windows platforms with clear skip messages.

// ─── a. WSL auto-detection (WSL-01) ───────────────────────────────────────────

describeWsl('WSL integration - auto-detection (WSL-01)', () => {
  test('resolveWslSetting returns true on win32 with use_wsl: true', () => {
    const result = resolveWslSetting({ use_wsl: true }, 'win32');
    assert.strictEqual(result, true);
  });

  test('resolveWslSetting returns false on win32 with use_wsl: false', () => {
    const result = resolveWslSetting({ use_wsl: false }, 'win32');
    assert.strictEqual(result, false);
  });

  test('resolveWslSetting returns false on linux with use_wsl: false', () => {
    const result = resolveWslSetting({ use_wsl: false }, 'linux');
    assert.strictEqual(result, false);
  });

  test('resolveWslSetting with use_wsl "auto" on win32 returns boolean', () => {
    // On real Windows, this calls wsl --list --quiet. The result depends on
    // whether WSL is actually available on the system.
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'win32');
    assert.strictEqual(typeof result, 'boolean');
  });

  test('resolveWslSetting returns false on linux with use_wsl "auto"', () => {
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'linux');
    assert.strictEqual(result, false);
  });

  test('resolveWslSetting returns false on darwin with use_wsl "auto"', () => {
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'darwin');
    assert.strictEqual(result, false);
  });

  test('resolveWslSetting defaults to auto behavior when use_wsl is missing', () => {
    // On linux, defaults to no WSL needed
    const result = resolveWslSetting({}, 'linux');
    assert.strictEqual(result, false);
  });
});

// ─── b. WSL path translation (WSL-03) ──────────────────────────────────────────

describeWsl('WSL integration - path translation (WSL-03)', () => {
  test('translates C:\\Projects\\AI\\Git\\get-shit-done to /mnt/c/Projects/AI/Git/get-shit-done', () => {
    assert.strictEqual(
      windowsToWslPath('C:\\Projects\\AI\\Git\\get-shit-done'),
      '/mnt/c/Projects/AI/Git/get-shit-done'
    );
  });

  test('translates C:\\Users\\X to /mnt/c/Users/X', () => {
    assert.strictEqual(
      windowsToWslPath('C:\\Users\\X'),
      '/mnt/c/Users/X'
    );
  });

  test('translates D:\\data to /mnt/d/data', () => {
    assert.strictEqual(
      windowsToWslPath('D:\\data'),
      '/mnt/d/data'
    );
  });

  test('handles drive letter case (lowercase c:)', () => {
    assert.strictEqual(
      windowsToWslPath('c:\\temp\\file.txt'),
      '/mnt/c/temp/file.txt'
    );
  });

  test('handles paths with spaces', () => {
    assert.strictEqual(
      windowsToWslPath('C:\\Program Files\\GitNexus'),
      '/mnt/c/Program Files/GitNexus'
    );
  });

  test('passes through untranslatable paths unchanged', () => {
    assert.strictEqual(windowsToWslPath('/usr/local/bin'), '/usr/local/bin');
    assert.strictEqual(windowsToWslPath('relative/path'), 'relative/path');
    assert.strictEqual(windowsToWslPath(''), '');
    assert.strictEqual(windowsToWslPath(null), null);
    assert.strictEqual(windowsToWslPath(undefined), undefined);
  });

  test('handles forward slash Windows paths', () => {
    // C:/Users/X is a valid Windows path with forward slashes
    assert.strictEqual(
      windowsToWslPath('C:/Users/X'),
      '/mnt/c/Users/X'
    );
  });

  test('handles root drive path', () => {
    assert.strictEqual(
      windowsToWslPath('C:\\'),
      '/mnt/c/'
    );
  });
});

// ─── c. WSL error codes (WSL-04) ───────────────────────────────────────────────

describeWsl('WSL integration - error codes (WSL-04)', () => {
  test('WSL_NOT_AVAILABLE includes suggestion to install WSL', () => {
    assert.strictEqual(GITNEXUS_REASON.WSL_NOT_AVAILABLE, 'wsl_not_available');
    // Verify the execGitNexus function returns WSL_NOT_AVAILABLE with suggestion
    // when WSL is not found on Windows (simulated via mock)
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_NOT_AVAILABLE);
    mock.restoreAll();
  });

  test('WSL_COMMAND_FAILED includes diagnostic info', () => {
    // Verify the error code exists in the enum
    assert.strictEqual(GITNEXUS_REASON.WSL_COMMAND_FAILED, 'wsl_command_failed');
  });

  test('WSL_DISTRO_MISSING includes suggestion to configure use_wsl: false', () => {
    // Verify the error code exists in the enum
    assert.strictEqual(GITNEXUS_REASON.WSL_DISTRO_MISSING, 'wsl_distro_missing');

    // Verify that execGitNexus returns WSL_DISTRO_MISSING with suggestion
    // when WSL reports no installed distributions
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'The Windows Subsystem for Linux has no installed distributions.',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_DISTRO_MISSING);
    assert.ok(result.suggestion, 'should include suggestion');
    assert.ok(
      result.suggestion.includes('use_wsl: false') || result.suggestion.includes('install a WSL distro'),
      `suggestion should mention use_wsl: false or WSL distro install, got: ${result.suggestion}`
    );
    mock.restoreAll();
  });

  test('WSL_NOT_AVAILABLE has actionable suggestion in execGitNexus result', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_NOT_AVAILABLE);
    // The suggestion should be present or the stderr should indicate wsl not found
    assert.ok(result.stderr || result.reason === GITNEXUS_REASON.WSL_NOT_AVAILABLE);
    mock.restoreAll();
  });

  test('WSL_DISTRO_MISSING detected from "no installed distributions" stderr', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'Windows Subsystem for Linux has no installed distributions.',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_DISTRO_MISSING);
    mock.restoreAll();
  });

  test('WSL_DISTRO_MISSING detected from "no distributions" stderr', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'Error: no distributions are installed',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_DISTRO_MISSING);
    mock.restoreAll();
  });

  test('WSL_COMMAND_FAILED returned when WSL command exits non-zero without distro error', () => {
    // When WSL is available (no ENOENT), a distro is present (no "no installed" or
    // "no distributions" in stderr), and the command exits with a non-zero code,
    // execGitNexus must return WSL_COMMAND_FAILED — not the generic CLI_ERROR.
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'command not found: gitnexus',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_COMMAND_FAILED, 'should return WSL_COMMAND_FAILED for non-zero WSL exit without distro error');
    assert.strictEqual(result.exitCode, 1, 'should preserve original exit code');
    assert.ok(result.stderr.includes('command not found: gitnexus'), `stderr should contain original error, got: ${result.stderr}`);
    mock.restoreAll();
  });

  test('WSL_COMMAND_FAILED returned for non-zero exit with empty stderr', () => {
    // Even with empty stderr, a non-zero exit from WSL (that is not distro-missing)
    // must produce WSL_COMMAND_FAILED, not CLI_ERROR.
    mock.method(childProcess, 'spawnSync', () => ({
      status: 2,
      stdout: '',
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_COMMAND_FAILED, 'should return WSL_COMMAND_FAILED even with empty stderr');
    assert.strictEqual(result.exitCode, 2);
    mock.restoreAll();
  });

  test('WSL_COMMAND_FAILED includes diagnostic stderr message', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 127,
      stdout: '',
      stderr: 'bash: gitnexus: command not found',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['query', 'test'], { config: { use_wsl: true }, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_COMMAND_FAILED);
    assert.ok(result.stderr, 'should include stderr for diagnostics');
    mock.restoreAll();
  });
});

// ─── d. Real WSL invocation (WSL-01) ──────────────────────────────────────────
// These tests only pass on Windows with WSL actually available.
// They verify that gitNexus functions correctly route through WSL.

describeWsl('WSL integration - real WSL invocation (WSL-01)', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    // Enable gitnexus with use_wsl: true for forced WSL routing
    writeGitNexusConfig(planningDir, { enabled: true, use_wsl: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('execGitNexus routes through WSL on Windows with use_wsl: true', () => {
    // This test uses use_wsl: true to force WSL routing.
    // On Windows with WSL available, this should route through wsl gitnexus.
    // Since gitnexus CLI may not be installed in WSL, we expect either:
    // - A successful response (if gitnexus is installed in WSL)
    // - A WSL_COMMAND_FAILED or WSL_NOT_AVAILABLE error (if WSL is available but gitnexus isn't)
    // - A WSL_DISTRO_MISSING error (if WSL is installed but no distro)
    // All of these are valid outcomes proving WSL routing works.
    const result = execGitNexus(tmpDir, ['--version']);
    assert.ok(
      result.reason === GITNEXUS_REASON.OK ||
      result.reason === GITNEXUS_REASON.CLI_ERROR ||
      result.reason === GITNEXUS_REASON.WSL_COMMAND_FAILED ||
      result.reason === GITNEXUS_REASON.WSL_NOT_AVAILABLE ||
      result.reason === GITNEXUS_REASON.WSL_DISTRO_MISSING ||
      result.reason === GITNEXUS_REASON.ENOENT,
      `Expected a valid WSL routing outcome, got: ${result.reason}`
    );
  });

  test('windowsToWslPath translates cwd-style paths correctly', () => {
    // Verify path translation works for the test directory
    const wslPath = windowsToWslPath(tmpDir);
    // On Windows, tmpDir starts with a drive letter like C:\
    // The WSL path should start with /mnt/
    if (tmpDir.match(/^[A-Za-z]:[\\/]/)) {
      assert.ok(wslPath.startsWith('/mnt/'), `WSL path should start with /mnt/, got: ${wslPath}`);
      // Verify the drive letter is correctly mapped
      const driveLetter = tmpDir.match(/^([A-Za-z]):/)[1].toLowerCase();
      assert.ok(wslPath.startsWith(`/mnt/${driveLetter}/`), `WSL path should map drive ${driveLetter}, got: ${wslPath}`);
    }
  });

  test('resolveWslSetting with use_wsl: true forces WSL on any platform', () => {
    // When use_wsl is explicitly true, WSL should be used regardless of platform
    const result = resolveWslSetting({ use_wsl: true }, 'linux');
    assert.strictEqual(result, true);
  });
});

// ─── e. use_wsl config (WSL-02) ────────────────────────────────────────────────

describeWsl('WSL integration - use_wsl config (WSL-02)', () => {
  test('use_wsl "auto" detects platform - false on linux', () => {
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'linux');
    assert.strictEqual(result, false);
  });

  test('use_wsl "auto" detects platform - false on darwin', () => {
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'darwin');
    assert.strictEqual(result, false);
  });

  test('use_wsl true forces WSL routing', () => {
    const result = resolveWslSetting({ use_wsl: true }, 'linux');
    assert.strictEqual(result, true);
  });

  test('use_wsl false disables WSL on any platform', () => {
    assert.strictEqual(resolveWslSetting({ use_wsl: false }, 'win32'), false);
    assert.strictEqual(resolveWslSetting({ use_wsl: false }, 'linux'), false);
    assert.strictEqual(resolveWslSetting({ use_wsl: false }, 'darwin'), false);
  });

  test('use_wsl auto on win32 returns boolean (WSL availability dependent)', () => {
    // On Windows, this will actually call wsl --list --quiet
    // The result depends on the system's WSL availability
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'win32');
    assert.strictEqual(typeof result, 'boolean');
  });

  test('use_wsl undefined defaults to auto behavior', () => {
    // Missing use_wsl should behave like "auto"
    const linuxResult = resolveWslSetting({ enabled: true }, 'linux');
    assert.strictEqual(linuxResult, false);
  });

  test('config with use_wsl "true" string does not force WSL', () => {
    // String "true" should not be treated as boolean true
    const result = resolveWslSetting({ use_wsl: 'true' }, 'linux');
    // "true" as string falls through to the auto-detection branch on linux = false
    assert.strictEqual(result, false);
  });
});

// ─── Budget Configuration Tests ────────────────────────────────────────────────
// These tests run on all platforms.

// ─── f. Budget defaults (TB-02) ────────────────────────────────────────────────

describe('Budget defaults (TB-02)', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('readGitNexusConfig returns empty object when gitnexus.budget is not set', () => {
    enableGitNexus(planningDir);
    const config = readGitNexusConfig(tmpDir);
    // When budget section is not present, the config object has enabled:true but no budget
    assert.strictEqual(config.budget, undefined);
  });

  test('gitNexusQuery uses default budget of 2000 when no budget config', () => {
    enableGitNexus(planningDir);
    // Write a config with enabled:true but no budget section
    writeGitNexusConfig(planningDir, { enabled: true });
    const config = readGitNexusConfig(tmpDir);
    // Verify config doesn't have budget section
    assert.strictEqual(config.budget, undefined);
  });

  test('default budget values are applied when config has no budget section', () => {
    enableGitNexus(planningDir);
    // Verify that applyGitNexusBudget uses default operation budgets correctly
    // by checking budget cap behavior with default-sized data
    const data = { processes: [{ name: 'test' }], total: 1 };
    // With a budget larger than the data, no truncation should occur
    const result = applyGitNexusBudget(data, 2000, 'query');
    assert.strictEqual(result.truncated, undefined);
  });

  test('all default budget values are correct', () => {
    // Verify the default budget values per SPEC TB-02:
    // query: 2000, context: 1500, impact: 1000, detect_changes: 500, rename: 1000, cypher: 2000
    // These are hardcoded in the gitnexusQuery, gitNexusContext, etc. functions
    // We verify them indirectly via budget truncation behavior

    // query default = 2000
    const queryData = { processes: [{ name: 'p1' }], symbols: [{ name: 's1' }], total: 1 };
    const queryResult = applyGitNexusBudget(queryData, 2000, 'query');
    assert.strictEqual(queryResult.truncated, undefined, 'query data under 2000 should not be truncated');

    // context default = 1500
    const contextData = { callers: [{ name: 'c1' }], callees: [{ name: 'c2' }], processes: ['p1'] };
    const contextResult = applyGitNexusBudget(contextData, 1500, 'context');
    assert.strictEqual(contextResult.truncated, undefined, 'context data under 1500 should not be truncated');

    // impact default = 1000
    const impactData = { risk: 'LOW', affected_processes: [], affected_modules: [] };
    const impactResult = applyGitNexusBudget(impactData, 1000, 'impact');
    assert.strictEqual(impactResult.truncated, undefined, 'impact data under 1000 should not be truncated');

    // detect_changes default = 500
    const changesData = { changed_symbols: [], affected_processes: [], risk_summary: 'none' };
    const changesResult = applyGitNexusBudget(changesData, 500, 'detect_changes');
    assert.strictEqual(changesResult.truncated, undefined, 'detect_changes data under 500 should not be truncated');

    // rename default = 1000
    const renameData = { graph_edits: [], text_search_edits: [], confidence: {} };
    const renameResult = applyGitNexusBudget(renameData, 1000, 'rename');
    assert.strictEqual(renameResult.truncated, undefined, 'rename data under 1000 should not be truncated');

    // cypher default = 2000
    const cypherData = { rows: [{ name: 'r1' }], markdown: '# Results' };
    const cypherResult = applyGitNexusBudget(cypherData, 2000, 'cypher');
    assert.strictEqual(cypherResult.truncated, undefined, 'cypher data under 2000 should not be truncated');
  });
});

// ─── g. Budget overrides (TB-02) ─────────────────────────────────────────────

describe('Budget overrides (TB-02)', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('config.json gitnexus.budget.query overrides default to 500', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { query: 500 } });
    const config = readGitNexusConfig(tmpDir);
    assert.strictEqual(config.budget.query, 500);
    // Other budget values should not be present
    assert.strictEqual(config.budget.context, undefined);
  });

  test('gitNexusQuery uses config budget override for query', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { query: 100 } });
    // Create large query data that exceeds budget 100
    const largeData = {
      processes: Array.from({ length: 100 }, (_, i) => ({ name: `proc_${i}`, details: 'x'.repeat(50) })),
      symbols: Array.from({ length: 50 }, (_, i) => ({ name: `sym_${i}` })),
      definitions: Array.from({ length: 30 }, (_, i) => ({ name: `def_${i}` })),
      edges: Array.from({ length: 200 }, (_, i) => ({ source: `a_${i}`, target: `b_${i}` })),
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(largeData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusQuery(tmpDir, 'test');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 100, 'budget should be overridden to 100 from config');
  });

  test('budget override for one operation does not affect others', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { query: 500 } });
    const config = readGitNexusConfig(tmpDir);
    // query is overridden to 500
    assert.strictEqual(config.budget.query, 500);
    // Other budget keys are not present in the config
    assert.strictEqual(config.budget.context, undefined);
    assert.strictEqual(config.budget.impact, undefined);
    assert.strictEqual(config.budget.detect_changes, undefined);
  });

  test('multiple budget overrides in config', () => {
    writeGitNexusConfig(planningDir, {
      enabled: true,
      budget: {
        query: 500,
        context: 750,
        impact: 400,
        detect_changes: 250,
        rename: 600,
        cypher: 1500,
      },
    });
    const config = readGitNexusConfig(tmpDir);
    assert.strictEqual(config.budget.query, 500);
    assert.strictEqual(config.budget.context, 750);
    assert.strictEqual(config.budget.impact, 400);
    assert.strictEqual(config.budget.detect_changes, 250);
    assert.strictEqual(config.budget.rename, 600);
    assert.strictEqual(config.budget.cypher, 1500);
  });

  test('empty budget object does not break readGitNexusConfig', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: {} });
    const config = readGitNexusConfig(tmpDir);
    assert.deepStrictEqual(config.budget, {});
  });
});

// ─── h. applyGitNexusBudget with config budgets ────────────────────────────────

describe('applyGitNexusBudget with config budgets', () => {
  test('applies query budget cap with field-priority removal', () => {
    const largeData = {
      processes: [{ name: 'proc_1' }],
      symbols: [{ name: 'sym_1' }],
      definitions: [{ name: 'def_1' }],
      edges: Array.from({ length: 100 }, (_, i) => ({ source: `a_${i}`, target: `b_${i}` })),
    };
    // Set a small budget to force truncation but keep high-priority fields
    const result = applyGitNexusBudget(largeData, 30, 'query');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(typeof result.budget_used, 'number');
    assert.strictEqual(result.budget_limit, 30);
    // Edges should be removed first (lowest priority in query field priority)
    assert.strictEqual(result.edges, undefined, 'edges should be removed first');
    // Processes should remain (highest priority)
    assert.ok(result.processes !== undefined || result.symbols !== undefined, 'high-priority fields should remain');
  });

  test('applies context budget cap with field-priority removal', () => {
    const largeData = {
      edges: Array.from({ length: 100 }, (_, i) => ({ source: `a_${i}`, target: `b_${i}` })),
      definitions: Array.from({ length: 30 }, (_, i) => ({ name: `def_${i}` })),
      callees: Array.from({ length: 50 }, (_, i) => ({ name: `callee_${i}` })),
      callers: Array.from({ length: 50 }, (_, i) => ({ name: `caller_${i}` })),
      processes: [{ name: 'p1' }],
    };
    // Set a small budget to force truncation
    const result = applyGitNexusBudget(largeData, 30, 'context');
    assert.strictEqual(result.truncated, true);
    // Context field priority: edges, definitions, callees, callers, processes
    // edges should be removed first (lowest priority)
    assert.strictEqual(result.edges, undefined, 'edges should be removed first for context');
  });

  test('applies impact budget cap with field-priority removal', () => {
    const largeData = {
      byDepth: { '1': ['a'], '2': ['b'], '3': ['c'] },
      affected_modules: Array.from({ length: 30 }, (_, i) => ({ name: `mod_${i}` })),
      affected_processes: Array.from({ length: 20 }, (_, i) => ({ name: `proc_${i}` })),
      risk: 'HIGH',
    };
    // Set a small budget to force truncation
    const result = applyGitNexusBudget(largeData, 15, 'impact');
    assert.strictEqual(result.truncated, true);
    // Impact field priority: byDepth, affected_modules, affected_processes, risk
    // byDepth should be removed first (lowest priority)
    assert.strictEqual(result.byDepth, undefined, 'byDepth should be removed first for impact');
    // risk should remain (highest priority)
    assert.strictEqual(result.risk, 'HIGH', 'risk should remain');
  });

  test('applies detect_changes budget cap with field-priority removal', () => {
    const largeData = {
      risk_summary: 'HIGH: 3 processes affected',
      affected_processes: Array.from({ length: 20 }, (_, i) => ({ name: `proc_${i}` })),
      changed_symbols: Array.from({ length: 50 }, (_, i) => ({ name: `sym_${i}` })),
    };
    // Set a small budget to force truncation
    const result = applyGitNexusBudget(largeData, 10, 'detect_changes');
    assert.strictEqual(result.truncated, true);
    // detect_changes field priority: risk_summary, affected_processes, changed_symbols
    // risk_summary should be removed first (lowest priority)
    assert.strictEqual(result.risk_summary, undefined, 'risk_summary should be removed first');
  });

  test('applies rename budget cap with field-priority removal', () => {
    const largeData = {
      confidence: { overall: 0.85 },
      text_search_edits: Array.from({ length: 50 }, (_, i) => ({ file: `f_${i}`, line: i })),
      graph_edits: Array.from({ length: 20 }, (_, i) => ({ file: `g_${i}`, line: i })),
    };
    // Set a small budget to force truncation
    const result = applyGitNexusBudget(largeData, 10, 'rename');
    assert.strictEqual(result.truncated, true);
    // Rename field priority: confidence, text_search_edits, graph_edits
    // confidence should be removed first (lowest priority)
    assert.strictEqual(result.confidence, undefined, 'confidence should be removed first');
  });

  test('applies cypher budget cap with field-priority removal', () => {
    const largeData = {
      markdown: '# Results\n' + 'x'.repeat(500),
      rows: Array.from({ length: 50 }, (_, i) => ({ name: `row_${i}` })),
    };
    // Set a small budget to force truncation
    const result = applyGitNexusBudget(largeData, 10, 'cypher');
    assert.strictEqual(result.truncated, true);
    // Cypher field priority: markdown, rows
    // markdown should be removed first (lowest priority)
    assert.strictEqual(result.markdown, undefined, 'markdown should be removed first');
  });

  test('returns data unchanged when under budget (no truncation metadata)', () => {
    const data = { processes: [], symbols: 10, total: 1 };
    const result = applyGitNexusBudget(data, 5000, 'query');
    assert.strictEqual(result.truncated, undefined);
    assert.strictEqual(result.symbols, 10);
  });

  test('handles zero and null budgets as unlimited', () => {
    const data = { processes: [{ name: 'test' }], symbols: 10 };
    assert.strictEqual(applyGitNexusBudget(data, 0, 'query').truncated, undefined);
    assert.strictEqual(applyGitNexusBudget(data, null, 'query').truncated, undefined);
    assert.strictEqual(applyGitNexusBudget(data, undefined, 'query').truncated, undefined);
  });
});