import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain JS module without declarations
import { MANIFEST_REQUIRED, assertManifestEntries, assertPackedVersion } from '../../../scripts/pack-manifest.mjs';

const FULL = [...MANIFEST_REQUIRED, 'package/dist/chunk-ABC123.js'];

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function packedSources(version: string) {
  return {
    esm: `var x = { version: "${version}" };`,
    // The published IIFE is minified: no space after the key.
    iife: `(()=>{var x={version:"${version}"};})();`,
    readme: `\`canvas-scan@${version}\` is on npm.`,
  };
}

describe('pack manifest rules', () => {
  it('accepts the complete expected manifest', () => {
    expect(() => assertManifestEntries(FULL)).not.toThrow();
  });

  it('fails when a required file is missing', () => {
    const withoutLicense = FULL.filter((e: string) => e !== 'package/LICENSE');
    expect(() => assertManifestEntries(withoutLicense)).toThrow(/missing required/);
  });

  it('fails on a hollow tarball even if nothing is unexpected', () => {
    expect(() =>
      assertManifestEntries(['package/package.json', 'package/dist/chunk-ABCD12.js']),
    ).toThrow(/missing required/);
  });

  it('fails on unexpected entries', () => {
    expect(() => assertManifestEntries([...FULL, 'package/dist/extra.js'])).toThrow(
      /unexpected/,
    );
  });

  it('fails on zero or multiple shared chunks', () => {
    expect(() => assertManifestEntries([...MANIFEST_REQUIRED])).toThrow(/exactly one/);
    expect(() =>
      assertManifestEntries([...FULL, 'package/dist/chunk-DEF456.js']),
    ).toThrow(/exactly one/);
  });
});

describe('packed version rules', () => {
  it('accepts bundles and a README that agree with the manifest', () => {
    expect(() => assertPackedVersion(packedSources('9.9.9'), '9.9.9')).not.toThrow();
  });

  it('fails when a bundle carries a stale runtime version', () => {
    const stale = { ...packedSources('9.9.9'), iife: 'var x={version:"0.0.0"};' };
    expect(() => assertPackedVersion(stale, '9.9.9')).toThrow(
      /iife does not carry runtime version 9\.9\.9/,
    );
  });

  it('fails when the packed README still advertises the previous release', () => {
    const stale = { ...packedSources('9.9.9'), readme: '`canvas-scan@9.9.8` is on npm.' };
    expect(() => assertPackedVersion(stale, '9.9.9')).toThrow(/packed README/);
  });
});

describe('runtime version', () => {
  // The version the tool reports at runtime is a literal in src/index.ts; this
  // catches the drift before a build bakes it into a published bundle.
  it('matches the package manifest', () => {
    const { version } = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    );
    const source = readFileSync(join(packageDir, 'src/index.ts'), 'utf8');

    expect(source).toContain(`version: '${version}'`);
  });
});
