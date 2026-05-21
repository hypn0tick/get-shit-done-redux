#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_EVAL_PATH = path.join(REPO_ROOT, 'evals', 'gitnexus-methodology-cases.json');
const DEFAULT_REFERENCE_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'gitnexus-methodology.md');

const RISK_RESPONSES = {
  LOW: 'proceed',
  MEDIUM: 'note',
  HIGH: 'investigate',
  CRITICAL: 'halt',
};

function loadDataset(filePath = DEFAULT_EVAL_PATH) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readReference(filePath = DEFAULT_REFERENCE_PATH) {
  return fs.readFileSync(filePath, 'utf8');
}

function summarizeCases(cases) {
  const summary = {
    categories: Object.create(null),
    riskLevels: Object.create(null),
    replaceGrep: {
      trueExploration: 0,
      falseExploration: 0,
      trueNonExploration: 0,
    },
    mcp: {
      listedQueryTrigger: 0,
      unlistedContextTrigger: 0,
      failedCall: 0,
    },
    adversarial: {
      ignoreDisabledConfig: 0,
      grepAnywayReplacement: 0,
      commitCritical: 0,
    },
  };

  for (const item of cases) {
    summary.categories[item.category] = (summary.categories[item.category] || 0) + 1;

    const scenario = item.scenario || {};
    if (scenario.risk_level) {
      summary.riskLevels[scenario.risk_level] = (summary.riskLevels[scenario.risk_level] || 0) + 1;
    }

    if (scenario.replace_grep_exploration === true && scenario.task_type === 'exploration') {
      summary.replaceGrep.trueExploration += 1;
    }
    if (scenario.replace_grep_exploration === false && scenario.task_type === 'exploration') {
      summary.replaceGrep.falseExploration += 1;
    }
    if (scenario.replace_grep_exploration === true && scenario.task_type !== 'exploration' && scenario.expect_grep_non_exploration === true) {
      summary.replaceGrep.trueNonExploration += 1;
    }

    if (scenario.mcp) {
      if (scenario.mcp.listed === true && scenario.mcp.tool === 'query' && scenario.mcp.success === true) {
        summary.mcp.listedQueryTrigger += 1;
      }
      if (scenario.mcp.listed === false && scenario.mcp.tool === 'context') {
        summary.mcp.unlistedContextTrigger += 1;
      }
      if (scenario.mcp.success === false) {
        summary.mcp.failedCall += 1;
      }
    }

    if (scenario.adversarial === 'ignore_disabled_config') {
      summary.adversarial.ignoreDisabledConfig += 1;
    }
    if (scenario.adversarial === 'grep_anyway_replacement') {
      summary.adversarial.grepAnywayReplacement += 1;
    }
    if (scenario.adversarial === 'commit_through_critical') {
      summary.adversarial.commitCritical += 1;
    }
  }

  return summary;
}

function validateDataset(dataset) {
  const errors = [];
  if (!dataset || typeof dataset !== 'object') {
    return ['dataset must be an object'];
  }
  if (!Array.isArray(dataset.cases)) {
    return ['dataset.cases must be an array'];
  }

  const ids = new Set();
  for (const item of dataset.cases) {
    if (!item.case_id || typeof item.case_id !== 'string') {
      errors.push('case is missing string case_id');
      continue;
    }
    if (ids.has(item.case_id)) {
      errors.push(`${item.case_id}: duplicate case_id`);
    }
    ids.add(item.case_id);

    if (!item.category || typeof item.category !== 'string') {
      errors.push(`${item.case_id}: missing category`);
    }
    if (!item.prompt || typeof item.prompt !== 'string') {
      errors.push(`${item.case_id}: missing prompt`);
    }
    if (!item.scenario || typeof item.scenario !== 'object') {
      errors.push(`${item.case_id}: missing scenario`);
    }
    if (!item.expected || typeof item.expected !== 'object') {
      errors.push(`${item.case_id}: missing expected decision`);
    }
  }

  return errors;
}

