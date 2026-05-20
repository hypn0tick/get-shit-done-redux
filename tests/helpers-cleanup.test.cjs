'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { cleanup } = require('./helpers.cjs');

test('cleanup retries Windows EPERM deletes via quarantine rename', { skip: process.platform !== 'win32' }, (t) => {
  const originalCwd = process.cwd();
  const target = path.join(originalCwd, 'tmp-cleanup-target');
  const calls = [];

  t.mock.method(fs, 'rmSync', (rmTarget, options) => {
    calls.push({ rmTarget, options });
    if (calls.length === 1) {
      const err = new Error('permission denied');
      err.code = 'EPERM';
      throw err;
    }
  });

  let renamedTo = null;
  t.mock.method(fs, 'renameSync', (from, to) => {
    assert.strictEqual(from, path.resolve(target));
    renamedTo = to;
  });

  cleanup(target);

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].rmTarget, path.resolve(target));
  assert.ok(renamedTo && renamedTo.includes('pending-delete'));
  assert.strictEqual(calls[1].rmTarget, renamedTo);
  assert.strictEqual(calls[1].options.maxRetries, 40);
});
