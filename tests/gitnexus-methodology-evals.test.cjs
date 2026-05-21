'use strict';

// allow-test-rule: source-text-is-the-product
// The eval dataset and methodology reference are deployed policy artifacts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const evalPath = path.join(repoRoot, 'evals', 'gitnexus-methodology-cases.json');
const referencePath = path.join(repoRoot, 'get-shit-done', 'references', 'gitnexus-methodology.md');
const runnerPath = path.join(repoRoot, 'scripts', 'run-gitnexus-methodology-evals.cjs');

test('Phase 03 GitNexus methodology eval dataset has required coverage', () => {
  const { loadDataset, summarizeCases, validateDataset } = require(runnerPath);
  const dataset = loadDataset(evalPath);
  const summary = summarizeCases(dataset.cases);

  assert.equal(dataset.name, 'gitnexus-methodology-phase-03');
  assert.ok(dataset.cases.length >= 14, `expected at least 14 cases, got ${dataset.cases.length}`);

  for (const category of [
    'risk-threshold',
    'replace-grep',
    'disabled-fallback',
    'mcp-trigger',
    'adversarial',
    'stale-or-failed-graph',
  ]) {
    assert.ok(summary.categories[category] > 0, `missing category ${category}`);
  }

  for (const risk of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    assert.ok(summary.riskLevels[risk] > 0, `missing risk level ${risk}`);
  }

  assert.ok(summary.replaceGrep.trueExploration >= 1, 'missing replace-grep true exploration case');
  assert.ok(summary.replaceGrep.falseExploration >= 1, 'missing replace-grep false exploration case');
  assert.ok(summary.replaceGrep.trueNonExploration >= 1, 'missing replace-grep true non-exploration allowance case');

  assert.ok(summary.mcp.listedQueryTrigger >= 1, 'missing listed MCP query trigger case');
  assert.ok(summary.mcp.unlistedContextTrigger >= 1, 'missing unlisted MCP context trigger case');
  assert.ok(summary.mcp.failedCall >= 1, 'missing failed MCP call case');

  assert.ok(summary.adversarial.ignoreDisabledConfig >= 1, 'missing adversarial disabled-config case');
  assert.ok(summary.adversarial.grepAnywayReplacement >= 1, 'missing adversarial replacement-mode grep case');
  assert.ok(summary.adversarial.commitCritical >= 1, 'missing adversarial CRITICAL commit case');

  assert.deepEqual(validateDataset(dataset), []);
});

test('Phase 03 GitNexus methodology eval runner validates expected decisions', () => {
  const { runEvaluations } = require(runnerPath);
  const result = runEvaluations({ evalPath, referencePath });

  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.failures.length, 0);
  assert.ok(result.total >= 14);
  assert.equal(result.passed, result.total);
});
