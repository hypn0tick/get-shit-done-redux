'use strict';

/**
 * Tests for CONF-04: Graphify fallback behavior when GitNexus is disabled.
 *
 * Verifies that:
 * 1. GitNexus functions return clean disabled responses when gitnexus.enabled=false
 * 2. Graphify functions continue working independently when gitnexus.enabled=false
 * 3. No errors or exceptions propagate between the two modules
 */

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { createTempProject, cleanup } = require('./helpers.cjs');

const gitnexus = require('../get-shit-done/bin/lib/gitnexus.cjs');
const graphify = require('../get-shit-done/bin/lib/graphify.cjs');

// ─── Helpers ────────────────────────────────────────────────────────────────

function writeConfig(planningDir, gitnexusConfig, graphifyConfig) {
  const configPath = path.join(planningDir, 'config.json');
  const config = {};
  if (gitnexusConfig !== undefined) config.gitnexus = gitnexusConfig;
  if (graphifyConfig !== undefined) config.graphify = graphifyConfig;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function writeGraphJson(planningDir, nodes, edges) {
  const graphsDir = path.join(planningDir, 'graphs');
  fs.mkdirSync(graphsDir, { recursive: true });
  fs.writeFileSync(
    path.join(graphsDir, 'graph.json'),
    JSON.stringify({ nodes: nodes || [], edges: edges || [] }, null, 2),
    'utf8'
  );
}

// ─── GitNexus returns clean disabled response when disabled (CONF-04) ──────

describe('CONF-04: GitNexus disabled — clean error responses', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    writeConfig(planningDir, { enabled: false }, { enabled: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gitNexusQuery returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusQuery(tmpDir, 'test');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
    assert.ok(result.message.includes('not enabled'));
  });

  test('gitNexusContext returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusContext(tmpDir, 'mySymbol');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });

  test('gitNexusImpact returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusImpact(tmpDir, 'mySymbol');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });

  test('gitNexusDetectChanges returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusDetectChanges(tmpDir);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });

  test('gitNexusBuild returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusBuild(tmpDir);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });

  test('gitNexusCypher returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusCypher(tmpDir, 'MATCH (n) RETURN n');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });

  test('gitNexusStatus returns disabled response when gitnexus.enabled=false', () => {
    const result = gitnexus.gitNexusStatus(tmpDir);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });
});

// ─── Graphify works independently when gitnexus.enabled=false (CONF-04) ────

describe('CONF-04: Graphify operates independently when gitnexus is disabled', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    // gitnexus disabled, graphify enabled
    writeConfig(planningDir, { enabled: false }, { enabled: true });
    // Write a graph so graphify can operate
    writeGraphJson(planningDir,
      [{ id: 'n1', label: 'myFunction' }, { id: 'n2', label: 'helper' }],
      [{ source: 'n1', target: 'n2', label: 'calls' }]
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('graphifyQuery returns results when gitnexus is disabled', () => {
    const result = graphify.graphifyQuery(tmpDir, 'myFunction');
    assert.ok(!result.disabled, 'graphifyQuery should not be disabled');
    assert.ok(!result.error, `graphifyQuery should not return error, got: ${result.error}`);
    assert.strictEqual(result.term, 'myFunction');
    assert.ok(result.nodes.length >= 1, `should find at least 1 matching node, found ${result.nodes.length}`);
  });

  test('graphifyStatus returns structured data when gitnexus is disabled', () => {
    const result = graphify.graphifyStatus(tmpDir);
    assert.ok(!result.disabled, 'graphifyStatus should not be disabled');
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.node_count, 2);
    assert.strictEqual(result.edge_count, 1);
  });

  test('isGraphifyEnabled returns true independently of gitnexus.enabled', () => {
    const result = graphify.isGraphifyEnabled(planningDir);
    assert.strictEqual(result, true, 'graphify should be enabled even when gitnexus is disabled');
  });

  test('gitnexus isGitNexusEnabled returns false in same project', () => {
    const result = gitnexus.isGitNexusEnabled(planningDir);
    assert.strictEqual(result, false, 'gitnexus should be disabled');
  });
});

// ─── No cross-module error propagation (CONF-04) ──────────────────────────

describe('CONF-04: No error propagation between gitnexus and graphify', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    // gitnexus disabled, graphify enabled
    writeConfig(planningDir, { enabled: false }, { enabled: true });
    writeGraphJson(planningDir,
      [{ id: 'n1', label: 'testNode' }],
      []
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
    mock.restoreAll();
  });

  test('gitnexus disabled response does not throw exceptions', () => {
    assert.doesNotThrow(() => {
      gitnexus.gitNexusQuery(tmpDir, 'test');
      gitnexus.gitNexusContext(tmpDir, 'test');
      gitnexus.gitNexusImpact(tmpDir, 'test');
      gitnexus.gitNexusDetectChanges(tmpDir);
      gitnexus.gitNexusBuild(tmpDir);
      gitnexus.gitNexusCypher(tmpDir, 'MATCH (n) RETURN n');
    }, 'gitnexus disabled responses should never throw');
  });

  test('graphify functions never throw when gitnexus is disabled', () => {
    assert.doesNotThrow(() => {
      graphify.graphifyQuery(tmpDir, 'testNode');
      graphify.graphifyStatus(tmpDir);
    }, 'graphify should never throw regardless of gitnexus state');
  });

  test('gitnexus disabled response has no graphify-related side effects', () => {
    // Call a gitnexus function — it should return disabled, not mutate graph data
    const gitnexusResult = gitnexus.gitNexusQuery(tmpDir, 'testNode');
    assert.strictEqual(gitnexusResult.disabled, true);

    // Verify graphify graph data is untouched
    const graphPath = path.join(planningDir, 'graphs', 'graph.json');
    assert.ok(fs.existsSync(graphPath), 'graph.json should still exist');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.strictEqual(graph.nodes.length, 1);
    assert.strictEqual(graph.nodes[0].label, 'testNode');
  });

  test('graphify disabled response does not interfere with gitnexus config reading', () => {
    // Both disabled — verify each module reads its own config independently
    writeConfig(planningDir, { enabled: false }, { enabled: false });

    const gitnexusConfig = gitnexus.readGitNexusConfig(tmpDir);
    assert.strictEqual(gitnexusConfig.enabled, false);

    // graphify reads its own config, not gitnexus config
    const graphifyEnabled = graphify.isGraphifyEnabled(planningDir);
    assert.strictEqual(graphifyEnabled, false);

    const gitnexusEnabled = gitnexus.isGitNexusEnabled(planningDir);
    assert.strictEqual(gitnexusEnabled, false);
  });
});

// ─── Both modules disabled simultaneously (CONF-04 edge case) ──────────────

describe('CONF-04: Both gitnexus and graphify disabled simultaneously', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
    writeConfig(planningDir, { enabled: false }, { enabled: false });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gitnexusQuery returns disabled when both modules are off', () => {
    const result = gitnexus.gitNexusQuery(tmpDir, 'test');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.reason, 'disabled');
  });

  test('graphifyQuery returns disabled when both modules are off', () => {
    const result = graphify.graphifyQuery(tmpDir, 'test');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.message.includes('not enabled'), true);
  });

  test('graphifyStatus returns disabled when both modules are off', () => {
    const result = graphify.graphifyStatus(tmpDir);
    assert.strictEqual(result.disabled, true);
  });
});