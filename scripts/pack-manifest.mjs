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
  'package/dist/recording.d.ts',
  'package/dist/types.d.ts',
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
  const literal = new RegExp(`version:\\s*['"]${version.replace(/\./g, '\\.')}['"]`);
  const wrong = [];
  for (const [name, text] of Object.entries(sources)) {
    if (name === 'manifest') {
      try {
        if (JSON.parse(text).version !== version) wrong.push(`packed manifest version is not ${version}`);
      } catch {
        wrong.push('packed manifest is not valid JSON');
      }
      continue;
    }
    if (name === 'readme') {
      if (!text.includes(`canvas-scan@${version}`)) {
        wrong.push(`packed README does not mention canvas-scan@${version}`);
      }
      continue;
    }
    const required = name === 'recording'
      ? new RegExp(`canvasScanVersion:\\s*['"]${version.replace(/\./g, '\\.')}['"]`)
      : literal;
    if (!required.test(text)) {
      wrong.push(`${name} does not carry runtime version ${version}`);
    }
  }
  if (wrong.length > 0) {
    throw new Error(`packed version mismatch: ${wrong.join('; ')}`);
  }
}

const publicOperations = ['start', 'startRecording', 'stopRecording', 'getLastSession', 'mark', 'startExplanation', 'stopExplanation', 'getLastExplanation'];
const labMarkers = ['CANVAS_LAB_V04', 'canvas-performance-lab-v0.4', 'lab-v04-truth'];

function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:declare\s+)?function\s+(\w+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of match[1].split(',')) {
      const value = item.trim().replace(/^type\s+/, '');
      const alias = value.match(/\bas\s+(\w+)$/)?.[1];
      const direct = value.match(/^(\w+)/)?.[1];
      if (alias ?? direct) names.add(alias ?? direct);
    }
  }
  return names;
}

function iifeOperations(source) {
  const body = source.match(/(?:window|globalThis)\.__CANVAS_SCAN__=\{([^}]*)\}/)?.[1] ?? '';
  return new Set(body.split(',').map((item) => item.trim().match(/^(\w+)/)?.[1]).filter(Boolean));
}

export function assertPublicContract({ runtime, declarations, iife }) {
  const runtimeExports = exportedNames(runtime);
  const declarationExports = exportedNames(declarations);
  const missing = publicOperations.filter((name) => !runtimeExports.has(name) || !declarationExports.has(name));
  if (missing.length) throw new Error(`missing ESM or declaration exports: ${missing.join(', ')}`);
  const operations = iifeOperations(iife);
  const iifeMissing = publicOperations.slice(1).filter((name) => !operations.has(name));
  if (iifeMissing.length) throw new Error(`missing IIFE public operations: ${iifeMissing.join(', ')}`);
}

export function assertLabBoundary(entries, sources) {
  const entry = entries.find((name) => /lab-v04|lab-v04-truth|v0\.4.*fixture/i.test(name));
  if (entry) throw new Error(`lab-only tarball entry: ${entry}`);
  for (const [name, text] of Object.entries(sources)) {
    const marker = labMarkers.find((value) => text.includes(value));
    if (marker) throw new Error(`lab-only marker ${marker} in ${name}`);
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
