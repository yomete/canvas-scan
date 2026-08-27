import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { RITUAL_METHODS } from '../../scripts/pack-manifest.mjs';
import { ContractViolation, checkInvestigationRunReport, checkInvestigationSnapshot, checkRunStages, classifyStageFailure, createRunState, finalizeInvestigationRun, investigationArtifactBytes, preflightInvestigationRunReport, reduceRunState, runExportStage, terminalRunOutput } from './investigation-run-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDirectory = '/private/tmp/sidproj-106-run-report';
const port = 5211;
const origin = `http://127.0.0.1:${port}`;
export const ACTION_IDS = ['early-load', 'record-baseline', 'explain-baseline', 'copy-explanation', 'keep-baseline', 'apply-change', 'record-candidate', 'pair-findings', 'copy-comparison'];
const diagnosticKeys = ['warnings', 'errors', 'pageErrors', 'requestFailures', 'cleanupErrors'];
const comparisonMeasureIds = [
  'active-window-count', 'raster-operation-count', 'canvas-api-self-time-ms', 'maximum-window-self-time-ms',
  'method:clearRect:operation-count', 'method:clearRect:self-time-ms',
  'method:fillRect:operation-count', 'method:fillRect:self-time-ms',
  'method:fillStyle:operation-count', 'method:fillStyle:self-time-ms',
  'unknown-command-window-count', 'repeated-window-count', 'repeated-raster-operation-count', 'comparison-gap-count',
];
const hash = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = value => typeof value === 'string' && value.length > 0;
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const READINESS_CONTRACT = {
  keys: {
    session: ['schemaVersion', 'sessionId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'browserFeatures', 'canvases', 'windows', 'resetEvents', 'lifecycleEvents', 'episodes', 'browserEntries', 'episodeAssociations', 'findings', 'collectionLimits', 'droppedEntryCounts'],
    canvas: ['canvasId', 'nearestReactOwner', 'attributionKind', 'sourceLocation', 'activeWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'maxWindowSelfTimeMs', 'evidenceLevel', 'methodEvidence', 'commandStatuses', 'windowDetailDropped'],
    window: ['canvasId', 'nearestReactOwner', 'attributionKind', 'sourceLocation', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'signatureStatus', 'unknownReason', 'sampled', 'comparisonGap', 'methodEvidence', 'windowIndex', 'timestampMs', 'startedAtTimestampMs', 'endedAtTimestampMs', 'geometry'],
    methodEvidence: ['clearRect', 'fillRect', 'fillStyle'],
    method: ['count', 'canvasApiSelfTimeMs'],
    sourceLocation: ['file', 'line', 'column'],
    geometry: ['backingWidth', 'backingHeight', 'cssWidth', 'cssHeight', 'devicePixelRatio', 'expectedBackingWidth', 'expectedBackingHeight', 'expectedPixelArea', 'actualToExpectedAreaRatio', 'unavailableReason'],
    lifecycle: ['canvasId', 'type', 'windowIndex', 'timestampMs', 'connected', 'activeRegistrySize', 'evidenceLevel'],
    episode: ['episodeId', 'firstWindowIndex', 'lastWindowIndex', 'startedAtTimestampMs', 'endedAtTimestampMs', 'activeWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'methodEvidence', 'canvases', 'resetEventCount'],
    episodeCanvas: ['canvasId', 'activeWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'maxWindowSelfTimeMs', 'methodEvidence', 'resetEventCount'],
    documentEvent: ['entryId', 'kind', 'eventType', 'startedAtTimestampMs', 'endedAtTimestampMs', 'targetTagName'],
    eventTiming: ['entryId', 'kind', 'eventType', 'startedAtTimestampMs', 'endedAtTimestampMs', 'targetTagName', 'durationMs', 'interactionId'],
    longAnimationFrame: ['entryId', 'kind', 'startedAtTimestampMs', 'endedAtTimestampMs', 'durationMs', 'blockingDurationMs', 'scripts', 'droppedScriptAttributionCount'],
    association: ['entryId', 'entryKind', 'episodeId', 'startedAtTimestampMs', 'endedAtTimestampMs', 'evidenceLevel'],
    finding: ['type', 'evidenceLevel', 'canvasId', 'episodeId', 'repeatedWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'repeatedWindows', 'unknownCoverage', 'claimBoundary', 'nextCheck'],
    repeatedWindow: ['windowIndex', 'timestampMs', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'comparisonGap'],
    unknownCoverage: ['unknownWindowCount', 'activeWindowCount'],
    claimBoundary: ['observation', 'explanation', 'nonEstablishedFacts'],
    command: ['ordinal', 'operationKind', 'name', 'argumentCount', 'arguments', 'unknownReason'],
    argument: ['position', 'kind', 'token'],
    explanation: ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'limitResults', 'callsiteCoverage', 'firstGap'],
    explanationSource: ['sessionId', 'findingIndex', 'findingType', 'canvasId'],
    explanationFollowUp: ['sessionId', 'canvasId'],
    explanationWindow: ['windowIndex', 'timestampMs', 'commands', 'complete', 'unknownReason'],
    explanationComparison: ['referenceWindowIndex', 'targetWindowIndex', 'status', 'difference', 'unknownReason'],
    stack: ['windowIndex', 'commandOrdinal', 'reason', 'frames', 'droppedFrameCount'],
    stackFrame: ['functionName', 'generated', 'mapped', 'mappingStatus', 'unresolvedReason'],
    limitResult: ['name', 'maximum', 'rejectedCount', 'reason', 'firstAffected'],
    callsiteCoverage: ['status', 'incompleteReasons'],
    firstGap: ['windowIndex', 'commandOrdinal', 'reason'],
    copiedComparison: ['schemaVersion', 'comparisonId', 'createdAt', 'canvasScanVersion', 'pairingMethod', 'baseline', 'candidate', 'status', 'incomparableReasons', 'measures', 'improvementEstablished'],
    comparisonReference: ['sessionId', 'findingIndex', 'findingType', 'canvasId'],
    measure: ['id', 'unit', 'baseline', 'candidate', 'delta', 'direction', 'interpretation'],
    readiness: ['schemaVersion', 'issue', 'status', 'gitSha', 'branch', 'packageVersion', 'tarballSha256', 'packedIifeSha256', 'installedIifeSha256', 'browserVersion', 'earlyLoad', 'cleanBefore', 'cleanAfter', 'publicMethods', 'actionIds', 'runStages', 'browserDrawCounts', 'baseline', 'explanation', 'candidate', 'comparison', 'artifacts', 'diagnostics', 'failures'],
    readinessFinding: ['sessionId', 'findingIndex', 'findingType'],
    readinessExplanation: ['sourceSessionId', 'sourceFindingIndex', 'followUpSessionId', 'stopReason'],
    readinessComparison: ['pairingMethod', 'status', 'improvementEstablished', 'baselineSessionId', 'baselineFindingIndex', 'candidateSessionId', 'candidateFindingIndex'],
    artifacts: ['baselineSession', 'candidateSession', 'copiedExplanation', 'copiedComparison'],
    browserDrawCounts: ['baseline', 'candidate'],
    browserDrawMode: ['clearRect', 'fillRect'],
    diagnostics: ['warnings', 'errors', 'pageErrors', 'requestFailures', 'cleanupErrors'],
  },
  fixed: {
    session: { schemaVersion: 1, stopReason: 'manual', canvasScanVersion: '0.5.0' },
    browserFeatures: { monotonicTime: true, eventTiming: true, longAnimationFrames: true },
    sessionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 },
    sessionDropped: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 },
    geometry: { backingWidth: 400, backingHeight: 150, cssWidth: 400, cssHeight: 150, devicePixelRatio: 1, expectedBackingWidth: 400, expectedBackingHeight: 150, expectedPixelArea: 60000, actualToExpectedAreaRatio: 1, unavailableReason: null },
    claimBoundary: {
      observation: 'The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.',
      explanation: 'The repeated commands are a review candidate.',
      nonEstablishedFacts: 'The evidence does not establish that the output stayed unchanged or that the work can be removed.',
    },
    nextCheck: 'Check whether the application needs to send these repeated commands for the same scene and interaction.',
    explanation: { schemaVersion: 1, stopReason: 'manual', canvasScanVersion: '0.5.0' },
    copiedComparison: { schemaVersion: 1, canvasScanVersion: '0.5.0', pairingMethod: 'user-selected', status: 'comparable', improvementEstablished: false },
    readiness: { schemaVersion: 1, issue: 'SIDPROJ-105', status: 'PASS' },
    explanationLimits: { maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 },
    explanationDropped: { durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 },
  },
  modes: {
    baseline: { drawsPerFrame: 4, lifecycleRows: 1, commandStatuses: { same: 6, changed: 1, unknown: 1 } },
    candidate: { drawsPerFrame: 2, lifecycleRows: 0, commandStatuses: { same: 7, changed: 1, unknown: 0 } },
  },
  identities: {
    explanationEpochOffsetsMs: [-1, 0],
    // durationMs is monotonic-clock, the ISO stamps are wall-clock: the bound covers 1 ms stamp
    // quantization at each end plus NTP slew up to 0.5 ms/s over the 30 s session cap.
    wallClockDurationToleranceMs: 25,
  },
  rows: { canvases: 1, windows: 8, resetEvents: 0, episodes: 1, findings: 1, explanationWindows: 8, explanationComparisons: 7, explanationStacks: 1 },
  commandRows: [
    { operationKind: 'call', name: 'clearRect', kinds: ['number', 'number', 'number', 'number'], tokens: [1, 1, 2, 3] },
    { operationKind: 'set', name: 'fillStyle', kinds: ['string'], tokens: [4] },
    ...Array.from({ length: 4 }, () => ({ operationKind: 'call', name: 'fillRect', kinds: ['number', 'number', 'number', 'number'], tokens: [5, 6, 7, 5] })),
  ],
  browserRows: [
    { kind: 'event-timing', eventType: 'pointerdown', targetTagName: 'div', pair: 'page' },
    { kind: 'event-timing', eventType: 'pointerup', targetTagName: 'div', pair: 'page' },
    { kind: 'document-event', eventType: 'pointermove', targetTagName: 'button' },
    { kind: 'document-event', eventType: 'pointerdown', targetTagName: 'button' },
    { kind: 'document-event', eventType: 'pointerup', targetTagName: 'button' },
    { kind: 'long-animation-frame', optional: true },
    { kind: 'event-timing', eventType: 'pointerdown', targetTagName: 'button', pair: 'replay' },
    { kind: 'event-timing', eventType: 'pointerup', targetTagName: 'button', pair: 'replay' },
    { kind: 'document-event', eventType: 'pointermove', targetTagName: 'div' },
    { kind: 'document-event', eventType: 'pointerdown', targetTagName: 'div' },
    { kind: 'document-event', eventType: 'pointerup', targetTagName: 'div' },
  ],
  stackFrames: [
    { functionName: 'CanvasRenderingContext2D.value', generated: false, unresolvedReason: 'mapping-missing' },
    { functionName: 'd', generated: true, unresolvedReason: 'no-source-map' },
    { functionName: 'onClick', generated: true, unresolvedReason: 'no-source-map' },
    { functionName: 'Iv', generated: true, unresolvedReason: 'no-source-map' },
    { functionName: null, generated: true, unresolvedReason: 'no-source-map' },
    { functionName: 'tm', generated: true, unresolvedReason: 'no-source-map' },
    { functionName: 'Br', generated: true, unresolvedReason: 'no-source-map' },
    { functionName: 'Fr', generated: true, unresolvedReason: 'no-source-map' },
    { functionName: 'yS', generated: true, unresolvedReason: 'no-source-map' },
  ],
  explanationLimitRows: [
    ['duration-ms', 'maxDurationMs'], ['selected-canvases', 'maxSelectedCanvases'], ['active-windows', 'maxActiveWindows'], ['command-entries', 'maxCommandEntries'], ['arguments-per-command', 'maxArgumentsPerCommand'], ['value-tokens', 'maxValueTokens'], ['stack-samples', 'maxStackSamples'], ['frames-per-stack', 'maxFramesPerStack'], ['source-map-lookups', 'maxSourceMapLookups'], ['source-map-response-bytes', 'maxSourceMapResponseBytes'],
  ],
  enums: {
    documentEvents: ['pointermove', 'pointerdown', 'pointerup'],
    eventTimingEvents: ['pointerdown', 'pointerup'],
    targetTags: ['button', 'div'],
    unresolvedReasons: ['no-source-map', 'cross-origin-source-map', 'source-map-lookup-limit', 'source-map-too-large', 'source-map-load-failed', 'source-map-parse-failed', 'mapping-missing'],
  },
  paths: {
    generated: /^http:\/\/127\.0\.0\.1:5211\/assets\/[A-Za-z0-9_.-]+\.js$/,
    mapped: /^\/?(?:src|apps|packages)\/[A-Za-z0-9_./-]+\.(?:js|jsx|ts|tsx)$/,
  },
};

function shape(value, keys, label) {
  if (!exact(value, keys)) throw new ContractViolation(`${label} shape changed`);
}

function list(value, label) {
  if (!Array.isArray(value)) throw new ContractViolation(`${label} shape changed`);
  return value;
}

function fixed(value, expected, label) {
  shape(value, Object.keys(expected), label);
  for (const [key, expectedValue] of Object.entries(expected)) if (JSON.stringify(value[key]) !== JSON.stringify(expectedValue)) throw new ContractViolation(`${label} value changed`);
}

function finite(value) {
  return Number.isFinite(value) && value >= 0;
}

function sameNumber(left, right) {
  return finite(left) && finite(right) && Math.abs(left - right) < 0.001;
}

function isoDate(value) {
  return text(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateSourceLocation(value, label, kind) {
  if (value === null) return;
  shape(value, READINESS_CONTRACT.keys.sourceLocation, label);
  const generated = kind === 'generated' && READINESS_CONTRACT.paths.generated.test(value.file);
  const mapped = kind === 'mapped' && !value.file.includes('..') && READINESS_CONTRACT.paths.mapped.test(value.file);
  if ((!generated && !mapped) || value.file.includes('?') || value.file.includes('#') || !Number.isInteger(value.line) || value.line < 1 || !Number.isInteger(value.column) || value.column < 0) throw new ContractViolation(`${label} value changed`);
}

function validateMethodEvidence(value, counts, label) {
  shape(value, READINESS_CONTRACT.keys.methodEvidence, label);
  for (const [name, count] of Object.entries(counts)) {
    shape(value[name], READINESS_CONTRACT.keys.method, `${label}.${name}`);
    if (value[name].count !== count || (name === 'fillStyle' ? value[name].canvasApiSelfTimeMs !== null : !finite(value[name].canvasApiSelfTimeMs))) throw new ContractViolation(`${label}.${name} value changed`);
  }
}

function validateBrowserEntries(entries) {
  const rows = list(entries, 'raw session browser entries');
  // Document events are captured synchronously, so their six-row order is exact truth.
  // Event-timing entries arrive with unordered per-entry delivery latency around the recording
  // window: any entry can be delivered outside it, and the record and stop clicks that bracket
  // the recording can add up to two div interactions. Timing entries are therefore checked as
  // per-interaction groups — consistent target, pointerdown before pointerup, at most one
  // button interaction and two div interactions — never by position or guaranteed presence.
  const documentRows = READINESS_CONTRACT.browserRows.filter(row => row.kind === 'document-event');
  const replayPair = READINESS_CONTRACT.browserRows.filter(row => row.pair === 'replay');
  const boundaryPair = READINESS_CONTRACT.browserRows.filter(row => row.pair === 'page');
  for (const [index, entry] of rows.entries()) {
    if (entry?.entryId !== `browser-evidence-${index + 1}` || !finite(entry.startedAtTimestampMs) || !finite(entry.endedAtTimestampMs) || entry.endedAtTimestampMs < entry.startedAtTimestampMs) throw new ContractViolation('raw browser entry identity changed');
    if (!['document-event', 'event-timing', 'long-animation-frame'].includes(entry.kind)) throw new ContractViolation('raw browser entry kind changed');
  }
  const documents = rows.filter(row => row.kind === 'document-event');
  const timings = rows.filter(row => row.kind === 'event-timing');
  const frames = rows.filter(row => row.kind === 'long-animation-frame');
  if (frames.length > 1 || documents.length !== documentRows.length) throw new ContractViolation('raw browser entry rows changed');
  for (const [index, entry] of documents.entries()) {
    shape(entry, READINESS_CONTRACT.keys.documentEvent, 'raw document event');
    if (entry.eventType !== documentRows[index].eventType || entry.targetTagName !== documentRows[index].targetTagName) throw new ContractViolation('raw document event value changed');
  }
  const interactions = new Map();
  for (const entry of timings) {
    shape(entry, READINESS_CONTRACT.keys.eventTiming, 'raw event timing');
    if (!sameNumber(entry.durationMs, entry.endedAtTimestampMs - entry.startedAtTimestampMs) || !Number.isInteger(entry.interactionId) || entry.interactionId < 1) throw new ContractViolation('raw event timing value changed');
    interactions.set(entry.interactionId, [...(interactions.get(entry.interactionId) ?? []), entry]);
  }
  const allowedSequences = [['pointerdown'], ['pointerup'], ['pointerdown', 'pointerup']].map(sequence => JSON.stringify(sequence));
  let replayInteractions = 0;
  let boundaryInteractions = 0;
  for (const group of interactions.values()) {
    if (group.some(entry => entry.targetTagName !== group[0].targetTagName) || !allowedSequences.includes(JSON.stringify(group.map(entry => entry.eventType)))) throw new ContractViolation('raw event timing pair changed');
    if (group[0].targetTagName === replayPair[0].targetTagName) replayInteractions++;
    else if (group[0].targetTagName === boundaryPair[0].targetTagName) boundaryInteractions++;
    else throw new ContractViolation('raw event timing value changed');
  }
  if (replayInteractions > 1 || boundaryInteractions > 2) throw new ContractViolation('raw browser entry rows changed');
  for (const entry of frames) {
    shape(entry, READINESS_CONTRACT.keys.longAnimationFrame, 'raw long animation frame');
    if (!sameNumber(entry.durationMs, entry.endedAtTimestampMs - entry.startedAtTimestampMs) || !finite(entry.blockingDurationMs) || list(entry.scripts, 'raw long animation frame scripts').length || entry.droppedScriptAttributionCount !== 0) throw new ContractViolation('raw long animation frame value changed');
  }
}

function validateCommand(command, expected, expectedOrdinal, namespace, label) {
  shape(command, READINESS_CONTRACT.keys.command, label);
  const argumentsList = list(command.arguments, `${label} arguments`);
  if (command.ordinal !== expectedOrdinal || command.operationKind !== expected.operationKind || command.name !== expected.name || command.argumentCount !== expected.kinds.length || argumentsList.length !== expected.kinds.length || command.unknownReason !== null) throw new ContractViolation(`${label} value changed`);
  for (const [index, argument] of argumentsList.entries()) {
    shape(argument, READINESS_CONTRACT.keys.argument, `${label} argument`);
    if (argument.position !== index || argument.kind !== expected.kinds[index] || argument.token !== `${namespace}-${expected.tokens[index]}`) throw new ContractViolation(`${label} argument value changed`);
  }
}

function validateStackFrame(frame, expected) {
  shape(frame, READINESS_CONTRACT.keys.stackFrame, 'copied explanation stack frame');
  if (frame.functionName !== expected.functionName) throw new ContractViolation('copied explanation stack function changed');
  validateSourceLocation(frame.generated, 'copied explanation generated location', 'generated');
  validateSourceLocation(frame.mapped, 'copied explanation mapped location', 'mapped');
  const generated = expected.generated ? frame.generated !== null : frame.generated === null;
  const mapped = expected.generated && frame.generated !== null && frame.mappingStatus === 'mapped' && frame.mapped !== null && frame.unresolvedReason === null;
  const unresolved = generated && frame.mapped === null && frame.mappingStatus === 'unresolved' && frame.unresolvedReason === expected.unresolvedReason;
  if (!mapped && !unresolved) throw new ContractViolation('copied explanation stack mapping changed');
}

export function readinessStatus(failures, diagnostics, conditions = []) {
  return failures.length || diagnosticKeys.some(key => diagnostics[key].length) || conditions.some(condition => !condition) ? 'FAIL' : 'PASS';
}

function measure(id, unit, baseline, candidate) {
  const delta = baseline === null || candidate === null ? null : unit === 'ms' || unit === 'ratio' ? Math.round((candidate - baseline) * 1000) / 1000 : candidate - baseline;
  return { id, unit, baseline, candidate, delta, direction: delta === null ? 'unknown' : delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural' };
}

function selectedRepeated(session, findingIndex) {
  const finding = session?.findings?.[findingIndex];
  const canvases = session?.canvases?.filter(canvas => canvas.canvasId === finding?.canvasId) ?? [];
  if (finding?.type !== 'repeated-draw-work' || canvases.length !== 1) throw new ContractViolation('readiness selected repeated finding changed');
  return { finding, canvas: canvases[0] };
}

function validateBrowserDrawCounts(drawCounts) {
  if (!exact(drawCounts, READINESS_CONTRACT.keys.browserDrawCounts)) throw new ContractViolation('browser draw counts changed');
  for (const mode of ['baseline', 'candidate']) {
    const drawsPerFrame = READINESS_CONTRACT.modes[mode].drawsPerFrame;
    if (!exact(drawCounts[mode], READINESS_CONTRACT.keys.browserDrawMode) || drawCounts[mode].clearRect !== 8 || drawCounts[mode].fillRect !== 8 * drawsPerFrame) throw new ContractViolation(`${mode} browser draw counts changed`);
  }
  return true;
}

function validateDemoSession(session, findingIndex, mode, drawCounts) {
  const expected = READINESS_CONTRACT.modes[mode];
  const methodCounts = { clearRect: 8, fillRect: 8 * expected.drawsPerFrame, fillStyle: 8 };
  const windowMethodCounts = { clearRect: 1, fillRect: expected.drawsPerFrame, fillStyle: 1 };
  const rasterOperationCount = drawCounts.clearRect + drawCounts.fillRect;
  shape(session, READINESS_CONTRACT.keys.session, 'raw session root');
  for (const [key, value] of Object.entries(READINESS_CONTRACT.fixed.session)) if (session[key] !== value) throw new ContractViolation('raw session root value changed');
  const sessionIdentity = session.sessionId?.match(/^canvas-scan-(\d+)-(\d+)$/);
  const startedAtMs = Date.parse(session.startedAt);
  const endedAtMs = Date.parse(session.endedAt);
  if (!sessionIdentity || !isoDate(session.startedAt) || !isoDate(session.endedAt) || Number(sessionIdentity[1]) !== startedAtMs || Number(sessionIdentity[2]) < 1 || endedAtMs < startedAtMs || !finite(session.durationMs) || Math.abs(endedAtMs - startedAtMs - session.durationMs) > READINESS_CONTRACT.identities.wallClockDurationToleranceMs) throw new ContractViolation('raw session identity changed');
  fixed(session.browserFeatures, READINESS_CONTRACT.fixed.browserFeatures, 'raw session browser features');
  fixed(session.collectionLimits, READINESS_CONTRACT.fixed.sessionLimits, 'raw session collection limits');
  fixed(session.droppedEntryCounts, READINESS_CONTRACT.fixed.sessionDropped, 'raw session dropped counts');
  if (list(session.canvases, 'raw session canvases').length !== READINESS_CONTRACT.rows.canvases || list(session.windows, 'raw session windows').length !== READINESS_CONTRACT.rows.windows || list(session.resetEvents, 'raw session reset events').length !== READINESS_CONTRACT.rows.resetEvents || list(session.lifecycleEvents, 'raw session lifecycle events').length !== expected.lifecycleRows || list(session.episodes, 'raw session episodes').length !== READINESS_CONTRACT.rows.episodes || list(session.findings, 'raw session findings').length !== READINESS_CONTRACT.rows.findings) throw new ContractViolation(`${mode} raw session rows changed`);

  const canvas = session.canvases[0];
  shape(canvas, READINESS_CONTRACT.keys.canvas, 'raw session canvas');
  if (canvas.canvasId !== 'ritual-canvas#1' || canvas.nearestReactOwner !== 'yA' || canvas.attributionKind !== 'jsx-owner' || canvas.sourceLocation !== null || canvas.activeWindowCount !== 8 || canvas.rasterOperationCount !== rasterOperationCount || canvas.evidenceLevel !== 'measured') throw new ContractViolation(`${mode} demo canvas truth changed`);
  validateMethodEvidence(canvas.methodEvidence, methodCounts, 'raw session canvas methods');
  fixed(canvas.commandStatuses, expected.commandStatuses, 'raw session command statuses');

  const firstWindowIndex = session.windows[0]?.windowIndex;
  if (!Number.isInteger(firstWindowIndex) || firstWindowIndex < 1) throw new ContractViolation(`${mode} window identity changed`);
  for (const [index, window] of session.windows.entries()) {
    shape(window, READINESS_CONTRACT.keys.window, 'raw session window');
    const baselineFirst = mode === 'baseline' && index === 0;
    const changed = mode === 'candidate' ? index === 0 : index === 1;
    const signatureStatus = baselineFirst ? 'unknown' : changed ? 'changed' : 'same';
    const comparisonGap = baselineFirst ? null : mode === 'candidate' && index === 0 ? window.comparisonGap : 1;
    if (window.canvasId !== canvas.canvasId || window.nearestReactOwner !== canvas.nearestReactOwner || window.attributionKind !== canvas.attributionKind || window.sourceLocation !== null || window.rasterOperationCount !== expected.drawsPerFrame + 1 || window.signatureStatus !== signatureStatus || window.unknownReason !== (baselineFirst ? 'first-window' : null) || window.sampled !== false || window.comparisonGap !== comparisonGap || (mode === 'candidate' && index === 0 && (!Number.isInteger(window.comparisonGap) || window.comparisonGap < 2)) || window.windowIndex !== firstWindowIndex + index || !finite(window.timestampMs) || !finite(window.startedAtTimestampMs) || window.endedAtTimestampMs !== window.timestampMs || window.endedAtTimestampMs < window.startedAtTimestampMs) throw new ContractViolation(`${mode} window truth changed`);
    validateMethodEvidence(window.methodEvidence, windowMethodCounts, 'raw session window methods');
    if (!sameNumber(window.canvasApiSelfTimeMs, window.methodEvidence.clearRect.canvasApiSelfTimeMs + window.methodEvidence.fillRect.canvasApiSelfTimeMs)) throw new ContractViolation(`${mode} window timing changed`);
    fixed(window.geometry, READINESS_CONTRACT.fixed.geometry, 'raw session window geometry');
    if (index > 0 && (window.startedAtTimestampMs !== session.windows[index - 1].endedAtTimestampMs || window.timestampMs <= session.windows[index - 1].timestampMs)) throw new ContractViolation(`${mode} window order changed`);
  }
  if (session.windows[7].endedAtTimestampMs - session.windows[0].startedAtTimestampMs > session.durationMs + 0.001) throw new ContractViolation(`${mode} window duration changed`);

  if (!sameNumber(canvas.canvasApiSelfTimeMs, session.windows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)) || !sameNumber(canvas.maxWindowSelfTimeMs, Math.max(...session.windows.map(window => window.canvasApiSelfTimeMs)))) throw new ContractViolation(`${mode} canvas timing changed`);
  for (const name of ['clearRect', 'fillRect']) if (!sameNumber(canvas.methodEvidence[name].canvasApiSelfTimeMs, session.windows.reduce((total, window) => total + window.methodEvidence[name].canvasApiSelfTimeMs, 0))) throw new ContractViolation(`${mode} method timing changed`);

  if (mode === 'baseline') {
    const lifecycle = session.lifecycleEvents[0];
    shape(lifecycle, READINESS_CONTRACT.keys.lifecycle, 'raw session lifecycle event');
    fixed(lifecycle, { canvasId: canvas.canvasId, type: 'active', windowIndex: firstWindowIndex, timestampMs: session.windows[0].timestampMs, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }, 'raw session lifecycle event');
  }

  const episode = session.episodes[0];
  shape(episode, READINESS_CONTRACT.keys.episode, 'raw session episode');
  if (episode.episodeId !== `${session.sessionId}:episode:1` || episode.firstWindowIndex !== firstWindowIndex || episode.lastWindowIndex !== firstWindowIndex + 7 || episode.startedAtTimestampMs !== session.windows[0].startedAtTimestampMs || episode.endedAtTimestampMs !== session.windows[7].endedAtTimestampMs || episode.activeWindowCount !== 8 || episode.rasterOperationCount !== canvas.rasterOperationCount || !sameNumber(episode.canvasApiSelfTimeMs, canvas.canvasApiSelfTimeMs) || episode.resetEventCount !== 0 || list(episode.canvases, 'raw session episode canvases').length !== 1) throw new ContractViolation(`${mode} episode truth changed`);
  validateMethodEvidence(episode.methodEvidence, methodCounts, 'raw session episode methods');
  const episodeCanvas = episode.canvases[0];
  shape(episodeCanvas, READINESS_CONTRACT.keys.episodeCanvas, 'raw session episode canvas');
  fixed(episodeCanvas, { canvasId: canvas.canvasId, activeWindowCount: 8, rasterOperationCount: canvas.rasterOperationCount, canvasApiSelfTimeMs: canvas.canvasApiSelfTimeMs, maxWindowSelfTimeMs: canvas.maxWindowSelfTimeMs, methodEvidence: canvas.methodEvidence, resetEventCount: 0 }, 'raw session episode canvas');
  for (const name of ['clearRect', 'fillRect', 'fillStyle']) if (JSON.stringify(episode.methodEvidence[name]) !== JSON.stringify(canvas.methodEvidence[name])) throw new ContractViolation(`${mode} episode method truth changed`);

  validateBrowserEntries(session.browserEntries);
  const expectedAssociations = session.browserEntries.flatMap(entry => entry.startedAtTimestampMs > episode.endedAtTimestampMs || episode.startedAtTimestampMs > entry.endedAtTimestampMs ? [] : [{ entryId: entry.entryId, entryKind: entry.kind, episodeId: episode.episodeId, startedAtTimestampMs: Math.max(entry.startedAtTimestampMs, episode.startedAtTimestampMs), endedAtTimestampMs: Math.min(entry.endedAtTimestampMs, episode.endedAtTimestampMs), evidenceLevel: 'associated' }]);
  if (list(session.episodeAssociations, 'raw session associations').length !== expectedAssociations.length) throw new ContractViolation(`${mode} association rows changed`);
  for (const [index, association] of session.episodeAssociations.entries()) {
    shape(association, READINESS_CONTRACT.keys.association, 'raw session association');
    fixed(association, expectedAssociations[index], 'raw session association');
  }

  const selected = selectedRepeated(session, findingIndex);
  const finding = selected.finding;
  shape(finding, READINESS_CONTRACT.keys.finding, 'raw repeated finding');
  const repeated = session.windows.filter(window => window.signatureStatus === 'same');
  if (findingIndex !== 0 || finding.type !== 'repeated-draw-work' || finding.evidenceLevel !== 'candidate' || finding.canvasId !== canvas.canvasId || finding.episodeId !== episode.episodeId || finding.repeatedWindowCount !== repeated.length || list(finding.repeatedWindows, 'raw repeated windows').length !== repeated.length || finding.rasterOperationCount !== repeated.reduce((total, window) => total + window.rasterOperationCount, 0) || !sameNumber(finding.canvasApiSelfTimeMs, repeated.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)) || finding.nextCheck !== READINESS_CONTRACT.fixed.nextCheck) throw new ContractViolation(`${mode} repeated finding truth changed`);
  fixed(finding.claimBoundary, READINESS_CONTRACT.fixed.claimBoundary, 'raw repeated finding claim boundary');
  fixed(finding.unknownCoverage, { unknownWindowCount: session.windows.filter(window => window.signatureStatus === 'unknown').length, activeWindowCount: 8 }, 'raw repeated finding coverage');
  for (const [index, repeatedWindow] of finding.repeatedWindows.entries()) {
    shape(repeatedWindow, READINESS_CONTRACT.keys.repeatedWindow, 'raw repeated window');
    fixed(repeatedWindow, { windowIndex: repeated[index].windowIndex, timestampMs: repeated[index].timestampMs, rasterOperationCount: repeated[index].rasterOperationCount, canvasApiSelfTimeMs: repeated[index].canvasApiSelfTimeMs, comparisonGap: repeated[index].comparisonGap }, 'raw repeated window');
  }
  return selected;
}

function validateComparisonMeasures(measures, baseline, candidate, drawCounts) {
  if (!Array.isArray(measures) || JSON.stringify(measures.map(item => item.id)) !== JSON.stringify(comparisonMeasureIds)) throw new ContractViolation('copied comparison measure IDs changed');
  const structural = new Map([
    ['active-window-count', [8, 8]], ['raster-operation-count', [drawCounts.baseline.clearRect + drawCounts.baseline.fillRect, drawCounts.candidate.clearRect + drawCounts.candidate.fillRect]],
    ['method:clearRect:operation-count', [drawCounts.baseline.clearRect, drawCounts.candidate.clearRect]], ['method:fillRect:operation-count', [drawCounts.baseline.fillRect, drawCounts.candidate.fillRect]], ['method:fillStyle:operation-count', [8, 8]],
    ['unknown-command-window-count', [baseline.finding.unknownCoverage.unknownWindowCount, candidate.finding.unknownCoverage.unknownWindowCount]], ['repeated-window-count', [baseline.finding.repeatedWindowCount, candidate.finding.repeatedWindowCount]], ['repeated-raster-operation-count', [baseline.finding.rasterOperationCount, candidate.finding.rasterOperationCount]], ['comparison-gap-count', [0, 0]],
  ]);
  const timing = new Map([
    ['canvas-api-self-time-ms', [baseline.canvas.canvasApiSelfTimeMs, candidate.canvas.canvasApiSelfTimeMs]],
    ['maximum-window-self-time-ms', [baseline.canvas.maxWindowSelfTimeMs, candidate.canvas.maxWindowSelfTimeMs]],
    ['method:clearRect:self-time-ms', [baseline.canvas.methodEvidence.clearRect.canvasApiSelfTimeMs, candidate.canvas.methodEvidence.clearRect.canvasApiSelfTimeMs]],
    ['method:fillRect:self-time-ms', [baseline.canvas.methodEvidence.fillRect.canvasApiSelfTimeMs, candidate.canvas.methodEvidence.fillRect.canvasApiSelfTimeMs]],
    ['method:fillStyle:self-time-ms', [baseline.canvas.methodEvidence.fillStyle.canvasApiSelfTimeMs, candidate.canvas.methodEvidence.fillStyle.canvasApiSelfTimeMs]],
  ]);
  for (const item of measures) {
    if (!exact(item, READINESS_CONTRACT.keys.measure)) throw new ContractViolation('copied comparison measure shape changed');
    const expected = structural.get(item.id);
    if (expected) {
      if (JSON.stringify(item) !== JSON.stringify(measure(item.id, 'count', expected[0], expected[1]))) throw new ContractViolation(`copied comparison ${item.id} truth changed`);
      continue;
    }
    const expectedTiming = timing.get(item.id);
    if (!expectedTiming || JSON.stringify(item) !== JSON.stringify(measure(item.id, 'ms', expectedTiming[0], expectedTiming[1]))) throw new ContractViolation(`copied comparison ${item.id} timing changed`);
  }
}

export function validateCopiedExplanation(artifact, selection) {
  shape(artifact, READINESS_CONTRACT.keys.explanation, 'copied explanation root');
  for (const [key, value] of Object.entries(READINESS_CONTRACT.fixed.explanation)) if (artifact[key] !== value) throw new ContractViolation('copied explanation root value changed');
  const explanationIdentity = artifact.explanationId?.match(/^canvas-scan-explanation-(\d+)-(\d+)$/);
  const followUpIdentity = artifact.followUp?.sessionId?.match(/^canvas-scan-(\d+)-(\d+)$/);
  const startedAtMs = Date.parse(artifact.startedAt);
  const endedAtMs = Date.parse(artifact.endedAt);
  const explanationEpochOffset = Number(explanationIdentity?.[1]) - startedAtMs;
  if (!explanationIdentity || !followUpIdentity || !isoDate(artifact.startedAt) || !isoDate(artifact.endedAt) || !READINESS_CONTRACT.identities.explanationEpochOffsetsMs.includes(explanationEpochOffset) || Number(followUpIdentity[1]) !== startedAtMs || Number(explanationIdentity[2]) < 1 || Number(followUpIdentity[2]) < 1 || endedAtMs < startedAtMs || !finite(artifact.durationMs) || Math.abs(endedAtMs - startedAtMs - artifact.durationMs) > READINESS_CONTRACT.identities.wallClockDurationToleranceMs) throw new ContractViolation('copied explanation identity changed');
  if (!exact(artifact.source, READINESS_CONTRACT.keys.explanationSource) || artifact.source.sessionId !== selection.sessionId || artifact.source.findingIndex !== selection.findingIndex || artifact.source.findingType !== selection.findingType || artifact.source.canvasId !== 'ritual-canvas#1') throw new ContractViolation('copied explanation selection changed');
  if (!exact(artifact.followUp, READINESS_CONTRACT.keys.explanationFollowUp) || !/^canvas-scan-\d+-\d+$/.test(artifact.followUp.sessionId) || artifact.followUp.sessionId === artifact.source.sessionId || artifact.followUp.canvasId !== artifact.source.canvasId) throw new ContractViolation('copied explanation follow-up changed');

  const windows = list(artifact.windows, 'copied explanation windows');
  if (windows.length !== READINESS_CONTRACT.rows.explanationWindows) throw new ContractViolation('copied explanation window rows changed');
  const namespace = windows[0]?.commands?.[0]?.arguments?.[0]?.token?.match(/^([0-9a-f]{32})-1$/)?.[1];
  if (!namespace) throw new ContractViolation('copied explanation token namespace changed');
  const firstWindowIndex = windows[0]?.windowIndex;
  if (!Number.isInteger(firstWindowIndex) || firstWindowIndex < 1) throw new ContractViolation('copied explanation window identity changed');
  for (const [windowOffset, window] of windows.entries()) {
    shape(window, READINESS_CONTRACT.keys.explanationWindow, 'copied explanation window');
    if (window.windowIndex !== firstWindowIndex + windowOffset || !finite(window.timestampMs) || window.complete !== (windowOffset > 0) || window.unknownReason !== (windowOffset === 0 ? 'sampling-gap' : null)) throw new ContractViolation('copied explanation window truth changed');
    if (windowOffset > 0 && window.timestampMs <= windows[windowOffset - 1].timestampMs) throw new ContractViolation('copied explanation window order changed');
    const commands = list(window.commands, 'copied explanation commands');
    if (commands.length !== READINESS_CONTRACT.commandRows.length) throw new ContractViolation('copied explanation command rows changed');
    for (const [commandIndex, command] of commands.entries()) validateCommand(command, READINESS_CONTRACT.commandRows[commandIndex], commandIndex, namespace, 'copied explanation command');
  }

  const comparisons = list(artifact.comparisons, 'copied explanation comparisons');
  if (comparisons.length !== READINESS_CONTRACT.rows.explanationComparisons) throw new ContractViolation('copied explanation comparison rows changed');
  for (const [index, comparison] of comparisons.entries()) {
    shape(comparison, READINESS_CONTRACT.keys.explanationComparison, 'copied explanation comparison');
    const reference = windows[index];
    const target = windows[index + 1];
    const comparisonIsSame = JSON.stringify(reference.commands) === JSON.stringify(target.commands);
    const expected = index === 0
      ? { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: 'unknown', difference: null, unknownReason: 'sampling-gap' }
      : { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: comparisonIsSame ? 'same' : 'changed', difference: null, unknownReason: null };
    if (!comparisonIsSame || JSON.stringify(comparison) !== JSON.stringify(expected)) throw new ContractViolation('copied explanation comparison truth changed');
  }
  if (artifact.firstDifference !== null) throw new ContractViolation('copied explanation first difference changed');

  const stacks = list(artifact.stacks, 'copied explanation stacks');
  if (stacks.length !== READINESS_CONTRACT.rows.explanationStacks) throw new ContractViolation('copied explanation stack rows changed');
  const stack = stacks[0];
  shape(stack, READINESS_CONTRACT.keys.stack, 'copied explanation stack');
  if (stack.windowIndex !== firstWindowIndex || stack.commandOrdinal !== 0 || stack.reason !== 'first-raster' || stack.droppedFrameCount !== 0 || !Array.isArray(stack.frames) || stack.frames.length !== READINESS_CONTRACT.stackFrames.length) throw new ContractViolation('copied explanation stack truth changed');
  for (const [index, frame] of stack.frames.entries()) validateStackFrame(frame, READINESS_CONTRACT.stackFrames[index]);

  fixed(artifact.collectionLimits, READINESS_CONTRACT.fixed.explanationLimits, 'copied explanation collection limits');
  fixed(artifact.droppedEntryCounts, READINESS_CONTRACT.fixed.explanationDropped, 'copied explanation dropped counts');
  const limits = list(artifact.limitResults, 'copied explanation limit results');
  if (limits.length !== READINESS_CONTRACT.explanationLimitRows.length) throw new ContractViolation('copied explanation limit result rows changed');
  for (const [index, result] of limits.entries()) {
    shape(result, READINESS_CONTRACT.keys.limitResult, 'copied explanation limit result');
    const [name, maximumKey] = READINESS_CONTRACT.explanationLimitRows[index];
    fixed(result, { name, maximum: READINESS_CONTRACT.fixed.explanationLimits[maximumKey], rejectedCount: 0, reason: null, firstAffected: null }, 'copied explanation limit result');
  }
  fixed(artifact.callsiteCoverage, { status: 'complete', incompleteReasons: [] }, 'copied explanation callsite coverage');
  fixed(artifact.firstGap, { windowIndex: firstWindowIndex, commandOrdinal: 0, reason: 'sampling-gap' }, 'copied explanation first gap');
  return true;
}

export function validateCopiedComparison(artifact, baselineSession, candidateSession, pairing, drawCounts) {
  const expectedId = `canvas-scan-comparison-${baselineSession?.sessionId}-${pairing.baselineFindingIndex}-${candidateSession?.sessionId}-${pairing.candidateFindingIndex}`;
  const expectedCreatedAt = Date.parse(baselineSession?.endedAt) >= Date.parse(candidateSession?.endedAt) ? baselineSession?.endedAt : candidateSession?.endedAt;
  if (!exact(artifact, READINESS_CONTRACT.keys.copiedComparison) || Object.entries(READINESS_CONTRACT.fixed.copiedComparison).some(([key, value]) => artifact[key] !== value) || artifact.comparisonId !== expectedId || artifact.createdAt !== expectedCreatedAt || !Array.isArray(artifact.incomparableReasons) || artifact.incomparableReasons.length !== 0) throw new ContractViolation('copied comparison root changed');
  validateBrowserDrawCounts(drawCounts);
  const left = validateDemoSession(baselineSession, pairing.baselineFindingIndex, 'baseline', drawCounts.baseline);
  const right = validateDemoSession(candidateSession, pairing.candidateFindingIndex, 'candidate', drawCounts.candidate);
  const refKeys = READINESS_CONTRACT.keys.comparisonReference;
  if (!exact(artifact.baseline, refKeys) || artifact.baseline.sessionId !== baselineSession.sessionId || artifact.baseline.findingIndex !== pairing.baselineFindingIndex || artifact.baseline.findingType !== left.finding.type || artifact.baseline.canvasId !== left.finding.canvasId) throw new ContractViolation('copied comparison baseline changed');
  if (!exact(artifact.candidate, refKeys) || artifact.candidate.sessionId !== candidateSession.sessionId || artifact.candidate.findingIndex !== pairing.candidateFindingIndex || artifact.candidate.findingType !== right.finding.type || artifact.candidate.canvasId !== right.finding.canvasId) throw new ContractViolation('copied comparison candidate changed');
  validateComparisonMeasures(artifact.measures, left, right, drawCounts);
  return true;
}

export function checkReadinessEvidence(value, expectedCandidate) {
  if (!exact(value, READINESS_CONTRACT.keys.readiness) || Object.entries(READINESS_CONTRACT.fixed.readiness).some(([key, expected]) => value[key] !== expected)) throw new ContractViolation('readiness evidence root changed');
  if (!expectedCandidate || value.gitSha !== expectedCandidate.gitSha || value.branch !== expectedCandidate.branch || value.packageVersion !== expectedCandidate.packageVersion || !/^[0-9a-f]{64}$/.test(value.tarballSha256) || !/^[0-9a-f]{64}$/.test(value.packedIifeSha256) || value.installedIifeSha256 !== value.packedIifeSha256 || !/^\d+\.\d+\.\d+\.\d+$/.test(value.browserVersion)) throw new ContractViolation('readiness candidate identity changed');
  if (value.earlyLoad !== true || value.cleanBefore !== true || value.cleanAfter !== true || JSON.stringify(value.publicMethods) !== JSON.stringify(RITUAL_METHODS) || JSON.stringify(value.actionIds) !== JSON.stringify(ACTION_IDS)) throw new ContractViolation('readiness ritual identity changed');
  checkRunStages(value.runStages, { requireComplete: true });
  if (JSON.stringify(value.runStages.slice(0, ACTION_IDS.length).map(row => row.id)) !== JSON.stringify(value.actionIds) || value.runStages.at(-1)?.id !== 'verify-run') throw new ContractViolation('readiness run stages changed');
  validateBrowserDrawCounts(value.browserDrawCounts);

  const findingKeys = READINESS_CONTRACT.keys.readinessFinding;
  if (!exact(value.baseline, findingKeys) || !exact(value.candidate, findingKeys) || !text(value.baseline.sessionId) || !text(value.candidate.sessionId) || value.baseline.sessionId === value.candidate.sessionId || !Number.isInteger(value.baseline.findingIndex) || !Number.isInteger(value.candidate.findingIndex) || value.baseline.findingType !== 'repeated-draw-work' || value.candidate.findingType !== value.baseline.findingType) throw new ContractViolation('readiness selected findings changed');

  const explanationKeys = READINESS_CONTRACT.keys.readinessExplanation;
  if (!exact(value.explanation, explanationKeys) || value.explanation.sourceSessionId !== value.baseline.sessionId || value.explanation.sourceFindingIndex !== value.baseline.findingIndex || !text(value.explanation.followUpSessionId) || value.explanation.stopReason !== 'manual') throw new ContractViolation('readiness explanation changed');

  const comparisonKeys = READINESS_CONTRACT.keys.readinessComparison;
  if (!exact(value.comparison, comparisonKeys) || value.comparison.pairingMethod !== 'user-selected' || value.comparison.status !== 'comparable' || value.comparison.improvementEstablished !== false || value.comparison.baselineSessionId !== value.baseline.sessionId || value.comparison.baselineFindingIndex !== value.baseline.findingIndex || value.comparison.candidateSessionId !== value.candidate.sessionId || value.comparison.candidateFindingIndex !== value.candidate.findingIndex) throw new ContractViolation('readiness explicit comparison changed');
  if (!exact(value.artifacts, READINESS_CONTRACT.keys.artifacts) || value.artifacts.baselineSession.sessionId !== value.baseline.sessionId || value.artifacts.candidateSession.sessionId !== value.candidate.sessionId) throw new ContractViolation('readiness raw artifacts changed');
  validateCopiedExplanation(value.artifacts.copiedExplanation, value.baseline);
  if (value.artifacts.copiedExplanation.followUp.sessionId !== value.explanation.followUpSessionId) throw new ContractViolation('readiness explanation artifact changed');
  validateCopiedComparison(value.artifacts.copiedComparison, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: value.baseline.findingIndex, candidateFindingIndex: value.candidate.findingIndex }, value.browserDrawCounts);
  if (!exact(value.diagnostics, READINESS_CONTRACT.keys.diagnostics) || diagnosticKeys.some(key => !Array.isArray(value.diagnostics[key]) || value.diagnostics[key].length > 0) || !Array.isArray(value.failures) || value.failures.length > 0) throw new ContractViolation('readiness diagnostics changed');
  return true;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function runBytes(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}`);
  return result.stdout;
}

function readinessWorktreeStatus() {
  return run('git', ['status', '--short', '--untracked-files=all'], root);
}

async function currentCandidate() {
  return {
    gitSha: run('git', ['rev-parse', 'HEAD'], root).trim(),
    branch: run('git', ['branch', '--show-current'], root).trim(),
    packageVersion: JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8')).version,
  };
}

function listenerPids() {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error(`could not inspect readiness port\n${result.stderr}`);
  return [...new Set(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
}

function processGroupId(pid) {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`could not inspect process group ${pid}\n${result.stderr}`);
  return Number(result.stdout.trim());
}

export function serverOwnsReadinessPort(server, listeners = listenerPids(), groupFor = processGroupId) {
  if (!server?.pid || listeners.length !== 1) return false;
  const serverGroup = groupFor(server.pid);
  return Number.isInteger(serverGroup) && listeners.every(pid => groupFor(pid) === serverGroup);
}

export async function waitForOwnedServer(server, ownershipToken, serverOrigin = origin, timeoutMs = 60_000, retryMs = 200, ownsPort = serverOwnsReadinessPort, fetcher = fetch) {
  for (let end = Date.now() + timeoutMs; Date.now() < end; await new Promise(resolve => setTimeout(resolve, retryMs))) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('clean consumer server exited before readiness');
    try {
      const response = await fetcher(`${serverOrigin}/readiness-owner.txt?token=${ownershipToken}`, { cache: 'no-store' });
      if (response.ok && (await response.text()) === ownershipToken && ownsPort(server)) return;
    } catch {}
  }
  throw new Error('clean consumer server did not prove ownership');
}

async function stopServer(server) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (server.exitCode === null && server.signalCode === null) throw new Error('clean consumer server did not stop');
}

export async function collectCleanupErrors(diagnostics, tasks) {
  for (const [label, cleanup] of tasks) {
    try { await cleanup(); }
    catch (error) { diagnostics.cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function replay(page) {
  const action = page.locator('[data-demo-action="replay-interaction"]');
  await action.click();
  await page.waitForFunction(() => !document.querySelector('[data-demo-action="replay-interaction"]')?.disabled);
  await settle(page);
}

async function expandFinding(page, findingIndex) {
  const card = page.locator('.finding-card').nth(findingIndex);
  const toggle = card.locator('.finding-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await settle(page);
}

async function record(page) {
  await page.locator('[aria-label="Record investigation"]').click();
  await replay(page);
  await page.locator('[aria-label="Stop recording"]').click();
  await page.waitForFunction(() => window.__CANVAS_SCAN__.getLastSession()?.stopReason === 'manual');
  await settle(page);
  return page.evaluate(() => window.__CANVAS_SCAN__.getLastSession());
}

async function installDrawCounter(page, counts) {
  await page.exposeFunction('sidproj105CountDraw', name => { counts[name]++; });
  await page.evaluate(() => {
    const context = document.querySelector('#ritual-canvas').getContext('2d');
    const pending = [];
    for (const name of ['clearRect', 'fillRect']) {
      const original = context[name];
      Object.defineProperty(context, name, { configurable: true, value(...args) { pending.push(globalThis.sidproj105CountDraw(name)); return original.apply(this, args); } });
    }
    Object.defineProperty(context, Symbol.for('sidproj105.drawCounter'), { value: { async flush() { await Promise.all(pending.splice(0)); } } });
  });
}

async function readDrawCounter(page, counts) {
  await page.evaluate(() => document.querySelector('#ritual-canvas').getContext('2d')[Symbol.for('sidproj105.drawCounter')].flush());
  return { clearRect: counts.clearRect, fillRect: counts.fillRect };
}

async function runBrowser(consumer, diagnostics, ownershipToken, runState) {
  let server;
  let browser;
  const actionIds = [];
  const counts = { clearRect: 0, fillRect: 0 };
  const result = { browserVersion: '', earlyLoad: false, publicMethods: [], actionIds, browserDrawCounts: { baseline: null, candidate: null }, baseline: null, explanation: null, candidate: null, comparison: null, artifacts: { baselineSession: null, candidateSession: null, copiedExplanation: null, copiedComparison: null } };
  try {
    try { await access('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'); }
    catch { reduceRunState(runState, { type: 'stage-unavailable', id: 'early-load', reason: 'browser-unavailable' }); throw new Error('local Chrome is unavailable'); }
    if (listenerPids().length) throw new Error(`readiness port ${port} already has a listener`);
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: consumer, detached: true, stdio: 'ignore' });
    await waitForOwnedServer(server, ownershipToken);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    result.browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'warning') diagnostics.warnings.push(message.text()); if (message.type() === 'error') diagnostics.errors.push(message.text()); });
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
    page.on('requestfailed', request => diagnostics.requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_SCAN__ && document.querySelector('[data-demo-action="replay-interaction"]'));
    await settle(page);

    result.earlyLoad = await page.evaluate(() => Boolean(window.__CANVAS_SCAN__));
    result.publicMethods = await page.evaluate(methods => methods.filter(method => typeof window.__CANVAS_SCAN__?.[method] === 'function'), RITUAL_METHODS);
    if (!result.earlyLoad || JSON.stringify(result.publicMethods) !== JSON.stringify(RITUAL_METHODS)) throw new Error('readiness public methods changed');
    const browserSupport = await page.evaluate(() => ({ eventTiming: PerformanceObserver.supportedEntryTypes.includes('event'), longAnimationFrames: PerformanceObserver.supportedEntryTypes.includes('long-animation-frame') }));
    await installDrawCounter(page, counts);
    reduceRunState(runState, { type: 'browser-support', rows: [{ id: 'canvas-2d', status: 'supported', reason: null }, { id: 'monotonic-time', status: 'supported', reason: null }, { id: 'event-timing', status: browserSupport.eventTiming ? 'supported' : 'unavailable', reason: browserSupport.eventTiming ? null : 'browser-feature-unavailable' }, { id: 'long-animation-frames', status: browserSupport.longAnimationFrames ? 'supported' : 'unavailable', reason: browserSupport.longAnimationFrames ? null : 'browser-feature-unavailable' }] });
    actionIds.push('early-load'); reduceRunState(runState, { type: 'stage-complete', id: 'early-load' });
    const baselineSession = await record(page);
    result.browserDrawCounts.baseline = await readDrawCounter(page, counts);
    const baselineFindingIndex = baselineSession.findings.findIndex(finding => finding.type === 'repeated-draw-work');
    if (baselineFindingIndex < 0) throw new Error('clean demo baseline has no repeated-draw-work finding');
    result.baseline = { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type };
    result.artifacts.baselineSession = baselineSession;
    actionIds.push('record-baseline'); reduceRunState(runState, { type: 'stage-complete', id: 'record-baseline' });
    await expandFinding(page, baselineFindingIndex);
    await page.locator(`.explanation-action[data-finding-index="${baselineFindingIndex}"]`).click();
    await replay(page);
    await page.locator('[aria-label="Stop recording"]').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-panel')?.textContent?.includes('EXPLANATION COMPLETE'));
    await settle(page);
    actionIds.push('explain-baseline'); reduceRunState(runState, { type: 'stage-complete', id: 'explain-baseline' });
    const copiedExplanation = await runExportStage('copy-explanation', {
      click: () => page.locator('.explanation-copy').click(),
      confirm: () => page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-copy-status')?.textContent === 'Explanation JSON copied'),
      read: () => page.evaluate(() => navigator.clipboard.readText()),
      parse: value => JSON.parse(value),
      validate: value => validateCopiedExplanation(value, { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type }),
    });
    result.explanation = { sourceSessionId: copiedExplanation.source.sessionId, sourceFindingIndex: copiedExplanation.source.findingIndex, followUpSessionId: copiedExplanation.followUp.sessionId, stopReason: copiedExplanation.stopReason };
    result.artifacts.copiedExplanation = copiedExplanation;
    actionIds.push('copy-explanation'); reduceRunState(runState, { type: 'stage-complete', id: 'copy-explanation' });
    await page.locator(`.baseline-action[data-finding-index="${baselineFindingIndex}"]`).click();
    actionIds.push('keep-baseline'); reduceRunState(runState, { type: 'stage-complete', id: 'keep-baseline' });
    await page.locator('[data-demo-action="apply-candidate-change"]').click();
    await page.waitForFunction(() => document.querySelector('[data-demo-action="apply-candidate-change"]')?.textContent?.includes('Candidate change applied'));
    actionIds.push('apply-change'); reduceRunState(runState, { type: 'stage-complete', id: 'apply-change' });
    await readDrawCounter(page, counts);
    counts.clearRect = 0;
    counts.fillRect = 0;
    const candidateSession = await record(page);
    result.browserDrawCounts.candidate = await readDrawCounter(page, counts);
    const candidateFindingIndex = candidateSession.findings.findIndex(finding => finding.type === baselineSession.findings[baselineFindingIndex].type);
    if (candidateFindingIndex < 0) throw new Error('clean demo candidate has no same-type finding');
    result.candidate = { sessionId: candidateSession.sessionId, findingIndex: candidateFindingIndex, findingType: candidateSession.findings[candidateFindingIndex].type };
    result.artifacts.candidateSession = candidateSession;
    actionIds.push('record-candidate'); reduceRunState(runState, { type: 'stage-complete', id: 'record-candidate' });
    await expandFinding(page, candidateFindingIndex);
    const comparisonAction = page.locator(`.comparison-action[data-finding-index="${candidateFindingIndex}"]`);
    await comparisonAction.waitFor({ state: 'visible' });
    await comparisonAction.click();
    actionIds.push('pair-findings'); reduceRunState(runState, { type: 'stage-complete', id: 'pair-findings' });
    const copiedComparison = await runExportStage('copy-comparison', {
      click: () => page.locator('.comparison-copy').click(),
      confirm: () => page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.comparison-copy-status')?.textContent === 'Comparison JSON copied'),
      read: () => page.evaluate(() => navigator.clipboard.readText()),
      parse: value => JSON.parse(value),
      validate: value => validateCopiedComparison(value, baselineSession, candidateSession, { baselineFindingIndex, candidateFindingIndex }, result.browserDrawCounts),
    });
    result.comparison = { pairingMethod: copiedComparison.pairingMethod, status: copiedComparison.status, improvementEstablished: copiedComparison.improvementEstablished, baselineSessionId: copiedComparison.baseline.sessionId, baselineFindingIndex: copiedComparison.baseline.findingIndex, candidateSessionId: copiedComparison.candidate.sessionId, candidateFindingIndex: copiedComparison.candidate.findingIndex };
    result.artifacts.copiedComparison = copiedComparison;
    actionIds.push('copy-comparison'); reduceRunState(runState, { type: 'stage-complete', id: 'copy-comparison' });
    await context.close();
    return result;
  } catch (error) {
    const classified = classifyStageFailure(runState.runStages, error);
    if (classified) reduceRunState(runState, { type: 'stage-failed', id: classified.id, reason: classified.reason });
    if (error && typeof error === 'object') error.browserResult = result;
    throw error;
  } finally {
    await collectCleanupErrors(diagnostics, [
      ['browser-close', async () => browser?.close()],
      ['server-stop', async () => stopServer(server)],
      ['server-port-release', async () => { if (listenerPids().length) throw new Error(`readiness port ${port} still has a listener`); }],
    ]);
  }
}

export async function checkDirectory(directory, expectedCandidate, checkEvidence = checkReadinessEvidence) {
  const expected = expectedCandidate ?? await currentCandidate();
  const reportPath = path.join(directory, 'run-report.json');
  const reportStat = await lstat(reportPath);
  if (!reportStat.isFile() || reportStat.isSymbolicLink()) throw new Error('readiness report file changed');
  const reportBytes = await readFile(reportPath);
  const report = JSON.parse(reportBytes);
  if (!reportBytes.equals(Buffer.from(stable(report)))) throw new Error('readiness report encoding changed');
  const declared = new Set(['run-report.json']);
  for (const artifact of report.artifacts ?? []) if (artifact.sha256 !== null) declared.add(artifact.path);
  if (!(report.missingFiles ?? []).includes('evidence-sha256.txt')) declared.add('evidence-sha256.txt');
  const actual = [];
  async function visit(relative = '') {
    for (const name of await readdir(path.join(directory, relative))) {
      const child = relative ? `${relative}/${name}` : name;
      const stat = await lstat(path.join(directory, child));
      if (stat.isSymbolicLink()) throw new Error('readiness evidence symlink changed');
      if (stat.isDirectory()) { if (child !== 'artifacts') throw new Error('readiness evidence directory changed'); await visit(child); }
      else if (stat.isFile()) actual.push(child); else throw new Error('readiness evidence entry changed');
    }
  }
  await visit();
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...declared].sort())) throw new Error('readiness evidence files changed');
  const files = {};
  for (const file of actual.filter(file => file !== 'run-report.json' && file !== 'evidence-sha256.txt')) {
    files[file] = await readFile(path.join(directory, file));
    const value = JSON.parse(files[file]);
    if (!files[file].equals(Buffer.from(stable(value)))) throw new Error('readiness artifact encoding changed');
  }
  const manifestPath = path.join(directory, 'evidence-sha256.txt');
  let manifestBytes = null;
  if (declared.has('evidence-sha256.txt')) {
    manifestBytes = await readFile(manifestPath);
    const manifestFiles = [...Object.keys(files), 'run-report.json'].sort();
    const expectedManifest = Buffer.from(`${manifestFiles.map(file => `${hash(file === 'run-report.json' ? reportBytes : files[file])}  ${file}`).join('\n')}\n`);
    if (!manifestBytes.equals(expectedManifest)) throw new Error('readiness evidence hash changed');
  }
  const evidence = files['evidence.json'] ? JSON.parse(files['evidence.json']) : null;
  if (evidence) checkEvidence(evidence, expected);
  return checkInvestigationRunReport(report, { candidate: expected, rawEvidence: evidence, files, manifestBytes });
}

async function main() {
  const checkIndex = process.argv.indexOf('--check-evidence');
  if (checkIndex >= 0) {
    await checkDirectory(process.argv[checkIndex + 1] || defaultDirectory);
    console.log('SIDPROJ_105_READINESS_CHECK: PASS');
    return;
  }

  const directoryIndex = process.argv.indexOf('--output');
  const directory = directoryIndex >= 0 ? process.argv[directoryIndex + 1] : defaultDirectory;
  try { await preflightInvestigationRunReport({ directory }); }
  catch { const output = terminalRunOutput(directory, null, true); process.stderr.write(output.stderr); process.exitCode = output.exitCode; return; }
  const runState = createRunState();
  const diagnostics = Object.fromEntries(diagnosticKeys.map(key => [key, []]));
  const failures = [];
  let candidate = { gitSha: null, branch: null, packageVersion: null };
  let cleanBefore = false;
  let temporaryRoot;
  let browserResult;
  let tarballSha256 = '';
  let packedIifeSha256 = '';
  let installedIifeSha256 = '';
  try {
    candidate = await currentCandidate();
    cleanBefore = readinessWorktreeStatus() === '';
    if (!cleanBefore) throw new Error('readiness requires a clean worktree');
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'canvas-scan-readiness-v05-'));
    const ownershipToken = hash(temporaryRoot);
    const packDirectory = path.join(temporaryRoot, 'pack');
    const consumer = path.join(temporaryRoot, 'consumer');
    await mkdir(packDirectory);
    await mkdir(path.join(consumer, 'src'), { recursive: true });
    run('pnpm', ['--filter', 'canvas-scan', 'pack', '--pack-destination', packDirectory], root);
    const tarballs = (await readdir(packDirectory)).filter(name => name.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new Error(`expected one readiness tarball, found ${tarballs.length}`);
    const tarball = path.join(packDirectory, tarballs[0]);
    tarballSha256 = hash(await readFile(tarball));
    packedIifeSha256 = hash(runBytes('tar', ['-xzOf', tarball, 'package/dist/canvas-scan.iife.js'], root));
    await writeFile(path.join(consumer, 'package.json'), stable({ private: true, type: 'module' }));
    await copyFile(path.join(root, 'apps/demo/index.html'), path.join(consumer, 'index.html'));
    await copyFile(path.join(root, 'apps/demo/vite.config.ts'), path.join(consumer, 'vite.config.ts'));
    await copyFile(path.join(root, 'apps/demo/src/App.tsx'), path.join(consumer, 'src/App.tsx'));
    await copyFile(path.join(root, 'apps/demo/src/main.tsx'), path.join(consumer, 'src/main.tsx'));
    run('npm', ['install', '--no-audit', '--no-fund', '--cache', path.join(temporaryRoot, 'npm-cache'), tarball, 'react@^19', 'react-dom@^19', '@vitejs/plugin-react@^4', 'typescript@^5.7', 'vite@^6'], consumer);
    installedIifeSha256 = hash(await readFile(path.join(consumer, 'node_modules/canvas-scan/dist/canvas-scan.iife.js')));
    run('npx', ['vite', 'build'], consumer);
    await writeFile(path.join(consumer, 'dist/readiness-owner.txt'), ownershipToken);
    browserResult = await runBrowser(consumer, diagnostics, ownershipToken, runState);
  } catch (error) {
    if (error && typeof error === 'object' && error.browserResult) browserResult = error.browserResult;
    failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    await collectCleanupErrors(diagnostics, [['temporary-directory-remove', async () => { if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }); }]]);
  }

  let cleanAfter = false;
  try { cleanAfter = readinessWorktreeStatus() === ''; }
  catch { failures.push('git-status-failed'); }
  if (runState.runStages[0].status === 'incomplete') reduceRunState(runState, { type: 'stage-failed', id: 'early-load', reason: 'setup-failed' });
  const verificationReason = !cleanBefore || !cleanAfter ? 'dirty-worktree' : diagnostics.cleanupErrors.length ? 'cleanup-failed' : runState.runStages.slice(0, 9).every(row => row.status === 'complete') ? null : 'ritual-incomplete';
  const projectedState = structuredClone(runState);
  reduceRunState(projectedState, { type: 'verification-result', status: verificationReason ? 'failed' : 'complete', reason: verificationReason });
  const { gitSha, branch, packageVersion } = candidate;
  const evidence = {
    schemaVersion: 1,
    issue: 'SIDPROJ-105',
    status: readinessStatus(failures, diagnostics, [Boolean(browserResult), cleanAfter, packedIifeSha256 === installedIifeSha256]),
    gitSha,
    branch,
    packageVersion,
    tarballSha256,
    packedIifeSha256,
    installedIifeSha256,
    browserVersion: browserResult?.browserVersion ?? '',
    earlyLoad: browserResult?.earlyLoad ?? false,
    cleanBefore,
    cleanAfter,
    publicMethods: browserResult?.publicMethods ?? [],
    actionIds: browserResult?.actionIds ?? [],
    runStages: structuredClone(projectedState.runStages),
    browserDrawCounts: browserResult?.browserDrawCounts ?? null,
    baseline: browserResult?.baseline ?? null,
    explanation: browserResult?.explanation ?? null,
    candidate: browserResult?.candidate ?? null,
    comparison: browserResult?.comparison ?? null,
    artifacts: browserResult?.artifacts ?? null,
    diagnostics,
    failures,
  };
  const reportEvidence = evidence.status === 'PASS' ? evidence : null;
  const files = investigationArtifactBytes(reportEvidence);
  let finalization;
  try {
    finalization = await finalizeInvestigationRun({
      directory, state: runState, candidate, rawEvidence: reportEvidence, files, verificationReason,
      checkSnapshot(value, context) {
        checkInvestigationSnapshot(value, context);
        if (value.status === 'complete') checkReadinessEvidence(evidence, candidate);
      },
    });
  } catch {
    const output = terminalRunOutput(directory, null, true); process.stderr.write(output.stderr); process.exitCode = output.exitCode; return;
  }
  try { await checkDirectory(directory, candidate); }
  catch { const output = terminalRunOutput(directory, finalization.report, false, true); process.stderr.write(output.stderr); process.exitCode = output.exitCode; return; }
  const output = terminalRunOutput(directory, finalization.report);
  process.stdout.write(output.stdout); process.stderr.write(output.stderr); process.exitCode = output.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
