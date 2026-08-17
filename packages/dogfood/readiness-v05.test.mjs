import assert from 'node:assert/strict';
import test from 'node:test';
import { RITUAL_METHODS } from '../../scripts/pack-manifest.mjs';
import { ACTION_IDS, checkReadinessEvidence, collectCleanupErrors, readinessStatus, serverOwnsReadinessPort, validateCopiedComparison, validateCopiedExplanation, waitForOwnedServer } from './readiness-v05.mjs';

const candidate = () => ({ gitSha: 'a'.repeat(40), branch: 'agent/sidproj-105-v05-ritual', packageVersion: '0.5.0' });
const browserDrawCounts = () => ({ baseline: { clearRect: 8, fillRect: 32 }, candidate: { clearRect: 8, fillRect: 16 } });
const rounded = value => Math.round(value * 1000) / 1000;
const measure = (id, unit, baseline, next) => {
  const delta = baseline === null || next === null ? null : unit === 'count' ? next - baseline : rounded(next - baseline);
  return { id, unit, baseline, candidate: next, delta, direction: delta === null ? 'unknown' : delta < 0 ? 'decreased' : delta > 0 ? 'increased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural' };
};

function session(id, values) {
  const methodEvidence = {
    clearRect: { count: 8, canvasApiSelfTimeMs: 0.2 },
    fillRect: { count: values.fills, canvasApiSelfTimeMs: values.fillTime },
    fillStyle: { count: 8, canvasApiSelfTimeMs: null },
  };
  const windows = Array.from({ length: 8 }, (_, index) => ({
    canvasId: 'canvas-1', nearestReactOwner: null, attributionKind: 'unattributed', sourceLocation: null,
    rasterOperationCount: index ? values.repeatedOperations / 7 : values.operations - values.repeatedOperations,
    canvasApiSelfTimeMs: values.time / 8, signatureStatus: index ? 'same' : 'unknown', unknownReason: index ? null : 'insufficient-history', sampled: true, comparisonGap: index ? 1 : null,
    methodEvidence, windowIndex: index + 1, timestampMs: index + 1, startedAtTimestampMs: index, endedAtTimestampMs: index + 1,
    geometry: { backingWidth: 320, backingHeight: 180, cssWidth: 320, cssHeight: 180, devicePixelRatio: 1, expectedBackingWidth: 320, expectedBackingHeight: 180, expectedPixelArea: 57600, actualToExpectedAreaRatio: 1, unavailableReason: null },
  }));
  return {
    schemaVersion: 1,
    sessionId: id,
    startedAt: '2026-08-17T20:00:00.000Z',
    endedAt: '2026-08-17T20:00:01.000Z',
    durationMs: 1000,
    stopReason: 'manual',
    canvasScanVersion: '0.5.0',
    browserFeatures: { monotonicTime: true, eventTiming: true, longAnimationFrames: true },
    canvases: [{
      canvasId: 'canvas-1',
      nearestReactOwner: null,
      attributionKind: 'unattributed',
      sourceLocation: null,
      activeWindowCount: 8,
      rasterOperationCount: values.operations,
      canvasApiSelfTimeMs: values.time,
      maxWindowSelfTimeMs: values.maximum,
      evidenceLevel: 'measured',
      methodEvidence,
      commandStatuses: { same: 7, changed: 0, unknown: 1 },
    }],
    windows,
    resetEvents: [],
    lifecycleEvents: id === 'baseline' ? [{ canvasId: 'canvas-1', type: 'first-observed', windowIndex: 1, timestampMs: 1, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }] : [],
    episodes: [{ episodeId: 'episode-1', firstWindowIndex: 1, lastWindowIndex: 8, startedAtTimestampMs: 0, endedAtTimestampMs: 8, activeWindowCount: 8, rasterOperationCount: values.operations, canvasApiSelfTimeMs: values.time, methodEvidence, canvases: [{ canvasId: 'canvas-1', activeWindowCount: 8, rasterOperationCount: values.operations, canvasApiSelfTimeMs: values.time, maxWindowSelfTimeMs: values.maximum, methodEvidence, resetEventCount: 0 }], resetEventCount: 0 }],
    browserEntries: [],
    episodeAssociations: [],
    findings: [{
      type: 'repeated-draw-work',
      evidenceLevel: 'candidate',
      canvasId: 'canvas-1',
      episodeId: 'episode-1',
      repeatedWindowCount: 7,
      rasterOperationCount: values.repeatedOperations,
      canvasApiSelfTimeMs: values.time,
      repeatedWindows: Array.from({ length: 7 }, (_, index) => ({ windowIndex: index + 2, timestampMs: index + 2, rasterOperationCount: values.repeatedOperations / 7, canvasApiSelfTimeMs: values.time / 7, comparisonGap: 1 })),
      unknownCoverage: { unknownWindowCount: 1, activeWindowCount: 8 },
      claimBoundary: { observation: 'Repeated work was observed.', explanation: 'The cause is not established.', nonEstablishedFacts: 'Application intent is not known.' },
      nextCheck: 'Inspect the selected callsite.',
    }],
    collectionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 },
    droppedEntryCounts: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 },
  };
}

