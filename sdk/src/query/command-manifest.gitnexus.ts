import type { CommandManifestEntry } from './command-manifest.types.js';

export const GITNEXUS_COMMAND_MANIFEST: readonly CommandManifestEntry[] = [
  { family: 'gitnexus', canonical: 'gitnexus.status', aliases: ['gitnexus status'], mutation: false, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.query', aliases: ['gitnexus query'], mutation: false, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.context', aliases: ['gitnexus context'], mutation: false, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.impact', aliases: ['gitnexus impact'], mutation: false, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.detect-changes', aliases: ['gitnexus detect-changes'], mutation: false, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.build', aliases: ['gitnexus build'], mutation: false, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.rename', aliases: ['gitnexus rename'], mutation: true, outputMode: 'json' },
  { family: 'gitnexus', canonical: 'gitnexus.cypher', aliases: ['gitnexus cypher'], mutation: false, outputMode: 'json' },
] as const;
