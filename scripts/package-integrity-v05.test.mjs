import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ESM_RUNTIME_EXPORTS,
  IIFE_RUNTIME_FIELDS,
  MANIFEST_STATIC,
  TYPE_EXPORTS,
  assertDeclarationSurface,
  assertExactManifest,
  assertExactRuntimeNames,
  assertGateFileHash,
  assertIntegrityNames,
  assertPackageBoundary,
  assertRepositoryState,
  assertSourceLiteralVersion,
  canonicalJson,
  checkGate,
  checkSummary,
  gateForTarball,
  parseCanonicalJson,
} from './package-integrity-v05.mjs';

const gitSha = 'a'.repeat(40);

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-v05-gate-'));
  const root = path.join(directory, 'root');
  const files = Object.fromEntries(MANIFEST_STATIC.map(entry => [entry, '']));
  files['package/package.json'] = JSON.stringify({ name: 'canvas-scan', version: '0.5.0' });
  files['package/README.md'] = 'canvas-scan@0.5.0\n';
  files['package/dist/index.js'] = 'export { start } from "./chunk-ABC123.js";\n';
  files['package/dist/chunk-ABC123.js'] = `const api={version:'0.5.0'}; const record={canvasScanVersion:'0.5.0'}; export { ${ESM_RUNTIME_EXPORTS.join(', ')} };\n`;
  files['package/dist/canvas-scan.iife.js'] = `window.__CANVAS_SCAN__={${IIFE_RUNTIME_FIELDS.join(',')}}; version:'0.5.0'; canvasScanVersion:'0.5.0';\n`;
  files['package/dist/index.d.ts'] = `${ESM_RUNTIME_EXPORTS.map(name => `export declare function ${name}(): void;`).join('\n')}\nexport type { ${TYPE_EXPORTS.join(', ')} };\n`;
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  const tarball = path.join(directory, 'canvas-scan-0.5.0.tgz');
  const entries = Object.keys(files).sort();
  execFileSync('tar', ['-czf', tarball, '-C', root, ...entries]);
  return { directory, tarball };
}

test('binds the exact tarball, manifest, bundles, and declarations', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.directory, { recursive: true, force: true }));
  const gate = gateForTarball(value.tarball, gitSha);
  assert.equal(checkGate(gate, value.tarball), gate);
  assert.equal(gate.packageVersion, '0.5.0');
  assert.equal(gate.gitSha, gitSha);
  assert.equal(Object.keys(gate.declarationSha256).length >= 4, true);
});

test('rejects changed gate fields and hashes', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.directory, { recursive: true, force: true }));
  const gate = gateForTarball(value.tarball, gitSha);
  for (const change of [
    changed => { changed.extra = true; },
    changed => { changed.packageVersion = '0.4.0'; },
    changed => { changed.tarballSha256 = 'b'.repeat(64); },
    changed => { changed.manifestEntries = changed.manifestEntries.slice(1); },
    changed => { changed.esmSha256 = 'b'.repeat(64); },
    changed => { changed.declarationSha256['package/dist/index.d.ts'] = 'b'.repeat(64); },
  ]) {
    const changed = structuredClone(gate);
    change(changed);
    assert.throws(() => checkGate(changed, value.tarball));
  }
  const changedTarball = path.join(value.directory, 'changed.tgz');
  fs.copyFileSync(value.tarball, changedTarball);
  fs.appendFileSync(changedTarball, 'changed');
  assert.throws(() => checkGate(gate, changedTarball), /tarball hash/);
});

