'use strict';

/**
 * GitNexus auto-update trigger config contract.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempProject, cleanup, runGsdTools } = require('./helpers.cjs');

const {
  VALID_CONFIG_KEYS,
  isValidConfigKey,
} = require('../get-shit-done/bin/lib/config-schema.cjs');

const {
  CONFIG_DEFAULTS: CANONICAL_CONFIG_DEFAULTS,
} = require('../get-shit-done/bin/lib/configuration.generated.cjs');

describe('GitNexus auto-update trigger config', () => {
  test('gitnexus.auto_update_triggers is a registered config key', () => {
    assert.ok(VALID_CONFIG_KEYS.has('gitnexus.auto_update_triggers'));
    assert.ok(isValidConfigKey('gitnexus.auto_update_triggers'));
  });

  test('default trigger list is commit-only', () => {
    assert.deepStrictEqual(
      CANONICAL_CONFIG_DEFAULTS.gitnexus.auto_update_triggers,
      ['commit'],
    );
  });

  test('config-set round-trips allowed trigger names as an array', (t) => {
    const tmpDir = createTempProject();
    t.after(() => cleanup(tmpDir));

    const result = runGsdTools([
      'config-set',
      'gitnexus.auto_update_triggers',
      '["commit","mcp_query","mcp_context","mcp_impact","mcp_detect_changes"]',
    ], tmpDir);

    assert.ok(result.success, result.error || result.output);

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf8'),
    );
    assert.deepStrictEqual(config.gitnexus.auto_update_triggers, [
      'commit',
      'mcp_query',
      'mcp_context',
      'mcp_impact',
      'mcp_detect_changes',
    ]);
  });

  test('config-set rejects unknown trigger names', (t) => {
    const tmpDir = createTempProject();
    t.after(() => cleanup(tmpDir));

    const result = runGsdTools([
      'config-set',
      'gitnexus.auto_update_triggers',
      '["commit","shell_anything"]',
    ], tmpDir);

    assert.equal(result.success, false);
    assert.match(result.error || result.output, /Invalid gitnexus\.auto_update_triggers/);
  });

  test('config-set rejects non-array trigger values', (t) => {
    const tmpDir = createTempProject();
    t.after(() => cleanup(tmpDir));

    const result = runGsdTools([
      'config-set',
      'gitnexus.auto_update_triggers',
      'commit',
    ], tmpDir);

    assert.equal(result.success, false);
    assert.match(result.error || result.output, /Must be a JSON array/);
  });
});
