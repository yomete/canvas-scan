import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CANDIDATE_ALLOWLIST, HUMAN_TEST, RELEASE_NOTES, REQUIRED_COMMANDS, ROOT_ENTRIES, candidateRetryHash, changedPaths, checkCommands, checkDocuments, checkPackSummary, checkPassiveBenchmarks, checkRetry, classifyCommand, evaluateRelease, failureFamily, recursiveManifestHash, retryDecision } from './release-v05.mjs';
import { ESM_RUNTIME_EXPORTS, MANIFEST_REQUIRED, TYPE_EXPORTS } from '../../scripts/pack-manifest.mjs';

const condition = () => ({ ports: { '4385': [], '5190': [], '5199': [], '5209': [], '5210': [] }, network: { github: true, npm: true }, chrome: { revision: 'Google Chrome 151.0.7922.137' }, cache: { npm: null, yarn: null }, timing: { token: null } });
const commands = () => REQUIRED_COMMANDS.map(command => ({ command, status: 'PASS' }));
const benchmark = () => ({ meanMs: 3.9, p95Ms: 7.9, noSelection: { commandEntryAllocations: 0, stackAllocations: 0 } });
const candidate = () => ({ gitSha: 'a'.repeat(40), files: ['a'], hashes: { a: 'b'.repeat(64) }, status: [' M a'], tarballSha256: null });

test('has the exact mechanical order and bounded scope', () => {
  assert.deepEqual(REQUIRED_COMMANDS, ['pnpm -r run typecheck', 'pnpm --filter canvas-scan run test', 'pnpm --filter canvas-scan run build', 'pnpm --filter demo run build', 'pnpm --filter dogfood run lab:v0.4', 'pnpm --filter dogfood run lab:v0.5', 'pnpm --filter dogfood run bench:chrome', 'pnpm --filter dogfood run bench:v0.5:chrome', 'node scripts/verify-pack.mjs', 'git diff --check']);
  assert.equal(ROOT_ENTRIES.length, 14); assert.deepEqual(CANDIDATE_ALLOWLIST, [...CANDIDATE_ALLOWLIST].sort()); assert.ok(CANDIDATE_ALLOWLIST.includes('packages/dogfood/lab-v05-truth.mjs')); assert.equal(REQUIRED_COMMANDS.some(command => /sign|publish|tag|upload|linear/i.test(command)), false);
});

test('keeps the leading porcelain status column when it reads paths', () => {
  assert.deepEqual(changedPaths([' M packages/core/a.ts', '?? new-file.ts', 'R  old.ts -> new.ts']), ['packages/core/a.ts', 'new-file.ts', 'new.ts']);
});

test('keeps every environment family separate from product failures', () => {
  for (const [message, family] of [['EADDRINUSE port 5210', 'ports'], ['ENOTFOUND github.com', 'network'], ['browserType.launch failed', 'chrome'], ['npm cache EACCES', 'cache'], ['server did not answer', 'timing']]) { assert.equal(classifyCommand({ exitCode: 1, stderr: message }), 'ENVIRONMENT_FAILURE'); assert.equal(failureFamily(message), family); }
  assert.equal(classifyCommand({ exitCode: 1, stderr: 'mean threshold failed' }), 'PRODUCT_FAILURE'); assert.equal(classifyCommand({ exitCode: 0 }), 'PASS');
});

test('uses strict performance and structural gates', () => {
  const base = { commands: commands(), bench: benchmark(), pack: { status: 'PASS' }, external: { status: 'PASS' }, passive: true }; assert.equal(evaluateRelease(base).pass, true);
  for (const change of [value => { value.bench.meanMs = 4; }, value => { value.bench.p95Ms = 8; }, value => { value.bench.noSelection.commandEntryAllocations = 1; }, value => { value.bench.noSelection.stackAllocations = 1; }, value => { value.pack.status = 'FAIL'; }, value => { value.external.status = 'FAIL'; }, value => { value.passive = false; }]) { const value = structuredClone(base); change(value); assert.equal(evaluateRelease(value).pass, false); }
});

test('binds retry identity to source but not the later tarball or report', () => { const first = candidate(); const second = structuredClone(first); second.tarballSha256 = 'c'.repeat(64); second.status.push('?? docs/releases/v0.5-report.md'); assert.equal(candidateRetryHash(first), candidateRetryHash(second)); second.hashes.a = 'd'.repeat(64); assert.notEqual(candidateRetryHash(first), candidateRetryHash(second)); });