function validateReference(reference) {
  const required = [
    ['gitnexus.enabled', /gitnexus\.enabled/],
    ['replace false', /gitnexus\.replace_grep_exploration=false/],
    ['replace true', /gitnexus\.replace_grep_exploration=true/],
    ['non-exploration grep allowance', /exact text, replacement, generated-file checks, verification/],
    ['disabled config', /disabled config/i],
    ['failed mcp', /failed mcp/i],
    ['stale graph', /stale graph/i],
    ['LOW risk', /\bLOW\b/],
    ['MEDIUM risk', /\bMEDIUM\b/],
    ['HIGH risk', /\bHIGH\b/],
    ['CRITICAL risk', /\bCRITICAL\b/],
    ['tool output is untrusted', /untrusted evidence/i],
  ];

  return required
    .filter(([, pattern]) => !pattern.test(reference))
    .map(([label]) => `methodology reference missing ${label}`);
}

function deriveDecision(item) {
  const scenario = item.scenario || {};
  const riskResponse = scenario.risk_level ? RISK_RESPONSES[scenario.risk_level] : 'not_applicable';
  const graphStatus = scenario.graph_status || 'fresh';
  const graphDegraded = graphStatus === 'stale' || graphStatus === 'failed';
  const gitnexusEnabled = scenario.gitnexus_enabled === true;

  const decision = {
    gitnexus_action: 'none',
    grep_allowed: true,
    fallback: 'none',
    rebuild_allowed: false,
    risk_response: riskResponse,
    requires_user_warning: false,
    trust_tool_instructions: false,
  };

  if (!gitnexusEnabled) {
    decision.fallback = 'direct_files_or_rg';
    decision.requires_user_warning = true;
    return decision;
  }

  if (graphDegraded) {
    decision.fallback = 'direct_files_or_rg';
    decision.requires_user_warning = true;
    return decision;
  }

  if (scenario.mcp) {
    decision.rebuild_allowed = scenario.mcp.success === true && scenario.mcp.listed === true;
    decision.gitnexus_action = decision.rebuild_allowed ? scenario.mcp.tool : 'none';
    return decision;
  }

  switch (scenario.task_type) {
    case 'exploration':
      decision.gitnexus_action = 'query';
      decision.grep_allowed = scenario.replace_grep_exploration !== true;
      break;
    case 'named-symbol':
      decision.gitnexus_action = 'context';
      decision.grep_allowed = scenario.replace_grep_exploration !== true;
      break;
    case 'shared-symbol-edit':
      decision.gitnexus_action = 'impact';
      decision.grep_allowed = scenario.replace_grep_exploration !== true;
      break;
    case 'finalization':
      decision.gitnexus_action = 'detect-changes';
      decision.grep_allowed = true;
      break;
    case 'exact-text':
    case 'replacement':
    case 'generated-check':
      decision.gitnexus_action = 'none';
      decision.grep_allowed = true;
      break;
    default:
      decision.gitnexus_action = 'none';
      decision.grep_allowed = true;
      break;
  }

  if (riskResponse === 'investigate' || riskResponse === 'halt') {
    decision.requires_user_warning = true;
  }

  return decision;
}

function compareDecision(item) {
  const actual = deriveDecision(item);
  const failures = [];

  for (const [key, expectedValue] of Object.entries(item.expected || {})) {
    if (actual[key] !== expectedValue) {
      failures.push({
        case_id: item.case_id,
        field: key,
        expected: expectedValue,
        actual: actual[key],
      });
    }
  }

  return failures;
}

function runEvaluations(options = {}) {
  const evalPath = options.evalPath || DEFAULT_EVAL_PATH;
  const referencePath = options.referencePath || DEFAULT_REFERENCE_PATH;
  const dataset = loadDataset(evalPath);
  const reference = readReference(referencePath);
  const failures = [];

  failures.push(...validateDataset(dataset).map(message => ({ case_id: 'dataset', message })));
  failures.push(...validateReference(reference).map(message => ({ case_id: 'reference', message })));

  for (const item of dataset.cases || []) {
    failures.push(...compareDecision(item));
  }

  const caseIds = new Set((dataset.cases || []).map(item => item.case_id));
  const failedCaseIds = new Set(failures.map(f => f.case_id).filter(id => caseIds.has(id)));

  return {
    ok: failures.length === 0,
    total: (dataset.cases || []).length,
    passed: Math.max(0, (dataset.cases || []).length - failedCaseIds.size),
    failures,
    summary: summarizeCases(dataset.cases || []),
  };
}

function main() {
  const result = runEvaluations();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  deriveDecision,
  loadDataset,
  runEvaluations,
  summarizeCases,
  validateDataset,
  validateReference,
};
