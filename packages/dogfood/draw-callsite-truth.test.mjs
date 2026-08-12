import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkEvidence, checkEvidenceObject, createManifest, evidenceFiles, fixtureFiles, rowNames } from './draw-callsite-truth.mjs';

const origin = 'http://127.0.0.1:5205';
const collectionLimits = { maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 };
const droppedEntryCounts = { durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 };
const limitResults = [
  ['duration-ms', 10000], ['selected-canvases', 1], ['active-windows', 120], ['command-entries', 5000], ['arguments-per-command', 20],
  ['value-tokens', 1024], ['stack-samples', 8], ['frames-per-stack', 20], ['source-map-lookups', 8], ['source-map-response-bytes', 2097152],
].map(([name, maximum]) => ({ name, maximum, rejectedCount: 0, reason: null, firstAffected: null }));
function command(token) { return { ordinal: 0, operationKind: 'call', name: 'fillRect', argumentCount: 1, arguments: [{ position: 0, kind: 'number', token }], unknownReason: null }; }
function frame(row) {
  const generated = { file: `${origin}/v05-05-generated/${row.name}.js`, line: 20, column: 2 };
  return row.class === 'positive'
    ? { functionName: row.name, generated, mapped: { ...row.mapped }, mappingStatus: 'mapped', unresolvedReason: null }
    : { functionName: 'noMap', generated, mapped: null, mappingStatus: 'unresolved', unresolvedReason: 'no-source-map' };
}
function artifact(row) {
  const difference = { referenceWindowIndex: 10, targetWindowIndex: 11, ordinal: 0, reason: 'argument-token', reference: command('a'), target: command('b') };
  const value = frame(row);
  return {
    schemaVersion: 1,
    explanationId: `canvas-scan-explanation-${row.name}`,
    startedAt: '2026-08-11T00:00:00.000Z',
    endedAt: '2026-08-11T00:00:00.010Z',
    durationMs: 10,
    stopReason: 'manual',
    canvasScanVersion: '0.4.0',
    source: { sessionId: 'canvas-scan-source', findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'selected#1' },
    followUp: { sessionId: 'canvas-scan-follow-up', canvasId: 'selected#1' },
    windows: [
      { windowIndex: 10, timestampMs: 10, commands: [command('a')], complete: true, unknownReason: null },
      { windowIndex: 11, timestampMs: 11, commands: [command('b')], complete: true, unknownReason: null },
    ],
    comparisons: [{ referenceWindowIndex: 10, targetWindowIndex: 11, status: 'changed', difference, unknownReason: null }],
    firstDifference: structuredClone(difference),
    stacks: [
      { windowIndex: 9, commandOrdinal: 0, reason: 'first-raster', frames: [structuredClone(value)], droppedFrameCount: 0 },
      { windowIndex: 11, commandOrdinal: 0, reason: 'first-difference', frames: [structuredClone(value)], droppedFrameCount: 0 },
    ],
    collectionLimits: { ...collectionLimits },
    droppedEntryCounts: { ...droppedEntryCounts },
    limitResults: JSON.parse(JSON.stringify(limitResults)),
    callsiteCoverage: { status: 'complete', incompleteReasons: [] },
    firstGap: { windowIndex: 9, commandOrdinal: 0, reason: 'sampling-gap' },
  };
}
function request(row, kind) {
  const pathName = kind === 'source-map' ? row.mapPath : `/v05-05-generated/${row.name}.js`;
  return { row: row.name, kind, url: `${origin}${pathName}`, requestOrigin: origin, responseUrl: `${origin}${pathName}`, responseOrigin: origin, status: 200, redirected: false, redirectChain: [], headers: { 'content-type': kind === 'source-map' ? 'application/json' : 'text/javascript' }, responseBytes: 100 };
}
function panel(artifact) {
  return artifact.stacks.flatMap(sample => [
    sample.reason === 'first-raster' ? 'First selected raster' : 'First command difference',
    `Window ${sample.windowIndex}, command ${sample.commandOrdinal}`,
    ...sample.frames.flatMap(value => [
      value.mapped ? `mapped ${value.mapped.file}:${value.mapped.line}:${value.mapped.column}` : '',
      value.generated ? `generated ${value.generated.file}:${value.generated.line}:${value.generated.column}` : '',
      value.mappingStatus,
      value.unresolvedReason ? `unresolved ${value.unresolvedReason}` : '',
    ]),
  ]).filter(Boolean).join('\n');
}
function validEvidence() {
  const rows = [
    { name: 'direct', class: 'positive', expectedReasons: ['first-raster', 'first-difference'], relationship: { status: 'changed', ordinal: 0, reason: 'argument-token' }, mapped: { file: 'fixtures/v05-05/direct-source.js', line: 3, column: 10 }, generatedPath: '/v05-05-generated/direct.js', mapPath: '/v05-05-generated/direct.js.map', maxMapRequests: 1 },
    { name: 'nested', class: 'positive', expectedReasons: ['first-raster', 'first-difference'], relationship: { status: 'changed', ordinal: 0, reason: 'argument-token' }, mapped: { file: 'fixtures/v05-05/nested-source.js', line: 4, column: 33 }, generatedPath: '/v05-05-generated/nested.js', mapPath: '/v05-05-generated/nested.js.map', maxMapRequests: 1 },
    { name: 'bundled', class: 'positive', expectedReasons: ['first-raster', 'first-difference'], relationship: { status: 'changed', ordinal: 0, reason: 'argument-token' }, mapped: { file: 'fixtures/v05-05/bundled-source.js', line: 2, column: 48 }, generatedPath: '/v05-05-generated/bundled.js', mapPath: '/v05-05-generated/bundled.js.map', maxMapRequests: 1 },
    { name: 'no-map', class: 'negative', expectedReasons: ['first-raster', 'first-difference'], relationship: { status: 'changed', ordinal: 0, reason: 'argument-token' }, generatedPath: '/v05-05-generated/no-map.js', unresolvedReason: 'no-source-map', maxMapRequests: 0 },
  ];
  const expected = { origin, privateSentinels: ['SIDPROJ_68_PRIVATE_SENTINEL', 'private-query', 'private-fragment'], expectedDroppedEntryCounts: { ...droppedEntryCounts }, rows };
  const artifacts = Object.fromEntries(rows.map(row => [row.name, artifact(row)]));
  const requests = rows.flatMap(row => row.class === 'positive' ? [request(row, 'generated-script'), request(row, 'source-map')] : [request(row, 'generated-script')]);
  const overlay = { rows: rows.map(row => ({ name: row.name, text: panel(artifacts[row.name]) })) };
  const metadata = { status: 'PASS', chromeRevision: 'Chrome 140', gitSha: 'a'.repeat(40), initialDirtyState: '', finalDirtyState: '', coreIifeSha256: 'b'.repeat(64), fixtureSha256: Object.fromEntries(fixtureFiles.map(file => [file, 'c'.repeat(64)])), loopbackOrigin: origin, crossOriginRequestAttempts: 0, checks: { rows: true, privacy: true }, browserConsoleWarnings: [], browserConsoleErrors: [], pageErrors: [], failures: [] };
  return { expected, artifacts, requests, overlay, metadata };
}
function validTrusted(evidence = validEvidence()) {
  const { origin: _origin, ...expected } = evidence.expected;
  return { expected: structuredClone(expected), gitSha: 'a'.repeat(40), coreIifeSha256: 'b'.repeat(64), fixtureSha256: Object.fromEntries(fixtureFiles.map(file => [file, 'c'.repeat(64)])) };
}
function rejects(name, mutate) {
  test(`rejects ${name}`, () => {
    const evidence = validEvidence(); const trusted = validTrusted(evidence); mutate(evidence);
    assert.throws(() => checkEvidenceObject(evidence, trusted));
  });
}