test('requires one recorded environment change for a retry', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sidproj-70-retry-test-')); t.after(() => rmSync(directory, { recursive: true })); writeFileSync(path.join(directory, 'failure.txt'), 'failure\n'); const manifest = recursiveManifestHash(directory); const before = condition(); before.ports['5210'] = ['10'];
  const prior = { candidate: candidate(), retry: { status: 'environment-failure', attemptPath: directory, attemptManifestSha256: manifest, failureFamily: 'ports', checkedConditions: [before] } }; const changed = condition(); assert.deepEqual(retryDecision(prior, candidate(), changed), { name: 'ports', before: before.ports, after: changed.ports }); assert.throws(() => retryDecision(prior, candidate(), before), /did not change/); prior.retry.status = 'product-failure'; assert.throws(() => retryDecision(prior, candidate(), changed), /product failure/);
});

test('checks the closed retry records', () => {
  const value = { attemptCount: 1, status: 'not-used', attemptPath: '/private/tmp/attempt', attemptManifestSha256: null, priorAttemptPath: null, priorManifestSha256: null, priorError: null, failureFamily: null, checkedConditions: [condition()], changedCondition: null };
  assert.doesNotThrow(() => checkRetry(value)); for (const mutate of [item => { item.extra = true; }, item => { item.checkedConditions[0].ports.extra = []; }, item => { item.attemptCount = 2; }]) { const changed = structuredClone(value); mutate(changed); assert.throws(() => checkRetry(changed)); }
});

function packFixture() {
  const identity = { version: '0.5.0', gitSha: 'a'.repeat(40), iifeSha256: 'b'.repeat(64), esmSha256: 'c'.repeat(64), declarationSha256: 'd'.repeat(64), tarballSha256: 'e'.repeat(64) };
  const manifestEntries = [...MANIFEST_REQUIRED, 'package/dist/chunk-ABC123.js']; const declarations = manifestEntries.filter(entry => /^package\/dist\/.*\.d\.ts$/.test(entry)); const fixtureResults = ['public contract', 'lab boundary', 'package', 'clean public surface fixture', 'Vite fixture', 'manual release test', 'Next fixture'].map(name => ({ name, status: 'PASS' }));
  const pack = { schemaVersion: 1, packageVersion: identity.version, baseGitSha: identity.gitSha, dirty: true, tarballSha256: identity.tarballSha256, esmSha256: identity.esmSha256, runtimeSha256: 'f'.repeat(64), iifeSha256: identity.iifeSha256, packageManifestVersion: identity.version, declarationHashes: Object.fromEntries(declarations.map(entry => [entry, entry === 'package/dist/index.d.ts' ? identity.declarationSha256 : '1'.repeat(64)])), manifestEntries, runtimeExports: ESM_RUNTIME_EXPORTS, typeExports: TYPE_EXPORTS, publicContract: 'PASS', labBoundary: 'PASS', manualReleaseTestSha256: '2'.repeat(64), fixtureResults, publicContractResults: fixtureResults.slice(0, 2), labBoundaryResults: [fixtureResults[1]], publicSurfaceProbe: { installCommand: 'npm install --no-audit --no-fund <exact-tarball> typescript@^5 --cache <temporary-cache>', importCommand: 'node --eval <runtime-export-allowlist-probe>', typecheckCommand: 'node <fixture-typescript>/bin/tsc --project tsconfig.json', runtimeExports: ESM_RUNTIME_EXPORTS, typeExports: TYPE_EXPORTS, importStatus: 'PASS', typecheckStatus: 'PASS' }, environmentErrors: [], finalStatus: 'PASS' };
  return { identity, pack };
}

test('requires the complete clean package surface and exact nested schema', () => {
  const { identity, pack } = packFixture(); assert.doesNotThrow(() => checkPackSummary(pack, identity));
  for (const mutate of [value => { value.runtimeExports.push('extra'); }, value => { value.declarationHashes.extra = '0'.repeat(64); }, value => { value.fixtureResults[0].extra = true; }, value => { value.publicSurfaceProbe.importCommand = 'node anything'; }, value => { value.manifestEntries.push('package/private.js'); }, value => { value.tarballSha256 = '0'.repeat(64); }]) { const value = structuredClone(pack); mutate(value); assert.throws(() => checkPackSummary(value, identity)); }
});

