import assert from 'node:assert/strict';
import test from 'node:test';
import { RITUAL_METHODS } from '../../scripts/pack-manifest.mjs';
import { ACTION_IDS, checkReadinessEvidence, collectCleanupErrors, readinessStatus, serverOwnsReadinessPort, validateCopiedComparison, validateCopiedExplanation, waitForOwnedServer } from './readiness-v05.mjs';
import { readinessMutations } from './readiness-v05-mutations.mjs';
import { RUN_STAGE_IDS } from './investigation-run-report.mjs';

const candidate = () => ({ gitSha: 'a'.repeat(40), branch: 'agent/sidproj-105-v05-ritual', packageVersion: '0.5.0' });
const browserDrawCounts = () => ({ baseline: { clearRect: 8, fillRect: 32 }, candidate: { clearRect: 8, fillRect: 16 } });
const startedAtEpoch = Date.parse('2026-08-17T20:00:00.000Z');
const baselineSessionId = `canvas-scan-${startedAtEpoch}-1`;
const candidateSessionId = `canvas-scan-${startedAtEpoch}-2`;
const followUpSessionId = `canvas-scan-${startedAtEpoch}-3`;
const repeatedDrawClaim = {
  observation: 'The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.',
  explanation: 'The repeated commands are a review candidate.',
  nonEstablishedFacts: 'The evidence does not establish that the output stayed unchanged or that the work can be removed.',
};
const repeatedDrawNextCheck = 'Check whether the application needs to send these repeated commands for the same scene and interaction.';
const rounded = value => Math.round(value * 1000) / 1000;
const measure = (id, unit, baseline, next) => {
  const delta = baseline === null || next === null ? null : unit === 'count' ? next - baseline : rounded(next - baseline);
  return { id, unit, baseline, candidate: next, delta, direction: delta === null ? 'unknown' : delta < 0 ? 'decreased' : delta > 0 ? 'increased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural' };
};

function browserEntries() {
  return [
    { entryId: 'browser-evidence-1', kind: 'event-timing', eventType: 'pointerdown', startedAtTimestampMs: 0, endedAtTimestampMs: 0.5, targetTagName: 'div', durationMs: 0.5, interactionId: 11 },
    { entryId: 'browser-evidence-2', kind: 'event-timing', eventType: 'pointerup', startedAtTimestampMs: 0.5, endedAtTimestampMs: 1, targetTagName: 'div', durationMs: 0.5, interactionId: 11 },
    { entryId: 'browser-evidence-3', kind: 'document-event', eventType: 'pointermove', startedAtTimestampMs: 1, endedAtTimestampMs: 1, targetTagName: 'button' },
    { entryId: 'browser-evidence-4', kind: 'document-event', eventType: 'pointerdown', startedAtTimestampMs: 1.1, endedAtTimestampMs: 1.1, targetTagName: 'button' },
    { entryId: 'browser-evidence-5', kind: 'document-event', eventType: 'pointerup', startedAtTimestampMs: 1.2, endedAtTimestampMs: 1.2, targetTagName: 'button' },
    { entryId: 'browser-evidence-6', kind: 'event-timing', eventType: 'pointerdown', startedAtTimestampMs: 2, endedAtTimestampMs: 2.5, targetTagName: 'button', durationMs: 0.5, interactionId: 22 },
    { entryId: 'browser-evidence-7', kind: 'event-timing', eventType: 'pointerup', startedAtTimestampMs: 2.5, endedAtTimestampMs: 3, targetTagName: 'button', durationMs: 0.5, interactionId: 22 },
    { entryId: 'browser-evidence-8', kind: 'document-event', eventType: 'pointermove', startedAtTimestampMs: 3, endedAtTimestampMs: 3, targetTagName: 'div' },
    { entryId: 'browser-evidence-9', kind: 'document-event', eventType: 'pointerdown', startedAtTimestampMs: 3.1, endedAtTimestampMs: 3.1, targetTagName: 'div' },
    { entryId: 'browser-evidence-10', kind: 'document-event', eventType: 'pointerup', startedAtTimestampMs: 3.2, endedAtTimestampMs: 3.2, targetTagName: 'div' },
  ];
}

function episodeAssociations(entries, episodeId) {
  return entries.map(entry => ({ entryId: entry.entryId, entryKind: entry.kind, episodeId, startedAtTimestampMs: entry.startedAtTimestampMs, endedAtTimestampMs: entry.endedAtTimestampMs, evidenceLevel: 'associated' }));
}

