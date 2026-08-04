import { copyReport, getCurrentWindowIndex, subscribeToLifecycleEvents, subscribeToReports, subscribeToResetEvents } from './frame-loop';
import { drainAttributeRecords, records, setMethodEvidenceCollectionEnabled, setResetEventCollectionEnabled, takeResetEvents } from './wrap-context';
import { collectCanvasGeometry } from './geometry';
import type {
  CanvasMethodEvidence,
  CanvasScanOptions,
  HeavyCanvasWorkFinding,
  InvestigationFinding,
  InvestigationSessionV1,
  RecordedDrawEpisode,
  RecordedEpisodeCanvasSummary,
  RecordedCanvasSummary,
  RecordedCanvasWindow,
  RecordedTopMethod,
  RepeatedDrawWorkFinding,
  RecordedResetEvent,
  RecordedCanvasLifecycleEvent,
  ResizeChurnFinding,
  BackingStoreMismatchFinding,
  RecordingState,
  RecordingStopReason,
} from './types';

const MAX_DURATION_MS = 30000;
const MAX_WINDOWS = 10000;
const MAX_CANVASES = 128;
const MAX_RESET_EVENTS = 10000;
const MAX_LIFECYCLE_EVENTS = 10000;
const HEAVY_CANVAS_WORK_THRESHOLD_MS = 8;
const HEAVY_CANVAS_WORK_CLAIM = {
  observation: 'The canvas spent the measured Canvas2D API self-time in the named draw episode.',
  explanation: 'The episode contains concentrated synchronous Canvas2D API work and is a review candidate.',
  nonEstablishedFacts: 'The evidence does not establish GPU time, presentation or render time, or avoidable work.',
};
const HEAVY_CANVAS_WORK_NEXT_CHECK = 'Check the top measured methods and the application code that calls them.';
const REPEATED_DRAW_WORK_CLAIM = {
  observation: 'The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.',
  explanation: 'The repeated commands are a review candidate.',
  nonEstablishedFacts: 'The evidence does not establish that the output stayed unchanged or that the work can be removed.',
};
const REPEATED_DRAW_WORK_NEXT_CHECK = 'Check whether the application needs to send these repeated commands for the same scene and interaction.';
const RESIZE_CHURN_CLAIM = {
  observation: 'canvas-scan observed the stated resets in windows with raster work.',
  explanation: 'Repeated resets overlapped active canvas work and are a review candidate.',
  nonEstablishedFacts: 'The evidence does not show that resets made the application slow or that the application can remove them.',
};
const RESIZE_CHURN_NEXT_CHECK = 'Check whether sizing or reset calls can run only when dimensions or state need to change.';
const BACKING_STORE_MISMATCH_CLAIM = {
  observation: 'The recorded backing area is larger than the DPR-adjusted expected area in the named active windows.',
  explanation: 'The recorded dimensions are a review candidate.',
  nonEstablishedFacts: 'The evidence does not establish GPU cost, render cost, or the required image quality.',
};
const BACKING_STORE_MISMATCH_NEXT_CHECK = 'Check the canvas sizing policy and the required image quality.';

let state: RecordingState = 'idle';
let lastSession: InvestigationSessionV1 | undefined;
let startedAt = '';
let startedMonotonic = 0;
let sessionId = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let windows: RecordedCanvasWindow[] = [];
let resetEvents: RecordedResetEvent[] = [];
let lifecycleEvents: RecordedCanvasLifecycleEvent[] = [];
let canvasIds: string[] = [];
let droppedWindows = 0;
let droppedCanvases = 0;
let droppedResetEvents = 0;
let droppedLifecycleEvents = 0;
let sequence = 0;
let unsubscribe: (() => void) | undefined;
let unsubscribeResetEvents: (() => void) | undefined;
let unsubscribeLifecycleEvents: (() => void) | undefined;
let recordingStartWindowIndex = 0;
let minRepeatedRasterOps = 2;
let recordingStartOffsets = new Map<string, { rasterOperationCount: number; canvasApiSelfTimeMs: number }>();
const listeners = new Set<(state: RecordingState) => void>();

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function copyWindow(window: RecordedCanvasWindow): RecordedCanvasWindow {
  return { ...copyReport(window), windowIndex: window.windowIndex, timestampMs: window.timestampMs, geometry: { ...window.geometry } };
}

