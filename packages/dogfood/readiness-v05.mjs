import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { RITUAL_METHODS } from '../../scripts/pack-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDirectory = '/private/tmp/sidproj-105-readiness-v05';
const port = 5211;
const origin = `http://127.0.0.1:${port}`;
export const ACTION_IDS = ['early-load', 'record-baseline', 'explain-baseline', 'copy-explanation', 'keep-baseline', 'apply-change', 'record-candidate', 'pair-findings', 'copy-comparison'];
const diagnosticKeys = ['warnings', 'errors', 'pageErrors', 'requestFailures', 'cleanupErrors'];
const demoTruth = {
  baseline: { activeWindowCount: 8, clearRects: 8, fillRects: 32, fillStyles: 8, repeatedWindowCounts: [6, 7], rasterOperationsPerRepeatedWindow: [4, 5] },
  candidate: { activeWindowCount: 8, clearRects: 8, fillRects: 16, fillStyles: 8, repeatedWindowCounts: [6, 7], rasterOperationsPerRepeatedWindow: [2, 3] },
};
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
const sessionKeys = ['schemaVersion', 'sessionId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'browserFeatures', 'canvases', 'windows', 'resetEvents', 'lifecycleEvents', 'episodes', 'browserEntries', 'episodeAssociations', 'findings', 'collectionLimits', 'droppedEntryCounts'];
const sessionLimitKeys = ['maxDurationMs', 'maxCanvasWindowReports', 'maxCanvasLifetimes', 'maxResetEvents', 'maxLifecycleEvents', 'maxBrowserEvidenceEntries', 'maxLongFrameScriptAttributions'];
const sessionDroppedKeys = ['canvasWindowReports', 'canvasLifetimes', 'resetEvents', 'lifecycleEvents', 'documentEvents', 'eventTiming', 'userMarks', 'longAnimationFrames'];
const explanationLimitNames = ['duration-ms', 'selected-canvases', 'active-windows', 'command-entries', 'arguments-per-command', 'value-tokens', 'stack-samples', 'frames-per-stack', 'source-map-lookups', 'source-map-response-bytes'];

function shape(value, keys, label) {
  if (!exact(value, keys)) throw new Error(`${label} shape changed`);
}

function list(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} shape changed`);
  return value;
}

function validateSourceLocation(value, label) {
  if (value === null) return;
  shape(value, ['file', 'line', 'column'], label);
  if (!text(value.file) || value.file.includes('?') || value.file.includes('#') || !Number.isInteger(value.line) || !Number.isInteger(value.column)) throw new Error(`${label} value changed`);
}

function validateMethodEvidence(value, label) {
  shape(value, ['clearRect', 'fillRect', 'fillStyle'], label);
  for (const name of ['clearRect', 'fillRect', 'fillStyle']) shape(value[name], ['count', 'canvasApiSelfTimeMs'], `${label}.${name}`);
}

function validateSessionSchema(session) {
  shape(session, sessionKeys, 'raw session root');
  shape(session.browserFeatures, ['monotonicTime', 'eventTiming', 'longAnimationFrames'], 'raw session browser features');
  shape(session.collectionLimits, sessionLimitKeys, 'raw session collection limits');
  shape(session.droppedEntryCounts, sessionDroppedKeys, 'raw session dropped counts');

  for (const canvas of list(session.canvases, 'raw session canvases')) {
    shape(canvas, ['canvasId', 'nearestReactOwner', 'attributionKind', 'sourceLocation', 'activeWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'maxWindowSelfTimeMs', 'evidenceLevel', 'methodEvidence', 'commandStatuses'], 'raw session canvas');
    validateSourceLocation(canvas.sourceLocation, 'raw session canvas source location');
    validateMethodEvidence(canvas.methodEvidence, 'raw session canvas methods');
    shape(canvas.commandStatuses, ['same', 'changed', 'unknown'], 'raw session command statuses');
  }
  for (const window of list(session.windows, 'raw session windows')) {
    shape(window, ['canvasId', 'nearestReactOwner', 'attributionKind', 'sourceLocation', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'signatureStatus', 'unknownReason', 'sampled', 'comparisonGap', 'methodEvidence', 'windowIndex', 'timestampMs', 'startedAtTimestampMs', 'endedAtTimestampMs', 'geometry'], 'raw session window');
    validateSourceLocation(window.sourceLocation, 'raw session window source location');
    validateMethodEvidence(window.methodEvidence, 'raw session window methods');
    shape(window.geometry, ['backingWidth', 'backingHeight', 'cssWidth', 'cssHeight', 'devicePixelRatio', 'expectedBackingWidth', 'expectedBackingHeight', 'expectedPixelArea', 'actualToExpectedAreaRatio', 'unavailableReason'], 'raw session window geometry');
  }
  for (const event of list(session.resetEvents, 'raw session reset events')) shape(event, ['canvasId', 'windowIndex', 'timestampMs', 'source', 'width', 'height', 'rasterOperationCount', 'activeRasterOverlap', 'commandStatus', 'unknownReason'], 'raw session reset event');
  for (const event of list(session.lifecycleEvents, 'raw session lifecycle events')) shape(event, ['canvasId', 'type', 'windowIndex', 'timestampMs', 'connected', 'activeRegistrySize', 'evidenceLevel'], 'raw session lifecycle event');
  for (const episode of list(session.episodes, 'raw session episodes')) {
    shape(episode, ['episodeId', 'firstWindowIndex', 'lastWindowIndex', 'startedAtTimestampMs', 'endedAtTimestampMs', 'activeWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'methodEvidence', 'canvases', 'resetEventCount'], 'raw session episode');
    validateMethodEvidence(episode.methodEvidence, 'raw session episode methods');
    for (const canvas of list(episode.canvases, 'raw session episode canvases')) {
      shape(canvas, ['canvasId', 'activeWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'maxWindowSelfTimeMs', 'methodEvidence', 'resetEventCount'], 'raw session episode canvas');
      validateMethodEvidence(canvas.methodEvidence, 'raw session episode canvas methods');
    }
  }
  for (const entry of list(session.browserEntries, 'raw session browser entries')) {
    if (entry?.kind === 'document-event') {
      shape(entry, ['entryId', 'kind', 'eventType', 'startedAtTimestampMs', 'endedAtTimestampMs', 'targetTagName'], 'raw document event');
      if (!['pointermove', 'pointerdown', 'pointerup'].includes(entry.eventType) || !['button', 'div'].includes(entry.targetTagName)) throw new Error('raw document event value changed');
    } else if (entry?.kind === 'event-timing') {
      shape(entry, ['entryId', 'kind', 'eventType', 'startedAtTimestampMs', 'endedAtTimestampMs', 'targetTagName', 'durationMs', 'interactionId'], 'raw event timing');
      if (!['pointerdown', 'pointerup'].includes(entry.eventType) || !['button', 'div'].includes(entry.targetTagName)) throw new Error('raw event timing value changed');
    }
    else if (entry?.kind === 'long-animation-frame') {
      shape(entry, ['entryId', 'kind', 'startedAtTimestampMs', 'endedAtTimestampMs', 'durationMs', 'blockingDurationMs', 'scripts', 'droppedScriptAttributionCount'], 'raw long animation frame');
      if (list(entry.scripts, 'raw long animation frame scripts').length) throw new Error('raw long animation frame script rows changed');
    } else throw new Error('raw browser entry kind changed');
  }
  for (const association of list(session.episodeAssociations, 'raw session associations')) shape(association, ['entryId', 'entryKind', 'episodeId', 'startedAtTimestampMs', 'endedAtTimestampMs', 'evidenceLevel'], 'raw session association');
  for (const finding of list(session.findings, 'raw session findings')) {
    if (finding?.type !== 'repeated-draw-work') throw new Error('raw session finding type changed');
    shape(finding, ['type', 'evidenceLevel', 'canvasId', 'episodeId', 'repeatedWindowCount', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'repeatedWindows', 'unknownCoverage', 'claimBoundary', 'nextCheck'], 'raw repeated finding');
    for (const window of list(finding.repeatedWindows, 'raw repeated windows')) shape(window, ['windowIndex', 'timestampMs', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'comparisonGap'], 'raw repeated window');
    shape(finding.unknownCoverage, ['unknownWindowCount', 'activeWindowCount'], 'raw repeated finding coverage');
    shape(finding.claimBoundary, ['observation', 'explanation', 'nonEstablishedFacts'], 'raw repeated finding claim boundary');
  }
}

function validateCommand(command, label, expectedOrdinal = command?.ordinal) {
  shape(command, ['ordinal', 'operationKind', 'name', 'argumentCount', 'arguments', 'unknownReason'], label);
  const argumentsList = list(command.arguments, `${label} arguments`);
  if (command.ordinal !== expectedOrdinal || !['call', 'set'].includes(command.operationKind) || !text(command.name) || command.argumentCount !== argumentsList.length) throw new Error(`${label} value changed`);
  for (const [index, argument] of argumentsList.entries()) {
    shape(argument, ['position', 'kind', 'token'], `${label} argument`);
    if (argument.position !== index || !['number', 'string', 'boolean', 'null', 'undefined', 'array', 'typed-array', 'image', 'canvas', 'path', 'gradient', 'pattern', 'object'].includes(argument.kind) || (argument.token !== null && !/^[0-9a-f]{32}-\d+$/.test(argument.token))) throw new Error(`${label} argument value changed`);
  }
}

function validateDifference(difference, label) {
  if (difference === null) return;
  shape(difference, ['referenceWindowIndex', 'targetWindowIndex', 'ordinal', 'reason', 'reference', 'target'], label);
  if (difference.reference !== null) validateCommand(difference.reference, `${label} reference`);
  if (difference.target !== null) validateCommand(difference.target, `${label} target`);
}

function validateExplanationSchema(artifact) {
  const keys = ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'limitResults', 'callsiteCoverage', 'firstGap'];
  shape(artifact, keys, 'copied explanation root');
  shape(artifact.source, ['sessionId', 'findingIndex', 'findingType', 'canvasId'], 'copied explanation source');
  shape(artifact.followUp, ['sessionId', 'canvasId'], 'copied explanation follow-up');
  for (const window of list(artifact.windows, 'copied explanation windows')) {
    shape(window, ['windowIndex', 'timestampMs', 'commands', 'complete', 'unknownReason'], 'copied explanation window');
    for (const [index, command] of list(window.commands, 'copied explanation commands').entries()) validateCommand(command, 'copied explanation command', index);
  }
  for (const comparison of list(artifact.comparisons, 'copied explanation comparisons')) {
    shape(comparison, ['referenceWindowIndex', 'targetWindowIndex', 'status', 'difference', 'unknownReason'], 'copied explanation comparison');
    validateDifference(comparison.difference, 'copied explanation difference');
  }
  validateDifference(artifact.firstDifference, 'copied explanation first difference');
  for (const stack of list(artifact.stacks, 'copied explanation stacks')) {
    shape(stack, ['windowIndex', 'commandOrdinal', 'reason', 'frames', 'droppedFrameCount'], 'copied explanation stack');
    for (const frame of list(stack.frames, 'copied explanation stack frames')) {
      shape(frame, ['functionName', 'generated', 'mapped', 'mappingStatus', 'unresolvedReason'], 'copied explanation stack frame');
      validateSourceLocation(frame.generated, 'copied explanation generated location');
      validateSourceLocation(frame.mapped, 'copied explanation mapped location');
    }
  }
  shape(artifact.collectionLimits, ['maxDurationMs', 'maxSelectedCanvases', 'maxActiveWindows', 'maxCommandEntries', 'maxArgumentsPerCommand', 'maxValueTokens', 'maxStackSamples', 'maxFramesPerStack', 'maxSourceMapLookups', 'maxSourceMapResponseBytes'], 'copied explanation collection limits');
  shape(artifact.droppedEntryCounts, ['durationStops', 'selectedCanvasRejections', 'activeWindows', 'commandEntries', 'commandArguments', 'valueTokens', 'stackSamples', 'stackFrames', 'sourceMapLookups', 'sourceMapResponses'], 'copied explanation dropped counts');
  const limits = list(artifact.limitResults, 'copied explanation limit results');
  if (JSON.stringify(limits.map(result => result.name)) !== JSON.stringify(explanationLimitNames)) throw new Error('copied explanation limit result rows changed');
  for (const result of limits) {
    shape(result, ['name', 'maximum', 'rejectedCount', 'reason', 'firstAffected'], 'copied explanation limit result');
    if (result.firstAffected !== null) shape(result.firstAffected, ['scope', 'windowIndex', 'commandOrdinal'], 'copied explanation limit coordinate');
  }
  shape(artifact.callsiteCoverage, ['status', 'incompleteReasons'], 'copied explanation callsite coverage');
  list(artifact.callsiteCoverage.incompleteReasons, 'copied explanation incomplete reasons');
  if (artifact.firstGap !== null) shape(artifact.firstGap, ['windowIndex', 'commandOrdinal', 'reason'], 'copied explanation first gap');
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
  if (finding?.type !== 'repeated-draw-work' || canvases.length !== 1) throw new Error('readiness selected repeated finding changed');
  return { finding, canvas: canvases[0] };
}

function validateBrowserDrawCounts(drawCounts) {
  if (!exact(drawCounts, ['baseline', 'candidate'])) throw new Error('browser draw counts changed');
  for (const mode of ['baseline', 'candidate']) {
    const expected = demoTruth[mode];
    if (!exact(drawCounts[mode], ['clearRect', 'fillRect']) || drawCounts[mode].clearRect !== expected.clearRects || drawCounts[mode].fillRect !== expected.fillRects) throw new Error(`${mode} browser draw counts changed`);
  }
  return true;
}

function validateDemoSession(session, findingIndex, mode, drawCounts) {
  validateSessionSchema(session);
  if (session.canvases.length !== 1 || session.windows.length !== demoTruth[mode].activeWindowCount || session.resetEvents.length !== 0 || session.lifecycleEvents.length !== (mode === 'baseline' ? 1 : 0) || session.episodes.length !== 1 || session.findings.length !== 1) throw new Error(`${mode} raw session rows changed`);
  const selected = selectedRepeated(session, findingIndex);
  const expected = demoTruth[mode];
  const methods = selected.canvas.methodEvidence;
  const rasterOperationCount = drawCounts.clearRect + drawCounts.fillRect;
  if (selected.canvas.activeWindowCount !== expected.activeWindowCount || selected.canvas.rasterOperationCount !== rasterOperationCount || !Number.isFinite(selected.canvas.canvasApiSelfTimeMs) || selected.canvas.canvasApiSelfTimeMs < 0 || !Number.isFinite(selected.canvas.maxWindowSelfTimeMs) || selected.canvas.maxWindowSelfTimeMs < 0) throw new Error(`${mode} demo canvas truth changed`);
  if (!exact(methods, ['clearRect', 'fillRect', 'fillStyle']) || methods.clearRect.count !== drawCounts.clearRect || methods.fillRect.count !== drawCounts.fillRect || methods.fillStyle.count !== expected.fillStyles || !Number.isFinite(methods.clearRect.canvasApiSelfTimeMs) || !Number.isFinite(methods.fillRect.canvasApiSelfTimeMs) || methods.fillStyle.canvasApiSelfTimeMs !== null) throw new Error(`${mode} demo method truth changed`);
  if (!expected.repeatedWindowCounts.includes(selected.finding.repeatedWindowCount) || !exact(selected.finding.unknownCoverage, ['unknownWindowCount', 'activeWindowCount']) || !Number.isInteger(selected.finding.unknownCoverage.unknownWindowCount) || selected.finding.unknownCoverage.unknownWindowCount < 0 || selected.finding.unknownCoverage.unknownWindowCount > 2 || selected.finding.unknownCoverage.activeWindowCount !== expected.activeWindowCount) throw new Error(`${mode} repeated finding truth changed`);
  if (!Array.isArray(selected.finding.repeatedWindows) || selected.finding.repeatedWindows.length !== selected.finding.repeatedWindowCount || selected.finding.repeatedWindows.some(window => !expected.rasterOperationsPerRepeatedWindow.includes(window.rasterOperationCount) || window.comparisonGap !== 1) || selected.finding.rasterOperationCount !== selected.finding.repeatedWindows.reduce((total, window) => total + window.rasterOperationCount, 0)) throw new Error(`${mode} repeated window truth changed`);
  return selected;
}

function validateDemoCommandWindow(window) {
  const expected = [
    ['call', 'clearRect', 4], ['set', 'fillStyle', 1],
    ['call', 'fillRect', 4], ['call', 'fillRect', 4], ['call', 'fillRect', 4], ['call', 'fillRect', 4],
  ];
  if (!window || window.complete !== true || window.unknownReason !== null || !Array.isArray(window.commands) || window.commands.length !== expected.length) return false;
  return window.commands.every((command, index) => command.ordinal === index && command.operationKind === expected[index][0] && command.name === expected[index][1] && command.argumentCount === expected[index][2] && Array.isArray(command.arguments) && command.arguments.length === expected[index][2] && command.unknownReason === null);
}

function validateComparisonMeasures(measures, baseline, candidate, drawCounts) {
  if (!Array.isArray(measures) || JSON.stringify(measures.map(item => item.id)) !== JSON.stringify(comparisonMeasureIds)) throw new Error('copied comparison measure IDs changed');
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
    if (!exact(item, ['id', 'unit', 'baseline', 'candidate', 'delta', 'direction', 'interpretation'])) throw new Error('copied comparison measure shape changed');
    const expected = structural.get(item.id);
    if (expected) {
      if (JSON.stringify(item) !== JSON.stringify(measure(item.id, 'count', expected[0], expected[1]))) throw new Error(`copied comparison ${item.id} truth changed`);
      continue;
    }
    const expectedTiming = timing.get(item.id);
    if (!expectedTiming || JSON.stringify(item) !== JSON.stringify(measure(item.id, 'ms', expectedTiming[0], expectedTiming[1]))) throw new Error(`copied comparison ${item.id} timing changed`);
  }
}

export function validateCopiedExplanation(artifact, selection) {
  const keys = ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'limitResults', 'callsiteCoverage', 'firstGap'];
  validateExplanationSchema(artifact);
  if (!exact(artifact, keys) || artifact.schemaVersion !== 1 || artifact.canvasScanVersion !== '0.5.0' || !text(artifact.explanationId) || artifact.stopReason !== 'manual') throw new Error('copied explanation root changed');
  if (!exact(artifact.source, ['sessionId', 'findingIndex', 'findingType', 'canvasId']) || artifact.source.sessionId !== selection.sessionId || artifact.source.findingIndex !== selection.findingIndex || artifact.source.findingType !== selection.findingType || !text(artifact.source.canvasId)) throw new Error('copied explanation selection changed');
  if (!exact(artifact.followUp, ['sessionId', 'canvasId']) || !text(artifact.followUp.sessionId) || artifact.followUp.sessionId === artifact.source.sessionId || artifact.followUp.canvasId !== artifact.source.canvasId) throw new Error('copied explanation follow-up changed');
  const windows = new Map(Array.isArray(artifact.windows) ? artifact.windows.map(window => [window.windowIndex, window]) : []);
  const same = Array.isArray(artifact.comparisons) ? artifact.comparisons.find(comparison => exact(comparison, ['referenceWindowIndex', 'targetWindowIndex', 'status', 'difference', 'unknownReason']) && comparison.status === 'same' && comparison.difference === null && comparison.unknownReason === null) : undefined;
  if (!same || !validateDemoCommandWindow(windows.get(same.referenceWindowIndex)) || !validateDemoCommandWindow(windows.get(same.targetWindowIndex)) || artifact.firstDifference !== null) throw new Error('copied explanation command truth changed');
  if (JSON.stringify(artifact).includes('#2563eb')) throw new Error('copied explanation contains a raw demo argument');
  return true;
}

export function validateCopiedComparison(artifact, baselineSession, candidateSession, pairing, drawCounts) {
  const keys = ['schemaVersion', 'comparisonId', 'createdAt', 'canvasScanVersion', 'pairingMethod', 'baseline', 'candidate', 'status', 'incomparableReasons', 'measures', 'improvementEstablished'];
  if (!exact(artifact, keys) || artifact.schemaVersion !== 1 || artifact.canvasScanVersion !== '0.5.0' || !text(artifact.comparisonId) || !text(artifact.createdAt) || artifact.pairingMethod !== 'user-selected' || artifact.status !== 'comparable' || artifact.improvementEstablished !== false || artifact.incomparableReasons.length !== 0) throw new Error('copied comparison root changed');
  validateBrowserDrawCounts(drawCounts);
  const left = validateDemoSession(baselineSession, pairing.baselineFindingIndex, 'baseline', drawCounts.baseline);
  const right = validateDemoSession(candidateSession, pairing.candidateFindingIndex, 'candidate', drawCounts.candidate);
  const refKeys = ['sessionId', 'findingIndex', 'findingType', 'canvasId'];
  if (!exact(artifact.baseline, refKeys) || artifact.baseline.sessionId !== baselineSession.sessionId || artifact.baseline.findingIndex !== pairing.baselineFindingIndex || artifact.baseline.findingType !== left.finding.type || artifact.baseline.canvasId !== left.finding.canvasId) throw new Error('copied comparison baseline changed');
  if (!exact(artifact.candidate, refKeys) || artifact.candidate.sessionId !== candidateSession.sessionId || artifact.candidate.findingIndex !== pairing.candidateFindingIndex || artifact.candidate.findingType !== right.finding.type || artifact.candidate.canvasId !== right.finding.canvasId) throw new Error('copied comparison candidate changed');
  validateComparisonMeasures(artifact.measures, left, right, drawCounts);
  return true;
}

export function checkReadinessEvidence(value, expectedCandidate) {
  const rootKeys = ['schemaVersion', 'issue', 'status', 'gitSha', 'branch', 'packageVersion', 'tarballSha256', 'packedIifeSha256', 'installedIifeSha256', 'browserVersion', 'earlyLoad', 'cleanBefore', 'cleanAfter', 'publicMethods', 'actionIds', 'browserDrawCounts', 'baseline', 'explanation', 'candidate', 'comparison', 'artifacts', 'diagnostics', 'failures'];
  if (!exact(value, rootKeys) || value.schemaVersion !== 1 || value.issue !== 'SIDPROJ-105' || value.status !== 'PASS') throw new Error('readiness evidence root changed');
  if (!expectedCandidate || value.gitSha !== expectedCandidate.gitSha || value.branch !== expectedCandidate.branch || value.packageVersion !== expectedCandidate.packageVersion || !/^[0-9a-f]{64}$/.test(value.tarballSha256) || !/^[0-9a-f]{64}$/.test(value.packedIifeSha256) || value.installedIifeSha256 !== value.packedIifeSha256 || !text(value.browserVersion)) throw new Error('readiness candidate identity changed');
  if (value.earlyLoad !== true || value.cleanBefore !== true || value.cleanAfter !== true || JSON.stringify(value.publicMethods) !== JSON.stringify(RITUAL_METHODS) || JSON.stringify(value.actionIds) !== JSON.stringify(ACTION_IDS)) throw new Error('readiness ritual identity changed');
  validateBrowserDrawCounts(value.browserDrawCounts);

  const findingKeys = ['sessionId', 'findingIndex', 'findingType'];
  if (!exact(value.baseline, findingKeys) || !exact(value.candidate, findingKeys) || !text(value.baseline.sessionId) || !text(value.candidate.sessionId) || value.baseline.sessionId === value.candidate.sessionId || !Number.isInteger(value.baseline.findingIndex) || !Number.isInteger(value.candidate.findingIndex) || value.baseline.findingType !== 'repeated-draw-work' || value.candidate.findingType !== value.baseline.findingType) throw new Error('readiness selected findings changed');

  const explanationKeys = ['sourceSessionId', 'sourceFindingIndex', 'followUpSessionId', 'stopReason'];
  if (!exact(value.explanation, explanationKeys) || value.explanation.sourceSessionId !== value.baseline.sessionId || value.explanation.sourceFindingIndex !== value.baseline.findingIndex || !text(value.explanation.followUpSessionId) || value.explanation.stopReason !== 'manual') throw new Error('readiness explanation changed');

  const comparisonKeys = ['pairingMethod', 'status', 'improvementEstablished', 'baselineSessionId', 'baselineFindingIndex', 'candidateSessionId', 'candidateFindingIndex'];
  if (!exact(value.comparison, comparisonKeys) || value.comparison.pairingMethod !== 'user-selected' || value.comparison.status !== 'comparable' || value.comparison.improvementEstablished !== false || value.comparison.baselineSessionId !== value.baseline.sessionId || value.comparison.baselineFindingIndex !== value.baseline.findingIndex || value.comparison.candidateSessionId !== value.candidate.sessionId || value.comparison.candidateFindingIndex !== value.candidate.findingIndex) throw new Error('readiness explicit comparison changed');
  if (!exact(value.artifacts, ['baselineSession', 'candidateSession', 'copiedExplanation', 'copiedComparison']) || value.artifacts.baselineSession.sessionId !== value.baseline.sessionId || value.artifacts.candidateSession.sessionId !== value.candidate.sessionId) throw new Error('readiness raw artifacts changed');
  validateCopiedExplanation(value.artifacts.copiedExplanation, value.baseline);
  validateCopiedComparison(value.artifacts.copiedComparison, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: value.baseline.findingIndex, candidateFindingIndex: value.candidate.findingIndex }, value.browserDrawCounts);
  if (!exact(value.diagnostics, diagnosticKeys) || diagnosticKeys.some(key => !Array.isArray(value.diagnostics[key]) || value.diagnostics[key].length > 0) || !Array.isArray(value.failures) || value.failures.length > 0) throw new Error('readiness diagnostics changed');
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

async function currentCandidate() {
  const status = run('git', ['status', '--short', '--untracked-files=all'], root);
  if (status) throw new Error(`readiness requires a clean worktree\n${status}`);
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

async function runBrowser(consumer, diagnostics, ownershipToken) {
  let server;
  let browser;
  const actionIds = [];
  const counts = { clearRect: 0, fillRect: 0 };
  const result = { browserVersion: '', earlyLoad: false, publicMethods: [], actionIds, browserDrawCounts: { baseline: null, candidate: null }, baseline: null, explanation: null, candidate: null, comparison: null, artifacts: { baselineSession: null, candidateSession: null, copiedExplanation: null, copiedComparison: null } };
  try {
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
    actionIds.push('early-load');
    result.publicMethods = await page.evaluate(methods => methods.filter(method => typeof window.__CANVAS_SCAN__?.[method] === 'function'), RITUAL_METHODS);
    await installDrawCounter(page, counts);
    const baselineSession = await record(page);
    result.browserDrawCounts.baseline = await readDrawCounter(page, counts);
    actionIds.push('record-baseline');
    const baselineFindingIndex = baselineSession.findings.findIndex(finding => finding.type === 'repeated-draw-work');
    if (baselineFindingIndex < 0) throw new Error('clean demo baseline has no repeated-draw-work finding');
    result.baseline = { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type };
    result.artifacts.baselineSession = baselineSession;
    await expandFinding(page, baselineFindingIndex);
    await page.locator(`.explanation-action[data-finding-index="${baselineFindingIndex}"]`).click();
    await replay(page);
    await page.locator('[aria-label="Stop recording"]').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-panel')?.textContent?.includes('EXPLANATION COMPLETE'));
    await settle(page);
    actionIds.push('explain-baseline');
    await page.locator('.explanation-copy').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-copy-status')?.textContent === 'Explanation JSON copied');
    const copiedExplanation = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    result.explanation = { sourceSessionId: copiedExplanation.source.sessionId, sourceFindingIndex: copiedExplanation.source.findingIndex, followUpSessionId: copiedExplanation.followUp.sessionId, stopReason: copiedExplanation.stopReason };
    result.artifacts.copiedExplanation = copiedExplanation;
    validateCopiedExplanation(copiedExplanation, { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type });
    actionIds.push('copy-explanation');
    await page.locator(`.baseline-action[data-finding-index="${baselineFindingIndex}"]`).click();
    actionIds.push('keep-baseline');
    await page.locator('[data-demo-action="apply-candidate-change"]').click();
    await page.waitForFunction(() => document.querySelector('[data-demo-action="apply-candidate-change"]')?.textContent?.includes('Candidate change applied'));
    actionIds.push('apply-change');
    await readDrawCounter(page, counts);
    counts.clearRect = 0;
    counts.fillRect = 0;
    const candidateSession = await record(page);
    result.browserDrawCounts.candidate = await readDrawCounter(page, counts);
    actionIds.push('record-candidate');
    const candidateFindingIndex = candidateSession.findings.findIndex(finding => finding.type === baselineSession.findings[baselineFindingIndex].type);
    if (candidateFindingIndex < 0) throw new Error('clean demo candidate has no same-type finding');
    result.candidate = { sessionId: candidateSession.sessionId, findingIndex: candidateFindingIndex, findingType: candidateSession.findings[candidateFindingIndex].type };
    result.artifacts.candidateSession = candidateSession;
    await expandFinding(page, candidateFindingIndex);
    const comparisonAction = page.locator(`.comparison-action[data-finding-index="${candidateFindingIndex}"]`);
    await comparisonAction.waitFor({ state: 'visible' });
    await comparisonAction.click();
    actionIds.push('pair-findings');
    await page.locator('.comparison-copy').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.comparison-copy-status')?.textContent === 'Comparison JSON copied');
    const copiedComparison = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    actionIds.push('copy-comparison');
    result.comparison = { pairingMethod: copiedComparison.pairingMethod, status: copiedComparison.status, improvementEstablished: copiedComparison.improvementEstablished, baselineSessionId: copiedComparison.baseline.sessionId, baselineFindingIndex: copiedComparison.baseline.findingIndex, candidateSessionId: copiedComparison.candidate.sessionId, candidateFindingIndex: copiedComparison.candidate.findingIndex };
    result.artifacts.copiedComparison = copiedComparison;
    validateCopiedComparison(copiedComparison, baselineSession, candidateSession, { baselineFindingIndex, candidateFindingIndex }, result.browserDrawCounts);
    await context.close();
    return result;
  } catch (error) {
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

async function checkDirectory(directory, expectedCandidate) {
  const expected = expectedCandidate ?? await currentCandidate();
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(['evidence-sha256.txt', 'evidence.json'])) throw new Error('readiness evidence files changed');
  const bytes = await readFile(path.join(directory, 'evidence.json'));
  const manifest = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim();
  if (manifest !== `${hash(bytes)}  evidence.json`) throw new Error('readiness evidence hash changed');
  return checkReadinessEvidence(JSON.parse(bytes), expected);
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
  const candidate = await currentCandidate();
  const { gitSha, branch, packageVersion } = candidate;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'canvas-scan-readiness-v05-'));
  const diagnostics = Object.fromEntries(diagnosticKeys.map(key => [key, []]));
  const failures = [];
  let browserResult;
  let tarballSha256 = '';
  let packedIifeSha256 = '';
  let installedIifeSha256 = '';
  const ownershipToken = hash(temporaryRoot);
  try {
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
    browserResult = await runBrowser(consumer, diagnostics, ownershipToken);
  } catch (error) {
    if (error && typeof error === 'object' && error.browserResult) browserResult = error.browserResult;
    failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    await collectCleanupErrors(diagnostics, [['temporary-directory-remove', async () => rm(temporaryRoot, { recursive: true, force: true })]]);
  }

  const cleanAfter = run('git', ['status', '--short', '--untracked-files=all'], root) === '';
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
    cleanBefore: true,
    cleanAfter,
    publicMethods: browserResult?.publicMethods ?? [],
    actionIds: browserResult?.actionIds ?? [],
    browserDrawCounts: browserResult?.browserDrawCounts ?? null,
    baseline: browserResult?.baseline ?? null,
    explanation: browserResult?.explanation ?? null,
    candidate: browserResult?.candidate ?? null,
    comparison: browserResult?.comparison ?? null,
    artifacts: browserResult?.artifacts ?? null,
    diagnostics,
    failures,
  };
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(stable(evidence));
  await writeFile(path.join(directory, 'evidence.json'), bytes);
  await writeFile(path.join(directory, 'evidence-sha256.txt'), `${hash(bytes)}  evidence.json\n`);
  if (evidence.status === 'PASS') await checkDirectory(directory, candidate);
  console.log(`SIDPROJ_105_READINESS_EVIDENCE: ${directory}`);
  console.log(`SIDPROJ_105_READINESS: ${evidence.status}`);
  if (evidence.status === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
