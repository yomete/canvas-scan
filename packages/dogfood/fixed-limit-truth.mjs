import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recompute as recomputeComparison } from './session-comparison-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const truthPath = path.join(root, 'packages/dogfood/fixtures/v05-08a-fixed-limits/expected.json');
const bundlePath = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const packagePath = path.join(root, 'packages/core/package.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const countKeys = ['durationStops', 'selectedCanvasRejections', 'activeWindows', 'commandEntries', 'commandArguments', 'valueTokens', 'stackSamples', 'stackFrames', 'sourceMapLookups', 'sourceMapResponses'];
const callsiteNames = ['stack-samples', 'frames-per-stack', 'source-map-lookups', 'source-map-response-bytes'];
const commandNames = ['active-windows', 'command-entries', 'arguments-per-command', 'value-tokens'];
const forbiddenClaims = ['same pixels', 'unchanged pixels', 'wasted work', 'avoidable work', 'caused by', 'fixed', 'faster', 'improved', 'regressed', 'automatic-match'];
const artifactKeys = ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'limitResults', 'callsiteCoverage', 'firstGap'];
const stable = value => JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error(`fixed-limit evidence: ${reason}`); };
const rowKey = row => `${row.limit}:${row.variant}`;
const exactKeys = (value, keys, reason) => { if (!value || stable(Object.keys(value).sort()) !== stable([...keys].sort())) fail(reason); };
const validPath = value => typeof value === 'string' && !path.isAbsolute(value) && !value.split('/').includes('..');
const metadataKeys = ['schemaVersion', 'runId', 'command', 'checkCommand', 'commitHash', 'initialStatus', 'finalStatus', 'chromeRevision', 'bundleHash', 'packageHash', 'expectedHash', 'fixtureHash', 'platform', 'nodeVersion'];
const verificationCommands = [
  'pnpm --filter canvas-scan exec vitest run test/explanation.test.ts test/command-capture.test.ts test/draw-callsite.test.ts test/comparison.test.ts test/overlay.test.ts',
  'pnpm --filter dogfood run probe:command-capture:test',
  'pnpm --filter dogfood run probe:draw-callsite:test',
  'pnpm --filter dogfood run probe:session-comparison:test',
  'pnpm --filter dogfood run probe:overlay-comparison:test',
  'pnpm --filter canvas-scan run test',
  'pnpm --filter dogfood run lab:v0.4',
  'pnpm --filter dogfood run probe:explanation-state',
  'pnpm --filter dogfood run probe:command-capture',
  'pnpm --filter dogfood run probe:draw-callsite',
  'pnpm --filter dogfood run probe:draw-callsite:check',
  'pnpm --filter dogfood run probe:explanation-overlay',
  'pnpm --filter dogfood run probe:overlay-comparison',
  'pnpm --filter dogfood run probe:overlay-comparison:check',
  'pnpm -r run typecheck',
  'pnpm --filter canvas-scan run build',
  'pnpm --filter demo run build',
  'git diff --check',
  'git status --short --branch',
];
const installedChromeRevision = (() => {
  const match = execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim().match(/^Google Chrome ([0-9]+(?:\.[0-9]+){3})$/);
  if (!match) fail('installed-chrome');
  return match[1];
})();

function claimText(value) {
  const values = [];
  function visit(item, key = '') {
    if (typeof item === 'string') { if (/text|label|claim|observation|explanation|nextcheck|interpretation/i.test(key)) values.push(item); return; }
    if (Array.isArray(item)) { item.forEach(entry => visit(entry, key)); return; }
    if (!item || typeof item !== 'object') return;
    for (const [name, entry] of Object.entries(item)) visit(entry, name);
  }
  visit(value);
  return values.join('\n').toLowerCase();
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function commandComparison(reference, target) {
  if (!reference.complete || !target.complete) return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: 'unknown', difference: null, unknownReason: reference.unknownReason ?? target.unknownReason };
  const count = Math.max(reference.commands.length, target.commands.length);
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const left = reference.commands[ordinal] ?? null;
    const right = target.commands[ordinal] ?? null;
    let reason = null;
    if (!left) reason = 'command-added'; else if (!right) reason = 'command-removed';
    else if (left.operationKind !== right.operationKind) reason = 'operation-kind';
    else if (left.name !== right.name) reason = 'operation-name';
    else if (left.argumentCount !== right.argumentCount) reason = 'argument-count';
    else for (let index = 0; index < Math.max(left.arguments.length, right.arguments.length); index++) {
      const leftArgument = left.arguments[index]; const rightArgument = right.arguments[index];
      if (!leftArgument || !rightArgument || leftArgument.kind !== rightArgument.kind) { reason = 'argument-kind'; break; }
      if (leftArgument.token !== rightArgument.token) { reason = 'argument-token'; break; }
    }
    if (reason) return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: 'changed', difference: { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, ordinal, reason, reference: left ? structuredClone(left) : null, target: right ? structuredClone(right) : null }, unknownReason: null };
  }
  return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: 'same', difference: null, unknownReason: null };
}