function session(id, values) {
  const baseline = id === 'baseline';
  const sessionId = baseline ? baselineSessionId : candidateSessionId;
  const methodEvidence = {
    clearRect: { count: 8, canvasApiSelfTimeMs: 0.2 },
    fillRect: { count: values.fills, canvasApiSelfTimeMs: values.fillTime },
    fillStyle: { count: 8, canvasApiSelfTimeMs: null },
  };
  const windows = Array.from({ length: 8 }, (_, index) => {
    const signatureStatus = baseline ? index === 0 ? 'unknown' : index === 1 ? 'changed' : 'same' : index === 0 ? 'changed' : 'same';
    return {
      canvasId: 'ritual-canvas#1', nearestReactOwner: 'yA', attributionKind: 'jsx-owner', sourceLocation: null,
      rasterOperationCount: values.operations / 8,
      canvasApiSelfTimeMs: values.time / 8,
      signatureStatus,
      unknownReason: signatureStatus === 'unknown' ? 'first-window' : null,
      sampled: false,
      comparisonGap: signatureStatus === 'unknown' ? null : !baseline && index === 0 ? 2 : 1,
      methodEvidence: {
        clearRect: { count: 1, canvasApiSelfTimeMs: 0.2 / 8 },
        fillRect: { count: values.fills / 8, canvasApiSelfTimeMs: values.fillTime / 8 },
        fillStyle: { count: 1, canvasApiSelfTimeMs: null },
      },
      windowIndex: index + 1, timestampMs: index + 1, startedAtTimestampMs: index, endedAtTimestampMs: index + 1,
      geometry: { backingWidth: 400, backingHeight: 150, cssWidth: 400, cssHeight: 150, devicePixelRatio: 1, expectedBackingWidth: 400, expectedBackingHeight: 150, expectedPixelArea: 60000, actualToExpectedAreaRatio: 1, unavailableReason: null },
    };
  });
  const repeatedWindows = windows.filter(window => window.signatureStatus === 'same').map(({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }) => ({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }));
  const episodeId = `${sessionId}:episode:1`;
  const entries = browserEntries();
  return {
    schemaVersion: 1,
    sessionId,
    startedAt: '2026-08-17T20:00:00.000Z',
    endedAt: '2026-08-17T20:00:01.000Z',
    durationMs: 1000,
    stopReason: 'manual',
    canvasScanVersion: '0.5.0',
    browserFeatures: { monotonicTime: true, eventTiming: true, longAnimationFrames: true },
    canvases: [{
      canvasId: 'ritual-canvas#1',
      nearestReactOwner: 'yA',
      attributionKind: 'jsx-owner',
      sourceLocation: null,
      activeWindowCount: 8,
      rasterOperationCount: values.operations,
      canvasApiSelfTimeMs: values.time,
      maxWindowSelfTimeMs: values.time / 8,
      evidenceLevel: 'measured',
      methodEvidence,
      commandStatuses: baseline ? { same: 6, changed: 1, unknown: 1 } : { same: 7, changed: 1, unknown: 0 },
    }],
    windows,
    resetEvents: [],
    lifecycleEvents: baseline ? [{ canvasId: 'ritual-canvas#1', type: 'active', windowIndex: 1, timestampMs: 1, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }] : [],
    episodes: [{ episodeId, firstWindowIndex: 1, lastWindowIndex: 8, startedAtTimestampMs: 0, endedAtTimestampMs: 8, activeWindowCount: 8, rasterOperationCount: values.operations, canvasApiSelfTimeMs: values.time, methodEvidence, canvases: [{ canvasId: 'ritual-canvas#1', activeWindowCount: 8, rasterOperationCount: values.operations, canvasApiSelfTimeMs: values.time, maxWindowSelfTimeMs: values.time / 8, methodEvidence, resetEventCount: 0 }], resetEventCount: 0 }],
    browserEntries: entries,
    episodeAssociations: episodeAssociations(entries, episodeId),
    findings: [{
      type: 'repeated-draw-work',
      evidenceLevel: 'candidate',
      canvasId: 'ritual-canvas#1',
      episodeId,
      repeatedWindowCount: repeatedWindows.length,
      rasterOperationCount: repeatedWindows.reduce((total, window) => total + window.rasterOperationCount, 0),
      canvasApiSelfTimeMs: rounded(repeatedWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)),
      repeatedWindows,
      unknownCoverage: { unknownWindowCount: windows.filter(window => window.signatureStatus === 'unknown').length, activeWindowCount: 8 },
      claimBoundary: { ...repeatedDrawClaim },
      nextCheck: repeatedDrawNextCheck,
    }],
    collectionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 },
    droppedEntryCounts: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 },
  };
}