function copyResetEvent(event: RecordedResetEvent): RecordedResetEvent { return { ...event }; }
function copyLifecycleEvent(event: RecordedCanvasLifecycleEvent): RecordedCanvasLifecycleEvent { return { ...event }; }

function copyEvidence(evidence: Record<string, CanvasMethodEvidence>): Record<string, CanvasMethodEvidence> {
  return Object.fromEntries(Object.entries(evidence).map(([method, value]) => [method, { ...value }]));
}

function addEvidence(target: Record<string, CanvasMethodEvidence>, source: Record<string, CanvasMethodEvidence>): void {
  for (const [method, value] of Object.entries(source)) {
    const current = target[method] ?? { count: 0, canvasApiSelfTimeMs: value.canvasApiSelfTimeMs === null ? null : 0 };
    current.count += value.count;
    if (current.canvasApiSelfTimeMs !== null && value.canvasApiSelfTimeMs !== null) current.canvasApiSelfTimeMs += value.canvasApiSelfTimeMs;
    target[method] = current;
  }
}

function rounded(value: number): number { return Number(value.toFixed(3)); }

function hasBackingStoreMismatch(geometry: RecordedCanvasWindow['geometry']): boolean {
  if (geometry.unavailableReason !== null || geometry.backingWidth === null || geometry.backingHeight === null || geometry.cssWidth === null || geometry.cssHeight === null || geometry.devicePixelRatio === null) return false;
  const actualPixelArea = geometry.backingWidth * geometry.backingHeight;
  const expectedPixelArea = geometry.cssWidth * geometry.cssHeight * geometry.devicePixelRatio * geometry.devicePixelRatio;
  return Number.isFinite(actualPixelArea) && Number.isFinite(expectedPixelArea) && expectedPixelArea > 0 && actualPixelArea >= expectedPixelArea * 2;
}

function roundedEvidence(evidence: Record<string, CanvasMethodEvidence>): Record<string, CanvasMethodEvidence> {
  return Object.fromEntries(Object.entries(evidence).map(([method, value]) => [method, {
    count: value.count,
    canvasApiSelfTimeMs: value.canvasApiSelfTimeMs === null ? null : rounded(value.canvasApiSelfTimeMs),
  }]));
}

function copySession(session: InvestigationSessionV1): InvestigationSessionV1 {
  return {
    ...session,
    browserFeatures: { ...session.browserFeatures },
    canvases: session.canvases.map(canvas => ({
      ...canvas,
      sourceLocation: canvas.sourceLocation ? { ...canvas.sourceLocation } : null,
      commandStatuses: { ...canvas.commandStatuses },
      methodEvidence: copyEvidence(canvas.methodEvidence),
    })),
    windows: session.windows.map(copyWindow),
    resetEvents: session.resetEvents.map(copyResetEvent),
    lifecycleEvents: session.lifecycleEvents.map(copyLifecycleEvent),
    episodes: session.episodes.map(episode => ({ ...episode, methodEvidence: copyEvidence(episode.methodEvidence), canvases: episode.canvases.map(canvas => ({ ...canvas, methodEvidence: copyEvidence(canvas.methodEvidence) })) })),
    findings: session.findings.map(finding => finding.type === 'heavy-canvas-work'
      ? { ...finding, topMethods: finding.topMethods.map(method => ({ ...method })), maximumWindow: { ...finding.maximumWindow, methodEvidence: copyEvidence(finding.maximumWindow.methodEvidence) }, claimBoundary: { ...finding.claimBoundary } }
      : finding.type === 'repeated-draw-work'
        ? { ...finding, repeatedWindows: finding.repeatedWindows.map(window => ({ ...window })), unknownCoverage: { ...finding.unknownCoverage }, claimBoundary: { ...finding.claimBoundary } }
        : finding.type === 'resize-churn'
          ? { ...finding, resetEvents: finding.resetEvents.map(event => ({ ...event })), affectedEpisodeIds: [...finding.affectedEpisodeIds], commandStatuses: { ...finding.commandStatuses }, unknownReasons: { ...finding.unknownReasons }, claimBoundary: { ...finding.claimBoundary } }
          : { ...finding, affectedWindows: finding.affectedWindows.map(window => ({ ...window })), affectedEpisodeIds: [...finding.affectedEpisodeIds], claimBoundary: { ...finding.claimBoundary } }),
    collectionLimits: { ...session.collectionLimits },
    droppedEntryCounts: { ...session.droppedEntryCounts },
  };
}