export function recomputeCommandComparisons(windows, droppedActiveWindows = 0) {
  const result = [];
  for (let index = 1; index < windows.length; index++) result.push(commandComparison(windows[index - 1], windows[index]));
  for (let index = 0; index < droppedActiveWindows; index++) {
    const reference = windows.at(-1);
    result.push({ referenceWindowIndex: reference.windowIndex, targetWindowIndex: reference.windowIndex + index + 1, status: 'unknown', difference: null, unknownReason: 'window-limit' });
  }
  return result;
}

export function scanPrivacy(value, seeds) {
  const text = stable(value).toLowerCase();
  const values = seeds.map(String);
  const combinations = [...values, values.join(''), values.join(':'), values.join('|'), JSON.stringify(values)];
  const digests = combinations.flatMap(item => [sha256(item), fnv1a(item), String(Number.parseInt(fnv1a(item), 16))]);
  const matches = [...values, ...digests].filter(item => text.includes(item.toLowerCase()));
  if (/\b(?:query|fragment)\b/i.test(text) || /error:\s+sidproj_84_raw_stack/i.test(text) || /sourcescontent/i.test(text)) matches.push('private-shape');
  function visit(entry) {
    if (typeof entry === 'string' && /(?:https?:\/\/|file:|\/)[^\s"'\\]*[?#][^\s"'\\]*/i.test(entry)) matches.push('url-query-or-fragment');
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === 'object') Object.entries(entry).forEach(([key, item]) => { visit(key); visit(item); });
  }
  visit(value);
  return [...new Set(matches)];
}

function limitMap(truth) { return new Map(truth.limits.map(item => [item.name, item])); }

function expectedCoordinate(artifact, value, reason) {
  if (!value || value.scope === 'explanation') return value;
  let windowIndex = value.windowIndex;
  if (value.windowIndex === 'gap-comparison') {
    const comparisons = artifact.comparisons.filter(item => item.status === 'unknown' && item.unknownReason === reason);
    const lastStored = artifact.windows.at(-1)?.windowIndex;
    if (comparisons.length !== 1 || !Number.isInteger(lastStored) || comparisons[0].referenceWindowIndex !== lastStored || comparisons[0].targetWindowIndex !== lastStored + 1) fail('coordinate-gap-comparison');
    windowIndex = lastStored + 1;
  }
  if (value.windowIndex === 'command-gap') {
    const windows = artifact.windows.filter(item => item.unknownReason === reason);
    if (windows.length !== 1) fail('coordinate-command-gap');
    windowIndex = windows[0].windowIndex;
  }
  if (value.windowIndex === 'stack-sample-overflow') {
    const lastStored = Math.max(...artifact.stacks.map(item => item.windowIndex));
    const later = artifact.windows.map(item => item.windowIndex).filter(item => item > lastStored).sort((left, right) => left - right);
    if (artifact.stacks.length !== 8 || later.length === 0) fail('coordinate-stack-sample-overflow');
    windowIndex = later[0];
  }
  if (value.windowIndex === 'dropped-frame-sample') {
    const samples = artifact.stacks.filter(item => item.droppedFrameCount > 0);
    if (samples.length !== 1) fail('coordinate-dropped-frame-sample');
    windowIndex = samples[0].windowIndex;
  }
  if (value.windowIndex === 'unresolved-frame') {
    const samples = artifact.stacks.filter(item => item.frames.some(frame => frame.unresolvedReason === reason));
    if (samples.length !== 1) fail('coordinate-unresolved-frame');
    windowIndex = samples[0].windowIndex;
  }
  if (value.windowIndex === 'last-command-window') {
    const windows = artifact.windows.filter(item => item.commands.some(command => command.ordinal === value.commandOrdinal));
    if (!windows.length) fail('coordinate-last-command-window');
    windowIndex = windows.at(-1).windowIndex;
  }
  if (!Number.isInteger(windowIndex)) fail('coordinate-anchor');
  return { ...value, windowIndex };
}

function validateArtifact(artifact, truth, row) {
  exactKeys(artifact, artifactKeys, `${rowKey(row)}:artifact-keys`);
  if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.windows) || !Array.isArray(artifact.comparisons) || !Array.isArray(artifact.stacks)) fail(`${rowKey(row)}:artifact-shape`);
  exactKeys(artifact.droppedEntryCounts, countKeys, `${rowKey(row)}:drop-keys`);
  for (const key of countKeys) if (!Number.isInteger(artifact.droppedEntryCounts[key]) || artifact.droppedEntryCounts[key] < 0) fail(`${rowKey(row)}:drop-count:${key}`);
  if (!Array.isArray(artifact.limitResults) || artifact.limitResults.length !== truth.limits.length) fail(`${rowKey(row)}:limit-count`);
  if (stable(artifact.limitResults.map(item => item.name)) !== stable(truth.limits.map(item => item.name))) fail(`${rowKey(row)}:limit-order`);
  for (const [index, expected] of truth.limits.entries()) {
    const item = artifact.limitResults[index];
    exactKeys(item, ['name', 'maximum', 'rejectedCount', 'reason', 'firstAffected'], `${rowKey(row)}:${expected.name}:result-keys`);
    if (item.maximum !== expected.maximum || artifact.collectionLimits[`max${expected.name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`] !== expected.maximum) fail(`${rowKey(row)}:${expected.name}:maximum`);
    if (item.rejectedCount !== artifact.droppedEntryCounts[expected.countKey]) fail(`${rowKey(row)}:${expected.name}:count-link`);
    if (item.rejectedCount === 0 && (item.reason !== null || item.firstAffected !== null)) fail(`${rowKey(row)}:${expected.name}:false-event`);
    if (item.rejectedCount > 0 && (item.reason !== expected.reason || item.firstAffected?.scope !== expected.scope)) fail(`${rowKey(row)}:${expected.name}:event`);
    if (item.firstAffected?.scope === 'explanation' && (item.firstAffected.windowIndex !== null || item.firstAffected.commandOrdinal !== null)) fail(`${rowKey(row)}:${expected.name}:explanation-coordinate`);
    if (item.firstAffected?.scope === 'window' && (!Number.isInteger(item.firstAffected.windowIndex) || item.firstAffected.windowIndex < 0 || item.firstAffected.commandOrdinal !== null)) fail(`${rowKey(row)}:${expected.name}:window-coordinate`);
    if (item.firstAffected?.scope === 'command' && (!Number.isInteger(item.firstAffected.windowIndex) || item.firstAffected.windowIndex < 0 || !Number.isInteger(item.firstAffected.commandOrdinal) || item.firstAffected.commandOrdinal < 0)) fail(`${rowKey(row)}:${expected.name}:command-coordinate`);
  }
  const reasons = truth.limits.filter(item => callsiteNames.includes(item.name) && artifact.droppedEntryCounts[item.countKey] > 0).map(item => item.reason);
  if (artifact.callsiteCoverage?.status !== (reasons.length ? 'incomplete' : 'complete') || stable(artifact.callsiteCoverage?.incompleteReasons) !== stable(reasons)) fail(`${rowKey(row)}:callsite-coverage`);
}

