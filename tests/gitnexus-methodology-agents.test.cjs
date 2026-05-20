'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const METHODOLOGY_REF = '@~/.claude/get-shit-done/references/gitnexus-methodology.md';

const TARGET_AGENTS = [
  'agents/gsd-planner.md',
  'agents/gsd-phase-researcher.md',
  'agents/gsd-executor.md',
  'agents/gsd-code-fixer.md',
  'agents/gsd-codebase-mapper.md',
];

const EXPLORATION_POLICY_TERMS = [
  'gitnexus.replace_grep_exploration',
  'Supplemental mode',
  'GitNexus first',
  'grep/direct-read validation',
  'Replacement mode',
  'skip grep exploration',
  'exact text, replacement, and verification',
];

function readAgent(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('all target agents load the shared GitNexus methodology reference exactly once', () => {
  for (const agent of TARGET_AGENTS) {
    const content = readAgent(agent);
    const matches = content.match(new RegExp(METHODOLOGY_REF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];

    assert.equal(matches.length, 1, `${agent} should contain ${METHODOLOGY_REF} exactly once`);
  }
});

test('agent code-intelligence sections encode replace-grep exploration modes', () => {
  for (const agent of TARGET_AGENTS) {
    const content = readAgent(agent);

    for (const term of EXPLORATION_POLICY_TERMS) {
      assert.match(content, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${agent} missing policy term: ${term}`);
    }
  }
});

test('agents preserve grep for non-exploration tasks in replacement mode', () => {
  for (const agent of TARGET_AGENTS) {
    const content = readAgent(agent);

    assert.match(
      content,
      /Replacement mode[\s\S]{0,500}skip grep exploration[\s\S]{0,500}exact text, replacement, and verification/,
      `${agent} should skip grep exploration while preserving non-exploration grep use`,
    );
  }
});

test('agents do not instruct generation of project skill files', () => {
  for (const agent of TARGET_AGENTS) {
    const content = readAgent(agent);

    assert.doesNotMatch(
      content,
      /\.claude\/skills\/generated\//,
      `${agent} should not instruct generation of .claude/skills/generated/`,
    );
  }
});