function notify(): void {
  for (const listener of listeners) listener(state);
}

function removeCanvas(canvasId: string): void {
  canvasIds = canvasIds.filter(id => id !== canvasId);
  const kept: RecordedCanvasWindow[] = [];
  for (const window of windows) {
    if (window.canvasId === canvasId) droppedWindows++;
    else kept.push(window);
  }
  windows = kept;
  const keptResetEvents: RecordedResetEvent[] = [];
  for (const event of resetEvents) {
    if (event.canvasId === canvasId) droppedResetEvents++;
    else keptResetEvents.push(event);
  }
  resetEvents = keptResetEvents;
  const keptLifecycleEvents: RecordedCanvasLifecycleEvent[] = [];
  for (const event of lifecycleEvents) {
    if (event.canvasId === canvasId) droppedLifecycleEvents++;
    else keptLifecycleEvents.push(event);
  }
  lifecycleEvents = keptLifecycleEvents;
}

function removeCanvasIfEmpty(canvasId: string): void {
  if (windows.some(window => window.canvasId === canvasId) || resetEvents.some(event => event.canvasId === canvasId) || lifecycleEvents.some(event => event.canvasId === canvasId)) return;
  canvasIds = canvasIds.filter(id => id !== canvasId);
}

function retainCanvas(canvasId: string): void {
  if (canvasIds.includes(canvasId)) return;
  if (canvasIds.length === MAX_CANVASES) {
    removeCanvas(canvasIds[0]);
    droppedCanvases++;
  }
  canvasIds.push(canvasId);
}

function capture(report: RecordedCanvasWindow): void {
  if (state !== 'recording') return;
  if (windows.length === MAX_WINDOWS) {
    const removed = windows.shift()!;
    droppedWindows++;
    removeCanvasIfEmpty(removed.canvasId);
  }
  retainCanvas(report.canvasId);
  windows.push(copyWindow(report));
}

function captureResetEvent(event: RecordedResetEvent): void {
  if (state !== 'recording') return;
  if (resetEvents.length === MAX_RESET_EVENTS) {
    const removed = resetEvents.shift()!;
    droppedResetEvents++;
    removeCanvasIfEmpty(removed.canvasId);
  }
  retainCanvas(event.canvasId);
  resetEvents.push(copyResetEvent(event));
}

function captureLifecycleEvent(event: RecordedCanvasLifecycleEvent): void {
  if (state !== 'recording') return;
  if (lifecycleEvents.length === MAX_LIFECYCLE_EVENTS) {
    const removed = lifecycleEvents.shift()!;
    droppedLifecycleEvents++;
    removeCanvasIfEmpty(removed.canvasId);
  }
  retainCanvas(event.canvasId);
  lifecycleEvents.push(copyLifecycleEvent(event));
}

function summaries(): RecordedCanvasSummary[] {
  return canvasIds.filter(canvasId => windows.some(window => window.canvasId === canvasId)).map(canvasId => {
    const retained = windows.filter(window => window.canvasId === canvasId);
    const latest = retained[retained.length - 1];
    const commandStatuses = { same: 0, changed: 0, unknown: 0 };
    let rasterOperationCount = 0;
    let canvasApiSelfTimeMs = 0;
    let maxWindowSelfTimeMs = 0;
    const methodEvidence: Record<string, CanvasMethodEvidence> = {};
    for (const window of retained) {
      commandStatuses[window.signatureStatus]++;
      rasterOperationCount += window.rasterOperationCount;
      canvasApiSelfTimeMs += window.canvasApiSelfTimeMs;
      maxWindowSelfTimeMs = Math.max(maxWindowSelfTimeMs, window.canvasApiSelfTimeMs);
      addEvidence(methodEvidence, window.methodEvidence);
    }
    return {
      canvasId,
      nearestReactOwner: latest.nearestReactOwner,
      attributionKind: latest.attributionKind,
      sourceLocation: latest.sourceLocation ? { ...latest.sourceLocation } : null,
      activeWindowCount: retained.length,
      rasterOperationCount,
      canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), maxWindowSelfTimeMs: rounded(maxWindowSelfTimeMs), evidenceLevel: 'measured' as const, methodEvidence: roundedEvidence(methodEvidence),
      commandStatuses,
    };
  }).sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs || right.maxWindowSelfTimeMs - left.maxWindowSelfTimeMs || right.rasterOperationCount - left.rasterOperationCount || left.canvasId.localeCompare(right.canvasId));
}