function copiedExplanation() {
  const namespace = 'a'.repeat(32);
  const commandRows = [
    { operationKind: 'call', name: 'clearRect', kinds: ['number', 'number', 'number', 'number'], tokens: [1, 1, 2, 3] },
    { operationKind: 'set', name: 'fillStyle', kinds: ['string'], tokens: [4] },
    ...Array.from({ length: 4 }, () => ({ operationKind: 'call', name: 'fillRect', kinds: ['number', 'number', 'number', 'number'], tokens: [5, 6, 7, 5] })),
  ];
  const command = (ordinal, row) => ({ ordinal, operationKind: row.operationKind, name: row.name, argumentCount: row.kinds.length, arguments: row.kinds.map((kind, position) => ({ position, kind, token: `${namespace}-${row.tokens[position]}` })), unknownReason: null });
  const window = windowIndex => ({ windowIndex, timestampMs: windowIndex, complete: windowIndex > 1, unknownReason: windowIndex === 1 ? 'sampling-gap' : null, commands: commandRows.map((row, ordinal) => command(ordinal, row)) });
  const generated = functionName => ({ functionName, generated: { file: 'http://127.0.0.1:5211/assets/index.js', line: 1, column: 1 }, mapped: null, mappingStatus: 'unresolved', unresolvedReason: 'no-source-map' });
  return {
    schemaVersion: 1,
    explanationId: `canvas-scan-explanation-${startedAtEpoch}-1`,
    startedAt: '2026-08-17T20:00:00.000Z',
    endedAt: '2026-08-17T20:00:01.000Z',
    durationMs: 1000,
    stopReason: 'manual',
    canvasScanVersion: '0.5.0',
    source: { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'ritual-canvas#1' },
    followUp: { sessionId: followUpSessionId, canvasId: 'ritual-canvas#1' },
    windows: Array.from({ length: 8 }, (_, index) => window(index + 1)),
    comparisons: Array.from({ length: 7 }, (_, index) => ({ referenceWindowIndex: index + 1, targetWindowIndex: index + 2, status: index === 0 ? 'unknown' : 'same', difference: null, unknownReason: index === 0 ? 'sampling-gap' : null })),
    firstDifference: null,
    stacks: [{
      windowIndex: 1,
      commandOrdinal: 0,
      reason: 'first-raster',
      frames: [
        { functionName: 'CanvasRenderingContext2D.value', generated: null, mapped: null, mappingStatus: 'unresolved', unresolvedReason: 'mapping-missing' },
        ...['d', 'onClick', 'Iv', null, 'tm', 'Br', 'Fr', 'yS'].map(generated),
      ],
      droppedFrameCount: 0,
    }],
    collectionLimits: { maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 },
    droppedEntryCounts: { durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 },
    limitResults: [['duration-ms', 10000], ['selected-canvases', 1], ['active-windows', 120], ['command-entries', 5000], ['arguments-per-command', 20], ['value-tokens', 1024], ['stack-samples', 8], ['frames-per-stack', 20], ['source-map-lookups', 8], ['source-map-response-bytes', 2097152]].map(([name, maximum]) => ({ name, maximum, rejectedCount: 0, reason: null, firstAffected: null })),
    callsiteCoverage: { status: 'complete', incompleteReasons: [] },
    firstGap: { windowIndex: 1, commandOrdinal: 0, reason: 'sampling-gap' },
  };
}

