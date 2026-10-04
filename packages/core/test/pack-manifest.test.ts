import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain JS module without declarations
import { ESM_RUNTIME_EXPORTS, MANIFEST_REQUIRED, PACKED_README_HEADER, RITUAL_METHODS, RITUAL_STEP_IDS, TYPE_EXPORTS, assertInvestigationRitual, assertLabBoundary, assertManifestEntries, assertPackedVersion, assertPublicContract } from '../../../scripts/pack-manifest.mjs';

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

describe('public package rules', () => {
  const runtimeApi = 'export { start, stop, getReports, startRecording, stopRecording, getLastSession, mark, startExplanation, stopExplanation, getLastExplanation, compareSessions };';
  const api = `${runtimeApi} export type { ${TYPE_EXPORTS.join(', ')} };`;
  const iife = 'window.__CANVAS_SCAN__={version,stop,getHistory,getReports,startRecording,stopRecording,getLastSession,mark,startExplanation,stopExplanation,getLastExplanation,compareSessions};';

  it('accepts every required public operation', () => {
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api, iife })).not.toThrow();
  });

  it.each(['getReports', 'startExplanation', 'stopExplanation', 'getLastExplanation', 'compareSessions'])('rejects %s from every packed surface', (operation) => {
    expect(() => assertPublicContract({ runtime: runtimeApi.replace(operation, ''), declarations: api, iife })).toThrow(new RegExp(operation));
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api.replace(operation, ''), iife })).toThrow(new RegExp(operation));
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api, iife: iife.replace(operation, '') })).toThrow(new RegExp(operation));
  });

  it('keeps the v0.4 mark operation mandatory on every packed surface', () => {
    expect(() => assertPublicContract({ runtime: runtimeApi.replace('mark', ''), declarations: api, iife })).toThrow(/mark/);
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api.replace('mark', ''), iife })).toThrow(/mark/);
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api, iife: iife.replace('mark', '') })).toThrow(/mark/);
  });

  it('rejects public names that exist but are not exported', () => {
    const unexported = 'const start = startRecording = stopRecording = getLastSession = mark = startExplanation = stopExplanation = getLastExplanation = compareSessions = () => {}; export {};';
    expect(() => assertPublicContract({ runtime: unexported, declarations: api, iife })).toThrow(/ESM runtime exports.*start/);
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: unexported, iife })).toThrow(/declaration exports.*start/);
  });

  it('rejects each missing type export', () => {
    for (const type of TYPE_EXPORTS) {
      expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api.replace(type, ''), iife })).toThrow(new RegExp(type));
    }
  });

  it('rejects IIFE operations outside the public global', () => {
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api, iife: `const mark = true; ${iife.replace(',mark', '')}` })).toThrow(/IIFE.*mark/);
  });

  it('rejects extra ESM, declaration, and IIFE exports', () => {
    expect(() => assertPublicContract({ runtime: `${runtimeApi} export { extraRuntime };`, declarations: api, iife })).toThrow(/ESM runtime exports.*extraRuntime/);
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: `${api} export type { ExtraType };`, iife })).toThrow(/declaration exports.*ExtraType/);
    expect(() => assertPublicContract({ runtime: runtimeApi, declarations: api, iife: iife.replace('compareSessions}', 'compareSessions,extraOperation}') })).toThrow(/IIFE public operations.*extraOperation/);
  });

  it('rejects lab-only entries and markers inside allowed entries', () => {
    expect(() => assertLabBoundary([...FULL, 'package/dist/lab-v04.js'], {})).toThrow(/lab-only tarball entry/);
    for (const marker of ['CANVAS_LAB_V04', 'canvas-performance-lab-v0.4', 'lab-v04-truth']) {
      expect(() => assertLabBoundary(FULL, { 'package/dist/index.js': marker })).toThrow(marker);
    }
  });
});

