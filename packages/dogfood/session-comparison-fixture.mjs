import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
export const expectedMatrix = JSON.parse(readFileSync(join(directory, 'fixtures/v05-06/expected.json'), 'utf8'));

function methodEvidence(side) {
  return Object.fromEntries(Object.entries(expectedMatrix.facts.methods).flatMap(([name, values]) => {
    const [count, time] = values[side];
    return count === 0 ? [] : [[name, { count, canvasApiSelfTimeMs: time }]];
  }));
}

function summary(side, canvasId) {
  const [activeWindowCount, rasterOperationCount, canvasApiSelfTimeMs, maxWindowSelfTimeMs] = expectedMatrix.facts.common[side ? 'candidate' : 'baseline'];
  const unknown = side ? 1 : 2;
  return { canvasId, nearestReactOwner: null, attributionKind: 'unattributed', sourceLocation: null, activeWindowCount, rasterOperationCount, canvasApiSelfTimeMs, maxWindowSelfTimeMs, evidenceLevel: 'measured', methodEvidence: methodEvidence(side), commandStatuses: { same: activeWindowCount - 1 - unknown, changed: 1, unknown } };
}

function finding(type, side, canvasId, episodeSuffix = '') {
  const common = { evidenceLevel: 'candidate', canvasId, claimBoundary: { observation: '', explanation: '', nonEstablishedFacts: '' }, nextCheck: '' };
  if (type === 'heavy-canvas-work') {
    const [rasterOperationCount, canvasApiSelfTimeMs] = expectedMatrix.facts.heavy[side];
    return { ...common, type, episodeId: `${side ? 'candidate' : 'baseline'}-episode${episodeSuffix}`, rasterOperationCount, canvasApiSelfTimeMs, topMethods: Object.entries(methodEvidence(side)).map(([method, value]) => ({ method, ...value })), maximumWindow: { windowIndex: 1, timestampMs: 1, rasterOperationCount: 1, canvasApiSelfTimeMs: 1, methodEvidence: methodEvidence(side) } };
  }
  if (type === 'repeated-draw-work') {
    const [repeatedWindowCount, rasterOperationCount, gaps, unknownWindowCount] = expectedMatrix.facts.repeated[side];
    return { ...common, type, episodeId: `${side ? 'candidate' : 'baseline'}-episode${episodeSuffix}`, repeatedWindowCount, rasterOperationCount, canvasApiSelfTimeMs: 1, repeatedWindows: gaps.map((comparisonGap, index) => ({ windowIndex: index, timestampMs: index, rasterOperationCount: 1, canvasApiSelfTimeMs: 1, comparisonGap })), unknownCoverage: { unknownWindowCount, activeWindowCount: expectedMatrix.facts.common[side ? 'candidate' : 'baseline'][0] } };
  }
  if (type === 'resize-churn') {
    const [activeResetCount, observedResetCount, episodes, statuses] = expectedMatrix.facts.resize[side];
    return { ...common, type, observedResetCount, activeResetCount, resetEvents: Array.from({ length: activeResetCount }, (_, windowIndex) => ({ source: 'width-setter', width: 1, height: 1, windowIndex, timestampMs: windowIndex })), affectedEpisodeIds: Array.from({ length: episodes }, (_, index) => `episode-${index}`), commandStatuses: { same: statuses[0], changed: statuses[1], unknown: statuses[2] }, unknownReasons: {}, canvasApiSelfTimeMs: 1, rasterOperationCount: 1 };
  }
  const [affectedWindowCount, ratios] = expectedMatrix.facts.backing[side];
  return { ...common, type: 'backing-store-mismatch', affectedWindowCount, affectedWindows: ratios.map((actualToExpectedAreaRatio, windowIndex) => ({ windowIndex, timestampMs: windowIndex, rasterOperationCount: 1, canvasApiSelfTimeMs: 1, backingWidth: 1, backingHeight: 1, expectedBackingWidth: 1, expectedBackingHeight: 1, expectedPixelArea: 1, actualToExpectedAreaRatio })), affectedEpisodeIds: ['episode-0'], rasterOperationCount: 1, canvasApiSelfTimeMs: 1 };
}

export function sessionFor(row, side) {
  const candidate = side === 1;
  let canvasId = `${candidate ? 'candidate' : 'baseline'}-canvas`;
  let sessionId = `${candidate ? 'candidate' : 'baseline'}-session`;
  if (row.variant === 'session-identities') { canvasId = `${candidate ? 'candidate' : 'baseline'}-other-canvas`; sessionId = `${candidate ? 'candidate' : 'baseline'}-other-session`; }
  const selected = finding(row.findingType ?? 'heavy-canvas-work', side, canvasId, row.variant === 'session-identities' ? '-other' : '');
  let findings = [selected]; let canvases = [summary(side, canvasId)];
  if (row.id === 'finding-type-mismatch' && candidate) findings.push(finding('repeated-draw-work', side, canvasId));
  if (row.variant === 'canvas-creation-order' || row.variant === 'unrelated-canvas-work') {
    const unrelatedCanvas = summary(side, `${canvasId}-unrelated`);
    if (row.variant === 'unrelated-canvas-work') {
      unrelatedCanvas.methodEvidence = { clearRect: { count: 7, canvasApiSelfTimeMs: 2 } };
      unrelatedCanvas.activeWindowCount = 1;
      unrelatedCanvas.rasterOperationCount = 7;
      unrelatedCanvas.canvasApiSelfTimeMs = 2;
      unrelatedCanvas.maxWindowSelfTimeMs = 2;
      unrelatedCanvas.commandStatuses = { same: 1, changed: 0, unknown: 0 };
    }
    const unrelatedFinding = finding('heavy-canvas-work', side, unrelatedCanvas.canvasId, '-unrelated');
    canvases = [unrelatedCanvas, ...canvases]; findings = [unrelatedFinding, ...findings];
  }
  const windows = row.variant === 'unrelated-canvas-work' ? [{ canvasId: `${canvasId}-unrelated`, windowIndex: 99, rasterOperationCount: 7 }] : [];
  return { schemaVersion: 1, sessionId, startedAt: '2026-08-11T10:00:00.000Z', endedAt: candidate ? '2026-08-11T10:01:00.000Z' : '2026-08-11T10:00:30.000Z', durationMs: 1, stopReason: 'manual', canvasScanVersion: '0.4.0', browserFeatures: { monotonicTime: true, eventTiming: false, longAnimationFrames: false }, canvases, windows, resetEvents: [], lifecycleEvents: [], episodes: [], browserEntries: [], episodeAssociations: [], findings, collectionLimits: {}, droppedEntryCounts: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 } };
}