function episodeCanvasSummary(canvasId: string, reports: RecordedCanvasWindow[], episodeResetEvents: RecordedResetEvent[]): RecordedEpisodeCanvasSummary {
  let rasterOperationCount = 0; let canvasApiSelfTimeMs = 0; let maxWindowSelfTimeMs = 0;
  const methodEvidence: Record<string, CanvasMethodEvidence> = {};
  for (const report of reports) { rasterOperationCount += report.rasterOperationCount; canvasApiSelfTimeMs += report.canvasApiSelfTimeMs; maxWindowSelfTimeMs = Math.max(maxWindowSelfTimeMs, report.canvasApiSelfTimeMs); addEvidence(methodEvidence, report.methodEvidence); }
  return { canvasId, activeWindowCount: reports.length, rasterOperationCount, canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), maxWindowSelfTimeMs: rounded(maxWindowSelfTimeMs), methodEvidence: roundedEvidence(methodEvidence), resetEventCount: episodeResetEvents.filter(event => event.canvasId === canvasId).length };
}

function topMethods(evidence: Record<string, CanvasMethodEvidence>): RecordedTopMethod[] {
  return Object.entries(evidence).map(([method, value]) => ({ method, ...value })).sort((left, right) => (right.canvasApiSelfTimeMs ?? -Infinity) - (left.canvasApiSelfTimeMs ?? -Infinity) || right.count - left.count || left.method.localeCompare(right.method));
}