describe('investigation section', () => {
  const root = join(packageDir, '../..');
  const sources = () => ({
    sourceReadme: readFileSync(join(root, 'README.md'), 'utf8'),
    packedReadme: readFileSync(join(packageDir, 'README.md'), 'utf8'),
    demo: readFileSync(join(root, 'apps/demo/src/App.tsx'), 'utf8'),
    demoEntry: readFileSync(join(root, 'apps/demo/src/main.tsx'), 'utf8'),
    runtimeExports: [...ESM_RUNTIME_EXPORTS],
  });

  it('binds both READMEs, the demo, early load, and the public API', () => {
    expect(() => assertInvestigationRitual(sources())).not.toThrow();
  });

  it('rejects independent and coordinated README drift', () => {
    const actual = sources();
    expect(() => assertInvestigationRitual({ ...actual, sourceReadme: actual.sourceReadme.replace('Copy comparison JSON', 'Copy result') })).toThrow(/outside the packed header/);
    expect(() => assertInvestigationRitual({ ...actual, packedReadme: actual.packedReadme.replace('Copy explanation JSON', 'Copy result') })).toThrow(/outside the packed header/);
    expect(() => assertInvestigationRitual({
      ...actual,
      sourceReadme: actual.sourceReadme.replaceAll('candidateFindingIndex', 'candidateIndex'),
      packedReadme: actual.packedReadme.replaceAll('candidateFindingIndex', 'candidateIndex'),
    })).toThrow(/step 7.*candidateFindingIndex/);
  });

  it('rejects packed README drift outside the ritual section', () => {
    const actual = sources();
    expect(actual.packedReadme).toContain('## Quick start');
    expect(actual.packedReadme).toContain('## What it finds');
    expect(() => assertInvestigationRitual({ ...actual, packedReadme: actual.packedReadme.replace('## What it finds', '## What it found') })).toThrow(/outside the packed header/);
    expect(() => assertInvestigationRitual({ ...actual, packedReadme: `${actual.packedReadme}\nA line only the tarball has.\n` })).toThrow(/outside the packed header/);
    expect(() => assertInvestigationRitual({ ...actual, packedReadme: actual.packedReadme.replace(PACKED_README_HEADER, '') })).toThrow(/packed header/);
  });

  it('rejects every missing or reordered demo step', () => {
    const actual = sources();
    for (const id of RITUAL_STEP_IDS) {
      expect(() => assertInvestigationRitual({ ...actual, demo: actual.demo.replace(`data-ritual-step="${id}"`, '') })).toThrow(/demo ritual step/);
    }
    expect(() => assertInvestigationRitual({ ...actual, demo: actual.demo.replace('data-ritual-step="baseline"', 'data-ritual-step="candidate"') })).toThrow(/demo ritual step/);
  });

  it('rejects missing demo actions, boundaries, and early load', () => {
    const actual = sources();
    expect(() => assertInvestigationRitual({ ...actual, demo: actual.demo.replace('data-demo-action="replay-interaction"', '') })).toThrow(/demo actions/);
    expect(() => assertInvestigationRitual({ ...actual, demo: actual.demo.replace('honest unknown', 'unclear result') })).toThrow(/demo boundaries/);
    expect(() => assertInvestigationRitual({ ...actual, demoEntry: actual.demoEntry.replace("import 'canvas-scan/auto';", '') })).toThrow(/load canvas-scan/);
  });

  it('rejects disconnected demo actions', () => {
    const actual = sources();
    expect(() => assertInvestigationRitual({ ...actual, demo: actual.demo.replace('onClick={() => void replayInteraction()}', '') })).toThrow(/demo replay behavior/);
    expect(() => assertInvestigationRitual({ ...actual, demo: actual.demo.replace('onClick={() => setDrawsPerFrame(2)}', '') })).toThrow(/demo candidate behavior/);
  });

  it('rejects each missing public ritual method', () => {
    const actual = sources();
    for (const method of RITUAL_METHODS) {
      expect(() => assertInvestigationRitual({ ...actual, runtimeExports: actual.runtimeExports.filter((name: string) => name !== method) })).toThrow(new RegExp(method));
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
