import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain JS module without declarations
import { MANIFEST_REQUIRED, assertLabBoundary, assertManifestEntries, assertPackedVersion, assertPublicContract } from '../../../scripts/pack-manifest.mjs';

const FULL = [...MANIFEST_REQUIRED, 'package/dist/chunk-ABC123.js'];

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function packedSources(version: string) {
  return {
    manifest: JSON.stringify({ version }),
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

  it('fails when the packed manifest carries a stale version', () => {
    const stale = { ...packedSources('9.9.9'), manifest: JSON.stringify({ version: '9.9.8' }) };
    expect(() => assertPackedVersion(stale, '9.9.9')).toThrow(/manifest version/);
  });

  it('fails when the packed README still advertises the previous release', () => {
    const stale = { ...packedSources('9.9.9'), readme: '`canvas-scan@9.9.8` is on npm.' };
    expect(() => assertPackedVersion(stale, '9.9.9')).toThrow(/packed README/);
  });
});

describe('v0.4 public package rules', () => {
  const api = 'export { start, startRecording, stopRecording, getLastSession, mark };';
  const iife = 'window.__CANVAS_SCAN__={startRecording,stopRecording,getLastSession,mark};';

  it('accepts every required public operation', () => {
    expect(() => assertPublicContract({ runtime: api, declarations: api, iife })).not.toThrow();
  });

  it('rejects a missing recording operation in every packed surface', () => {
    expect(() => assertPublicContract({ runtime: api.replace('mark', ''), declarations: api, iife })).toThrow(/mark/);
    expect(() => assertPublicContract({ runtime: api, declarations: api.replace('mark', ''), iife })).toThrow(/mark/);
    expect(() => assertPublicContract({ runtime: api, declarations: api, iife: iife.replace('mark', '') })).toThrow(/mark/);
  });

  it('rejects public names that exist but are not exported', () => {
    const unexported = 'const start = startRecording = stopRecording = getLastSession = mark = () => {}; export {};';
    expect(() => assertPublicContract({ runtime: unexported, declarations: api, iife })).toThrow(/missing ESM/);
    expect(() => assertPublicContract({ runtime: api, declarations: unexported, iife })).toThrow(/missing ESM/);
  });

  it('rejects IIFE operations outside the public global', () => {
    expect(() => assertPublicContract({ runtime: api, declarations: api, iife: `const mark = true; ${iife.replace(',mark', '')}` })).toThrow(/IIFE.*mark/);
  });

  it('rejects lab-only entries and markers inside allowed entries', () => {
    expect(() => assertLabBoundary([...FULL, 'package/dist/lab-v04.js'], {})).toThrow(/lab-only tarball entry/);
    for (const marker of ['CANVAS_LAB_V04', 'canvas-performance-lab-v0.4', 'lab-v04-truth']) {
      expect(() => assertLabBoundary(FULL, { 'package/dist/index.js': marker })).toThrow(marker);
    }
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
    const recording = readFileSync(join(packageDir, 'src/recording.ts'), 'utf8');

    expect(source).toContain(`version: '${version}'`);
    expect(recording).toContain(`canvasScanVersion: '${version}'`);
  });
});
