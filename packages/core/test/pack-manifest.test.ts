import { describe, expect, it } from 'vitest';

// @ts-expect-error plain JS module without declarations
import { MANIFEST_REQUIRED, assertManifestEntries } from '../../../scripts/pack-manifest.mjs';

const FULL = [...MANIFEST_REQUIRED, 'package/dist/chunk-ABC123.js'];

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