function copiedExplanation() {
  const command = (ordinal, operationKind, name, argumentCount) => ({ ordinal, operationKind, name, argumentCount, arguments: Array.from({ length: argumentCount }, (_, position) => ({ position, kind: 'number', token: `${'a'.repeat(32)}-${position}` })), unknownReason: null });
  const window = windowIndex => ({ windowIndex, timestampMs: windowIndex, complete: true, unknownReason: null, commands: [command(0, 'call', 'clearRect', 4), command(1, 'set', 'fillStyle', 1), ...Array.from({ length: 4 }, (_, index) => command(index + 2, 'call', 'fillRect', 4))] });
  return {
    schemaVersion: 1,
    explanationId: 'explanation-1',
    startedAt: '2026-08-17T20:00:00.000Z',
    endedAt: '2026-08-17T20:00:01.000Z',
    durationMs: 1000,
    stopReason: 'manual',
    canvasScanVersion: '0.5.0',
    source: { sessionId: 'baseline', findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'canvas-1' },
    followUp: { sessionId: 'explanation-follow-up', canvasId: 'canvas-1' },
    windows: [window(1), window(2)],
    comparisons: [{ referenceWindowIndex: 1, targetWindowIndex: 2, status: 'same', difference: null, unknownReason: null }],
    firstDifference: null,
    stacks: [{ windowIndex: 1, commandOrdinal: 0, reason: 'first-raster', frames: [{ functionName: 'draw', generated: { file: 'http://127.0.0.1:5211/assets/index.js', line: 1, column: 1 }, mapped: null, mappingStatus: 'unresolved', unresolvedReason: 'no-source-map' }], droppedFrameCount: 0 }],
    collectionLimits: { maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 },
    droppedEntryCounts: { durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 },
    limitResults: ['duration-ms', 'selected-canvases', 'active-windows', 'command-entries', 'arguments-per-command', 'value-tokens', 'stack-samples', 'frames-per-stack', 'source-map-lookups', 'source-map-response-bytes'].map(name => ({ name, maximum: 1, rejectedCount: 0, reason: null, firstAffected: null })),
    callsiteCoverage: { status: 'complete', incompleteReasons: [] },
    firstGap: null,
  };
}