test('accepts a complete synthetic evidence set', () => {
  const evidence = validEvidence();
  assert.equal(checkEvidenceObject(evidence, validTrusted(evidence)), true);
});
rejects('a missing row', value => { delete value.artifacts.direct; });
rejects('a duplicate expected row', value => { value.expected.rows[1].name = 'direct'; });
rejects('a missing raster sample', value => { value.artifacts.direct.stacks.shift(); });
rejects('a wrong first-difference window', value => { value.artifacts.direct.stacks[1].windowIndex = 12; });
rejects('a wrong first-difference ordinal', value => { value.artifacts.direct.stacks[1].commandOrdinal = 1; });
rejects('more than eight samples', value => { value.artifacts.direct.stacks = Array.from({ length: 9 }, () => structuredClone(value.artifacts.direct.stacks[0])); });
rejects('more than twenty frames', value => { value.artifacts.direct.stacks[0].frames = Array.from({ length: 21 }, () => structuredClone(value.artifacts.direct.stacks[0].frames[0])); });
rejects('a changed limit', value => { value.artifacts.direct.collectionLimits.maxStackSamples = 9; });
rejects('an extra drop key', value => { value.artifacts.direct.droppedEntryCounts.extra = 0; });
rejects('a negative drop count', value => { value.artifacts.direct.droppedEntryCounts.stackFrames = -1; });
rejects('an inconsistent frame drop count', value => { value.artifacts.direct.droppedEntryCounts.stackFrames = 999; });
rejects('a changed expected drop count', value => { value.expected.expectedDroppedEntryCounts.stackSamples = 1; });
rejects('a missing no-map generated request', value => { value.requests = value.requests.filter(request => !(request.row === 'no-map' && request.kind === 'generated-script')); });
rejects('more than eight generated lookups', value => { value.requests.push(...Array.from({ length: 5 }, (_, index) => ({ ...value.requests[0], url: `${origin}/unique-${index}.js`, responseUrl: `${origin}/unique-${index}.js` }))); });
rejects('a cross-origin request', value => { value.requests[0].requestOrigin = 'https://other.test'; });
rejects('a cross-origin redirect', value => { value.requests[0].redirected = true; value.requests[0].redirectChain = [value.requests[0].url]; value.requests[0].responseOrigin = 'https://other.test'; value.requests[0].responseUrl = 'https://other.test/file.js'; });
rejects('an oversized response', value => { value.requests[0].responseBytes = 2097153; });
rejects('a non-OK response', value => { value.requests[0].status = 404; });
rejects('a mapped source request', value => { value.requests[0].url = `${origin}/fixtures/v05-05/direct-source.js`; value.requests[0].responseUrl = value.requests[0].url; });
rejects('a wrong mapped location', value => { value.artifacts.direct.stacks[0].frames[0].mapped.line = 99; });
rejects('a mapped no-map row', value => { value.artifacts['no-map'].stacks[0].frames[0].mapped = { file: 'private.js', line: 1, column: 0 }; value.artifacts['no-map'].stacks[0].frames[0].mappingStatus = 'mapped'; value.artifacts['no-map'].stacks[0].frames[0].unresolvedReason = null; });
rejects('a query in an artifact location', value => { value.artifacts.direct.stacks[0].frames[0].generated.file += '?private-query'; });
rejects('a fragment in an artifact location', value => { value.artifacts.direct.stacks[0].frames[0].generated.file += '#private-fragment'; });
rejects('a sourcesContent key', value => { value.artifacts.direct.sourcesContent = ['private']; });
rejects('a nested raw source-map object', value => { value.artifacts.direct.debug = { version: 3, sources: ['private-source.js'], mappings: 'AAAA' }; });
rejects('a raw stack line', value => { value.artifacts.direct.stacks[0].frames[0].functionName = '    at privateFunction'; });
rejects('a multiline raw stack field', value => { value.artifacts.direct.debug = 'Error: secret\n    at privateFunction (private.js:1:1)'; });
rejects('a raw map body', value => { value.artifacts.direct.rawMap = '{"mappings":"AAAA"}'; });
rejects('source content in an extra field', value => { value.artifacts.direct.debug = 'const privateCustomerCode=42'; });
rejects('a private sentinel', value => { value.artifacts.direct.stacks[0].frames[0].functionName = 'SIDPROJ_68_PRIVATE_SENTINEL'; });
rejects('a private sentinel in request headers', value => { value.requests[0].headers['x-private'] = 'SIDPROJ_68_PRIVATE_SENTINEL'; });
rejects('a nested raw map in request headers', value => { value.requests[0].headers['x-private'] = { version: 3, sources: ['private-source.js'], mappings: 'AAAA' }; });
rejects('a multiline raw stack in request headers', value => { value.requests[0].headers['x-private'] = 'Error: secret\n    at privateFunction (private.js:1:1)'; });
rejects('a source sentinel in a request URL', value => { value.requests[0].url += '&value=SIDPROJ_68_PRIVATE_SENTINEL'; });
rejects('a mapped source-map request count', value => { value.requests = value.requests.filter(request => !(request.row === 'direct' && request.kind === 'source-map')); });
rejects('causal overlay text', value => { value.overlay.rows[0].text += '\nThis caused wasted work'; });
rejects('overlay text not backed by the artifact', value => { value.overlay.rows[0].text = value.overlay.rows[0].text.replaceAll('mapped ', 'hidden '); });
rejects('an invalid git SHA', value => { value.metadata.gitSha = 'x'; });
rejects('an invalid bundle SHA', value => { value.metadata.coreIifeSha256 = 'x'; });
rejects('a missing fixture hash', value => { delete value.metadata.fixtureSha256[fixtureFiles[0]]; });
rejects('an arbitrary valid fixture hash', value => { value.metadata.fixtureSha256[fixtureFiles[0]] = 'd'.repeat(64); });
rejects('an arbitrary valid bundle hash', value => { value.metadata.coreIifeSha256 = 'd'.repeat(64); });
rejects('an arbitrary valid git SHA', value => { value.metadata.gitSha = 'd'.repeat(40); });
rejects('a changed final dirty state', value => { value.metadata.finalDirtyState = ' M changed'; });
rejects('a false check', value => { value.metadata.checks.privacy = false; });
rejects('a browser diagnostic', value => { value.metadata.browserConsoleErrors.push('failure'); });
rejects('a cross-origin attempt', value => { value.metadata.crossOriginRequestAttempts = 1; });
rejects('a private sentinel in metadata', value => { value.metadata.chromeRevision = 'Chrome SIDPROJ_68_PRIVATE_SENTINEL'; });

test('checks the exact file set, manifest coverage, and hashes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sidproj-68-checker-'));
  try {
    const evidence = validEvidence();
    const trusted = validTrusted(evidence);
    for (const name of rowNames) await writeFile(path.join(directory, `${name}-artifact.json`), JSON.stringify(evidence.artifacts[name]));
    await writeFile(path.join(directory, 'expected.json'), JSON.stringify(evidence.expected));
    await writeFile(path.join(directory, 'request-log.json'), JSON.stringify(evidence.requests));
    await writeFile(path.join(directory, 'overlay-evidence.json'), JSON.stringify(evidence.overlay));
    await writeFile(path.join(directory, 'run-metadata.json'), JSON.stringify(evidence.metadata));
    await writeFile(path.join(directory, 'evidence-sha256.txt'), await createManifest(directory));
    assert.equal(await checkEvidence(directory, trusted), true);
    await writeFile(path.join(directory, 'direct-artifact.json'), '{}');
    await assert.rejects(checkEvidence(directory, trusted));
    assert.equal(evidenceFiles.length, 8);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
