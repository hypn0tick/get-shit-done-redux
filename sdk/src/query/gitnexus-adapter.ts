import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type CjsResponse = Record<string, unknown> & {
  disabled?: boolean;
  reason?: string;
  message?: string;
};

type CjsApi = {
  gitNexusStatus: (projectDir: string) => CjsResponse;
  gitNexusQuery: (projectDir: string, term?: string) => CjsResponse;
  gitNexusContext: (projectDir: string, name?: string) => CjsResponse;
  gitNexusImpact: (projectDir: string, target?: string, direction?: string) => CjsResponse;
  gitNexusDetectChanges: (projectDir: string, scope?: string) => CjsResponse;
  gitNexusBuild: (projectDir: string) => CjsResponse;
  gitNexusRename: (projectDir: string, symbolName?: string, newSymbolName?: string) => CjsResponse;
  gitNexusCypher: (projectDir: string, query?: string) => CjsResponse;
};

type GitNexusOperation =
  | 'status'
  | 'query'
  | 'context'
  | 'impact'
  | 'detect_changes'
  | 'build'
  | 'rename'
  | 'cypher';

let cjs: CjsApi | null = null;
let cjsLoadError = false;

try {
  const cjsPath = path.resolve(__dirname, '..', '..', '..', 'get-shit-done', 'bin', 'lib', 'gitnexus.cjs');
  cjs = require(cjsPath) as CjsApi;
} catch {
  cjsLoadError = true;
}

function disabledResult() {
  return {
    ok: false,
    reason: 'disabled',
    provider: 'gitnexus',
    suggestion: 'Enable via gsd-sdk query config-set gitnexus.enabled true',
  };
}

function errorResult(reason: string, message: string) {
  return {
    ok: false,
    reason,
    provider: 'gitnexus',
    message,
  };
}

function isObject(value: unknown): value is CjsResponse {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasAnyKey(value: CjsResponse, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasValidSuccessShape(operation: GitNexusOperation, value: CjsResponse) {
  switch (operation) {
    case 'status':
      return typeof value.exists === 'boolean';
    case 'query':
      return hasAnyKey(value, ['processes', 'definitions', 'symbols', 'edges']);
    case 'context':
      return hasAnyKey(value, ['processes', 'callers', 'callees', 'definitions', 'edges', 'symbol']);
    case 'impact':
      return hasAnyKey(value, ['risk', 'affected_processes', 'affected_modules', 'byDepth', 'impactedCount']);
    case 'detect_changes':
      return hasAnyKey(value, ['changed_symbols', 'affected_processes', 'risk_summary']);
    case 'build':
      return value.action === 'spawn_agent';
    case 'rename':
      return hasAnyKey(value, ['graph_edits', 'text_search_edits', 'confidence', 'edits', 'changes']);
    case 'cypher':
      return hasAnyKey(value, ['rows', 'markdown']);
  }
}

function translateCjsResult(operation: GitNexusOperation, cjsResult: unknown) {
  if (cjsLoadError || !cjs) return disabledResult();
  if (!isObject(cjsResult)) {
    return errorResult('invalid_response', 'GitNexus returned a malformed response.');
  }
  if (cjsResult && cjsResult.disabled === true) return disabledResult();
  if (cjsResult && typeof cjsResult.reason === 'string' && cjsResult.reason !== 'ok') {
    return errorResult(cjsResult.reason, cjsResult.message ?? '');
  }
  if (!hasValidSuccessShape(operation, cjsResult)) {
    return errorResult('invalid_response', 'GitNexus returned a malformed response.');
  }
  return { ok: true, ...cjsResult };
}

function callCjs(operation: GitNexusOperation, callback: () => CjsResponse) {
  if (!cjs) return disabledResult();
  try {
    return translateCjsResult(operation, callback());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult('gitnexus_error', message);
  }
}

function namedFlagValue(args: string[], flag: string) {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) return undefined;
  return args[flagIndex + 1];
}

export async function gitnexusStatus(_args: string[], projectDir: string) {
  return callCjs('status', () => cjs!.gitNexusStatus(projectDir));
}

export async function gitnexusQuery(args: string[], projectDir: string) {
  return callCjs('query', () => cjs!.gitNexusQuery(projectDir, args[0]));
}

export async function gitnexusContext(args: string[], projectDir: string) {
  return callCjs('context', () => cjs!.gitNexusContext(projectDir, args[0]));
}

export async function gitnexusImpact(args: string[], projectDir: string) {
  const direction = namedFlagValue(args, '--direction') ?? args[1] ?? 'upstream';
  return callCjs('impact', () => cjs!.gitNexusImpact(projectDir, args[0], direction));
}

export async function gitnexusDetectChanges(args: string[], projectDir: string) {
  const scope = namedFlagValue(args, '--scope') ?? args[0] ?? 'unstaged';
  return callCjs('detect_changes', () => cjs!.gitNexusDetectChanges(projectDir, scope));
}

export async function gitnexusBuild(_args: string[], projectDir: string) {
  return callCjs('build', () => cjs!.gitNexusBuild(projectDir));
}

export async function gitnexusRename(args: string[], projectDir: string) {
  return callCjs('rename', () => cjs!.gitNexusRename(projectDir, args[0], args[1]));
}

export async function gitnexusCypher(args: string[], projectDir: string) {
  return callCjs('cypher', () => cjs!.gitNexusCypher(projectDir, args[0]));
}
