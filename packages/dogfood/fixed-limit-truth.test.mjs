import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { expectedMatrix as comparisonMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { recompute as recomputeComparison } from './session-comparison-truth.mjs';
import { checkEvidence, checkEvidenceObject, recomputeCommandComparisons } from './fixed-limit-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const truthPath = path.join(root, 'packages/dogfood/fixtures/v05-08a-fixed-limits/expected.json');
const bundlePath = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const packagePath = path.join(root, 'packages/core/package.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const truth = JSON.parse(await readFile(truthPath, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const limits = Object.fromEntries(truth.limits.map(item => [item.name, item]));
const collectionLimits = Object.fromEntries(truth.limits.map(item => [`max${item.name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`, item.maximum]));
const countKeys = truth.limits.map(item => item.countKey);
const commandLimits = new Set(['active-windows', 'command-entries', 'arguments-per-command', 'value-tokens']);
const callsiteLimits = new Set(['stack-samples', 'frames-per-stack', 'source-map-lookups', 'source-map-response-bytes']);
const chromeRevision = execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim().replace('Google Chrome ', '');

function artifact(row) {
  const target = limits[row.limit];
  const positive = row.mode === 'positive';
  const drops = Object.fromEntries(countKeys.map(key => [key, 0]));
  if (positive) drops[target.countKey] = 1;
  const expectedFirstAffected = clone(row.expectedFirstAffected);
  const windowIndex = expectedFirstAffected?.scope === 'explanation' ? 10 : 10;
  const firstAffected = expectedFirstAffected && expectedFirstAffected.scope !== 'explanation'
    ? { ...expectedFirstAffected, windowIndex: expectedFirstAffected.windowIndex === 'gap-comparison' ? 11 : 10 }
    : expectedFirstAffected;
  const commandOrdinal = firstAffected?.commandOrdinal ?? target.commandOrdinal ?? 0;
  const command = { ordinal: commandOrdinal, operationKind: 'call', name: 'fillRect', argumentCount: 4, arguments: [], unknownReason: positive && commandLimits.has(row.limit) ? target.reason : null };
  const referenceCommand = { ...command, arguments: [], unknownReason: null };
  const windows = row.limit === 'active-windows'
    ? Array.from({ length: 120 }, (_, index) => ({ windowIndex: index - 109, timestampMs: index, commands: [], complete: true, unknownReason: null }))
    : commandLimits.has(row.limit)
    ? [{ windowIndex: windowIndex - 1, timestampMs: 9, commands: [referenceCommand], complete: true, unknownReason: null }, { windowIndex, timestampMs: 10, commands: [command], complete: !positive, unknownReason: positive ? target.reason : null }]
    : callsiteLimits.has(row.limit)
    ? [{ windowIndex: windowIndex - 1, timestampMs: 9, commands: [referenceCommand], complete: true, unknownReason: null }, { windowIndex, timestampMs: 10, commands: [referenceCommand], complete: true, unknownReason: null }]
    : [{ windowIndex: windowIndex - 1, timestampMs: 9, commands: [], complete: true, unknownReason: null }, { windowIndex, timestampMs: 10, commands: [], complete: true, unknownReason: null }];
  const comparisons = recomputeCommandComparisons(windows, drops.activeWindows);
  const stacks = !positive ? []
    : row.limit === 'stack-samples' ? Array.from({ length: 8 }, () => ({ windowIndex: windowIndex - 1, commandOrdinal, frames: [], droppedFrameCount: 0 }))
    : row.limit === 'frames-per-stack' ? [{ windowIndex, commandOrdinal, frames: [], droppedFrameCount: 1 }]
    : row.limit === 'source-map-lookups' || row.limit === 'source-map-response-bytes' ? [{ windowIndex, commandOrdinal, frames: [{ unresolvedReason: target.reason }], droppedFrameCount: 0 }]
    : [];
  return {
    schemaVersion: 1,
    explanationId: `explanation-${row.limit}-${row.variant}`,
    startedAt: '2026-08-12T10:00:00.000Z',
    endedAt: row.limit === 'duration-ms' && positive ? '2026-08-12T10:00:10.000Z' : '2026-08-12T10:00:00.100Z',
    durationMs: row.limit === 'duration-ms' ? positive ? 10000 : row.attempted : 100,
    stopReason: row.limit === 'duration-ms' && positive ? 'max-duration' : 'manual',
    canvasScanVersion: '0.5.0',
    source: { sessionId: 'source', findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'selected#1' },
    followUp: { sessionId: 'follow-up', canvasId: 'selected#1' },
    windows,
    comparisons,
    firstDifference: comparisons.find(item => item.status === 'changed')?.difference ?? null,
    stacks,
    collectionLimits: { ...collectionLimits },
    droppedEntryCounts: drops,
    limitResults: truth.limits.map(definition => ({ name: definition.name, maximum: definition.maximum, rejectedCount: drops[definition.countKey], reason: drops[definition.countKey] ? definition.reason : null, firstAffected: drops[definition.countKey] ? firstAffected : null })),
    callsiteCoverage: positive && callsiteLimits.has(row.limit) ? { status: 'incomplete', incompleteReasons: [target.reason] } : { status: 'complete', incompleteReasons: [] },
    firstGap: positive && commandLimits.has(row.limit) ? { windowIndex, commandOrdinal: target.scope === 'window' ? null : commandOrdinal, reason: target.reason } : null,
  };
}

function fixture() {
  const metadata = { schemaVersion: 1, runId: 'test-run', command: 'pnpm --filter dogfood run probe:fixed-limits', checkCommand: 'pnpm --filter dogfood run probe:fixed-limits:check', commitHash: 'a'.repeat(40), initialStatus: '', finalStatus: '', chromeRevision, bundleHash: 'c'.repeat(64), packageHash: 'b'.repeat(64), expectedHash: 'd'.repeat(64), fixtureHash: 'e'.repeat(64), platform: process.platform, nodeVersion: process.version };
  const artifacts = {};
  const matrix = truth.rows.map(row => {
    const artifactPath = `artifacts/${row.limit}/${row.variant}.json`;
    artifacts[artifactPath] = artifact(row);
    const target = artifacts[artifactPath];
    return { ...row, artifactPath, commitHash: metadata.commitHash, packageHash: metadata.packageHash, chromeRevision: metadata.chromeRevision, facts: { start: { status: 'started' }, repeatedStart: row.limit === 'selected-canvases' ? { status: 'already-active' } : null, completedArtifactStable: row.limit === 'duration-ms' && row.attempted > limits[row.limit].maximum ? true : null, sourceCanvasId: target.source.canvasId, followUpCanvasId: target.followUp.canvasId } };
  });
  const mismatchRow = comparisonMatrix.rows.find(row => row.id === 'finding-type-mismatch');
  const baseline = sessionFor(mismatchRow, 0); const candidate = sessionFor(mismatchRow, 1);
  const pairing = { baselineFindingIndex: mismatchRow.baselineFindingIndex, candidateFindingIndex: mismatchRow.candidateFindingIndex };
  const mismatch = { row: pairing, baseline, candidate, artifact: recomputeComparison(pairing, baseline, candidate) };
  const overlayFilter = {
    baselineType: 'repeated-draw-work',
    mismatch: { candidateTypes: ['resize-churn'], actions: [{ findingIndex: 0, hidden: true }] },
    same: { candidateTypes: ['repeated-draw-work', 'repeated-draw-work'], actions: [{ findingIndex: 0, hidden: false }, { findingIndex: 1, hidden: false }] },
  };
  const privacyArtifact = artifact(truth.rows.find(row => row.limit === 'arguments-per-command' && row.mode === 'negative'));
  const privacyCommand = privacyArtifact.windows.at(-1).commands[0];
  privacyCommand.argumentCount = 10;
  privacyCommand.arguments = Array.from({ length: 10 }, (_, position) => ({ position, kind: position === 5 ? 'object' : 'number', token: position === 9 ? null : `${'a'.repeat(32)}-${position + 1}` }));
  privacyCommand.unknownReason = 'unsupported-value';
  privacyArtifact.windows.at(-1).complete = false;
  privacyArtifact.windows.at(-1).unknownReason = 'unsupported-value';
  privacyArtifact.comparisons = recomputeCommandComparisons(privacyArtifact.windows, 0);
  const privacy = { nativeSucceeded: true, prepareStackTraceCalls: 0, artifact: privacyArtifact };
  const requests = truth.rows.filter(row => row.limit === 'source-map-response-bytes').map(row => ({ row: `${row.limit}:${row.variant}`, kind: 'source-map', origin: 'http://127.0.0.1:5208', responseUrl: 'http://127.0.0.1:5208/large/fixture.js.map', status: 200, redirected: false, responseHeaders: { contentType: 'application/json', contentLength: String(row.attempted), cacheControl: 'no-store' }, responseByteSource: 'served-body', responseBytes: row.attempted }));
  const diagnostics = { warnings: [], errors: [], pageErrors: [], requestFailures: [], instrumentationKills: [], runnerFailures: [], general: [] };
  return { matrix, artifacts, mismatch, overlayFilter, privacy, requests, diagnostics, metadata, origin: 'http://127.0.0.1:5208' };
}

function rejected(name, mutate, reason) {
  test(name, () => {
    const evidence = fixture(); mutate(evidence);
    assert.throws(() => checkEvidenceObject(evidence, truth), new RegExp(reason));
  });
}

test('accepts complete deterministic fixed-limit evidence', () => assert.equal(checkEvidenceObject(fixture(), truth), true));

rejected('rejects a false zero drop', value => { const row = value.matrix.find(item => item.limit === 'command-entries' && item.mode === 'positive'); const item = value.artifacts[row.artifactPath]; item.droppedEntryCounts.commandEntries = 0; item.limitResults.find(result => result.name === 'command-entries').rejectedCount = 0; }, 'false-event');
rejected('rejects a wrong limit reason', value => { const row = value.matrix.find(item => item.limit === 'value-tokens' && item.mode === 'positive'); value.artifacts[row.artifactPath].limitResults.find(result => result.name === row.limit).reason = 'command-limit'; }, 'event');
rejected('rejects a wrong coordinate scope', value => { const row = value.matrix.find(item => item.limit === 'active-windows' && item.mode === 'positive'); value.artifacts[row.artifactPath].limitResults.find(result => result.name === row.limit).firstAffected.scope = 'command'; }, 'event');
rejected('rejects a plausible wrong coordinate window', value => { const row = value.matrix.find(item => item.limit === 'stack-samples' && item.mode === 'positive'); value.artifacts[row.artifactPath].limitResults.find(result => result.name === row.limit).firstAffected.windowIndex += 1000; }, 'exact-coordinate');
rejected('rejects a coordinated last-window and response-limit forgery', value => { const row = value.matrix.find(item => item.limit === 'source-map-response-bytes' && item.mode === 'positive'); const item = value.artifacts[row.artifactPath]; item.limitResults.find(result => result.name === row.limit).firstAffected.windowIndex = 999999; item.windows.at(-1).windowIndex = 999999; }, 'command-recompute');
rejected('rejects a coordinated active-window comparison forgery', value => { const row = value.matrix.find(item => item.limit === 'active-windows' && item.mode === 'positive'); const item = value.artifacts[row.artifactPath]; item.limitResults.find(result => result.name === row.limit).firstAffected.windowIndex = 999999; item.comparisons.at(-1).targetWindowIndex = 999999; }, 'coordinate-gap-comparison');
rejected('rejects a coordinated command comparison forgery', value => { const row = value.matrix.find(item => item.limit === 'command-entries' && item.mode === 'positive'); const item = value.artifacts[row.artifactPath]; item.limitResults.find(result => result.name === row.limit).firstAffected.windowIndex = 999999; item.comparisons.at(-1).targetWindowIndex = 999999; }, 'exact-coordinate');
rejected('rejects a coordinated callsite sample forgery', value => { const row = value.matrix.find(item => item.limit === 'source-map-response-bytes' && item.mode === 'positive'); const item = value.artifacts[row.artifactPath]; item.limitResults.find(result => result.name === row.limit).firstAffected.windowIndex = 999999; item.stacks.at(-1).windowIndex = 999999; }, 'exact-coordinate');
rejected('rejects a wrong command ordinal', value => { const row = value.matrix.find(item => item.limit === 'arguments-per-command' && item.mode === 'positive'); value.artifacts[row.artifactPath].limitResults.find(result => result.name === row.limit).firstAffected.commandOrdinal = 4; }, 'exact-coordinate');
rejected('rejects an imprecise manual duration', value => { const row = value.matrix.find(item => item.limit === 'duration-ms' && item.mode === 'negative'); value.artifacts[row.artifactPath].durationMs = 10000; }, 'duration-value');
rejected('rejects a changed completed duration artifact', value => { const row = value.matrix.find(item => item.limit === 'duration-ms' && item.attempted > limits[item.limit].maximum); row.facts.completedArtifactStable = false; }, 'duration-stability');
rejected('rejects a known result across a command gap', value => { const row = value.matrix.find(item => item.limit === 'command-entries' && item.mode === 'positive'); Object.assign(value.artifacts[row.artifactPath].comparisons[0], { status: 'same', unknownReason: null }); }, 'command-recompute');
rejected('rejects a raw argument value', value => { const row = value.matrix[0]; value.artifacts[row.artifactPath].explanationId = 'SIDPROJ_84_PRIVATE_STRING'; }, 'privacy-leak');
rejected('rejects a raw stack', value => { const row = value.matrix[0]; value.artifacts[row.artifactPath].explanationId = 'Error: SIDPROJ_84_RAW_STACK'; }, 'privacy-leak');
rejected('rejects a source map body', value => { value.artifacts[value.matrix[0].artifactPath].explanationId = JSON.stringify({ version: 3, mappings: 'AAAA', sourcesContent: ['SIDPROJ_84_SOURCE_CONTENT'] }); }, 'privacy-leak');
rejected('rejects forged response bytes', value => { value.requests.find(item => item.row.includes('source-map-response-bytes:wrapper-depth')).responseBytes = 2; }, 'request-byte-measurement');
rejected('rejects an oversized response marked at the boundary', value => { const row = value.matrix.find(item => item.limit === 'source-map-response-bytes' && item.mode === 'positive'); row.attempted = 2097152; }, 'matrix-truth');
rejected('rejects a callsite limit that changes command status', value => { const row = value.matrix.find(item => item.limit === 'stack-samples' && item.mode === 'positive'); Object.assign(value.artifacts[row.artifactPath].comparisons[0], { status: 'unknown', unknownReason: 'stack-sample-limit' }); }, 'command-recompute');
rejected('rejects callsite command-status tampering', value => { const row = value.matrix.find(item => item.limit === 'frames-per-stack' && item.mode === 'positive'); const comparison = value.artifacts[row.artifactPath].comparisons.at(-1); Object.assign(comparison, { status: 'changed', difference: { ordinal: 0 }, unknownReason: null }); }, 'command-recompute');
rejected('rejects a forged mismatch overlay activation', value => { value.overlayFilter.mismatch.actions[0].hidden = false; }, 'overlay-filter-exact');
rejected('rejects coordinated overlay type and visibility tampering', value => { value.overlayFilter.mismatch.candidateTypes[0] = 'repeated-draw-work'; value.overlayFilter.mismatch.actions[0].hidden = false; }, 'overlay-filter-exact');
rejected('rejects an unseeded URL query and fragment', value => { value.privacy.artifact.explanationId = 'https://example.invalid/path?token=abc#secret'; }, 'privacy-leak');
rejected('rejects an application stack hook call', value => { value.privacy.prepareStackTraceCalls = 1; }, 'privacy-probe-facts');
rejected('rejects mismatch measures', value => { value.mismatch.artifact.measures.push({ id: 'forged' }); }, 'mismatch-recompute');
rejected('rejects a missing matrix row', value => { value.matrix.pop(); }, 'matrix-shape');
rejected('rejects a wrong variant', value => { value.matrix[0].variant = 'forged'; }, 'matrix-truth');
rejected('rejects a missing nearest negative', value => { value.matrix = value.matrix.filter(row => !(row.limit === 'duration-ms' && row.mode === 'negative')); }, 'matrix-shape');
rejected('rejects a missing raw artifact', value => { delete value.artifacts[value.matrix[0].artifactPath]; }, 'missing-artifact');
rejected('rejects forged commit metadata', value => { value.metadata.commitHash = 'c'.repeat(40); }, 'matrix-metadata');
rejected('rejects forged package metadata', value => { value.metadata.packageHash = 'd'.repeat(64); }, 'matrix-metadata');
rejected('rejects forged Chrome metadata', value => { value.metadata.chromeRevision = '999.1.2.3'; for (const row of value.matrix) row.chromeRevision = value.metadata.chromeRevision; }, 'metadata-chrome');
rejected('rejects an extra metadata key', value => { value.metadata.extra = true; }, 'metadata-keys');
rejected('rejects a browser warning', value => { value.diagnostics.warnings.push('warning'); }, 'diagnostic:warnings');
rejected('rejects unsupported claim text', value => { value.mismatch.artifact.measures.push({ interpretation: 'faster' }); value.mismatch.artifact = recomputeComparison(value.mismatch.row, value.mismatch.baseline, value.mismatch.candidate); value.overlayFilter.label = 'improved'; }, 'unsupported-claim');

async function diskFixture() {
  const evidence = fixture();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sidproj-84-checker-'));
  const currentStatus = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  const bundle = await readFile(bundlePath);
  evidence.metadata = {
    schemaVersion: 1,
    runId: 'test-run',
    command: 'pnpm --filter dogfood run probe:fixed-limits',
    checkCommand: 'pnpm --filter dogfood run probe:fixed-limits:check',
    commitHash: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    initialStatus: currentStatus,
    finalStatus: currentStatus,
    chromeRevision,
    bundleHash: sha(bundle),
    packageHash: sha(Buffer.concat([await readFile(packagePath), bundle])),
    expectedHash: sha(await readFile(truthPath)),
    fixtureHash: sha(await readFile(path.join(root, 'apps/workbench/public/v05-08a-fixed-limits.html'))),
    platform: process.platform,
    nodeVersion: process.version,
  };
  for (const row of evidence.matrix) { row.commitHash = evidence.metadata.commitHash; row.packageHash = evidence.metadata.packageHash; row.chromeRevision = evidence.metadata.chromeRevision; }
  const verificationCommands = [
    'pnpm --filter canvas-scan exec vitest run test/explanation.test.ts test/command-capture.test.ts test/draw-callsite.test.ts test/comparison.test.ts test/overlay.test.ts',
    'pnpm --filter dogfood run probe:command-capture:test', 'pnpm --filter dogfood run probe:draw-callsite:test', 'pnpm --filter dogfood run probe:session-comparison:test', 'pnpm --filter dogfood run probe:overlay-comparison:test',
    'pnpm --filter canvas-scan run test', 'pnpm --filter dogfood run lab:v0.4', 'pnpm --filter dogfood run probe:explanation-state', 'pnpm --filter dogfood run probe:command-capture', 'pnpm --filter dogfood run probe:draw-callsite', 'pnpm --filter dogfood run probe:draw-callsite:check', 'pnpm --filter dogfood run probe:explanation-overlay', 'pnpm --filter dogfood run probe:overlay-comparison', 'pnpm --filter dogfood run probe:overlay-comparison:check', 'pnpm -r run typecheck', 'pnpm --filter canvas-scan run build', 'pnpm --filter demo run build', 'git diff --check', 'git status --short --branch',
  ];
  const verificationOutput = verificationCommands.map((command, index) => `COMMAND: ${command}\nEXIT: 0\nSTDOUT:\n${index === 0 ? 'Test Files  5 passed\n' : 'PASS\n'}STDERR:\n`).join('\n');
  const writes = {
    'expected.json': truth,
    'matrix.json': evidence.matrix,
    'requests.json': evidence.requests,
    'mismatch.json': evidence.mismatch,
    'overlay-filter.json': evidence.overlayFilter,
    'privacy.json': evidence.privacy,
    'diagnostics.json': evidence.diagnostics,
    'run-metadata.json': evidence.metadata,
    'checker-output.txt': 'SIDPROJ_84_FIXED_LIMITS: PASS\n',
    'mutation-test-output.txt': 'COMMAND: pnpm --filter dogfood run probe:fixed-limits:test\nEXIT: 0\nSTDOUT:\n# fail 0\nSTDERR:\n',
    'verification-output.txt': verificationOutput,
    ...evidence.artifacts,
  };
  for (const [relative, value] of Object.entries(writes)) { const file = path.join(directory, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); }
  const lines = await Promise.all(Object.keys(writes).sort().map(async relative => `${sha(await readFile(path.join(directory, relative)))}  ${relative}`));
  await writeFile(path.join(directory, 'evidence-sha256.txt'), `${lines.join('\n')}\n`);
  return directory;
}

test('disk checker accepts the complete exact file set', async t => { const directory = await diskFixture(); t.after(() => rm(directory, { recursive: true, force: true })); assert.equal(await checkEvidence(directory), true); });
test('disk checker rejects a hash mismatch', async t => { const directory = await diskFixture(); t.after(() => rm(directory, { recursive: true, force: true })); const file = path.join(directory, 'verification-output.txt'); await writeFile(file, `${await readFile(file, 'utf8')}changed\n`); await assert.rejects(checkEvidence(directory), /manifest-hash/); });
test('disk checker rejects a forged fixture hash after manifest refresh', async t => {
  const directory = await diskFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const metadataPath = path.join(directory, 'run-metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.fixtureHash = 'f'.repeat(64);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const present = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim().split('\n').map(line => line.slice(66));
  const lines = await Promise.all(present.map(async relative => `${sha(await readFile(path.join(directory, relative)))}  ${relative}`));
  await writeFile(path.join(directory, 'evidence-sha256.txt'), `${lines.join('\n')}\n`);
  await assert.rejects(checkEvidence(directory), /metadata-hashes/);
});
test('disk checker rejects a missing manifest line', async t => { const directory = await diskFixture(); t.after(() => rm(directory, { recursive: true, force: true })); const file = path.join(directory, 'evidence-sha256.txt'); const lines = (await readFile(file, 'utf8')).trim().split('\n'); await writeFile(file, `${lines.slice(1).join('\n')}\n`); await assert.rejects(checkEvidence(directory), /manifest-coverage/); });
test('disk checker rejects a symbolic-link artifact', async t => { const directory = await diskFixture(); t.after(() => rm(directory, { recursive: true, force: true })); const relative = fixture().matrix[0].artifactPath; const file = path.join(directory, relative); await rm(file); await symlink(path.join(directory, 'matrix.json'), file); await assert.rejects(checkEvidence(directory), /artifact-file/); });