function copiedComparison() {
  return {
    schemaVersion: 1,
    comparisonId: 'comparison-1',
    createdAt: '2026-08-17T20:00:02.000Z',
    canvasScanVersion: '0.5.0',
    pairingMethod: 'user-selected',
    baseline: { sessionId: 'baseline', findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'canvas-1' },
    candidate: { sessionId: 'candidate', findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'canvas-1' },
    status: 'comparable',
    incomparableReasons: [],
    measures: [
      measure('active-window-count', 'count', 8, 8),
      measure('raster-operation-count', 'count', 40, 24),
      measure('canvas-api-self-time-ms', 'ms', 1, 0.7),
      measure('maximum-window-self-time-ms', 'ms', 0.2, 0.15),
      measure('method:clearRect:operation-count', 'count', 8, 8),
      measure('method:clearRect:self-time-ms', 'ms', 0.2, 0.2),
      measure('method:fillRect:operation-count', 'count', 32, 16),
      measure('method:fillRect:self-time-ms', 'ms', 0.8, 0.5),
      measure('method:fillStyle:operation-count', 'count', 8, 8),
      measure('method:fillStyle:self-time-ms', 'ms', null, null),
      measure('unknown-command-window-count', 'count', 1, 1),
      measure('repeated-window-count', 'count', 7, 7),
      measure('repeated-raster-operation-count', 'count', 35, 21),
      measure('comparison-gap-count', 'count', 0, 0),
    ],
    improvementEstablished: false,
  };
}

function evidence() {
  const baselineSession = session('baseline', { operations: 40, time: 1, maximum: 0.2, fills: 32, fillTime: 0.8, repeatedOperations: 35 });
  const candidateSession = session('candidate', { operations: 24, time: 0.7, maximum: 0.15, fills: 16, fillTime: 0.5, repeatedOperations: 21 });
  return {
    schemaVersion: 1,
    issue: 'SIDPROJ-105',
    status: 'PASS',
    gitSha: 'a'.repeat(40),
    branch: 'agent/sidproj-105-v05-ritual',
    packageVersion: '0.5.0',
    tarballSha256: 'b'.repeat(64),
    packedIifeSha256: 'c'.repeat(64),
    installedIifeSha256: 'c'.repeat(64),
    browserVersion: '151.0.0.0',
    earlyLoad: true,
    cleanBefore: true,
    cleanAfter: true,
    publicMethods: [...RITUAL_METHODS],
    actionIds: [...ACTION_IDS],
    browserDrawCounts: browserDrawCounts(),
    baseline: { sessionId: 'baseline', findingIndex: 0, findingType: 'repeated-draw-work' },
    explanation: { sourceSessionId: 'baseline', sourceFindingIndex: 0, followUpSessionId: 'explanation-follow-up', stopReason: 'manual' },
    candidate: { sessionId: 'candidate', findingIndex: 0, findingType: 'repeated-draw-work' },
    comparison: { pairingMethod: 'user-selected', status: 'comparable', improvementEstablished: false, baselineSessionId: 'baseline', baselineFindingIndex: 0, candidateSessionId: 'candidate', candidateFindingIndex: 0 },
    artifacts: { baselineSession, candidateSession, copiedExplanation: copiedExplanation(), copiedComparison: copiedComparison() },
    diagnostics: { warnings: [], errors: [], pageErrors: [], requestFailures: [], cleanupErrors: [] },
    failures: [],
  };
}

test('accepts one complete clean-consumer ritual', () => {
  assert.equal(checkReadinessEvidence(evidence(), candidate()), true);
});

test('rejects missing, extra, and reordered actions', () => {
  const missing = evidence(); missing.actionIds.pop(); assert.throws(() => checkReadinessEvidence(missing, candidate()), /ritual identity/);
  const extra = evidence(); extra.actionIds.push('extra'); assert.throws(() => checkReadinessEvidence(extra, candidate()), /ritual identity/);
  const reordered = evidence(); [reordered.actionIds[0], reordered.actionIds[1]] = [reordered.actionIds[1], reordered.actionIds[0]]; assert.throws(() => checkReadinessEvidence(reordered, candidate()), /ritual identity/);
});

test('rejects every missing public ritual method', () => {
  for (const method of RITUAL_METHODS) {
    const value = evidence(); value.publicMethods = value.publicMethods.filter(name => name !== method);
    assert.throws(() => checkReadinessEvidence(value, candidate()), /ritual identity/);
  }
});

test('binds evidence to the clean expected candidate and packed IIFE', () => {
  for (const mutate of [
    value => { value.gitSha = 'd'.repeat(40); },
    value => { value.branch = 'main'; },
    value => { value.cleanBefore = false; },
    value => { value.cleanAfter = false; },
    value => { value.installedIifeSha256 = 'd'.repeat(64); },
  ]) {
    const value = evidence(); mutate(value); assert.throws(() => checkReadinessEvidence(value, candidate()));
  }
  assert.throws(() => checkReadinessEvidence(evidence()), /candidate identity/);
});