function passiveBlock() { return Object.fromEntries([100, 1000, 10000].map(operations => [operations, Object.fromEntries(['off', 'passthrough', 'full', 'countonly'].map(mode => [mode, Array(240).fill(1)]))])); }
function passiveStats() { const stats = { median: 1, p95: 1, mean: 1 }; return Object.fromEntries([100, 1000, 10000].map(operations => [operations, { off: stats, passthrough: stats, full: stats, countonly: stats, fullAddedMeanMs: 0, fullAddedP95Ms: 0, countOnlyAddedMeanMs: 0, countOnlyAddedP95Ms: 0, passthroughAddedMeanMs: 0 }])); }
function passiveArtifact(stream) { return { schemaVersion: 1, when: '2026-08-13T10:00:01.000Z', selfContained: true, baseUrl: 'http://localhost:5199', stream, git: { sha: 'a'.repeat(40), dirty: true }, bundleSha256: 'b'.repeat(64), browserVersion: '151.0.7922.137', hardware: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? process.arch, cores: os.cpus().length }, thresholds: { fullAddedMeanMs: 2, fullAddedP95Ms: 3, countOnlyAddedMeanMs: .75, countOnlyAddedP95Ms: 2 }, harnessSha256: 'c'.repeat(64), failures: [], raw: Array.from({ length: 5 }, passiveBlock), perBlock: Array.from({ length: 5 }, passiveStats), gates: { fullAddedMeanMs: 0, fullAddedP95Ms: 0, countOnlyAddedMeanMs: 0, countOnlyAddedP95Ms: 0, pass: true } }; }

test('recomputes passive benchmark summaries and gates from raw frames', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sidproj-70-passive-test-')); t.after(() => rmSync(directory, { recursive: true })); const identity = { gitSha: 'a'.repeat(40), iifeSha256: 'b'.repeat(64), passiveBenchmarkHarnessSha256: 'c'.repeat(64), chromeRevision: 'Google Chrome 151.0.7922.137', host: { cpu: os.cpus()[0]?.model ?? process.arch, cores: os.cpus().length } }; const command = { startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:00:02.000Z' };
  const write = (stream, value) => writeFileSync(path.join(directory, `sidproj-56-bench-${stream}-test.json`), `${JSON.stringify(value)}\n`); write('mixed', passiveArtifact('mixed')); write('tracked-source', passiveArtifact('tracked-source')); assert.doesNotThrow(() => checkPassiveBenchmarks(directory, identity, command));
  const forged = passiveArtifact('mixed'); forged.gates.fullAddedMeanMs = 1; write('mixed', forged); assert.throws(() => checkPassiveBenchmarks(directory, identity, command), /gate changed/);
});

test('checks exact command schemas, ordering, timestamps, and output files', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sidproj-70-command-test-')); t.after(() => rmSync(directory, { recursive: true })); mkdirSync(path.join(directory, 'command-output'));
  const rows = REQUIRED_COMMANDS.map((command, index) => { const name = String(index).padStart(2, '0'); writeFileSync(path.join(directory, `command-output/${name}.stdout`), ''); writeFileSync(path.join(directory, `command-output/${name}.stderr`), ''); return { command, class: 'mechanical', startedAt: `2026-08-13T10:00:${String(index * 2).padStart(2, '0')}.000Z`, endedAt: `2026-08-13T10:00:${String(index * 2 + 1).padStart(2, '0')}.000Z`, exitCode: 0, status: 'PASS', stdout: `command-output/${name}.stdout`, stderr: `command-output/${name}.stderr`, artifactPath: null }; });
  assert.doesNotThrow(() => checkCommands(directory, rows)); for (const mutate of [value => { value[0].extra = true; }, value => { value[1].startedAt = value[0].startedAt; }, value => { value[2].stdout = 'wrong'; }]) { const changed = structuredClone(rows); mutate(changed); assert.throws(() => checkCommands(directory, changed)); }
});

test('accepts only the approved release documents', () => { assert.equal(checkDocuments(RELEASE_NOTES, HUMAN_TEST), true); assert.throws(() => checkDocuments(`${RELEASE_NOTES}extra\n`, HUMAN_TEST)); assert.throws(() => checkDocuments(RELEASE_NOTES, HUMAN_TEST.replace('Step 8', 'Step 9'))); });
