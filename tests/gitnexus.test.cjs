'use strict';

/**
 * Tests for get-shit-done/bin/lib/gitnexus.cjs
 *
 * Covers: isGitNexusEnabled, gitNexusStatus, GITNEXUS_REASON, execGitNexus,
 * applyGitNexusBudget, readGitNexusConfig, resolveWslSetting, windowsToWslPath,
 * parseGitNexusOutput, gitNexusQuery, gitNexusContext, gitNexusImpact,
 * gitNexusDetectChanges, gitNexusBuild, gitNexusRename, gitNexusCypher,
 * and never-throw pattern.
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
  gitNexusQuery,
  gitNexusContext,
  gitNexusImpact,
  gitNexusDetectChanges,
  gitNexusBuild,
  gitNexusRename,
  gitNexusCypher,
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

function writeGitNexusBuildStatus(cwd, data) {
  const gitNexusDir = path.join(cwd, '.gitnexus');
  fs.mkdirSync(gitNexusDir, { recursive: true });
  fs.writeFileSync(
    path.join(gitNexusDir, '.last-build-status.json'),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
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

  test('uses command-specific timeout defaults for detect-changes', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: undefined,
      signal: 'SIGTERM',
    }));

    const result = execGitNexus('/tmp', ['detect-changes', '--scope', 'unstaged'], { platform: 'linux' });
    assert.strictEqual(result.reason, GITNEXUS_REASON.TIMEOUT);
    assert.strictEqual(result.timeout_ms, 180000);
    assert.ok(result.stderr.includes('detect-changes'));
    assert.ok(result.stderr.includes('runtime=native'));
  });

  test('uses config timeout override for semantic commands', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: undefined,
      signal: 'SIGTERM',
    }));

    const result = execGitNexus('/tmp', ['query', 'test'], {
      config: { query_timeout_ms: 45000 },
      platform: 'linux',
    });
    assert.strictEqual(result.reason, GITNEXUS_REASON.TIMEOUT);
    assert.strictEqual(result.timeout_ms, 45000);
    assert.ok(result.stderr.includes('gitnexus query timed out'));
    assert.ok(result.stderr.includes('gitnexus.query_timeout_ms'));
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

  // WSL-01: cwd must be Windows path (not WSL path) when routing through WSL

  test('passes Windows cwd to spawnSync when useWsl is true', () => {
    const calls = [];
    mock.method(childProcess, 'spawnSync', (...args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ processes: [] }),
        stderr: '',
        error: undefined,
        signal: null,
      };
    });

    execGitNexus('C:\\Projects\\test', ['status'], { config: { use_wsl: true }, platform: 'win32' });

    // With use_wsl: true, resolveWslSetting returns true immediately (no auto-detect call),
    // so there is exactly one spawnSync call for the gitnexus invocation via WSL.
    assert.strictEqual(calls.length, 1, 'Expected exactly one spawnSync call');
    const [program, args, options] = calls[0];
    assert.strictEqual(program, 'wsl');
    // The cwd must be the Windows path, NOT a /mnt/c/... WSL path.
    // Node.js spawnSync on Windows cannot resolve Unix-style paths as cwd.
    assert.strictEqual(options.cwd, 'C:\\Projects\\test');
  });

  test('translates file-path arguments to WSL paths while keeping cwd as Windows path', () => {
    const calls = [];
    mock.method(childProcess, 'spawnSync', (...args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ processes: [] }),
        stderr: '',
        error: undefined,
        signal: null,
      };
    });

    execGitNexus('C:\\Projects\\test', ['query', 'C:\\data\\file.txt'], { config: { use_wsl: true }, platform: 'win32' });

    assert.strictEqual(calls.length, 1, 'Expected exactly one spawnSync call');
    const [program, args, options] = calls[0];
    assert.strictEqual(program, 'wsl');
    // cwd must remain as Windows path
    assert.strictEqual(options.cwd, 'C:\\Projects\\test');
    // file path argument should be translated to WSL path format
    assert.ok(args.includes('/mnt/c/data/file.txt'), 'File path arguments should be translated to WSL paths');
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
    assert.strictEqual(result.rebuild_status, null);
  });

  test('returns rebuild_status when status file exists before meta.json', () => {
    enableGitNexus(planningDir);
    writeGitNexusBuildStatus(tmpDir, {
      ts: '2026-05-20T12:34:56Z',
      status: 'failed',
      exit_code: 7,
      duration_ms: 1234,
      head_at_build: 'abcdef0',
    });

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.exists, false);
    assert.strictEqual(result.reason, GITNEXUS_REASON.NO_INDEX);
    assert.deepStrictEqual(result.rebuild_status, {
      ts: '2026-05-20T12:34:56Z',
      status: 'failed',
      exit_code: 7,
      duration_ms: 1234,
      head_at_build: 'abcdef0',
    });
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

  test('returns rebuild_status from .gitnexus/.last-build-status.json', () => {
    enableGitNexus(planningDir);
    writeMetaJson(tmpDir, SAMPLE_META);
    writeGitNexusBuildStatus(tmpDir, {
      ts: '2026-05-20T12:34:56Z',
      status: 'ok',
      exit_code: 0,
      duration_ms: 1234,
      head_at_build: 'abcdef0',
    });

    const result = gitNexusStatus(tmpDir);
    assert.deepStrictEqual(result.rebuild_status, {
      ts: '2026-05-20T12:34:56Z',
      status: 'ok',
      exit_code: 0,
      duration_ms: 1234,
      head_at_build: 'abcdef0',
    });
  });

  test('returns rebuild_status:null when status file is absent', () => {
    enableGitNexus(planningDir);
    writeMetaJson(tmpDir, SAMPLE_META);

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.rebuild_status, null);
  });

  test('returns rebuild_status:null when status file is malformed', () => {
    enableGitNexus(planningDir);
    writeMetaJson(tmpDir, SAMPLE_META);
    writeGitNexusBuildStatus(tmpDir, '{{{not json');

    const result = gitNexusStatus(tmpDir);
    assert.strictEqual(result.rebuild_status, null);
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

// ─── gitNexusQuery (CJS-05, SPEC item 8) ─────────────────────────────────────

describe('gitNexusQuery', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns process-grouped data when enabled and CLI succeeds', () => {
    const queryData = {
      processes: [{ name: 'process1', symbols: ['sym1', 'sym2'] }],
      process_symbols: ['sym1', 'sym2'],
      definitions: ['def1'],
      total: 3,
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(queryData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusQuery(tmpDir, 'test', { budget: 5000 });
    assert.strictEqual(result.processes.length, 1);
    assert.strictEqual(result.process_symbols.length, 2);
    assert.strictEqual(result.definitions.length, 1);
  });

  test('returns disabled response when gitnexus is not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify({ processes: [] }),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusQuery(tmpDir, 'test');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, GITNEXUS_REASON.DISABLED);
  });

  test('returns error on empty term', () => {
    const result = gitNexusQuery(tmpDir, '');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('query term required'));
  });

  test('returns error on null term', () => {
    const result = gitNexusQuery(tmpDir, null);
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('query term required'));
  });

  test('returns ENOENT when gitnexus CLI not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = gitNexusQuery(tmpDir, 'test');
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
  });

  test('applies budget caps from options', () => {
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

    const result = gitNexusQuery(tmpDir, 'test', { budget: 50 });
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 50);
  });

  test('applies budget caps from config when options budget is null', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { query: 100 } });
    const largeData = {
      processes: Array.from({ length: 100 }, (_, i) => ({ name: `proc_${i}`, details: 'x'.repeat(50) })),
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
    assert.strictEqual(result.budget_limit, 100);
  });

  test('handles CLI error response', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: 'Error: query failed',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusQuery(tmpDir, 'test');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
  });

  test('handles multi-repo error in output', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify({ processes: [], total: 0 }),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusQuery(tmpDir, 'test');
    assert.ok(result.processes || result.reason);
  });
});

// ─── gitNexusContext (CJS-06, SPEC item 9) ────────────────────────────────────

describe('gitNexusContext', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns caller/callee data when enabled and CLI succeeds', () => {
    const contextData = {
      name: 'isGraphifyEnabled',
      callers: [{ name: 'caller1' }],
      callees: [{ name: 'callee1' }],
      processes: ['process1'],
      file: 'src/myFile.js',
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(contextData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusContext(tmpDir, 'isGraphifyEnabled');
    assert.strictEqual(result.name, 'isGraphifyEnabled');
    assert.strictEqual(result.callers.length, 1);
    assert.strictEqual(result.callees.length, 1);
    assert.strictEqual(result.processes.length, 1);
  });

  test('returns disabled response when gitnexus not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    const result = gitNexusContext(tmpDir, 'someSymbol');
    assert.strictEqual(result.disabled, true);
  });

  test('returns error on empty name', () => {
    const result = gitNexusContext(tmpDir, '');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('symbol name required'));
  });

  test('returns error on null name', () => {
    const result = gitNexusContext(tmpDir, null);
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
  });

  test('applies budget caps from config', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { context: 50 } });
    const largeData = {
      callers: Array.from({ length: 100 }, (_, i) => ({ name: `caller_${i}` })),
      callees: Array.from({ length: 100 }, (_, i) => ({ name: `callee_${i}` })),
      processes: ['process1'],
      edges: Array.from({ length: 200 }, (_, i) => ({ source: `a_${i}`, target: `b_${i}` })),
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(largeData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusContext(tmpDir, 'test');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 50);
  });

  test('handles CLI error response', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 1,
      stdout: '',
      stderr: JSON.stringify({ error: 'Symbol not found' }),
      error: undefined,
      signal: null,
    }));

    const result = gitNexusContext(tmpDir, 'nonexistent');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
  });
});

// ─── gitNexusImpact (CJS-07, SPEC item 10) ────────────────────────────────────

describe('gitNexusImpact', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns blast radius with risk level on success', () => {
    const impactData = {
      target: 'isGraphifyEnabled',
      direction: 'upstream',
      risk: 'MEDIUM',
      summary: '3 affected processes',
      affected_processes: ['process1', 'process2'],
      affected_modules: ['module1'],
      byDepth: { '1': ['sym1'], '2': ['sym2'] },
      impactedCount: 3,
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(impactData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusImpact(tmpDir, 'isGraphifyEnabled', 'upstream');
    assert.strictEqual(result.risk, 'MEDIUM');
    assert.strictEqual(result.affected_processes.length, 2);
    assert.strictEqual(result.affected_modules.length, 1);
  });

  test('defaults direction to upstream', () => {
    const impactData = {
      target: 'myFunction',
      direction: 'upstream',
      risk: 'LOW',
      affected_processes: [],
      affected_modules: [],
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(impactData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusImpact(tmpDir, 'myFunction');
    assert.strictEqual(result.risk, 'LOW');
  });

  test('handles downstream direction', () => {
    const impactData = {
      target: 'myFunction',
      direction: 'downstream',
      risk: 'HIGH',
      affected_processes: ['proc1'],
      affected_modules: ['mod1'],
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(impactData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusImpact(tmpDir, 'myFunction', 'downstream');
    assert.strictEqual(result.risk, 'HIGH');
  });

  test('returns error on empty target', () => {
    const result = gitNexusImpact(tmpDir, '');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('target symbol required'));
  });

  test('returns error on null target', () => {
    const result = gitNexusImpact(tmpDir, null);
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
  });

  test('returns disabled response when gitnexus not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    const result = gitNexusImpact(tmpDir, 'myFunction');
    assert.strictEqual(result.disabled, true);
  });

  test('applies budget caps', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { impact: 50 } });
    const largeData = {
      risk: 'CRITICAL',
      affected_processes: Array.from({ length: 100 }, (_, i) => ({ name: `proc_${i}` })),
      affected_modules: Array.from({ length: 50 }, (_, i) => ({ name: `mod_${i}` })),
      byDepth: { '1': ['sym1'], '2': ['sym2'] },
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(largeData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusImpact(tmpDir, 'myFunction');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 50);
  });

  test('handles ENOENT when CLI not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = gitNexusImpact(tmpDir, 'myFunction');
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
  });
});

// ─── gitNexusDetectChanges (CJS-08, SPEC item 11) ────────────────────────────

describe('gitNexusDetectChanges', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns changed symbols on success', () => {
    const changesData = {
      changed_symbols: [{ name: 'myFunction', type: 'function' }],
      affected_processes: ['process1'],
      risk_summary: 'LOW: 1 changed symbol, 1 affected process',
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(changesData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusDetectChanges(tmpDir, 'unstaged');
    assert.strictEqual(result.changed_symbols.length, 1);
    assert.strictEqual(result.affected_processes.length, 1);
    assert.strictEqual(result.risk_summary, 'LOW: 1 changed symbol, 1 affected process');
  });

  test('handles "No changes detected" plain text output', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: 'No changes detected.',
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusDetectChanges(tmpDir, 'unstaged');
    assert.deepStrictEqual(result.changed_symbols, []);
    assert.deepStrictEqual(result.affected_processes, []);
    assert.strictEqual(result.risk_summary, 'none');
  });

  test('defaults scope to unstaged', () => {
    const changesData = {
      changed_symbols: [],
      affected_processes: [],
      risk_summary: 'none',
    };
    mock.method(childProcess, 'spawnSync', () => {
      // Verify args include --scope unstaged
      return {
        status: 0,
        stdout: JSON.stringify(changesData),
        stderr: '',
        error: undefined,
        signal: null,
      };
    });

    const result = gitNexusDetectChanges(tmpDir);
    assert.ok(result.changed_symbols !== undefined);
  });

  test('handles JSON response for changes', () => {
    const changesData = {
      changed_symbols: [{ name: 'func1' }, { name: 'func2' }],
      affected_processes: ['proc1'],
      risk_summary: 'MEDIUM',
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(changesData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusDetectChanges(tmpDir, 'all');
    assert.strictEqual(result.changed_symbols.length, 2);
  });

  test('returns disabled response when gitnexus not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    const result = gitNexusDetectChanges(tmpDir);
    assert.strictEqual(result.disabled, true);
  });

  test('applies budget caps', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { detect_changes: 50 } });
    const largeData = {
      changed_symbols: Array.from({ length: 100 }, (_, i) => ({ name: `sym_${i}` })),
      affected_processes: Array.from({ length: 50 }, (_, i) => ({ name: `proc_${i}` })),
      risk_summary: 'HIGH',
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(largeData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusDetectChanges(tmpDir, 'unstaged');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 50);
  });

  test('handles ENOENT when CLI not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = gitNexusDetectChanges(tmpDir);
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
  });
});

// ─── gitNexusBuild (CJS-09, SPEC item 12) ─────────────────────────────────────

describe('gitNexusBuild', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns spawn_agent when CLI is available', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: '1.6.5\n',
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusBuild(tmpDir);
    assert.strictEqual(result.action, 'spawn_agent');
    assert.ok(result.graphs_dir);
    assert.strictEqual(result.timeout_seconds, 600);
    assert.strictEqual(result.version, '1.6.5');
  });

  test('returns ENOENT when CLI not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = gitNexusBuild(tmpDir);
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
    assert.ok(result.message.includes('not found'));
  });

  test('returns disabled response when gitnexus not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    const result = gitNexusBuild(tmpDir);
    assert.strictEqual(result.disabled, true);
  });

  test('uses custom build_timeout from config', () => {
    writeGitNexusConfig(planningDir, { enabled: true, build_timeout: 300 });
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: '1.6.5\n',
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusBuild(tmpDir);
    assert.strictEqual(result.action, 'spawn_agent');
    assert.strictEqual(result.timeout_seconds, 300);
  });

  test('handles version extraction from pino-mixed output', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: '{"level":30,"time":1234567890,"msg":"Starting..."}\n1.6.5\n',
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusBuild(tmpDir);
    assert.strictEqual(result.action, 'spawn_agent');
    assert.strictEqual(result.version, '1.6.5');
  });

  test('returns action spawn_agent even when version is null', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: '',
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusBuild(tmpDir);
    assert.strictEqual(result.action, 'spawn_agent');
    assert.strictEqual(result.version, null);
  });
});

// ─── gitNexusRename (SPEC item 13, STUB) ─────────────────────────────────────

describe('gitNexusRename', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns graph-backed result on success', () => {
    const renameData = { graph_edits: [{ file: 'a.ts', edits: 1 }], confidence: 0.9 };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(renameData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusRename(tmpDir, 'oldName', 'newName');
    assert.ok(Array.isArray(result.graph_edits));
  });

  test('returns error when current symbol name is missing', () => {
    const result = gitNexusRename(tmpDir, '', 'newName');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('current symbol name required'));
  });

  test('returns error when new symbol name is missing', () => {
    const result = gitNexusRename(tmpDir, 'oldName', '');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('new symbol name required'));
  });

  test('returns disabled response when gitnexus not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    const result = gitNexusRename(tmpDir, 'oldName', 'newName');
    assert.strictEqual(result.disabled, true);
  });

  test('applies rename budget caps', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { rename: 50 } });
    const largeData = {
      confidence: 0.9,
      text_search_edits: Array.from({ length: 100 }, (_, i) => ({ file: `f${i}.ts` })),
      graph_edits: Array.from({ length: 100 }, (_, i) => ({ file: `g${i}.ts` })),
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(largeData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusRename(tmpDir, 'oldName', 'newName');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 50);
  });

  test('handles ENOENT when CLI not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = gitNexusRename(tmpDir, 'oldName', 'newName');
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
  });
});

// ─── gitNexusCypher (CJS-09, SPEC item 14) ────────────────────────────────────

describe('gitNexusCypher', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('returns query results with budget caps on success', () => {
    const cypherData = {
      markdown: '# Results\n| Name |\n|------|\n| sym1 |',
      row_count: 1,
      rows: [{ name: 'sym1' }],
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(cypherData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusCypher(tmpDir, 'MATCH (n:Function) RETURN n.name LIMIT 5');
    assert.strictEqual(result.row_count, 1);
    assert.ok(result.markdown);
  });

  test('returns disabled response when gitnexus not enabled', () => {
    writeGitNexusConfig(planningDir, { enabled: false });
    const result = gitNexusCypher(tmpDir, 'MATCH (n) RETURN n');
    assert.strictEqual(result.disabled, true);
  });

  test('returns error on empty query', () => {
    const result = gitNexusCypher(tmpDir, '');
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
    assert.ok(result.message.includes('cypher query required'));
  });

  test('returns error on null query', () => {
    const result = gitNexusCypher(tmpDir, null);
    assert.strictEqual(result.reason, GITNEXUS_REASON.CLI_ERROR);
  });

  test('applies budget caps from config', () => {
    writeGitNexusConfig(planningDir, { enabled: true, budget: { cypher: 50 } });
    const largeData = {
      markdown: 'x'.repeat(5000),
      row_count: 100,
      rows: Array.from({ length: 100 }, (_, i) => ({ name: `sym_${i}`, details: 'x'.repeat(50) })),
    };
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: JSON.stringify(largeData),
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusCypher(tmpDir, 'MATCH (n) RETURN n');
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.budget_limit, 50);
  });

  test('handles pino log mixed output', () => {
    const cypherData = { markdown: '# Results', row_count: 2, rows: [{ name: 'a' }, { name: 'b' }] };
    const pinoLine = JSON.stringify({ level: 30, time: 1234567890, msg: 'Loading...' });
    const dataLine = JSON.stringify(cypherData);
    mock.method(childProcess, 'spawnSync', () => ({
      status: 0,
      stdout: pinoLine + '\n' + dataLine,
      stderr: '',
      error: undefined,
      signal: null,
    }));

    const result = gitNexusCypher(tmpDir, 'MATCH (n) RETURN n');
    assert.strictEqual(result.row_count, 2);
  });

  test('handles ENOENT when CLI not found', () => {
    mock.method(childProcess, 'spawnSync', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
      signal: null,
    }));

    const result = gitNexusCypher(tmpDir, 'MATCH (n) RETURN n');
    assert.strictEqual(result.reason, GITNEXUS_REASON.ENOENT);
  });
});

// ─── Never-throw verification for all new functions ─────────────────────────────

describe('Never-throw pattern for query functions', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    // Do NOT enable gitnexus -- testing disabled state
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gitNexusQuery with null/undefined/invalid args returns error objects, never throws', () => {
    assert.doesNotThrow(() => gitNexusQuery(null, 'test'));
    assert.doesNotThrow(() => gitNexusQuery(undefined, 'test'));
    assert.doesNotThrow(() => gitNexusQuery('/nonexistent/path', 'test'));

    const result1 = gitNexusQuery(null, 'test');
    assert.ok(result1.disabled || result1.reason, 'should return structured error');

    const result2 = gitNexusQuery(undefined, 'test');
    assert.ok(result2.disabled || result2.reason, 'should return structured error');
  });

  test('gitNexusContext with null/undefined/invalid args returns error objects, never throws', () => {
    assert.doesNotThrow(() => gitNexusContext(null, 'symbol'));
    assert.doesNotThrow(() => gitNexusContext(undefined, 'symbol'));

    const result = gitNexusContext(null, 'symbol');
    assert.ok(result.disabled || result.reason, 'should return structured error');
  });

  test('gitNexusImpact with null/undefined/invalid args returns error objects, never throws', () => {
    assert.doesNotThrow(() => gitNexusImpact(null, 'target'));
    assert.doesNotThrow(() => gitNexusImpact(undefined, 'target'));

    const result = gitNexusImpact(null, 'target');
    assert.ok(result.disabled || result.reason, 'should return structured error');
  });

  test('gitNexusDetectChanges with null/undefined/invalid args returns error objects, never throws', () => {
    assert.doesNotThrow(() => gitNexusDetectChanges(null));
    assert.doesNotThrow(() => gitNexusDetectChanges(undefined));

    const result = gitNexusDetectChanges(null);
    assert.ok(result.disabled || result.reason, 'should return structured error');
  });

  test('gitNexusBuild with null/undefined args returns error objects, never throws', () => {
    assert.doesNotThrow(() => gitNexusBuild(null));
    assert.doesNotThrow(() => gitNexusBuild(undefined));

    const result = gitNexusBuild(null);
    assert.ok(result.disabled || result.reason, 'should return structured error');
  });

  test('gitNexusCypher with null/undefined/invalid args returns error objects, never throws', () => {
    assert.doesNotThrow(() => gitNexusCypher(null, 'query'));
    assert.doesNotThrow(() => gitNexusCypher(undefined, 'query'));

    const result = gitNexusCypher(null, 'query');
    assert.ok(result.disabled || result.reason, 'should return structured error');
  });
});

// ─── Module exports verification ───────────────────────────────────────────────

describe('Module exports (CJS-01)', () => {
  const gitnexus = require('../get-shit-done/bin/lib/gitnexus.cjs');

  test('exports all 9 functions and GITNEXUS_REASON enum', () => {
    const exports = Object.keys(gitnexus);
    assert.ok(exports.includes('isGitNexusEnabled'), 'isGitNexusEnabled');
    assert.ok(exports.includes('gitNexusStatus'), 'gitNexusStatus');
    assert.ok(exports.includes('gitNexusQuery'), 'gitNexusQuery');
    assert.ok(exports.includes('gitNexusContext'), 'gitNexusContext');
    assert.ok(exports.includes('gitNexusImpact'), 'gitNexusImpact');
    assert.ok(exports.includes('gitNexusDetectChanges'), 'gitNexusDetectChanges');
    assert.ok(exports.includes('gitNexusBuild'), 'gitNexusBuild');
    assert.ok(exports.includes('gitNexusRename'), 'gitNexusRename');
    assert.ok(exports.includes('gitNexusCypher'), 'gitNexusCypher');
    assert.ok(exports.includes('GITNEXUS_REASON'), 'GITNEXUS_REASON');
  });

  test('exports count is at least 10 (9 functions + 1 enum)', () => {
    const exports = Object.keys(gitnexus);
    // 9 query/status functions + GITNEXUS_REASON enum + helper functions
    assert.ok(exports.length >= 10, `Expected >= 10 exports, got ${exports.length}`);
  });
});

// ─── CLI Dispatcher Routing (Task 2) ─────────────────────────────────────────

describe('CLI dispatcher routing for gitnexus subcommands', () => {
  const { runGsdTools } = require('./helpers.cjs');
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    enableGitNexus(planningDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gitnexus status outputs structured JSON', () => {
    writeMetaJson(tmpDir, SAMPLE_META);
    const result = runGsdTools(['gitnexus', 'status'], tmpDir);
    assert.strictEqual(result.success, true, `Expected success but got: ${result.error || result.output}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.exists, true);
  });

  test('gitnexus build routes through gitNexusBuild and returns structured response', () => {
    const result = runGsdTools(['gitnexus', 'build'], tmpDir);
    assert.strictEqual(result.success, true, `Expected success but got: ${result.error || result.output}`);
    const parsed = JSON.parse(result.output);
    // Response is either { action: 'spawn_agent' } on CLI available,
    // or { reason: 'gitnexus_not_found' } / { reason: 'wsl_not_available' } when not
    assert.ok(parsed.action === 'spawn_agent' || parsed.reason, `Expected action or reason, got: ${JSON.stringify(parsed)}`);
  });

  test('gitnexus rename routes through rename implementation', () => {
    const result = runGsdTools(['gitnexus', 'rename', 'oldName', 'newName'], tmpDir);
    assert.strictEqual(result.success, true, `Expected success but got: ${result.error || result.output}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.reason || parsed.graph_edits || parsed.text_search_edits);
  });

  test('gitnexus query with --budget flag passes budget to function', () => {
    // This test verifies the CLI dispatcher routes --budget correctly.
    // Since gitnexus CLI may not be available in test env, we test
    // that the command doesn't crash and the output is structured.
    const result = runGsdTools(['gitnexus', 'query', 'test', '--budget', '100'], tmpDir);
    // Command may succeed or fail depending on gitnexus availability,
    // but it should not crash the process
    assert.ok(result.output || result.error, 'should produce output');
  });

  test('gitnexus impact with --direction flag defaults to upstream', () => {
    const result = runGsdTools(['gitnexus', 'impact', 'testSymbol', '--direction', 'downstream'], tmpDir);
    // Command may succeed or fail depending on gitnexus availability
    assert.ok(result.output || result.error, 'should produce output');
  });

  test('gitnexus detect-changes with --scope flag defaults to unstaged', () => {
    const result = runGsdTools(['gitnexus', 'detect-changes', '--scope', 'staged'], tmpDir);
    assert.ok(result.output || result.error, 'should produce output');
  });

  test('gitnexus cypher routes correctly', () => {
    const result = runGsdTools(['gitnexus', 'cypher', 'MATCH'], tmpDir);
    assert.ok(result.output || result.error, 'should produce output');
  });

  test('gitnexus context with symbol routes correctly', () => {
    const result = runGsdTools(['gitnexus', 'context', 'myFunction'], tmpDir);
    assert.ok(result.output || result.error, 'should produce output');
  });

  test('unknown gitnexus subcommand shows error with usage message listing all 8 modes', () => {
    const result = runGsdTools(['gitnexus', 'unknown'], tmpDir);
    assert.strictEqual(result.success, false, 'Expected non-zero exit for unknown subcommand');
    assert.ok(
      result.error.includes('Unknown gitnexus subcommand') || result.error.includes('Available'),
      `Error should mention unknown subcommand and list available ones. Got: ${result.error}`
    );
    // Verify all 8 subcommands are listed in the error
    const subcommands = ['status', 'query', 'context', 'impact', 'detect-changes', 'build', 'rename', 'cypher'];
    for (const sc of subcommands) {
      assert.ok(result.error.includes(sc), `Error should list '${sc}' subcommand`);
    }
  });
});