test('binds product counts to the independent browser draw counts', () => {
  for (const mutate of [
    value => { value.browserDrawCounts.baseline.fillRect = 31; },
    value => { value.browserDrawCounts.candidate.clearRect = 7; },
    value => { value.artifacts.baselineSession.canvases[0].methodEvidence.fillRect.count = 31; },
  ]) {
    const value = evidence(); mutate(value); assert.throws(() => checkReadinessEvidence(value, candidate()));
  }
});

test('checks copied explanation truth without a runtime oracle', () => {
  const selection = { sessionId: 'baseline', findingIndex: 0, findingType: 'repeated-draw-work' };
  assert.equal(validateCopiedExplanation(copiedExplanation(), selection), true);
  for (const mutate of [
    value => { value.source.sessionId = 'other'; },
    value => { value.comparisons[0].status = 'changed'; },
    value => { value.windows[0].commands.pop(); },
    value => { value.windows[0].commands[0].arguments[0].rawValue = 'private-user-value'; },
    value => { value.windows[0].commands[0].arguments[0].token = 'private-user-value'; },
    value => { value.windows[0].commands[0].arguments[0].kind = 'private-user-value'; },
    value => { value.windows[0].commands[0].arguments[0].position = 80; },
    value => { value.stacks[0].frames[0].generated.file += '?token=private-user-value'; },
    value => { value.privateValue = '#2563eb'; },
  ]) {
    const value = copiedExplanation(); mutate(value); assert.throws(() => validateCopiedExplanation(value, selection));
  }
});

test('recomputes copied comparison truth outside the public API', () => {
  const value = evidence();
  assert.equal(validateCopiedComparison(value.artifacts.copiedComparison, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), true);
  for (const mutate of [
    artifact => { artifact.baseline.sessionId = 'other'; },
    artifact => { artifact.pairingMethod = 'automatic'; },
    artifact => { artifact.measures[1].delta = 0; },
    artifact => { artifact.measures[12].baseline = 28; },
    artifact => { artifact.measures[2] = measure('canvas-api-self-time-ms', 'ms', 999, 0); },
    artifact => { artifact.measures[3] = measure('maximum-window-self-time-ms', 'ms', 999, 0); },
    artifact => { artifact.measures[5] = measure('method:clearRect:self-time-ms', 'ms', 999, 0); },
    artifact => { artifact.measures[7] = measure('method:fillRect:self-time-ms', 'ms', 999, 0); },
    artifact => { artifact.measures[9] = measure('method:fillStyle:self-time-ms', 'ms', 999, 0); },
    artifact => { artifact.improvementEstablished = true; },
  ]) {
    const artifact = copiedComparison(); mutate(artifact); assert.throws(() => validateCopiedComparison(artifact, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts));
  }
});

test('accepts the finite browser boundary for repeated-window grouping', () => {
  const value = evidence();
  const profiles = [[value.artifacts.baselineSession, 28, 4], [value.artifacts.candidateSession, 14, 2]];
  for (const [artifact, total, perWindow] of profiles) {
    artifact.findings[0].rasterOperationCount = total;
    for (const window of artifact.findings[0].repeatedWindows) window.rasterOperationCount = perWindow;
  }
  value.artifacts.candidateSession.findings[0].unknownCoverage.unknownWindowCount = 0;
  value.artifacts.copiedComparison.measures[10] = measure('unknown-command-window-count', 'count', 1, 0);
  value.artifacts.copiedComparison.measures[12] = measure('repeated-raster-operation-count', 'count', 28, 14);
  assert.equal(checkReadinessEvidence(value, candidate()), true);

  value.artifacts.baselineSession.findings[0].repeatedWindows[0].rasterOperationCount = 3;
  value.artifacts.baselineSession.findings[0].rasterOperationCount = 27;
  assert.throws(() => checkReadinessEvidence(value, candidate()), /repeated window truth/);

  const invalidCoverage = evidence();
  invalidCoverage.artifacts.candidateSession.findings[0].unknownCoverage.unknownWindowCount = -1;
  invalidCoverage.artifacts.copiedComparison.measures[10] = measure('unknown-command-window-count', 'count', 1, -1);
  assert.throws(() => checkReadinessEvidence(invalidCoverage, candidate()), /repeated finding truth/);
});

