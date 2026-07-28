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

// The runtime version is a literal in src/index.ts, so a stale dist or a
// forgotten bump ships a package that lies about its own version. Both bundles
// and the packed README must agree with package.json.
export function assertPackedVersion(sources, version) {
  // The IIFE ships minified, so the space after the key is not guaranteed.
  const literal = new RegExp(`version:\\s*"${version.replace(/\./g, '\\.')}"`);
  const wrong = [];
  for (const [name, text] of Object.entries(sources)) {
    if (name === 'readme') {
      if (!text.includes(`canvas-scan@${version}`)) {
        wrong.push(`packed README does not mention canvas-scan@${version}`);
      }
      continue;
    }
    if (!literal.test(text)) {
      wrong.push(`${name} does not carry runtime version ${version}`);
    }
  }
  if (wrong.length > 0) {
    throw new Error(`packed version mismatch: ${wrong.join('; ')}`);
  }
}

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
