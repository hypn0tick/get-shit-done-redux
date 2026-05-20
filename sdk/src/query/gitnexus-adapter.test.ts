import { describe, it, expect, vi, afterEach } from 'vitest';

type CjsApi = Record<string, (...args: unknown[]) => unknown>;

const cjsFunctionNames = [
  'gitNexusStatus',
  'gitNexusQuery',
  'gitNexusContext',
  'gitNexusImpact',
  'gitNexusDetectChanges',
  'gitNexusBuild',
  'gitNexusRename',
  'gitNexusCypher',
] as const;

async function importAdapterWith(cjsApi: CjsApi) {
  vi.resetModules();
  vi.doMock('node:module', async () => {
    const actual = await vi.importActual<typeof import('node:module')>('node:module');
    return {
      ...actual,
      createRequire: () => () => cjsApi,
    };
  });

  return import('./gitnexus-adapter.js');
}

function cjsApiWith(fn: (...args: unknown[]) => unknown): CjsApi {
  return Object.fromEntries(cjsFunctionNames.map((name) => [name, fn]));
}

describe('gitnexus adapter', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:module');
  });

  it('returns a structured error when a CJS GitNexus call throws', async () => {
    const adapter = await importAdapterWith(cjsApiWith(() => {
      throw new Error('boom');
    }));

    await expect(adapter.gitnexusStatus([], '/project')).resolves.toEqual({
      ok: false,
      reason: 'gitnexus_error',
      provider: 'gitnexus',
      message: 'boom',
    });
  });

  it('rejects malformed successful CJS payloads', async () => {
    const adapter = await importAdapterWith(cjsApiWith(() => ({ status: 'indexed' })));

    await expect(adapter.gitnexusStatus([], '/project')).resolves.toEqual({
      ok: false,
      reason: 'invalid_response',
      provider: 'gitnexus',
      message: 'GitNexus returned a malformed response.',
    });
  });
});
