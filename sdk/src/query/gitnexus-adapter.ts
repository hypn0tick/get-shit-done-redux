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

function translateCjsResult(cjsResult: CjsResponse) {
  if (cjsLoadError || !cjs) return disabledResult();
  if (cjsResult && cjsResult.disabled === true) return disabledResult();
  if (cjsResult && typeof cjsResult.reason === 'string' && cjsResult.reason !== 'ok') {
    return {
      ok: false,
      reason: cjsResult.reason,
      provider: 'gitnexus',
      message: cjsResult.message ?? '',
    };
  }
  return { ok: true, ...cjsResult };
}

export async function gitnexusStatus(_args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusStatus(projectDir));
}

export async function gitnexusQuery(args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusQuery(projectDir, args[0]));
}

export async function gitnexusContext(args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusContext(projectDir, args[0]));
}

export async function gitnexusImpact(args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusImpact(projectDir, args[0], args[1] || 'upstream'));
}

export async function gitnexusDetectChanges(args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusDetectChanges(projectDir, args[0] || 'unstaged'));
}

export async function gitnexusBuild(_args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusBuild(projectDir));
}

export async function gitnexusRename(args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusRename(projectDir, args[0], args[1]));
}

export async function gitnexusCypher(args: string[], projectDir: string) {
  if (!cjs) return disabledResult();
  return translateCjsResult(cjs.gitNexusCypher(projectDir, args[0]));
}