function copiedComparison() {
  return {
    schemaVersion: 1,
    comparisonId: `canvas-scan-comparison-${baselineSessionId}-0-${candidateSessionId}-0`,
    createdAt: '2026-08-17T20:00:01.000Z',
    canvasScanVersion: '0.5.0',
    pairingMethod: 'user-selected',
    baseline: { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'ritual-canvas#1' },
    candidate: { sessionId: candidateSessionId, findingIndex: 0, findingType: 'repeated-draw-work', canvasId: 'ritual-canvas#1' },
    status: 'comparable',
    incomparableReasons: [],
    measures: [
      measure('active-window-count', 'count', 8, 8),
      measure('raster-operation-count', 'count', 40, 24),
      measure('canvas-api-self-time-ms', 'ms', 1, 0.7),
      measure('maximum-window-self-time-ms', 'ms', 0.125, 0.0875),
      measure('method:clearRect:operation-count', 'count', 8, 8),
      measure('method:clearRect:self-time-ms', 'ms', 0.2, 0.2),
      measure('method:fillRect:operation-count', 'count', 32, 16),
      measure('method:fillRect:self-time-ms', 'ms', 0.8, 0.5),
      measure('method:fillStyle:operation-count', 'count', 8, 8),
      measure('method:fillStyle:self-time-ms', 'ms', null, null),
      measure('unknown-command-window-count', 'count', 1, 0),
      measure('repeated-window-count', 'count', 6, 7),
      measure('repeated-raster-operation-count', 'count', 30, 21),
      measure('comparison-gap-count', 'count', 0, 0),
    ],
    improvementEstablished: false,
  };
}

function evidence() {
  const baselineSession = session('baseline', { operations: 40, time: 1, fills: 32, fillTime: 0.8 });
  const candidateSession = session('candidate', { operations: 24, time: 0.7, fills: 16, fillTime: 0.5 });
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
    runStages: RUN_STAGE_IDS.map(id => ({ id, status: 'complete', reason: null })),
    browserDrawCounts: browserDrawCounts(),
    baseline: { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work' },
    explanation: { sourceSessionId: baselineSessionId, sourceFindingIndex: 0, followUpSessionId, stopReason: 'manual' },
    candidate: { sessionId: candidateSessionId, findingIndex: 0, findingType: 'repeated-draw-work' },
    comparison: { pairingMethod: 'user-selected', status: 'comparable', improvementEstablished: false, baselineSessionId, baselineFindingIndex: 0, candidateSessionId, candidateFindingIndex: 0 },
    artifacts: { baselineSession, candidateSession, copiedExplanation: copiedExplanation(), copiedComparison: copiedComparison() },
    diagnostics: { warnings: [], errors: [], pageErrors: [], requestFailures: [], cleanupErrors: [] },
    failures: [],
  };
}

test('accepts one complete clean-consumer ritual', () => {
  assert.equal(checkReadinessEvidence(evidence(), candidate()), true);
  const withLongAnimationFrame = evidence();
  for (const session of [withLongAnimationFrame.artifacts.baselineSession, withLongAnimationFrame.artifacts.candidateSession]) {
    session.browserEntries.splice(2, 0, { entryId: '', kind: 'long-animation-frame', startedAtTimestampMs: 0.25, endedAtTimestampMs: 0.75, durationMs: 0.5, blockingDurationMs: 0, scripts: [], droppedScriptAttributionCount: 0 });
    session.browserEntries.forEach((entry, index) => { entry.entryId = `browser-evidence-${index + 1}`; });
    session.episodeAssociations = episodeAssociations(session.browserEntries, session.episodes[0].episodeId);
  }
  assert.equal(checkReadinessEvidence(withLongAnimationFrame, candidate()), true);
});

test('rejects missing, extra, and reordered actions', () => {
  const missing = evidence(); missing.actionIds.pop(); assert.throws(() => checkReadinessEvidence(missing, candidate()), /ritual identity/);
  const extra = evidence(); extra.actionIds.push('extra'); assert.throws(() => checkReadinessEvidence(extra, candidate()), /ritual identity/);
  const reordered = evidence(); [reordered.actionIds[0], reordered.actionIds[1]] = [reordered.actionIds[1], reordered.actionIds[0]]; assert.throws(() => checkReadinessEvidence(reordered, candidate()), /ritual identity/);
});

