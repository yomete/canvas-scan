// Pure tarball-manifest rules for the canvas-scan package, shared by
// scripts/verify-pack.mjs and its unit regressions.
export const MANIFEST_REQUIRED = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/bin/canvas-scan.mjs',
  'package/dist/index.js',
  'package/dist/auto.js',
  'package/dist/canvas-scan.iife.js',
  'package/dist/index.d.ts',
  'package/dist/auto.d.ts',
];

export const MANIFEST_ALLOW = [
  ...MANIFEST_REQUIRED.map(
    (entry) => new RegExp(`^${entry.replace(/[.$+]/g, '\\$&')}$`),
  ),
  /^package\/dist\/chunk-[A-Z0-9]+\.js$/,
  /^package\/dist\/[\w-]+\.d\.ts$/,
];

export function assertManifestEntries(entries) {
  const missing = MANIFEST_REQUIRED.filter((entry) => !entries.includes(entry));
  if (missing.length > 0) {
    throw new Error(`missing required tarball entries: ${missing.join(', ')}`);
  }
  const unexpected = entries.filter(
    (entry) => !MANIFEST_ALLOW.some((pattern) => pattern.test(entry)),
  );
  if (unexpected.length > 0) {
    throw new Error(`unexpected tarball entries: ${unexpected.join(', ')}`);
  }
  const chunks = entries.filter((entry) => /dist\/chunk-/.test(entry));
  if (chunks.length !== 1) {
    throw new Error(
      `expected exactly one shared chunk, found: ${chunks.join(', ') || 'none'}`,
    );
  }
}