function episodesAndFindings(): { episodes: RecordedDrawEpisode[]; findings: InvestigationFinding[] } {
  const groups: RecordedCanvasWindow[][] = [];
  let group: RecordedCanvasWindow[] | undefined;
  let previousIndex: number | undefined;
  let boundaryIndex: number | undefined;
  for (const window of windows) {
    if (window.windowIndex !== boundaryIndex) {
      if (previousIndex === undefined || window.windowIndex - previousIndex >= 3) {
        group = [];
        groups.push(group);
      }
      previousIndex = window.windowIndex;
      boundaryIndex = window.windowIndex;
    }
    group!.push(window);
  }
  const episodeMaximumWindows = new Map<string, Map<string, RecordedCanvasWindow>>();
  const episodes = groups.map((reports, index) => {
    const first = reports[0]; const last = reports.at(-1)!; const methodEvidence: Record<string, CanvasMethodEvidence> = {};
    let rasterOperationCount = 0; let canvasApiSelfTimeMs = 0;
    for (const report of reports) { rasterOperationCount += report.rasterOperationCount; canvasApiSelfTimeMs += report.canvasApiSelfTimeMs; addEvidence(methodEvidence, report.methodEvidence); }
    const reportsByCanvas = new Map<string, RecordedCanvasWindow[]>();
    for (const report of reports) {
      const canvasReports = reportsByCanvas.get(report.canvasId) ?? [];
      canvasReports.push(report);
      reportsByCanvas.set(report.canvasId, canvasReports);
    }
    const maximumWindows = new Map<string, RecordedCanvasWindow>();
    for (const [canvasId, canvasReports] of reportsByCanvas) {
      maximumWindows.set(canvasId, canvasReports.reduce((largest, report) => report.canvasApiSelfTimeMs > largest.canvasApiSelfTimeMs ? report : largest));
    }
    const episodeResetEvents = resetEvents.filter(event => event.windowIndex >= first.windowIndex && event.windowIndex <= last.windowIndex);
    const canvases = [...reportsByCanvas].map(([canvasId, canvasReports]) => episodeCanvasSummary(canvasId, canvasReports, episodeResetEvents));
    const episodeId = `${sessionId}:episode:${index + 1}`;
    episodeMaximumWindows.set(episodeId, maximumWindows);
    return { episodeId, firstWindowIndex: first.windowIndex, lastWindowIndex: last.windowIndex, startedAtTimestampMs: first.timestampMs, endedAtTimestampMs: last.timestampMs, activeWindowCount: new Set(reports.map(report => report.windowIndex)).size, rasterOperationCount, canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), methodEvidence: roundedEvidence(methodEvidence), canvases, resetEventCount: episodeResetEvents.length };
  });
  const findings: InvestigationFinding[] = [];
  for (const episode of episodes) for (const canvas of episode.canvases) if (canvas.canvasApiSelfTimeMs >= HEAVY_CANVAS_WORK_THRESHOLD_MS) {
    const maximum = episodeMaximumWindows.get(episode.episodeId)!.get(canvas.canvasId)!;
    findings.push({ type: 'heavy-canvas-work', evidenceLevel: 'candidate', canvasId: canvas.canvasId, episodeId: episode.episodeId, canvasApiSelfTimeMs: canvas.canvasApiSelfTimeMs, rasterOperationCount: canvas.rasterOperationCount, topMethods: topMethods(canvas.methodEvidence), maximumWindow: { windowIndex: maximum.windowIndex, timestampMs: maximum.timestampMs, canvasApiSelfTimeMs: maximum.canvasApiSelfTimeMs, rasterOperationCount: maximum.rasterOperationCount, methodEvidence: copyEvidence(maximum.methodEvidence) }, claimBoundary: { ...HEAVY_CANVAS_WORK_CLAIM }, nextCheck: HEAVY_CANVAS_WORK_NEXT_CHECK });
  }
  for (const episode of episodes) {
    const reports = windows.filter(window => window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex);
    for (const canvas of episode.canvases) {
      const canvasReports = reports.filter(window => window.canvasId === canvas.canvasId);
      const repeatedWindows = canvasReports
        .filter(window => window.signatureStatus === 'same' && window.rasterOperationCount >= minRepeatedRasterOps)
        .map(({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }) => ({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }));
      if (repeatedWindows.length === 0) continue;
      findings.push({ type: 'repeated-draw-work', evidenceLevel: 'candidate', canvasId: canvas.canvasId, episodeId: episode.episodeId, repeatedWindowCount: repeatedWindows.length, rasterOperationCount: repeatedWindows.reduce((total, window) => total + window.rasterOperationCount, 0), canvasApiSelfTimeMs: rounded(repeatedWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)), repeatedWindows, unknownCoverage: { unknownWindowCount: canvasReports.filter(window => window.signatureStatus === 'unknown').length, activeWindowCount: canvasReports.length }, claimBoundary: { ...REPEATED_DRAW_WORK_CLAIM }, nextCheck: REPEATED_DRAW_WORK_NEXT_CHECK });
    }
  }
  for (const canvasId of [...new Set(resetEvents.map(event => event.canvasId))]) {
    const observed = resetEvents.filter(event => event.canvasId === canvasId);
    const qualifying = observed.filter(event => event.activeRasterOverlap);
    if (qualifying.length < 2) continue;
    const reportedWindows = new Map(windows.filter(window => window.canvasId === canvasId).map(window => [window.windowIndex, window]));
    const qualifyingWindows = [...new Map(qualifying.map(event => {
      const key = event.windowIndex;
      const report = reportedWindows.get(key);
      return [key, report ?? {
        canvasId,
        windowIndex: event.windowIndex,
        timestampMs: event.timestampMs,
        rasterOperationCount: event.rasterOperationCount,
        canvasApiSelfTimeMs: 0,
        signatureStatus: event.commandStatus,
        unknownReason: event.unknownReason,
        geometry: { backingWidth: null, backingHeight: null, cssWidth: null, cssHeight: null, devicePixelRatio: null, expectedBackingWidth: null, expectedBackingHeight: null, expectedPixelArea: null, actualToExpectedAreaRatio: null, unavailableReason: 'unavailable' },
      }];
    })).values()];
    const affectedEpisodeIds = episodes.filter(episode => qualifying.some(event => event.windowIndex >= episode.firstWindowIndex && event.windowIndex <= episode.lastWindowIndex)).map(episode => episode.episodeId);
    const commandStatuses = { same: 0, changed: 0, unknown: 0 };
    const unknownReasons: Record<string, number> = {};
    for (const window of qualifyingWindows) { commandStatuses[window.signatureStatus]++; if (window.unknownReason) unknownReasons[window.unknownReason] = (unknownReasons[window.unknownReason] ?? 0) + 1; }
    const finding: ResizeChurnFinding = { type: 'resize-churn', evidenceLevel: 'candidate', canvasId, observedResetCount: observed.length, activeResetCount: qualifying.length, resetEvents: qualifying.map(({ source, width, height, windowIndex, timestampMs }) => ({ source, width, height, windowIndex, timestampMs })), affectedEpisodeIds, commandStatuses, unknownReasons, canvasApiSelfTimeMs: rounded(qualifyingWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)), rasterOperationCount: qualifyingWindows.reduce((total, window) => total + window.rasterOperationCount, 0), claimBoundary: { ...RESIZE_CHURN_CLAIM }, nextCheck: RESIZE_CHURN_NEXT_CHECK };
    findings.push(finding);
  }
  for (const canvasId of [...new Set(windows.map(window => window.canvasId))]) {
    const qualifying = windows.filter(window => window.canvasId === canvasId && window.rasterOperationCount > 0 && hasBackingStoreMismatch(window.geometry));
    const distinct = [...new Map(qualifying.map(window => [window.windowIndex, window])).values()];
    if (distinct.length < 2) continue;
    const affectedEpisodeIds = episodes.filter(episode => distinct.some(window => window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex)).map(episode => episode.episodeId);
    const finding: BackingStoreMismatchFinding = {
      type: 'backing-store-mismatch', evidenceLevel: 'candidate', canvasId, affectedWindowCount: distinct.length,
      affectedWindows: distinct.map(window => ({ windowIndex: window.windowIndex, timestampMs: window.timestampMs, backingWidth: window.geometry.backingWidth, backingHeight: window.geometry.backingHeight, expectedBackingWidth: window.geometry.expectedBackingWidth, expectedBackingHeight: window.geometry.expectedBackingHeight, expectedPixelArea: window.geometry.expectedPixelArea, actualToExpectedAreaRatio: window.geometry.actualToExpectedAreaRatio, rasterOperationCount: window.rasterOperationCount, canvasApiSelfTimeMs: window.canvasApiSelfTimeMs })),
      affectedEpisodeIds, rasterOperationCount: distinct.reduce((total, window) => total + window.rasterOperationCount, 0), canvasApiSelfTimeMs: rounded(distinct.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)), claimBoundary: { ...BACKING_STORE_MISMATCH_CLAIM }, nextCheck: BACKING_STORE_MISMATCH_NEXT_CHECK,
    };
    findings.push(finding);
  }
  findings.sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs || right.rasterOperationCount - left.rasterOperationCount || left.type.localeCompare(right.type) || left.canvasId.localeCompare(right.canvasId));
  return { episodes, findings };
}