test('requires explicit complete stages that agree with the ritual outputs', () => {
  for (const mutate of [
    value => { value.runStages.pop(); },
    value => { value.runStages.push(structuredClone(value.runStages[0])); },
    value => { value.runStages[1].id = value.runStages[0].id; },
    value => { value.runStages[0].status = 'failed'; value.runStages[0].reason = 'setup-failed'; },
    value => { value.runStages[0].status = 'complete'; value.runStages[0].reason = 'setup-failed'; },
    value => { value.runStages[0].status = 'other'; },
    value => { value.runStages = value.actionIds; },
    value => { value.actionIds.pop(); },
  ]) { const value = evidence(); mutate(value); assert.throws(() => checkReadinessEvidence(value, candidate())); }
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
  const selection = { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work' };
  assert.equal(validateCopiedExplanation(copiedExplanation(), selection), true);
  const mapped = copiedExplanation();
  Object.assign(mapped.stacks[0].frames[1], { mapped: { file: '/src/ritual-canvas.tsx', line: 1, column: 1 }, mappingStatus: 'mapped', unresolvedReason: null });
  assert.equal(validateCopiedExplanation(mapped, selection), true);
  for (const mutate of [
    value => { value.source.sessionId = 'other'; },
    value => { value.comparisons[0].status = 'changed'; },
    value => { value.windows[0].commands.pop(); },
    value => { value.privateValue = '#2563eb'; },
  ]) {
    const value = copiedExplanation(); mutate(value); assert.throws(() => validateCopiedExplanation(value, selection));
  }
});

test('accepts only the finite explanation epoch boundaries', () => {
  const selection = { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work' };
  for (const offset of [-1, 0]) {
    const artifact = copiedExplanation();
    artifact.explanationId = `canvas-scan-explanation-${Date.parse(artifact.startedAt) + offset}-1`;
    assert.equal(validateCopiedExplanation(artifact, selection), true);
  }
});

test('accepts the observed one millisecond clock conversion', () => {
  const artifact = copiedExplanation();
  artifact.explanationId = 'canvas-scan-explanation-1787004809895-1';
  artifact.startedAt = '2026-08-17T22:13:29.896Z';
  artifact.endedAt = '2026-08-17T22:13:30.028Z';
  artifact.durationMs = 132.7;
  artifact.followUp.sessionId = 'canvas-scan-1787004809896-2';
  const selection = { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work' };
  assert.equal(validateCopiedExplanation(artifact, selection), true);
});

test('accepts monotonic durations within the declared wall-clock tolerance', () => {
  const value = evidence();
  value.artifacts.baselineSession.durationMs = 1000 + 25;
  assert.equal(validateCopiedComparison(value.artifacts.copiedComparison, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), true);
  const explanation = copiedExplanation();
  explanation.durationMs = 1000 + 25;
  assert.equal(validateCopiedExplanation(explanation, { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work' }), true);
});

test('rejects monotonic durations beyond the declared wall-clock tolerance', () => {
  const value = evidence();
  value.artifacts.baselineSession.durationMs = 1000 + 25.001;
  assert.throws(() => validateCopiedComparison(value.artifacts.copiedComparison, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), /raw session identity changed/);
  const explanation = copiedExplanation();
  explanation.durationMs = 1000 + 25.001;
  assert.throws(() => validateCopiedExplanation(explanation, { sessionId: baselineSessionId, findingIndex: 0, findingType: 'repeated-draw-work' }), /copied explanation identity changed/);
});

test('accepts a session whose page interaction pair was delivered outside the recording', () => {
  const value = evidence();
  const target = value.artifacts.baselineSession;
  const removed = target.browserEntries.splice(0, 2).map(entry => entry.entryId);
  const renumbered = new Map(target.browserEntries.map((entry, index) => [entry.entryId, `browser-evidence-${index + 1}`]));
  for (const entry of target.browserEntries) entry.entryId = renumbered.get(entry.entryId);
  target.episodeAssociations = target.episodeAssociations.filter(association => !removed.includes(association.entryId));
  for (const association of target.episodeAssociations) association.entryId = renumbered.get(association.entryId);
  assert.equal(validateCopiedComparison(value.artifacts.copiedComparison, target, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), true);
});

test('accepts a lone boundary half delivered across the recording edge', () => {
  const value = evidence();
  const target = value.artifacts.baselineSession;
  const removed = target.browserEntries.splice(0, 1).map(entry => entry.entryId);
  const renumbered = new Map(target.browserEntries.map((entry, index) => [entry.entryId, `browser-evidence-${index + 1}`]));
  for (const entry of target.browserEntries) entry.entryId = renumbered.get(entry.entryId);
  target.episodeAssociations = target.episodeAssociations.filter(association => !removed.includes(association.entryId));
  for (const association of target.episodeAssociations) association.entryId = renumbered.get(association.entryId);
  assert.equal(validateCopiedComparison(value.artifacts.copiedComparison, target, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), true);
});

const stopPairEntry = (index, eventType, startedAtTimestampMs) => ({ entryId: `browser-evidence-${index}`, kind: 'event-timing', eventType, startedAtTimestampMs, endedAtTimestampMs: startedAtTimestampMs + 0.5, targetTagName: 'div', durationMs: 0.5, interactionId: 33 });

test('accepts a session whose stop interaction pair was delivered inside the recording', () => {
  const value = evidence();
  const target = value.artifacts.baselineSession;
  target.browserEntries.push(stopPairEntry(target.browserEntries.length + 1, 'pointerdown', 9), stopPairEntry(target.browserEntries.length + 2, 'pointerup', 9.5));
  assert.equal(validateCopiedComparison(value.artifacts.copiedComparison, target, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), true);
});

test('rejects a stop interaction pair that reuses another interaction id', () => {
  const value = evidence();
  const target = value.artifacts.baselineSession;
  const replayId = target.browserEntries.find(entry => entry.kind === 'event-timing' && entry.targetTagName === 'button').interactionId;
  const down = { ...stopPairEntry(target.browserEntries.length + 1, 'pointerdown', 9), interactionId: replayId };
  const up = { ...stopPairEntry(target.browserEntries.length + 2, 'pointerup', 9.5), interactionId: replayId };
  target.browserEntries.push(down, up);
  assert.throws(() => validateCopiedComparison(value.artifacts.copiedComparison, target, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), /raw event timing pair changed/);
});

test('rejects a third distinct div interaction', () => {
  const value = evidence();
  const target = value.artifacts.baselineSession;
  target.browserEntries.push(stopPairEntry(target.browserEntries.length + 1, 'pointerdown', 9), { ...stopPairEntry(target.browserEntries.length + 2, 'pointerdown', 9.5), interactionId: 44 });
  assert.throws(() => validateCopiedComparison(value.artifacts.copiedComparison, target, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), /raw browser entry rows changed/);
});

test('rejects a reversed or foreign-target interaction group', () => {
  const value = evidence();
  const target = value.artifacts.baselineSession;
  target.browserEntries.push(stopPairEntry(target.browserEntries.length + 1, 'pointerup', 9), stopPairEntry(target.browserEntries.length + 2, 'pointerdown', 9.5));
  assert.throws(() => validateCopiedComparison(value.artifacts.copiedComparison, target, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts), /raw event timing pair changed/);
  const foreign = evidence();
  const foreignTarget = foreign.artifacts.baselineSession;
  foreignTarget.browserEntries.push({ ...stopPairEntry(foreignTarget.browserEntries.length + 1, 'pointerdown', 9), targetTagName: 'span' });
  assert.throws(() => validateCopiedComparison(foreign.artifacts.copiedComparison, foreignTarget, foreign.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, foreign.browserDrawCounts), /raw event timing value changed/);
});

test('rejects the finite SIDPROJ-114 readiness mutation corpus', () => {
  for (const [name, mutate] of readinessMutations) {
    const value = evidence();
    mutate(value);
    assert.throws(() => checkReadinessEvidence(value, candidate()), undefined, name);
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
    artifact => { artifact.improvementEstablished = true; },
  ]) {
    const artifact = copiedComparison(); mutate(artifact); assert.throws(() => validateCopiedComparison(artifact, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: 0, candidateFindingIndex: 0 }, value.browserDrawCounts));
  }
});

test('binds repeated finding rows to the raw command status rows', () => {
  const value = evidence();
  value.artifacts.baselineSession.findings[0].repeatedWindows[0].rasterOperationCount = 3;
  assert.throws(() => checkReadinessEvidence(value, candidate()), /raw repeated window/);

  const invalidCoverage = evidence();
  invalidCoverage.artifacts.candidateSession.findings[0].unknownCoverage.unknownWindowCount = -1;
  invalidCoverage.artifacts.copiedComparison.measures[10] = measure('unknown-command-window-count', 'count', 1, -1);
  assert.throws(() => checkReadinessEvidence(invalidCoverage, candidate()), /raw repeated finding/);
});

test('rejects selection, pairing, raw artifacts, and diagnostics drift', () => {
  for (const mutate of [
    value => { value.explanation.sourceFindingIndex = 1; },
    value => { value.candidate.findingType = 'heavy-canvas-work'; },
    value => { value.comparison.pairingMethod = 'automatic'; },
    value => { value.artifacts.copiedComparison.measures[1].candidate = 40; },
    value => { value.artifacts.baselineSession.canvases[0].extra = true; },
    value => { value.artifacts.candidateSession.findings.push(value.artifacts.candidateSession.findings[0]); },
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
