import type { QueryHandler } from './utils.js';
import {
  gitnexusStatus,
  gitnexusQuery,
  gitnexusContext,
  gitnexusImpact,
  gitnexusDetectChanges,
  gitnexusBuild,
  gitnexusRename,
  gitnexusCypher,
} from './gitnexus-adapter.js';

export const gitnexusStatusHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusStatus(args, projectDir) });
export const gitnexusQueryHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusQuery(args, projectDir) });
export const gitnexusContextHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusContext(args, projectDir) });
export const gitnexusImpactHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusImpact(args, projectDir) });
export const gitnexusDetectChangesHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusDetectChanges(args, projectDir) });
export const gitnexusBuildHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusBuild(args, projectDir) });
export const gitnexusRenameHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusRename(args, projectDir) });
export const gitnexusCypherHandler: QueryHandler = async (args, projectDir) => ({ data: await gitnexusCypher(args, projectDir) });