function finish(stopReason: RecordingStopReason): InvestigationSessionV1 | undefined {
  if (state !== 'recording') return undefined;
  drainAttributeRecords();
  const endedMonotonic = now();
  const pendingWindowIndex = getCurrentWindowIndex() + 1;
  for (const record of records) {
    const pending = takeResetEvents(record);
    if (!pending?.length) continue;
    const offset = recordingStartOffsets.get(record.id);
    const rasterOperationCount = Math.max(0, record.rasterOps - (offset?.rasterOperationCount ?? 0));
    for (const event of pending) captureResetEvent({
      ...event,
      canvasId: record.id,
      windowIndex: pendingWindowIndex,
      timestampMs: endedMonotonic,
      rasterOperationCount,
      activeRasterOverlap: rasterOperationCount > 0,
      commandStatus: 'unknown',
      unknownReason: record.resetPendingReason,
    });
  }
  setMethodEvidenceCollectionEnabled(false);
  setResetEventCollectionEnabled(false);
  recordingStartOffsets.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  unsubscribeResetEvents?.();
  unsubscribeResetEvents = undefined;
  unsubscribeLifecycleEvents?.();
  unsubscribeLifecycleEvents = undefined;
  const derived = episodesAndFindings();
  lastSession = {
    schemaVersion: 1, sessionId, startedAt, endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Number((endedMonotonic - startedMonotonic).toFixed(3))),
    stopReason, canvasScanVersion: '0.3.1', browserFeatures: { monotonicTime: typeof performance !== 'undefined' },
    canvases: summaries(), windows: windows.map(copyWindow), resetEvents: resetEvents.map(copyResetEvent), lifecycleEvents: lifecycleEvents.map(copyLifecycleEvent), episodes: derived.episodes, findings: derived.findings,
    collectionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000 },
    droppedEntryCounts: { canvasWindowReports: droppedWindows, canvasLifetimes: droppedCanvases, resetEvents: droppedResetEvents, lifecycleEvents: droppedLifecycleEvents },
  };
  state = 'complete';
  notify();
  return copySession(lastSession);
}