export function recomputeLimitResult(artifact, row, truth) {
  validateArtifact(artifact, truth, row);
  const expected = limitMap(truth).get(row.limit);
  const result = artifact.limitResults.find(item => item.name === row.limit);
  if (!expected || !result) fail(`${rowKey(row)}:missing-result`);
  return { maximum: result.maximum, rejectedCount: result.rejectedCount, reason: result.reason, firstAffected: result.firstAffected };
}

function checkRowResult(artifact, row, truth, matrixRow) {
  const definition = limitMap(truth).get(row.limit);
  const result = recomputeLimitResult(artifact, row, truth);
  const positive = row.mode === 'positive';
  if (result.maximum !== definition.maximum || result.rejectedCount !== (positive ? 1 : 0) || result.reason !== (positive ? definition.reason : null)) fail(`${rowKey(row)}:expected-result`);
  if (stable(result.firstAffected) !== stable(expectedCoordinate(artifact, row.expectedFirstAffected, definition.reason))) fail(`${rowKey(row)}:exact-coordinate`);
  const comparisons = recomputeCommandComparisons(artifact.windows, artifact.droppedEntryCounts.activeWindows);
  if (stable(artifact.comparisons) !== stable(comparisons) || stable(artifact.firstDifference) !== stable(comparisons.find(item => item.status === 'changed')?.difference ?? null)) fail(`${rowKey(row)}:command-recompute`);
  if (positive && commandNames.includes(row.limit)) {
    const affected = artifact.comparisons.find(item => item.targetWindowIndex === result.firstAffected.windowIndex);
    if (!affected || affected.status !== 'unknown' || affected.unknownReason !== definition.reason) fail(`${rowKey(row)}:known-command-gap`);
  }
  if (callsiteNames.includes(row.limit)) {
    const invalid = artifact.comparisons.some(item => ['stack-sample-limit', 'stack-frame-limit', 'source-map-lookup-limit', 'source-map-too-large'].includes(item.unknownReason));
    if (invalid) fail(`${rowKey(row)}:callsite-changed-command`);
  }
  if ((row.limit === 'duration-ms' || row.limit === 'selected-canvases') && artifact.firstGap && ['max-duration', 'selected-canvas-limit'].includes(artifact.firstGap.reason)) fail(`${rowKey(row)}:false-command-gap`);
  if (row.limit === 'duration-ms') {
    if (artifact.stopReason !== (positive ? 'max-duration' : 'manual')) fail(`${rowKey(row)}:duration-stop`);
    if (artifact.durationMs !== (positive ? definition.maximum : row.attempted)) fail(`${rowKey(row)}:duration-value`);
    if (positive && row.attempted > definition.maximum && matrixRow.facts.completedArtifactStable !== true) fail(`${rowKey(row)}:duration-stability`);
  }
  if (row.limit === 'selected-canvases') {
    if (matrixRow.facts?.repeatedStart?.status !== 'already-active' || matrixRow.facts.sourceCanvasId !== matrixRow.facts.followUpCanvasId) fail(`${rowKey(row)}:selection-preservation`);
  }
}