test('rejects selection, pairing, raw artifacts, and diagnostics drift', () => {
  for (const mutate of [
    value => { value.explanation.sourceFindingIndex = 1; },
    value => { value.candidate.findingType = 'heavy-canvas-work'; },
    value => { value.comparison.pairingMethod = 'automatic'; },
    value => { value.artifacts.copiedComparison.measures[1].candidate = 40; },
    value => { value.artifacts.baselineSession.canvases[0].extra = true; },
    value => { value.artifacts.candidateSession.findings.push(value.artifacts.candidateSession.findings[0]); },
    value => { value.artifacts.copiedExplanation.stacks.push({ windowIndex: 1, extra: true }); },
    value => { value.artifacts.baselineSession.browserEntries.push({ entryId: 'private', kind: 'user-mark', startedAtTimestampMs: 1, endedAtTimestampMs: 2, label: 'private-user-value' }); },
    value => { value.diagnostics.errors.push('page error'); },
    value => { value.failures.push('failure'); },
  ]) {
    const value = evidence(); mutate(value); assert.throws(() => checkReadinessEvidence(value, candidate()));
  }
});

test('reports execution, browser, and identity failures as FAIL', () => {
  const value = evidence();
  assert.equal(readinessStatus(value.failures, value.diagnostics, [true, true]), 'PASS');
  value.diagnostics.errors.push('favicon failed');
  assert.equal(readinessStatus(value.failures, value.diagnostics, [true, true]), 'FAIL');
  value.diagnostics.errors.length = 0;
  value.failures.push('workflow failed');
  assert.equal(readinessStatus(value.failures, value.diagnostics, [true, true]), 'FAIL');
  assert.equal(readinessStatus([], value.diagnostics, [true, false]), 'FAIL');
});

test('requires the new process group and ownership token for server readiness', async () => {
  let body = 'stale-owner';
  const server = { pid: 100, exitCode: null, signalCode: null };
  const fetcher = async () => ({ ok: true, text: async () => body });
  await assert.rejects(() => waitForOwnedServer(server, 'new-owner', 'http://owned.test', 30, 5, () => true, fetcher), /prove ownership/);
  body = 'new-owner';
  await assert.rejects(() => waitForOwnedServer(server, 'new-owner', 'http://owned.test', 30, 5, () => false, fetcher), /prove ownership/);
  await waitForOwnedServer(server, 'new-owner', 'http://owned.test', 100, 5, () => true, fetcher);

  const groupFor = pid => ({ 100: 7, 200: 7, 300: 8 })[pid];
  assert.equal(serverOwnsReadinessPort(server, [200], groupFor), true);
  assert.equal(serverOwnsReadinessPort(server, [300], groupFor), false);
  assert.equal(serverOwnsReadinessPort(server, [200, 300], groupFor), false);
});

test('records cleanup failures separately and continues every cleanup action', async () => {
  const diagnostics = { cleanupErrors: [] };
  const actions = [];
  await collectCleanupErrors(diagnostics, [
    ['browser-close', async () => { actions.push('browser-close'); throw new Error('browser stayed open'); }],
    ['server-stop', async () => { actions.push('server-stop'); throw new Error('server stayed open'); }],
    ['temporary-directory-remove', async () => { actions.push('temporary-directory-remove'); }],
  ]);
  assert.deepEqual(actions, ['browser-close', 'server-stop', 'temporary-directory-remove']);
  assert.deepEqual(diagnostics.cleanupErrors, ['browser-close: browser stayed open', 'server-stop: server stayed open']);
});