export function startRecording(): void {
  if (state === 'recording') return;
  recordingStartWindowIndex = getCurrentWindowIndex();
  recordingStartOffsets = new Map([...records].map(record => [record.id, {
    rasterOperationCount: record.rasterOps,
    canvasApiSelfTimeMs: record.selfTimeMs,
  }]));
  setMethodEvidenceCollectionEnabled(true);
  setResetEventCollectionEnabled(true);
  startedAt = new Date().toISOString();
  startedMonotonic = now();
  sessionId = `canvas-scan-${Date.parse(startedAt)}-${++sequence}`;
  windows = [];
  resetEvents = [];
  lifecycleEvents = [];
  canvasIds = [];
  droppedWindows = 0;
  droppedCanvases = 0;
  droppedResetEvents = 0;
  droppedLifecycleEvents = 0;
  state = 'recording';
  unsubscribe = subscribeToReports((report, canvas, metadata) => {
    if (!metadata) return;
    const offset = recordingStartOffsets.get(report.canvasId);
    recordingStartOffsets.delete(report.canvasId);
    const copied = copyReport(report);
    if (offset && metadata.windowIndex === recordingStartWindowIndex + 1) {
      copied.rasterOperationCount = Math.max(0, copied.rasterOperationCount - offset.rasterOperationCount);
      copied.canvasApiSelfTimeMs = rounded(Math.max(0, copied.canvasApiSelfTimeMs - offset.canvasApiSelfTimeMs));
    }
    capture({ ...copied, ...metadata, geometry: collectCanvasGeometry(canvas) });
  });
  unsubscribeResetEvents = subscribeToResetEvents(event => {
    if (state !== 'recording' || event.windowIndex <= recordingStartWindowIndex) return;
    const offset = recordingStartOffsets.get(event.canvasId);
    if (offset && event.windowIndex === recordingStartWindowIndex + 1) {
      const rasterOperationCount = Math.max(0, event.rasterOperationCount - offset.rasterOperationCount);
      captureResetEvent({ ...event, rasterOperationCount, activeRasterOverlap: rasterOperationCount > 0 });
    } else captureResetEvent(event);
  });
  unsubscribeLifecycleEvents = subscribeToLifecycleEvents(event => {
    if (event.windowIndex > recordingStartWindowIndex) captureLifecycleEvent(event);
  });
  timer = setTimeout(() => { finish('max-duration'); }, MAX_DURATION_MS);
  lastSession = undefined;
  notify();
}

export function configureRecording(options: CanvasScanOptions): void {
  minRepeatedRasterOps = options.minFlashRasterOps ?? 2;
}

export function stopRecording(): InvestigationSessionV1 | undefined { return finish('manual'); }
export function getLastSession(): InvestigationSessionV1 | undefined { return lastSession ? copySession(lastSession) : undefined; }
export function getRecordingState(): RecordingState { return state; }
export function subscribeToRecordingState(listener: (next: RecordingState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRecordingForTests(): void {
  setMethodEvidenceCollectionEnabled(false);
  setResetEventCollectionEnabled(false);
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  unsubscribeResetEvents?.();
  unsubscribeResetEvents = undefined;
  unsubscribeLifecycleEvents?.();
  unsubscribeLifecycleEvents = undefined;
  state = 'idle';
  lastSession = undefined;
  windows = [];
  resetEvents = [];
  lifecycleEvents = [];
  canvasIds = [];
  droppedWindows = 0;
  droppedCanvases = 0;
  droppedResetEvents = 0;
  droppedLifecycleEvents = 0;
  recordingStartWindowIndex = 0;
  recordingStartOffsets.clear();
  minRepeatedRasterOps = 2;
  sequence = 0;
  listeners.clear();
}
