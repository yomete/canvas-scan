import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rowNames = ['direct', 'nested', 'bundled', 'no-map'];
export const limits = { maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 };
export const evidenceFiles = [...rowNames.map(name => `${name}-artifact.json`), 'expected.json', 'request-log.json', 'overlay-evidence.json', 'run-metadata.json'];
export const fixtureFiles = ['apps/workbench/public/v05-05-draw-callsite.html', ...rowNames.map(name => `packages/dogfood/fixtures/v05-05/${name}-source.js`), 'packages/dogfood/fixtures/v05-05/expected.json'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const collectionLimits = {
  maxDurationMs: 10000,
  maxSelectedCanvases: 1,
  maxActiveWindows: 120,
  maxCommandEntries: 5000,
  maxArgumentsPerCommand: 20,
  maxValueTokens: 1024,
  maxStackSamples: 8,
  maxFramesPerStack: 20,
  maxSourceMapLookups: 8,
  maxSourceMapResponseBytes: 2097152,
};
const dropKeys = ['activeWindows', 'commandEntries', 'commandArguments', 'valueTokens', 'stackSamples', 'stackFrames', 'sourceMapLookups'];
const causalCopy = /\b(?:cause|caused|responsible|waste|wasted|avoidable|same pixels|unchanged pixels)\b/i;
function fail(message) { throw new Error(message); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sameKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
function locationText(location) { return `${location.file}:${location.line}:${location.column}`; }
function walk(value, visit, trail = '$') {
  visit(value, trail);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, `${trail}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => { visit(key, `${trail}.${key}`); walk(item, visit, `${trail}.${key}`); });
}
function scanPrivate(name, value, sentinels) {
  const forbiddenKeys = new Set(['sourcesContent', 'sourceContent', 'responseBody', 'rawStack', 'stackText', 'sourceMap', 'rawMap', 'mappings']);
  walk(value, (entry, trail) => {
    if (typeof entry !== 'string') return;
    if (forbiddenKeys.has(entry)) fail(`${name}: private key at ${trail}`);
    if (/(?:^|\n)\s*at\s+\S/.test(entry)) fail(`${name}: raw stack at ${trail}`);
    if (sentinels.some(sentinel => entry.includes(sentinel))) fail(`${name}: private sentinel at ${trail}`);
    if (/\bmappings\s*[":=]/.test(entry) || entry.includes('sourceMappingURL=')) fail(`${name}: raw source map at ${trail}`);
    if (/(?:^|\n)\s*(?:const|let|var|function|class|import|export)\s+[$\w]/.test(entry)) fail(`${name}: source content at ${trail}`);
  });
}
function rowFor(expected, name) {
  const rows = expected?.rows;
  if (!Array.isArray(rows) || rows.length !== rowNames.length || new Set(rows.map(row => row.name)).size !== rowNames.length) fail('expected rows');
  if (rows.some(row => !rowNames.includes(row.name)) || rowNames.some(rowName => !rows.some(row => row.name === rowName))) fail('expected row names');
  const row = rows.find(item => item.name === name);
  if (!row) fail(`${name}: expected row`);
  return row;
}
function comparisonFor(artifact, row) {
  const changed = artifact.comparisons?.filter(comparison => comparison.status === row.relationship.status && comparison.difference?.ordinal === row.relationship.ordinal && comparison.difference?.reason === row.relationship.reason);
  if (!Array.isArray(changed) || changed.length !== 1) fail(`${row.name}: expected comparison`);
  const comparison = changed[0];
  const difference = comparison.difference;
  if (!difference || difference.targetWindowIndex !== comparison.targetWindowIndex || difference.referenceWindowIndex !== comparison.referenceWindowIndex || difference.target === null) fail(`${row.name}: inconsistent comparison`);
  if (JSON.stringify(artifact.firstDifference) !== JSON.stringify(difference)) fail(`${row.name}: first difference`);
  return comparison;
}
function checkLocation(name, value) {
  if (value === null) return;
  if (!sameKeys(value, ['file', 'line', 'column']) || typeof value.file !== 'string' || !Number.isFinite(value.line) || !Number.isFinite(value.column)) fail(`${name}: location shape`);
}
function checkArgument(name, value) {
  if (!sameKeys(value, ['position', 'kind', 'token']) || !Number.isInteger(value.position) || value.position < 0 || typeof value.kind !== 'string' || typeof value.token !== 'string') fail(`${name}: argument shape`);
}
function checkCommand(name, value) {
  if (!sameKeys(value, ['ordinal', 'operationKind', 'name', 'argumentCount', 'arguments', 'unknownReason']) || !Number.isInteger(value.ordinal) || value.ordinal < 0 || !['call', 'set'].includes(value.operationKind) || typeof value.name !== 'string' || !Number.isInteger(value.argumentCount) || !Array.isArray(value.arguments) || value.argumentCount !== value.arguments.length || (value.unknownReason !== null && typeof value.unknownReason !== 'string')) fail(`${name}: command shape`);
  value.arguments.forEach(argument => checkArgument(name, argument));
}
function checkDifference(name, value) {
  if (!sameKeys(value, ['referenceWindowIndex', 'targetWindowIndex', 'ordinal', 'reason', 'reference', 'target']) || !Number.isInteger(value.referenceWindowIndex) || !Number.isInteger(value.targetWindowIndex) || !Number.isInteger(value.ordinal) || typeof value.reason !== 'string') fail(`${name}: difference shape`);
  if (value.reference !== null) checkCommand(name, value.reference);
  if (value.target !== null) checkCommand(name, value.target);
}

export function checkArtifact(name, artifact, expected) {
  const row = rowFor(expected, name);
  const artifactKeys = ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'firstGap'];
  if (!sameKeys(artifact, artifactKeys) || artifact.schemaVersion !== 1 || typeof artifact.explanationId !== 'string' || typeof artifact.startedAt !== 'string' || typeof artifact.endedAt !== 'string' || !Number.isFinite(artifact.durationMs) || typeof artifact.stopReason !== 'string' || typeof artifact.canvasScanVersion !== 'string' || !Array.isArray(artifact.stacks) || !Array.isArray(artifact.windows) || !Array.isArray(artifact.comparisons)) fail(`${name}: artifact shape`);
  if (!sameKeys(artifact.source, ['sessionId', 'findingIndex', 'findingType', 'canvasId']) || !sameKeys(artifact.followUp, ['sessionId', 'canvasId'])) fail(`${name}: session shape`);
  if (!sameKeys(artifact.firstGap, ['windowIndex', 'commandOrdinal', 'reason']) || !Number.isInteger(artifact.firstGap.windowIndex) || !Number.isInteger(artifact.firstGap.commandOrdinal) || typeof artifact.firstGap.reason !== 'string') fail(`${name}: gap shape`);
  for (const window of artifact.windows) {
    if (!sameKeys(window, ['windowIndex', 'timestampMs', 'commands', 'complete', 'unknownReason']) || !Number.isInteger(window.windowIndex) || !Number.isFinite(window.timestampMs) || !Array.isArray(window.commands) || typeof window.complete !== 'boolean' || (window.unknownReason !== null && typeof window.unknownReason !== 'string')) fail(`${name}: window shape`);
    window.commands.forEach(command => checkCommand(name, command));
  }
  for (const comparison of artifact.comparisons) {
    if (!sameKeys(comparison, ['referenceWindowIndex', 'targetWindowIndex', 'status', 'difference', 'unknownReason']) || !Number.isInteger(comparison.referenceWindowIndex) || !Number.isInteger(comparison.targetWindowIndex) || typeof comparison.status !== 'string' || (comparison.unknownReason !== null && typeof comparison.unknownReason !== 'string')) fail(`${name}: comparison shape`);
    if (comparison.difference !== null) checkDifference(name, comparison.difference);
  }
  checkDifference(name, artifact.firstDifference);
  if (!sameKeys(artifact.collectionLimits, Object.keys(collectionLimits)) || Object.entries(collectionLimits).some(([key, value]) => artifact.collectionLimits[key] !== value)) fail(`${name}: collection limits`);
  if (!sameKeys(expected.expectedDroppedEntryCounts, dropKeys) || dropKeys.some(key => !Number.isInteger(expected.expectedDroppedEntryCounts[key]) || expected.expectedDroppedEntryCounts[key] < 0)) fail(`${name}: expected drop counts`);
  if (!sameKeys(artifact.droppedEntryCounts, dropKeys) || dropKeys.some(key => !Number.isInteger(artifact.droppedEntryCounts[key]) || artifact.droppedEntryCounts[key] !== expected.expectedDroppedEntryCounts[key])) fail(`${name}: drop counts`);
  if (artifact.stacks.length > limits.maxStackSamples) fail(`${name}: sample limit`);
  const reasons = new Set(artifact.stacks.map(sample => sample.reason));
  if (!Array.isArray(row.expectedReasons) || row.expectedReasons.some(reason => !reasons.has(reason))) fail(`${name}: sample reasons`);
  const comparison = comparisonFor(artifact, row);
  const relationship = artifact.stacks.filter(sample => sample.reason === 'first-difference');
  if (relationship.length !== 1 || relationship[0].windowIndex !== comparison.targetWindowIndex || relationship[0].commandOrdinal !== comparison.difference.ordinal) fail(`${name}: relationship stack`);
  for (const sample of artifact.stacks) {
    if (!sameKeys(sample, ['windowIndex', 'commandOrdinal', 'reason', 'frames', 'droppedFrameCount'])) fail(`${name}: sample schema`);
    if (!Number.isInteger(sample.windowIndex) || sample.windowIndex < 0 || !Number.isInteger(sample.commandOrdinal) || sample.commandOrdinal < 0 || !row.expectedReasons.includes(sample.reason)) fail(`${name}: sample shape`);
    if (!Array.isArray(sample.frames) || sample.frames.length === 0 || sample.frames.length > limits.maxFramesPerStack || !Number.isInteger(sample.droppedFrameCount) || sample.droppedFrameCount < 0) fail(`${name}: frame limit`);
    for (const frame of sample.frames) {
      if (!sameKeys(frame, ['functionName', 'generated', 'mapped', 'mappingStatus', 'unresolvedReason']) || (frame.functionName !== null && (typeof frame.functionName !== 'string' || /[\r\n{};]/.test(frame.functionName)))) fail(`${name}: frame schema`);
      if (!['mapped', 'unresolved'].includes(frame.mappingStatus)) fail(`${name}: mapping status`);
      if (frame.mappingStatus === 'mapped' && (!frame.mapped || frame.unresolvedReason !== null)) fail(`${name}: mapped shape`);
      if (frame.mappingStatus === 'unresolved' && (frame.mapped !== null || typeof frame.unresolvedReason !== 'string')) fail(`${name}: unresolved shape`);
      for (const location of [frame.generated, frame.mapped]) {
        checkLocation(name, location);
        if (location && (location.file.includes('?') || location.file.includes('#'))) fail(`${name}: unsafe location`);
      }
    }
  }
  if (artifact.droppedEntryCounts.stackFrames !== artifact.stacks.reduce((sum, sample) => sum + sample.droppedFrameCount, 0)) fail(`${name}: frame drop count`);
  if (row.class === 'positive') {
    if (!artifact.stacks.some(sample => sample.frames.some(frame => frame.mappingStatus === 'mapped' && JSON.stringify(frame.mapped) === JSON.stringify(row.mapped)))) fail(`${name}: mapped location`);
  } else {
    const expectedFile = `${expected.origin}${row.generatedPath}`;
    const matches = artifact.stacks.flatMap(sample => sample.frames).filter(frame => frame.generated?.file === expectedFile);
    if (!matches.length || matches.some(frame => frame.mappingStatus !== 'unresolved' || frame.mapped !== null || frame.unresolvedReason !== row.unresolvedReason)) fail(`${name}: no-map result`);
  }
  scanPrivate(name, artifact, expected.privateSentinels ?? []);
  return true;
}

export function checkEvidenceObject(evidence, trusted) {
  const { expected, artifacts, requests, overlay, metadata } = evidence;
  if (!expected || expected.origin !== metadata?.loopbackOrigin || !Array.isArray(expected.privateSentinels) || !expected.privateSentinels.length) fail('expected metadata');
  if (!trusted || !sameKeys(trusted, ['expected', 'gitSha', 'coreIifeSha256', 'fixtureSha256'])) fail('trusted evidence');
  const { origin: _origin, ...expectedTemplate } = expected;
  if (JSON.stringify(expectedTemplate) !== JSON.stringify(trusted.expected)) fail('expected fixture truth');
  if (!sameKeys(artifacts, rowNames)) fail('artifact rows');
  for (const name of rowNames) checkArtifact(name, artifacts[name], expected);

  if (!Array.isArray(requests)) fail('request log');
  const requestKeys = ['row', 'kind', 'url', 'requestOrigin', 'responseUrl', 'responseOrigin', 'status', 'redirected', 'redirectChain', 'headers', 'responseBytes'];
  for (const request of requests) {
    if (!sameKeys(request, requestKeys) || !rowNames.includes(request.row) || !['generated-script', 'source-map'].includes(request.kind)) fail('request shape');
    if (request.requestOrigin !== expected.origin || request.responseOrigin !== expected.origin || !request.url.startsWith(`${expected.origin}/`) || !request.responseUrl.startsWith(`${expected.origin}/`)) fail('cross-origin request');
    if (request.redirected !== false || !Array.isArray(request.redirectChain) || request.redirectChain.length !== 0) fail('request redirect');
    if (!Number.isInteger(request.status) || request.status < 200 || request.status >= 300) fail('request status');
    if (!Number.isInteger(request.responseBytes) || request.responseBytes < 0 || request.responseBytes > limits.maxSourceMapResponseBytes) fail('request size');
    if (!request.headers || typeof request.headers !== 'object' || Array.isArray(request.headers) || Object.entries(request.headers).some(([key, value]) => /body|content$/i.test(key) || typeof value !== 'string')) fail('request headers');
  }
  scanPrivate('request log', requests, expected.privateSentinels.filter(sentinel => sentinel !== 'private-query' && sentinel !== 'private-fragment'));
  scanPrivate('request headers', requests.map(request => request.headers), expected.privateSentinels);
  const generated = new Set(requests.filter(request => request.kind === 'generated-script').map(request => request.url));
  if (generated.size > limits.maxSourceMapLookups) fail('lookup limit');
  for (const name of rowNames) {
    const row = rowFor(expected, name);
    const scripts = requests.filter(request => request.row === name && request.kind === 'generated-script');
    if (scripts.length !== 1 || new URL(scripts[0].url).pathname !== row.generatedPath) fail(`${name}: generated request`);
    const maps = requests.filter(request => request.row === name && request.kind === 'source-map');
    if (maps.length !== row.maxMapRequests || maps.some(request => new URL(request.url).pathname !== row.mapPath)) fail(`${name}: map requests`);
    const sourceNames = expected.rows.map(entry => entry.mapped?.file).filter(Boolean);
    if (requests.some(request => sourceNames.some(source => new URL(request.url).pathname.endsWith(source)))) fail('mapped source request');
  }

  if (!sameKeys(overlay, ['rows']) || !Array.isArray(overlay.rows) || overlay.rows.length !== rowNames.length || new Set(overlay.rows.map(row => row.name)).size !== rowNames.length || overlay.rows.some(row => !sameKeys(row, ['name', 'text']))) fail('overlay rows');
  for (const name of rowNames) {
    const entry = overlay.rows.find(row => row.name === name);
    if (!entry || typeof entry.text !== 'string' || causalCopy.test(entry.text)) fail(`${name}: overlay text`);
    const artifact = artifacts[name];
    for (const sample of artifact.stacks) {
      if (!entry.text.includes(sample.reason === 'first-raster' ? 'First selected raster' : 'First command difference')) fail(`${name}: overlay reason`);
      if (!entry.text.includes(`Window ${sample.windowIndex}, command ${sample.commandOrdinal}`)) fail(`${name}: overlay relationship`);
      for (const frame of sample.frames) {
        if (frame.generated && !entry.text.includes(`generated ${locationText(frame.generated)}`)) fail(`${name}: overlay generated`);
        if (frame.mapped && !entry.text.includes(`mapped ${locationText(frame.mapped)}`)) fail(`${name}: overlay mapped`);
        if (!entry.text.includes(frame.mappingStatus)) fail(`${name}: overlay status`);
        if (frame.unresolvedReason && !entry.text.includes(`unresolved ${frame.unresolvedReason}`)) fail(`${name}: overlay unresolved`);
      }
    }
  }
  scanPrivate('overlay', overlay, expected.privateSentinels ?? []);

  const metadataKeys = ['status', 'chromeRevision', 'gitSha', 'initialDirtyState', 'finalDirtyState', 'coreIifeSha256', 'fixtureSha256', 'loopbackOrigin', 'crossOriginRequestAttempts', 'checks', 'browserConsoleWarnings', 'browserConsoleErrors', 'pageErrors', 'failures'];
  if (!sameKeys(metadata, metadataKeys) || metadata.status !== 'PASS' || typeof metadata.chromeRevision !== 'string' || !metadata.chromeRevision || !/^[0-9a-f]{40}$/.test(metadata.gitSha) || !/^[0-9a-f]{64}$/.test(metadata.coreIifeSha256)) fail('run metadata');
  if (typeof metadata.initialDirtyState !== 'string' || metadata.initialDirtyState !== metadata.finalDirtyState || metadata.loopbackOrigin !== expected.origin || metadata.crossOriginRequestAttempts !== 0) fail('run state');
  if (!sameKeys(metadata.fixtureSha256, fixtureFiles) || Object.values(metadata.fixtureSha256).some(value => !/^[0-9a-f]{64}$/.test(value))) fail('fixture hashes');
  if (!sameKeys(trusted.fixtureSha256, fixtureFiles) || fixtureFiles.some(file => metadata.fixtureSha256[file] !== trusted.fixtureSha256[file])) fail('trusted fixture hashes');
  if (metadata.coreIifeSha256 !== trusted.coreIifeSha256 || metadata.gitSha !== trusted.gitSha) fail('trusted build metadata');
  if (!metadata.checks || !Object.keys(metadata.checks).length || Object.values(metadata.checks).some(value => value !== true)) fail('run checks');
  for (const key of ['browserConsoleWarnings', 'browserConsoleErrors', 'pageErrors', 'failures']) if (!Array.isArray(metadata[key]) || metadata[key].length) fail(`diagnostics ${key}`);
  scanPrivate('metadata', metadata, expected.privateSentinels);
  return true;
}

export async function readRepositoryTruth() {
  const expected = JSON.parse(await readFile(path.join(root, 'packages/dogfood/fixtures/v05-05/expected.json'), 'utf8'));
  const fixtureSha256 = Object.fromEntries(await Promise.all(fixtureFiles.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
  const coreIifeSha256 = sha256(await readFile(path.join(root, 'packages/core/dist/canvas-scan.iife.js')));
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { expected, gitSha, coreIifeSha256, fixtureSha256 };
}

export async function checkEvidence(directory, trusted) {
  const repositoryTruth = trusted ?? await readRepositoryTruth();
  const actualFiles = (await readdir(directory)).sort();
  const expectedFiles = [...evidenceFiles, 'evidence-sha256.txt'].sort();
  if (actualFiles.join('|') !== expectedFiles.join('|')) fail('evidence file set');
  const expected = JSON.parse(await readFile(path.join(directory, 'expected.json'), 'utf8'));
  const artifacts = Object.fromEntries(await Promise.all(rowNames.map(async name => [name, JSON.parse(await readFile(path.join(directory, `${name}-artifact.json`), 'utf8'))])));
  const requests = JSON.parse(await readFile(path.join(directory, 'request-log.json'), 'utf8'));
  const overlay = JSON.parse(await readFile(path.join(directory, 'overlay-evidence.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(path.join(directory, 'run-metadata.json'), 'utf8'));
  checkEvidenceObject({ expected, artifacts, requests, overlay, metadata }, repositoryTruth);
  const lines = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim().split('\n');
  if (lines.length !== evidenceFiles.length) fail('hash manifest count');
  const listed = new Set();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    const resolved = match ? path.resolve(match[2]) : '';
    const file = path.basename(resolved);
    if (!match || path.dirname(resolved) !== path.resolve(directory) || !evidenceFiles.includes(file) || listed.has(file)) fail('hash manifest');
    listed.add(file);
    const actual = sha256(await readFile(resolved));
    if (match[1] !== actual) fail(`hash ${file}`);
  }
  if (evidenceFiles.some(file => !listed.has(file))) fail('hash manifest coverage');
  return true;
}

export async function createManifest(directory) {
  const lines = await Promise.all(evidenceFiles.slice().sort().map(async file => `${sha256(await readFile(path.join(directory, file)))}  ${path.resolve(directory, file)}`));
  return `${lines.join('\n')}\n`;
}