test('rejects manifest, declaration, and source identity counterexamples', () => {
  const manifest = [...MANIFEST_STATIC, 'package/dist/chunk-ABC123.js'];
  assert.doesNotThrow(() => assertExactManifest(manifest));
  assert.throws(() => assertExactManifest([...manifest, 'package/dist/benchmark.d.ts']), /manifest/);
  assert.throws(() => assertExactManifest([...manifest, 'package/dist/index.js']), /duplicate/);

  const declarations = `${ESM_RUNTIME_EXPORTS.map(name => `export declare function ${name}(): void;`).join('\n')}\nexport type { ${TYPE_EXPORTS.join(', ')} };`;
  assert.doesNotThrow(() => assertDeclarationSurface(declarations));
  assert.throws(() => assertDeclarationSurface(`${declarations}\nexport interface ExtraType { value: string }`), /declaration exports/);
  assert.throws(() => assertDeclarationSurface(`${declarations}\nexport declare abstract class ExtraType {}`), /declaration exports/);

  assert.doesNotThrow(() => assertSourceLiteralVersion(`const api = { version: '0.5.0' };`, 'version'));
  for (const stale of [
    `const stale = { version: '0.4.0' }; const decoy = { version: '0.5.0' };`,
    `const stale = { 'version': '0.4.0' }; const decoy = { version: '0.5.0' };`,
    `const stale = { ['version']: '0.4.0' }; const decoy = { ['version']: '0.5.0' };`,
  ]) assert.throws(() => assertSourceLiteralVersion(stale, 'version'), /identity/);

  const runtime = Object.fromEntries(ESM_RUNTIME_EXPORTS.map(name => [name, () => {}]));
  assert.doesNotThrow(() => assertExactRuntimeNames(runtime, ESM_RUNTIME_EXPORTS, 'ESM'));
  assert.throws(() => assertExactRuntimeNames({ ...runtime, extraRuntime() {} }, ESM_RUNTIME_EXPORTS, 'ESM'), /exports changed/);
  assert.throws(() => assertPackageBoundary(manifest, { 'package/dist/index.js': 'CANVAS_LAB_V05' }), /release harness marker/);
});

test('rejects a copied PASS summary when the fresh consumer result differs', () => {
  const consumer = {
    runtimeExports: ESM_RUNTIME_EXPORTS,
    iifeFields: IIFE_RUNTIME_FIELDS,
    typeExports: TYPE_EXPORTS,
    runtimeStatus: 'PASS',
    typeStatus: 'PASS',
  };
  const gate = { gitSha, packageVersion: '0.5.0', tarballSha256: 'b'.repeat(64) };
  const summary = {
    schemaVersion: 1,
    status: 'PASS',
    gateSha256: 'c'.repeat(64),
    gitSha,
    packageVersion: '0.5.0',
    tarballSha256: 'b'.repeat(64),
    checks: {
      cleanWorktree: true,
      versionIdentity: true,
      exactManifest: true,
      labBoundary: true,
      esmSurface: true,
      iifeSurface: true,
      declarationSurface: true,
      cleanConsumer: true,
    },
    consumer,
  };
  assert.doesNotThrow(() => checkSummary(summary, gate, consumer));
  assert.throws(() => checkSummary(summary, gate, { ...consumer, runtimeStatus: 'FAIL' }), /fresh check/);
});

test('rejects repository, file-set, canonical JSON, and gate-link changes', () => {
  assert.doesNotThrow(() => assertRepositoryState(gitSha, gitSha, ''));
  assert.throws(() => assertRepositoryState(gitSha, 'b'.repeat(40), ''), /clean current commit/);
  assert.throws(() => assertRepositoryState(gitSha, gitSha, ' M README.md'), /clean current commit/);

  const names = ['canvas-scan-0.5.0.tgz', 'gate.json', 'pack-summary.json'];
  assert.doesNotThrow(() => assertIntegrityNames(names));
  assert.throws(() => assertIntegrityNames([...names, 'extra.json']), /integrity directory/);
  assert.throws(() => assertIntegrityNames(names.slice(1)), /integrity directory/);

  const gateText = canonicalJson({ schemaVersion: 1, gitSha });
  assert.deepEqual(parseCanonicalJson(gateText, 'gate'), { gitSha, schemaVersion: 1 });
  const reordered = `{\n  "schemaVersion": 1,\n  "gitSha": "${gitSha}"\n}\n`;
  assert.throws(() => parseCanonicalJson(reordered, 'gate'), /canonical JSON/);

  const summary = { gateSha256: createHash('sha256').update(gateText).digest('hex') };
  assert.doesNotThrow(() => assertGateFileHash(summary, gateText));
  assert.throws(() => assertGateFileHash(summary, `${gateText} `), /gate file hash/);
});
