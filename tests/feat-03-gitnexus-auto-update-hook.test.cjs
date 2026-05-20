'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'gsd-gitnexus-update.sh');
const REBUILD = path.join(ROOT, 'hooks', 'lib', 'gsd-gitnexus-rebuild.sh');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function createTempGitRepo(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-03-gitnexus-'));
  cp.execFileSync('git', ['init', '-b', opts.defaultBranch || 'main'], {
    cwd: tmpDir,
    stdio: 'ignore',
  });
  cp.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  cp.execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
  cp.execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
  cp.execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'ignore' });

  fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  if (opts.config !== undefined) {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify(opts.config, null, 2),
    );
  }
  return tmpDir;
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-03-gitnexus-'));
}

function makeConfig(overrides = {}) {
  return {
    gitnexus: {
      enabled: true,
      auto_update: true,
      auto_update_triggers: ['commit'],
      ...overrides,
    },
  };
}

function makeMockGitNexusPath(tmpDir, { exitCode = 0, sleepMs = 0 } = {}) {
  const binDir = path.join(tmpDir, '.mock-bin');
  fs.mkdirSync(binDir, { recursive: true });
  const logFile = path.join(tmpDir, 'mock-npx.log').replace(/\\/g, '/');
  const sleepLine = sleepMs ? `sleep ${(sleepMs / 1000).toFixed(3)}` : '';
  const npxBody = [
    '#!/usr/bin/env bash',
    'set -u',
    `printf '%s\\n' "$*" >> "${logFile}"`,
    sleepLine,
    `exit ${exitCode}`,
  ]
    .filter(Boolean)
    .join('\n');
  fs.writeFileSync(path.join(binDir, 'npx'), npxBody + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'gitnexus'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return { binDir, logFile };
}

function runHook(tmpDir, input, { env = {}, pathPrepend = '' } = {}) {
  const PATH = pathPrepend
    ? `${pathPrepend}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH || '';
  return cp.spawnSync('bash', [HOOK], {
    cwd: tmpDir,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: {
      ...process.env,
      PATH,
      CI: '',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30000,
  });
}

function runHelper(tmpDir, { exitCode = 0, sleepMs = 0 } = {}) {
  const { binDir, logFile } = makeMockGitNexusPath(tmpDir, { exitCode, sleepMs });
  const statusFile = path.join(tmpDir, '.gitnexus', '.last-build-status.json');
  const lockFile = path.join(tmpDir, '.gitnexus', '.rebuild.lock');
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  const result = cp.spawnSync(
    'bash',
    [REBUILD, statusFile, lockFile, 'abc1234', String(Date.now())],
    {
      cwd: tmpDir,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  return { result, statusFile, lockFile, logFile };
}

function waitForStatus(tmpDir, expected, timeoutMs = 8000) {
  const statusPath = path.join(tmpDir, '.gitnexus', '.last-build-status.json');
  const deadline = Date.now() + timeoutMs;
  let status;
  while (Date.now() < deadline) {
    if (fs.existsSync(statusPath)) {
      try {
        status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        if (!expected || status.status === expected) return status;
      } catch {
        // Detached writer can briefly expose partial JSON.
      }
    }
    sleep(50);
  }
  return status;
}

function statusExists(tmpDir) {
  return fs.existsSync(path.join(tmpDir, '.gitnexus', '.last-build-status.json'));
}

function cleanup(tmpDir) {
  const lockPath = path.join(tmpDir, '.gitnexus', '.rebuild.lock');
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!fs.existsSync(lockPath)) break;
    const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
    if (!Number.isFinite(pid) || pid <= 0) break;
    try {
      process.kill(pid, 0);
    } catch {
      break;
    }
    sleep(50);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

describe('GitNexus hook no-op gates', () => {
  test('empty stdin, malformed JSON, missing tool_name, unrelated tool, and unrelated Bash command exit 0 without dispatch', (t) => {
    const tmpDir = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(tmpDir));
    const { binDir } = makeMockGitNexusPath(tmpDir);

    for (const input of [
      '',
      '{not-json',
      { tool_input: { command: 'git commit -m x' } },
      { tool_name: 'Edit', tool_input: { file_path: 'x' } },
      { tool_name: 'Bash', tool_input: { command: 'ls -la' } },
    ]) {
      const r = runHook(tmpDir, input, { pathPrepend: binDir });
      assert.strictEqual(r.status, 0);
      assert.equal(statusExists(tmpDir), false);
    }
  });

  test('CI, outside git repo, non-default branch, disabled config, missing executable, and live lock no-op', (t) => {
    const outsideRepo = createTempDir();
    t.after(() => cleanup(outsideRepo));
    const outsideMock = makeMockGitNexusPath(outsideRepo);
    fs.mkdirSync(path.join(outsideRepo, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(outsideRepo, '.planning', 'config.json'),
      JSON.stringify(makeConfig(), null, 2),
    );
    assert.strictEqual(
      runHook(outsideRepo, { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, { pathPrepend: outsideMock.binDir }).status,
      0,
    );
    assert.equal(statusExists(outsideRepo), false);

    const cases = [
      { config: makeConfig(), env: { CI: 'true' }, reason: 'CI' },
      { config: { ...makeConfig(), git: { base_branch: 'trunk' } }, reason: 'non-default branch' },
      { config: makeConfig({ enabled: false }), reason: 'gitnexus.enabled=false' },
      { config: makeConfig({ auto_update: false }), reason: 'gitnexus.auto_update=false' },
    ];
    for (const c of cases) {
      const tmpDir = createTempGitRepo({ config: c.config });
      t.after(() => cleanup(tmpDir));
      const { binDir } = makeMockGitNexusPath(tmpDir);
      const r = runHook(
        tmpDir,
        { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } },
        { env: c.env || {}, pathPrepend: binDir },
      );
      assert.strictEqual(r.status, 0, c.reason);
      assert.equal(statusExists(tmpDir), false, c.reason);
    }

    const missingBinRepo = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(missingBinRepo));
    const missingBin = runHook(
      missingBinRepo,
      { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } },
      { env: { PATH: '/usr/bin:/bin' } },
    );
    assert.strictEqual(missingBin.status, 0);
    assert.equal(statusExists(missingBinRepo), false);

    const liveLockRepo = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(liveLockRepo));
    fs.mkdirSync(path.join(liveLockRepo, '.gitnexus'), { recursive: true });
    fs.writeFileSync(path.join(liveLockRepo, '.gitnexus', '.rebuild.lock'), String(process.pid));
    const liveMock = makeMockGitNexusPath(liveLockRepo);
    const live = runHook(
      liveLockRepo,
      { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } },
      { pathPrepend: liveMock.binDir },
    );
    assert.strictEqual(live.status, 0);
    assert.equal(statusExists(liveLockRepo), false);
  });

  test('stale GitNexus lock is removed and dispatch proceeds', (t) => {
    const tmpDir = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(tmpDir));
    fs.mkdirSync(path.join(tmpDir, '.gitnexus'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.gitnexus', '.rebuild.lock'), '4194303');
    const { binDir } = makeMockGitNexusPath(tmpDir, { sleepMs: 500 });

    const r = runHook(
      tmpDir,
      { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } },
      { pathPrepend: binDir },
    );
    assert.strictEqual(r.status, 0);
    const status = waitForStatus(tmpDir);
    assert.ok(status, 'stale lock must not block dispatch');
  });
});

describe('GitNexus hook commit and MCP triggers', () => {
  test('commit trigger works for HEAD-advancing git commands and exact gsd-sdk query commit shapes', (t) => {
    const commands = [
      'git commit -m fix',
      'git merge feature',
      'git pull --ff-only',
      'git rebase --continue',
      'git cherry-pick abc123',
      'gsd-sdk query commit "docs: probe" --files .planning/STATE.md',
      'npx gsd-sdk query commit "docs: probe" --files .planning/STATE.md',
    ];

    for (const command of commands) {
      const tmpDir = createTempGitRepo({ config: makeConfig() });
      t.after(() => cleanup(tmpDir));
      const { binDir } = makeMockGitNexusPath(tmpDir, { sleepMs: 100 });
      const r = runHook(tmpDir, { tool_name: 'Bash', tool_input: { command } }, { pathPrepend: binDir });
      assert.strictEqual(r.status, 0, command);
      assert.ok(waitForStatus(tmpDir), command);
    }
  });

  test('non-commit SDK prefix collision does not dispatch', (t) => {
    const tmpDir = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(tmpDir));
    const { binDir } = makeMockGitNexusPath(tmpDir);
    const r = runHook(
      tmpDir,
      { tool_name: 'Bash', tool_input: { command: 'gsd-sdk query commit-to-subrepo "msg" --files x' } },
      { pathPrepend: binDir },
    );
    assert.strictEqual(r.status, 0);
    assert.equal(statusExists(tmpDir), false);
  });

  test('mcp trigger short names map exactly to full GitNexus tool names and bypass commit/branch gates', (t) => {
    const mappings = [
      ['mcp_query', 'mcp__gitnexus__query'],
      ['mcp_context', 'mcp__gitnexus__context'],
      ['mcp_impact', 'mcp__gitnexus__impact'],
      ['mcp_detect_changes', 'mcp__gitnexus__detect_changes'],
    ];

    for (const [trigger, toolName] of mappings) {
      const tmpDir = createTempGitRepo({
        config: { ...makeConfig({ auto_update_triggers: [trigger] }), git: { base_branch: 'trunk' } },
      });
      t.after(() => cleanup(tmpDir));
      const { binDir } = makeMockGitNexusPath(tmpDir, { sleepMs: 100 });
      const r = runHook(tmpDir, { tool_name: toolName, tool_response: { is_error: false } }, { pathPrepend: binDir });
      assert.strictEqual(r.status, 0, toolName);
      assert.ok(waitForStatus(tmpDir), toolName);
    }
  });

  test('prefix collisions, unlisted tools, invalid trigger config, and failed MCP calls do not dispatch', (t) => {
    const cases = [
      {
        config: makeConfig({ auto_update_triggers: ['mcp_query'] }),
        payload: { tool_name: 'mcp__gitnexus__query_extra' },
        reason: 'prefix collision',
      },
      {
        config: makeConfig({ auto_update_triggers: ['mcp_query'] }),
        payload: { tool_name: 'prefix_mcp__gitnexus__query' },
        reason: 'substring collision',
      },
      {
        config: makeConfig({ auto_update_triggers: ['mcp_query'] }),
        payload: { tool_name: 'mcp__gitnexus__context' },
        reason: 'unlisted MCP tool',
      },
      {
        config: makeConfig({ auto_update_triggers: ['mcp__gitnexus__query'] }),
        payload: { tool_name: 'mcp__gitnexus__query' },
        reason: 'invalid full-name config value ignored',
      },
      {
        config: makeConfig({ auto_update_triggers: ['mcp_query'] }),
        payload: { tool_name: 'mcp__gitnexus__query', tool_response: { is_error: true } },
        reason: 'tool_response.is_error',
      },
      {
        config: makeConfig({ auto_update_triggers: ['mcp_query'] }),
        payload: { tool_name: 'mcp__gitnexus__query', tool_response: { error: 'boom' } },
        reason: 'tool_response.error',
      },
      {
        config: makeConfig({ auto_update_triggers: ['mcp_query'] }),
        payload: { tool_name: 'mcp__gitnexus__query', error: 'boom' },
        reason: 'top-level error',
      },
    ];

    for (const c of cases) {
      const tmpDir = createTempGitRepo({ config: c.config });
      t.after(() => cleanup(tmpDir));
      const { binDir } = makeMockGitNexusPath(tmpDir);
      const r = runHook(tmpDir, c.payload, { pathPrepend: binDir });
      assert.strictEqual(r.status, 0, c.reason);
      assert.equal(statusExists(tmpDir), false, c.reason);
    }
  });
});

describe('GitNexus rebuild helper', () => {
  test('writes ok status, removes lock, and invokes index-only analyze', (t) => {
    const tmpDir = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(tmpDir));
    const { result, statusFile, lockFile, logFile } = runHelper(tmpDir, { exitCode: 0 });

    assert.strictEqual(result.status, 0);
    assert.equal(fs.existsSync(lockFile), false);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    assert.strictEqual(status.status, 'ok');
    assert.strictEqual(status.exit_code, 0);
    assert.strictEqual(status.head_at_build, 'abc1234');
    assert.equal(typeof status.duration_ms, 'number');
    assert.match(fs.readFileSync(logFile, 'utf8'), /^gitnexus analyze --index-only$/m);
  });

  test('writes failed status and removes lock when analyze fails', (t) => {
    const tmpDir = createTempGitRepo({ config: makeConfig() });
    t.after(() => cleanup(tmpDir));
    const { result, statusFile, lockFile } = runHelper(tmpDir, { exitCode: 7 });

    assert.strictEqual(result.status, 0, 'helper should not propagate analyze failure');
    assert.equal(fs.existsSync(lockFile), false);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    assert.strictEqual(status.status, 'failed');
    assert.strictEqual(status.exit_code, 7);
    assert.strictEqual(status.head_at_build, 'abc1234');
  });
});
