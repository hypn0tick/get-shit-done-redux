'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const referencePath = path.join(repoRoot, 'get-shit-done', 'references', 'gitnexus-methodology.md');

function readReference() {
  assert.ok(
    fs.existsSync(referencePath),
    'get-shit-done/references/gitnexus-methodology.md must exist',
  );
  return fs.readFileSync(referencePath, 'utf8');
}

test('GitNexus methodology reference has the locked compact structure and guardrails', () => {
  const body = readReference();

  for (const heading of [
    '## Cross-Cutting GitNexus vs Grep',
    '## Planner/Researcher',
    '## Executor',
    '## Code-Fixer',
    '## Codebase-Mapper',
  ]) {
    assert.match(body, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  const tokenEstimate = body.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(tokenEstimate >= 650, `expected compact but substantive reference, got ${tokenEstimate} tokens`);
  assert.ok(tokenEstimate < 1200, `expected reference under 1200 tokens, got ${tokenEstimate}`);

  const guardMentions = body.match(/gitnexus\.enabled/g) || [];
  assert.ok(guardMentions.length >= 5, 'each methodology section should self-guard on gitnexus.enabled');
  assert.match(body, /if gitnexus\.enabled/i);
  assert.match(body, /gitnexus\.replace_grep_exploration=false/);
  assert.match(body, /gitnexus\.replace_grep_exploration=true/);
  assert.match(body, /\breplace_grep_exploration\b/);

  assert.doesNotMatch(body, /\.claude\/skills\/generated\//);

  for (const required of [
    /stale graph/i,
    /disabled config/i,
    /failed mcp/i,
    /\bHIGH\b/,
    /\bCRITICAL\b/,
    /tool-output poisoning/i,
    /untrusted evidence/i,
  ]) {
    assert.match(body, required);
  }
});