function checkRequests(evidence, truth) {
  for (const request of evidence.requests) {
    exactKeys(request, ['row', 'kind', 'origin', 'responseUrl', 'status', 'redirected', 'responseHeaders', 'responseByteSource', 'responseBytes'], 'request-keys');
    exactKeys(request.responseHeaders, ['contentType', 'contentLength', 'cacheControl'], 'request-header-keys');
    if (request.origin !== new URL(request.responseUrl).origin || request.origin !== evidence.origin || request.status !== 200 || request.redirected || !Number.isInteger(request.responseBytes) || request.responseBytes < 0) fail('request-safety');
    if (request.responseByteSource !== 'served-body' || request.responseHeaders.contentLength !== String(request.responseBytes) || request.responseHeaders.cacheControl !== 'no-store') fail('request-byte-measurement');
    if (request.kind === 'source-map' ? request.responseHeaders.contentType !== 'application/json' : request.responseHeaders.contentType !== 'text/javascript; charset=utf-8') fail('request-content-type');
    if (/[?#]/.test(request.responseUrl)) fail('request-private-url');
  }
  for (const row of truth.rows.filter(item => item.limit === 'source-map-response-bytes')) {
    const key = rowKey(row);
    const maps = evidence.requests.filter(item => item.row === key && item.kind === 'source-map');
    if (maps.length !== 1 || maps[0].responseBytes !== row.attempted) fail(`${key}:response-metadata`);
  }
}

function checkMismatch(value, truth) {
  const expected = truth.mismatch;
  const recomputed = recomputeComparison(value.row, value.baseline, value.candidate);
  if (stable(value.artifact) !== stable(recomputed)) fail('mismatch-recompute');
  if (value.artifact.status !== expected.status || stable(value.artifact.incomparableReasons) !== stable([expected.reason]) || value.artifact.measures.length !== expected.measureCount || value.artifact.improvementEstablished !== false) fail('mismatch-result');
}

function checkOverlay(value) {
  if (!value || value.baselineType !== 'repeated-draw-work'
    || stable(value.mismatch?.candidateTypes) !== stable(['resize-churn'])
    || stable(value.mismatch?.actions) !== stable([{ findingIndex: 0, hidden: true }])
    || stable(value.same?.candidateTypes) !== stable(['repeated-draw-work', 'repeated-draw-work'])
    || stable(value.same?.actions) !== stable([{ findingIndex: 0, hidden: false }, { findingIndex: 1, hidden: false }])) fail('overlay-filter-exact');
}

function checkPrivacyProbe(value) {
  exactKeys(value, ['nativeSucceeded', 'prepareStackTraceCalls', 'artifact'], 'privacy-probe-keys');
  if (value.nativeSucceeded !== true || value.prepareStackTraceCalls !== 0) fail('privacy-probe-facts');
  const artifact = value.artifact;
  const comparisons = recomputeCommandComparisons(artifact.windows, artifact.droppedEntryCounts.activeWindows);
  if (stable(artifact.comparisons) !== stable(comparisons)) fail('privacy-probe-comparisons');
  const command = artifact.windows.flatMap(window => window.commands).find(item => item.argumentCount === 10);
  if (!command || command.arguments.length !== 10 || command.unknownReason !== 'unsupported-value' || command.arguments.at(-1)?.token !== null) fail('privacy-probe-command');
}

export function checkEvidenceObject(evidence, truth) {
  if (!truth || truth.schemaVersion !== 1 || truth.rows.length !== 40 || truth.limits.length !== 10) fail('truth-shape');
  exactKeys(evidence.metadata, metadataKeys, 'metadata-keys');
  if (evidence.metadata.chromeRevision !== installedChromeRevision) fail('metadata-chrome');
  if (new Set(truth.rows.map(rowKey)).size !== 40) fail('truth-duplicates');
  for (const limit of truth.limits) {
    const rows = truth.rows.filter(row => row.limit === limit.name);
    if (rows.length !== 4 || rows.filter(row => row.mode === 'positive').length !== 3 || rows.filter(row => row.mode === 'negative').length !== 1) fail(`${limit.name}:coverage`);
  }
  if (!Array.isArray(evidence.matrix) || evidence.matrix.length !== 40 || new Set(evidence.matrix.map(rowKey)).size !== 40) fail('matrix-shape');
  const expectedRows = new Map(truth.rows.map(row => [rowKey(row), row]));
  for (const row of evidence.matrix) {
    const expected = expectedRows.get(rowKey(row));
    if (!expected || row.mode !== expected.mode || row.attempted !== expected.attempted) fail(`${rowKey(row)}:matrix-truth`);
    exactKeys(row, [...Object.keys(expected), 'artifactPath', 'commitHash', 'packageHash', 'chromeRevision', 'facts'], `${rowKey(row)}:matrix-keys`);
    if (row.artifactPath !== `artifacts/${expected.limit}/${expected.variant}.json`) fail(`${rowKey(row)}:artifact-path`);
    if (!validPath(row.artifactPath) || row.commitHash !== evidence.metadata.commitHash || row.packageHash !== evidence.metadata.packageHash || row.chromeRevision !== evidence.metadata.chromeRevision) fail(`${rowKey(row)}:matrix-metadata`);
    const artifact = evidence.artifacts[row.artifactPath];
    if (!artifact) fail(`${rowKey(row)}:missing-artifact`);
    checkRowResult(artifact, expected, truth, row);
  }
  checkRequests(evidence, truth);
  checkMismatch(evidence.mismatch, truth);
  checkOverlay(evidence.overlayFilter);
  checkPrivacyProbe(evidence.privacy);
  for (const [name, values] of Object.entries(evidence.diagnostics ?? {})) if (!Array.isArray(values) || values.length) fail(`diagnostic:${name}`);
  const privateEvidence = { matrix: evidence.matrix, artifacts: evidence.artifacts, requests: evidence.requests, mismatch: evidence.mismatch, overlayFilter: evidence.overlayFilter, privacy: evidence.privacy, diagnostics: evidence.diagnostics, metadata: evidence.metadata };
  if (scanPrivacy(privateEvidence, truth.privateSeeds).length) fail('privacy-leak');
  const text = claimText(privateEvidence);
  if (forbiddenClaims.some(claim => text.includes(claim))) fail('unsupported-claim');
  return true;
}

async function files(directory) {
  const result = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(next); else result.push(next);
    }
  }
  await walk('');
  return result.sort();
}

