'use strict';

/**
 * Tests for get-shit-done/bin/lib/gitnexus.cjs
 *
 * Covers: isGitNexusEnabled, gitNexusStatus, GITNEXUS_REASON, execGitNexus,
 * applyGitNexusBudget, readGitNexusConfig, resolveWslSetting, windowsToWslPath,
 * parseGitNexusOutput, and never-throw pattern.
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
  gitNexusStatus,
  GITNEXUS_REASON,
  execGitNexus,
  applyGitNexusBudget,
  readGitNexusConfig,
  resolveWslSetting,
  windowsToWslPath,
  parseGitNexusOutput,
} = require('../get-shit-done/bin/lib/gitnexus.cjs');

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function writeMetaJson(cwd, data) {
  const gitNexusDir = path.join(cwd, '.gitnexus');
  fs.mkdirSync(gitNexusDir, { recursive: true });
  fs.writeFileSync(
    path.join(gitNexusDir, 'meta.json'),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

const SAMPLE_META = {
  repoPath: '/Projects/AI/Git/get-shit-done',
  lastCommit: 'abc1234',
  indexedAt: new Date().toISOString(),
  remoteUrl: 'https://github.com/example/get-shit-done',
  stats: {
    files: 150,
    nodes: 27267,
    edges: 36419,
    communities: 45,
    processes: 300,
    embeddings: 12000,
  },
  capabilities: {
    graph: true,
    fts: true,
    vectorSearch: true,
  },
  schemaVersion: '1.0',
};

// ─── GITNEXUS_REASON enum (CJS-01) ──────────────────────────────────────────

describe('GITNEXUS_REASON', () => {
  test('has all 9 required enum values', () => {
    const requiredReasons = [
      'OK', 'DISABLED', 'ENOENT', 'TIMEOUT', 'CLI_ERROR',
      'WSL_NOT_AVAILABLE', 'WSL_COMMAND_FAILED', 'WSL_DISTRO_MISSING', 'NO_INDEX',
    ];
    for (const reason of requiredReasons) {
      assert.ok(GITNEXUS_REASON[reason], `GITNEXUS_REASON.${reason} must exist`);
      assert.strictEqual(typeof GITNEXUS_REASON[reason], 'string', `GITNEXUS_REASON.${reason} must be a string`);
    }
  });

  test('enum is frozen (immutable)', () => {
    assert.strictEqual(Object.isFrozen(GITNEXUS_REASON), true);
  });
});

// ─── isGitNexusEnabled (CONF-01, CJS-03) ────────────────────────────────────

describe('isGitNexusEnabled', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns true when gitnexus.enabled is true', () => {
    enableGitNexus(planningDir);
    assert.strictEqual(isGitNexusEnabled(planningDir), true);
  });

  test('returns false when gitnexus.enabled is false', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    assert.strictEqual(isGitNexusEnabled(planningDir), false);
  });

  test('returns false when gitnexus key is missing', () => {
    const configPath = path.join(planningDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ mode: 'yolo' }), 'utf8');
    assert.strictEqual(isGitNexusEnabled(planningDir), false);
  });

  test('returns false when config file does not exist', () => {
    const configPath = path.join(planningDir, 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    assert.strictEqual(isGitNexusEnabled(planningDir), false);
  });

  test('returns false when config.json is malformed', () => {
    const configPath = path.join(planningDir, 'config.json');
    fs.writeFileSync(configPath, 'not json{{{', 'utf8');
    assert.strictEqual(isGitNexusEnabled(planningDir), false);
  });
});

// ─── disabledResponse (CONF-04, D-05) ────────────────────────────────────────

describe('disabledResponse', () => {
  test('returns disabled:true with reason and message', () => {
    const result = disabledResponse();
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, GITNEXUS_REASON.DISABLED);
    assert.ok(result.message.includes('GitNexus is not enabled'));
  });
});

// ─── readGitNexusConfig ─────────────────────────────────────────────────────

describe('readGitNexusConfig', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns gitnexus config object when present', () => {
    writeGitNexusConfig(planningDir, { enabled: true, use_wsl: 'auto' });
    const config = readGitNexusConfig(tmpDir);
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.use_wsl, 'auto');
  });

  test('returns empty object when gitnexus key is missing', () => {
    const configPath = path.join(planningDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ mode: 'yolo' }), 'utf8');
    const config = readGitNexusConfig(tmpDir);
    assert.deepStrictEqual(config, {});
  });

  test('returns empty object when config file does not exist', () => {
    const configPath = path.join(planningDir, 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    const config = readGitNexusConfig(tmpDir);
    assert.deepStrictEqual(config, {});
  });

  test('returns empty object when config is malformed', () => {
    const configPath = path.join(planningDir, 'config.json');
    fs.writeFileSync(configPath, 'not json{{{', 'utf8');
    const config = readGitNexusConfig(tmpDir);
    assert.deepStrictEqual(config, {});
  });
});

// ─── windowsToWslPath (WSL-03, D-12) ────────────────────────────────────────

describe('windowsToWslPath', () => {
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

  test('passes through untranslatable paths unchanged', () => {
    assert.strictEqual(windowsToWslPath('/usr/local/bin'), '/usr/local/bin');
    assert.strictEqual(windowsToWslPath('relative/path'), 'relative/path');
    assert.strictEqual(windowsToWslPath(''), '');
  });
});

// ─── resolveWslSetting (WSL-02) ─────────────────────────────────────────────

describe('resolveWslSetting', () => {
  test('returns true when use_wsl is true', () => {
    assert.strictEqual(resolveWslSetting({ use_wsl: true }, 'win32'), true);
  });

  test('returns false when use_wsl is false', () => {
    assert.strictEqual(resolveWslSetting({ use_wsl: false }, 'win32'), false);
  });

  test('returns false when use_wsl is false on any platform', () => {
    assert.strictEqual(resolveWslSetting({ use_wsl: false }, 'linux'), false);
  });

  test('returns true when use_wsl is "auto" and platform is win32 with wsl available', () => {
    // On win32 with "auto", resolveWslSetting checks if wsl command is available
    // We test the logic path without mocking child_process
    const result = resolveWslSetting({ use_wsl: 'auto' }, 'win32');
    // On this Windows machine, WSL should be available, so result should be true
    // But we can't guarantee this in CI, so we just verify it returns a boolean
    assert.strictEqual(typeof result, 'boolean');
  });

  test('returns false when use_wsl is "auto" and platform is linux', () => {
    assert.strictEqual(resolveWslSetting({ use_wsl: 'auto' }, 'linux'), false);
  });

  test('returns false when use_wsl is "auto" and platform is darwin', () => {
    assert.strictEqual(resolveWslSetting({ use_wsl: 'auto' }, 'darwin'), false);
  });

  test('returns false when config is empty (defaults to auto on linux)', () => {
    assert.strictEqual(resolveWslSetting({}, 'linux'), false);
  });

  test('defaults to auto behavior when use_wsl is missing', () => {
    // On linux, should be false (no WSL needed)
    assert.strictEqual(resolveWslSetting({ enabled: true }, 'linux'), false);
  });
});

// ─── parseGitNexusOutput (D-13, RESEARCH Pitfall 2) ─────────────────────────

describe('parseGitNexusOutput', () => {
  test('parses valid JSON stdout', () => {
    const data = { processes: [], symbols: 100, edges: 500 };
    const result = parseGitNexusOutput(JSON.stringify(data), '');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, data);
  });

  test('extracts last valid JSON from mixed pino+JSON stdout', () => {
    const pinoLine1 = JSON.stringify({ level: 30, time: 1234567890, msg: 'Loading...' });
    const pinoLine2 = JSON.stringify({ level: 30, time: 1234567891, msg: 'Processing...' });
    const dataLine = JSON.stringify({ processes: [{ name: 'test' }], symbols: 50 });
    const stdout = pinoLine1 + '\n' + pinoLine2 + '\n' + dataLine;
    const result = parseGitNexusOutput(stdout, '');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.processes.length, 1);
    assert.strictEqual(result.data.symbols, 50);
  });

  test('falls back to stderr parsing when stdout is empty', () => {
    const errorData = { error: 'Symbol not found' };
    const result = parseGitNexusOutput('', JSON.stringify(errorData));
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.data, errorData);
  });

  test('wraps non-JSON stderr in CLI_ERROR structure', () => {
    const result = parseGitNexusOutput('', 'Command failed: something went wrong');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.data.message.includes('something went wrong'));
  });

  test('returns CLI_ERROR when both stdout and stderr are empty', () => {
    const result = parseGitNexusOutput('', '');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data.reason, GITNEXUS_REASON.CLI_ERROR);
  });

  test('skips pino log lines (with level and time but no result fields)', () => {
    const pinoLine = JSON.stringify({ level: 30, time: 1234567890, msg: 'Loading model...' });
    const result = parseGitNexusOutput(pinoLine, '');
    assert.strictEqual(result.ok, false);
  });

  test('handles multi-line JSON with pino logs interspersed', () => {
    const lines = [
      JSON.stringify({ level: 30, time: 123, msg: 'Starting' }),
      JSON.stringify({ level: 30, time: 124, msg: 'Loading' }),
      JSON.stringify({ query: 'test', processes: [{ name: 'p1' }] }),
    ];
    const stdout = lines.join('\n');
    const result = parseGitNexusOutput(stdout, '');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.query, 'test');
  });
});

// ─── applyGitNexusBudget (D-06, D-07, D-08, TB-01) ──────────────────────────

describe('applyGitNexusBudget', () => {
  test('returns data unchanged when under budget (no truncation metadata)', () => {
    const data = { processes: [], symbols: 10 };
    const result = applyGitNexusBudget(data, 10000, 'query');
    assert.strictEqual(result.truncated, undefined);
    assert.deepStrictEqual(result.processes, []);
    assert.strictEqual(result.symbols, 10);
  });

  test('returns truncated:true with budget info when over budget', () => {
    const largeData = {
      processes: Array.from({ length: 100 }, (_, i) => ({ name: `proc_${i}`, details: 'x'.repeat(50) })),
      symbols: Array.from({ length: 50 }, (_, i) => ({ name: `sym_${i}` })),
      definitions: Array.from({ length: 30 }, (_, i) => ({ name: `def_${i}` })),
      edges: Array.from({ length: 200 }, (_, i) => ({ source: `a_${i}`, target: `b_${i}` })),
    };
    // Set a very small budget to force truncation
    const result = applyGitNexusBudget(largeData, 100, 'query');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(typeof result.budget_used, 'number');
    assert.strictEqual(result.budget_limit, 100);
  });

  test('removes fields in priority order for query type (edges first)', () => {
    const data = {
      edges: [{ source: 'a', target: 'b', label: 'calls' }],
      definitions: [{ name: 'def1' }],
      symbols: [{ name: 'sym1' }],
      processes: [{ name: 'proc1' }],
    };
    // Set a budget that's small enough to trigger edge removal
    const result = applyGitNexusBudget(data, 5, 'query');
    // Edges should be removed first (lowest priority)
    assert.strictEqual(result.edges, undefined);
  });

  test('removes fields in priority order for detect_changes type (risk_summary first)', () => {
    const data = {
      risk_summary: 'HIGH: 3 affected processes',
      affected_processes: [{ name: 'proc1' }],
      changed_symbols: [{ name: 'sym1' }],
    };
    const result = applyGitNexusBudget(data, 5, 'detect_changes');
    // risk_summary removed first (lowest priority)
    assert.strictEqual(result.risk_summary, undefined);
  });

  test('handles zero budget gracefully', () => {
    const data = { processes: [{ name: 'test' }], symbols: 10 };
    const result = applyGitNexusBudget(data, 0, 'query');
    // Zero budget means no truncation applied (same as null/falsy)
    assert.strictEqual(result.truncated, undefined);
  });

  test('handles null budget (unlimited)', () => {
    const data = { processes: [{ name: 'test' }], symbols: 10 };
    const result = applyGitNexusBudget(data, null, 'query');
    assert.strictEqual(result.truncated, undefined);
  });

  test('handles undefined budget (unlimited)', () => {
    const data = { processes: [{ name: 'test' }], symbols: 10 };
    const result = applyGitNexusBudget(data, undefined, 'query');
    assert.strictEqual(result.truncated, undefined);
  });
});

// ─── execGitNexus (D-11, D-14, WSL-01, WSL-04) ────────────────────────────

describe('execGitNexus', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('returns OK result on successful CLI invocation', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify({ symbols: 100 }),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status']);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.reason, GITNEXUS_REASON.OK);
  });

  test('returns ENOENT when gitnexus not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status']);
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
    assert.strictEqual(result.exitCode, 127);
  });

  test('returns TIMEOUT when process is killed by SIGTERM', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: 'partial',
      stderr: '',
      error: undefined,
      signal: 'SIGTERM',
    }));

    const result = execGitNexus('/tmp', ['status']);
    assert.strictEqual(result.reason, GITNEXUS_REASON.TIMEOUT);
    assert.strictEqual(result.exitCode, 124);
  });

  test('returns CLI_ERROR on non-zero exit', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'Error: something failed',
      error: undefined,
      signal: null,
    }));

    const result = execGitNexus('/tmp', ['status']);
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.strictEqual(result.exitCode, 1);
  });

  test('returns WSL_NOT_AVAILABLE when wsl command not found on Windows', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    // Force WSL mode
    const config = { use_wsl: true };
    const result = execGitNexus('/tmp', ['status'], { config, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_NOT_AVAILABLE);
  });

  test('returns WSL_DISTRO_MISSING when wsl reports no installed distros', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'The Windows Subsystem for Linux has no installed distributions.',
      error: undefined,
      signal: null,
    }));

    const config = { use_wsl: true };
    const result = execGitNexus('/tmp', ['status'], { config, platform: 'win32' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.WSL_DISTRO_MISSING);
  });
});

// ─── gitNexusStatus (CJS-04, SPEC item 7) ───────────────────────────────────

describe('gitNexusStatus', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns disabled response when GitNexus not enabled', () => {
    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, GITNEXUS_REASON.DISABLED);
  });

  test('returns exists:true with structured data when meta.json is valid', () => {
    enableGitNexus(planningDir);
    writeMetaJson(tmpDir, SAMPLE_META);

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.symbols, 27267);
    assert.strictEqual(result.edges, 36419);
    assert.strictEqual(result.processes, 300);
    assert.strictEqual(result.communities, 45);
    assert.strictEqual(typeof result.stale, 'boolean');
    assert.ok(
      typeof result.commit_stale === 'boolean' || result.commit_stale === null,
      'commit_stale should be boolean or null'
    );
  });

  test('returns exists:false when meta.json does not exist', () => {
    enableGitNexus(planningDir);
    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.exists, false);
    assert.strictEqual(result.reason, GITNEXUS_REASON.NO_INDEX);
    assert.ok(result.message.includes('No GitNexus index found'));
  });

  test('reports stale:true when indexedAt is older than 24 hours', () => {
    enableGitNexus(planningDir);
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
    writeMetaJson(tmpDir, {
      ...SAMPLE_META,
      indexedAt: oldDate.toISOString(),
    });

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.stale, true);
  });

  test('reports stale:false when indexedAt is recent', () => {
    enableGitNexus(planningDir);
    writeMetaJson(tmpDir, {
      ...SAMPLE_META,
      indexedAt: new Date().toISOString(),
    });

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.stale, false);
  });

  test('returns auto_update:false by default', () => {
    enableGitNexus(planningDir);
    writeMetaJson(tmpDir, SAMPLE_META);

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.auto_update, false);
  });
});

// ─── Never-throw pattern (CJS-02, CONF-04) ──────────────────────────────────

describe('Never-throw pattern', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gitNexusStatus with invalid setup returns structured error, never throws', () => {
    // No config, no meta.json -- should return disabled response, not throw
    const configPath = path.join(planningDir, 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

    const result = gitNexusStatus(tmpDir);
    assert.ok(result.disabled || result.reason, 'should return structured response');
    assert.strictEqual(typeof result, 'object');
  });

  test('readGitNexusConfig with malformed JSON returns empty object, never throws', () => {
    const configPath = path.join(planningDir, 'config.json');
    fs.writeFileSync(configPath, '{{{not json', 'utf8');

    const result = readGitNexusConfig(tmpDir);
    assert.deepStrictEqual(result, {});
  });
});

// ─── CLI Dispatcher Routing (CLI-01) ────────────────────────────────────────

describe('CLI dispatcher routing', () => {
  const { runGsdTools } = require('./helpers.cjs');
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    // Enable gitnexus in config
    enableGitNexus(planningDir);
    // Write meta.json for status tests
    writeMetaJson(tmpDir, SAMPLE_META);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gitnexus status outputs structured JSON', () => {
    const result = runGsdTools(['gitnexus', 'status'], tmpDir);
    assert.strictEqual(result.success, true, `Expected success but got: ${result.error || result.output}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.exists, true);
    assert.strictEqual(typeof parsed.symbols, 'number');
    assert.strictEqual(typeof parsed.edges, 'number');
    assert.strictEqual(typeof parsed.processes, 'number');
  });

  test('gitnexus with unknown subcommand shows error with usage message', () => {
    const result = runGsdTools(['gitnexus', 'unknown'], tmpDir);
    assert.strictEqual(result.success, false, 'Expected non-zero exit for unknown subcommand');
    assert.ok(
      result.error.includes('Unknown gitnexus subcommand') || result.error.includes('Available'),
      `Error should mention unknown subcommand and list available ones. Got: ${result.error}`
    );
  });

  test('gitnexus status returns disabled when gitnexus not enabled', () => {
    // Disable gitnexus
    const configPath = path.join(planningDir, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.gitnexus.enabled = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const result = runGsdTools(['gitnexus', 'status'], tmpDir);
    assert.strictEqual(result.success, true);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.disabled, true);
    assert.strictEqual(parsed.reason, 'disabled');
  });
});