export async function checkEvidence(directory, options = {}) {
  const trustedTruth = JSON.parse(await readFile(truthPath, 'utf8'));
  const present = await files(directory);
  const artifactPaths = trustedTruth.rows.map(row => `artifacts/${row.limit}/${row.variant}.json`);
  const baseFiles = ['expected.json', 'matrix.json', 'requests.json', 'mismatch.json', 'overlay-filter.json', 'privacy.json', 'diagnostics.json', 'run-metadata.json', 'mutation-test-output.txt', 'verification-output.txt', 'checker-output.txt', ...artifactPaths, 'evidence-sha256.txt'];
  const expectedFiles = options.allowMissingCheckerOutput ? baseFiles.filter(name => name !== 'checker-output.txt') : baseFiles;
  if (stable(present) !== stable(expectedFiles.sort())) fail('file-set');
  const expectedCopy = JSON.parse(await readFile(path.join(directory, 'expected.json'), 'utf8'));
  if (stable(expectedCopy) !== stable(trustedTruth)) fail('expected-copy');
  const [matrix, requests, mismatch, overlayFilter, privacy, diagnostics, metadata] = await Promise.all(['matrix.json', 'requests.json', 'mismatch.json', 'overlay-filter.json', 'privacy.json', 'diagnostics.json', 'run-metadata.json'].map(name => readFile(path.join(directory, name), 'utf8').then(JSON.parse)));
  const artifacts = {};
  for (const row of matrix) {
    if (!validPath(row.artifactPath)) fail('artifact-path');
    const file = path.join(directory, row.artifactPath);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact-file');
    artifacts[row.artifactPath] = JSON.parse(await readFile(file, 'utf8'));
  }
  const evidence = { matrix, requests, mismatch, overlayFilter, privacy, diagnostics, metadata, artifacts, origin: 'http://127.0.0.1:5208' };
  checkEvidenceObject(evidence, trustedTruth);
  if (!/^[a-f0-9]{40}$/.test(metadata.commitHash) || metadata.commitHash !== execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()) fail('metadata-head');
  const bundle = await readFile(bundlePath);
  const bundleHash = sha256(bundle);
  const packageHash = sha256(Buffer.concat([await readFile(packagePath), bundle]));
  const fixtureHash = sha256(await readFile(path.join(root, 'apps/workbench/public/v05-08a-fixed-limits.html')));
  if (metadata.bundleHash !== bundleHash || metadata.packageHash !== packageHash || metadata.expectedHash !== sha256(await readFile(truthPath)) || metadata.fixtureHash !== fixtureHash || metadata.chromeRevision !== installedChromeRevision || metadata.command !== 'pnpm --filter dogfood run probe:fixed-limits' || metadata.checkCommand !== 'pnpm --filter dogfood run probe:fixed-limits:check') fail('metadata-hashes');
  const currentStatus = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  if (metadata.initialStatus !== metadata.finalStatus || metadata.finalStatus !== currentStatus) fail('worktree-status');
  const mutationOutput = await readFile(path.join(directory, 'mutation-test-output.txt'), 'utf8');
  const verificationOutput = await readFile(path.join(directory, 'verification-output.txt'), 'utf8');
  if (!mutationOutput.startsWith('COMMAND: pnpm --filter dogfood run probe:fixed-limits:test\nEXIT: 0\n') || !/[#ℹ] fail 0/.test(mutationOutput)) fail('mutation-output');
  for (const command of verificationCommands) if (!verificationOutput.includes(`COMMAND: ${command}\nEXIT: 0\n`)) fail(`verification-output:${command}`);
  if (!verificationOutput.includes('Test Files  5 passed')) fail('verification-focused-output');
  if (scanPrivacy({ mutationOutput, verificationOutput }, trustedTruth.privateSeeds).length) fail('output-privacy');
  if (!options.allowMissingCheckerOutput && await readFile(path.join(directory, 'checker-output.txt'), 'utf8') !== 'SIDPROJ_84_FIXED_LIMITS: PASS\n') fail('checker-output');
  const manifestFile = 'evidence-sha256.txt';
  const manifest = (await readFile(path.join(directory, manifestFile), 'utf8')).trim().split('\n').filter(Boolean);
  const listed = [];
  for (const line of manifest) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || !validPath(match[2]) || listed.includes(match[2]) || !present.includes(match[2])) fail('manifest-shape');
    if (sha256(await readFile(path.join(directory, match[2]))) !== match[1]) fail(`manifest-hash:${match[2]}`);
    listed.push(match[2]);
  }
  if (stable(listed.sort()) !== stable(present.filter(name => name !== manifestFile).sort())) fail('manifest-coverage');
  return true;
}
