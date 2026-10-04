import { copyReport, getCurrentWindowIndex, setRecordingWindowRangeTracking, subscribeToLifecycleEvents, subscribeToReports, subscribeToResetEvents } from './frame-loop.js';
import { drainAttributeRecords, getConnectionState, getRecord, isKilled, reactivateRecord, records, setMethodEvidenceCollectionEnabled, setResetEventCollectionEnabled, takeResetEvents, type CanvasRecord } from './wrap-context.js';
import { collectCanvasGeometry } from './geometry.js';
import { markBrowserEvidence, resetBrowserEvidence, startBrowserEvidence, stopBrowserEvidence } from './browser-evidence.js';
import { captureBoundary, captureCommand, createCommandCapture, disableCommandCapture, finishCommandCapture, getLiveCommandRelationship, resetCommandCaptureForTests } from './command-capture.js';
import { captureDrawCallsite, createDrawCallsiteCapture, disableDrawCallsiteCapture, finishDrawCallsiteCapture, resetDrawCallsiteForTests, resolveDrawCallsiteBoundary, settleDrawCallsiteCaptureForTests, shouldCaptureFirstDifference, shouldCaptureFirstRaster, shouldCaptureHeaviestMethod } from './draw-callsite.js';
import { subscribeToSelectedCommands } from './wrap-context.js';
import type {
  AttributionKind,
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
  RecordedBrowserEvidenceEntry,
  RecordedEpisodeAssociation,
  ExplanationArtifactV1,
  ExplanationSelection,
  ExplanationStartResult,
  ExplanationLimitResult,
  ExplanationCallsiteCoverage,
} from './types.js';

const MAX_DURATION_MS = 30000;
const EXPLANATION_MAX_DURATION_MS = 10000;
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
const HEAVY_CANVAS_WORK_AFTER_RESET_NEXT_CHECK = 'The slowest window followed a canvas reset. The backing-store reallocation cost lands on the next context call. Check the sizing code before you check the top measured methods.';
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
  // The displayed size is read from getBoundingClientRect, which reflects CSS
  // transforms. A canvas scaled down by CSS is genuinely over-provisioned for
  // the size it is displayed at, so the ratio stands — but a reader has to know
  // a transform can be the whole reason, or they go hunting a sizing bug that
  // is not in the sizing code.
  nonEstablishedFacts: 'The evidence does not establish GPU cost, render cost, or the required image quality. The displayed size includes any CSS transform on the canvas, so a scaled-down canvas raises this ratio without its backing store changing.',
};
const BACKING_STORE_MISMATCH_NEXT_CHECK = 'Check the canvas sizing policy, any CSS transform on the canvas, and the required image quality.';

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
// Canvases the MAX_CANVASES cap evicted, folded down to the totals a
// finding is derived from. Keyed by canvas id, so a canvas that draws
// again after eviction merges rather than appearing twice.
type EvictedCanvasTotals = Omit<RecordedCanvasSummary, 'canvasId' | 'evidenceLevel' | 'windowDetailDropped' | 'observability'>;
let evictedCanvasTotals = new Map<string, EvictedCanvasTotals>();
let droppedCanvases = 0;
let droppedWindows = 0;
let droppedResetEvents = 0;
let droppedLifecycleEvents = 0;
let sequence = 0;
let explanationSequence = 0;
let lastExplanation: ExplanationArtifactV1 | undefined;
let recordsForCompletedSession = new Map<string, CanvasRecord>();
let recordsForRecordingSession = new Map<string, CanvasRecord>();
let activeExplanation: {
  explanationId: string;
  sessionId: string;
  findingIndex: number;
  findingType: InvestigationFinding['type'];
  canvasId: string;
  record: CanvasRecord;
  capture: NonNullable<ReturnType<typeof createCommandCapture>>;
  callsites: ReturnType<typeof createDrawCallsiteCapture>;
  unsubscribeDetail: () => void;
  selectedCanvasRejections: number;
  selectableFindingIndexes: Set<number>;
} | undefined;
let unsubscribe: (() => void) | undefined;
let unsubscribeResetEvents: (() => void) | undefined;
let unsubscribeLifecycleEvents: (() => void) | undefined;
let recordingStartWindowIndex = 0;
let minRepeatedRasterOps = 2;
let captureEvery = 1;
let recordingStartOffsets = new Map<string, { rasterOperationCount: number; canvasApiSelfTimeMs: number }>();
let browserEntries: RecordedBrowserEvidenceEntry[] = [];
let episodeAssociations: RecordedEpisodeAssociation[] = [];
let browserFeatures = { eventTiming: false, longAnimationFrames: false };
let browserDropped = { documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 };
const listeners = new Set<(state: RecordingState) => void>();

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

// The clock's floor is measured rather than assumed. Chrome coarsens
// performance.now() to 100 µs unless the page is cross-origin isolated, so most
// single canvas calls read as 0 or 0.1 ms; a reader needs that floor to tell a
// self-time delta from tick straddling. The smallest nonzero step between
// consecutive reads, over a few ticks, is the resolution on this page.
function measureTimerResolutionMs(): number {
  let resolution = Infinity;
  let previous = now();
  for (let ticks = 0, reads = 0; ticks < 4 && reads < 20000; reads++) {
    const current = now();
    const delta = current - previous;
    if (delta > 0) { ticks++; if (delta < resolution) resolution = delta; }
    previous = current;
  }
  return resolution === Infinity ? 0 : Number(resolution.toFixed(6));
}

function copyWindow(window: RecordedCanvasWindow): RecordedCanvasWindow {
  return { ...copyReport(window), windowIndex: window.windowIndex, timestampMs: window.timestampMs, startedAtTimestampMs: window.startedAtTimestampMs, endedAtTimestampMs: window.endedAtTimestampMs, geometry: { ...window.geometry } };
}
function copyBrowserEntry(entry: RecordedBrowserEvidenceEntry): RecordedBrowserEvidenceEntry { return JSON.parse(JSON.stringify(entry)); }
function copyExplanation(explanation: ExplanationArtifactV1): ExplanationArtifactV1 { return JSON.parse(JSON.stringify(explanation)); }

function explanationLimits(detail: NonNullable<ReturnType<typeof finishCommandCapture>>, callsites: NonNullable<ReturnType<typeof finishDrawCallsiteCapture>>, durationStops: number, selectedCanvasRejections: number): { limitResults: ExplanationLimitResult[]; callsiteCoverage: ExplanationCallsiteCoverage } {
  const coordinates = (value: any, scope: 'window' | 'command') => value && Number.isInteger(value.windowIndex) && value.windowIndex >= 0 && (scope === 'window' || Number.isInteger(value.commandOrdinal))
    ? { scope, windowIndex: value.windowIndex, commandOrdinal: scope === 'window' ? null : value.commandOrdinal } as const : null;
  const items: Array<[ExplanationLimitResult['name'], number, number, Exclude<ExplanationLimitResult['reason'], null>, ExplanationLimitResult['firstAffected']]> = [
    ['duration-ms', 10000, durationStops, 'max-duration', durationStops ? { scope: 'explanation', windowIndex: null, commandOrdinal: null } : null],
    ['selected-canvases', 1, selectedCanvasRejections, 'selected-canvas-limit', selectedCanvasRejections ? { scope: 'explanation', windowIndex: null, commandOrdinal: null } : null],
    ['active-windows', 120, detail.droppedEntryCounts.activeWindows, 'window-limit', coordinates(detail.firstAffected.activeWindows, 'window')],
    ['command-entries', 5000, detail.droppedEntryCounts.commandEntries, 'command-limit', coordinates(detail.firstAffected.commandEntries, 'command')],
    ['arguments-per-command', 20, detail.droppedEntryCounts.commandArguments, 'argument-limit', coordinates(detail.firstAffected.commandArguments, 'command')],
    ['value-tokens', 1024, detail.droppedEntryCounts.valueTokens, 'value-token-limit', coordinates(detail.firstAffected.valueTokens, 'command')],
    ['stack-samples', 8, callsites.droppedEntryCounts.stackSamples, 'stack-sample-limit', coordinates(callsites.firstAffected.stackSamples, 'command')],
    ['frames-per-stack', 20, callsites.droppedEntryCounts.stackFrames, 'stack-frame-limit', coordinates(callsites.firstAffected.stackFrames, 'command')],
    ['source-map-lookups', 8, callsites.droppedEntryCounts.sourceMapLookups, 'source-map-lookup-limit', coordinates(callsites.firstAffected.sourceMapLookups, 'command')],
    ['source-map-response-bytes', 2097152, callsites.droppedEntryCounts.sourceMapResponses, 'source-map-too-large', coordinates(callsites.firstAffected.sourceMapResponses, 'command')],
  ];
  const limitResults = items.map(([name, maximum, rejectedCount, reason, firstAffected]) => ({ name, maximum, rejectedCount, reason: rejectedCount ? reason : null, firstAffected: rejectedCount ? firstAffected : null }));
  const callsiteReasons = limitResults.slice(6).filter(result => result.rejectedCount).map(result => result.reason!) as ExplanationCallsiteCoverage['incompleteReasons'];
  return { limitResults, callsiteCoverage: { status: callsiteReasons.length ? 'incomplete' : 'complete', incompleteReasons: callsiteReasons } };
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
    browserEntries: session.browserEntries.map(copyBrowserEntry),
    episodeAssociations: session.episodeAssociations.map(association => ({ ...association })),
    findings: session.findings.map(finding => finding.type === 'heavy-canvas-work'
      ? { ...finding, topMethods: finding.topMethods.map(method => ({ ...method })), maximumWindow: { ...finding.maximumWindow, methodEvidence: copyEvidence(finding.maximumWindow.methodEvidence) }, claimBoundary: { ...finding.claimBoundary } }
      : finding.type === 'repeated-draw-work'
        ? { ...finding, repeatedWindows: finding.repeatedWindows.map(window => ({ ...window })), unknownCoverage: { ...finding.unknownCoverage }, claimBoundary: { ...finding.claimBoundary } }
        : finding.type === 'resize-churn'
          ? { ...finding, resetEvents: finding.resetEvents.map(event => ({ ...event })), dimensionChanges: { ...finding.dimensionChanges }, affectedEpisodeIds: [...finding.affectedEpisodeIds], commandStatuses: { ...finding.commandStatuses }, unknownReasons: { ...finding.unknownReasons }, claimBoundary: { ...finding.claimBoundary } }
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
  recordsForRecordingSession.delete(canvasId);
  // The windows of an evicted canvas were folded into its totals, so they are
  // not lost reports. canvasWindowReports counts only the frames the window
  // cap dropped.
  windows = windows.filter(window => window.canvasId !== canvasId);
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
  recordsForRecordingSession.delete(canvasId);
}

// Applications that treat canvases as cache entries — one per element, per
// tile, per layer — reach MAX_CANVASES in seconds. Excalidraw created 228 in
// 18 seconds, and evicting the oldest used to take its windows, resets and
// lifecycle events with it: 43% of that recording, gone, with findings then
// derived from what survived. The windows are the bulk of the memory, so the
// totals they add up to are kept and only the per-window detail is dropped.
// The session then still says something true about every canvas it saw.
function foldWindowsIntoTotals(canvasId: string): boolean {
  const retained = windows.filter(window => window.canvasId === canvasId);
  // No window means no summary to keep. The canvas is forgotten as before, and
  // the count below says so — a summary of nothing would be an empty promise.
  if (retained.length === 0) return false;
  const totals = evictedCanvasTotals.get(canvasId) ?? {
    nearestReactOwner: null, attributionKind: 'unattributed' as AttributionKind, sourceLocation: null,
    activeWindowCount: 0, rasterOperationCount: 0, canvasApiSelfTimeMs: 0, maxWindowSelfTimeMs: 0,
    methodEvidence: {} as Record<string, CanvasMethodEvidence>,
    commandStatuses: { same: 0, changed: 0, unknown: 0 },
  };
  for (const window of retained) {
    totals.commandStatuses[window.signatureStatus]++;
    totals.activeWindowCount++;
    totals.rasterOperationCount += window.rasterOperationCount;
    totals.canvasApiSelfTimeMs += window.canvasApiSelfTimeMs;
    totals.maxWindowSelfTimeMs = Math.max(totals.maxWindowSelfTimeMs, window.canvasApiSelfTimeMs);
    addEvidence(totals.methodEvidence, window.methodEvidence);
  }
  const latest = retained[retained.length - 1];
  totals.nearestReactOwner = latest.nearestReactOwner;
  totals.attributionKind = latest.attributionKind;
  totals.sourceLocation = latest.sourceLocation ? { ...latest.sourceLocation } : null;
  evictedCanvasTotals.set(canvasId, totals);
  return true;
}

function retainCanvas(canvasId: string): void {
  if (canvasIds.includes(canvasId)) return;
  if (canvasIds.length === MAX_CANVASES) {
    if (!foldWindowsIntoTotals(canvasIds[0])) droppedCanvases++;
    removeCanvas(canvasIds[0]);
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
  // An evicted canvas keeps its entry here even though no window of it
  // survives. A canvas that was evicted and then drew again appears once, with
  // the two halves added together.
  // A canvas handed to a worker keeps its entry too, with or without a window.
  // Its drawing is out of reach, and the alternative — no row at all — reads
  // as a canvas that cost nothing.
  const transferred = new Set(lifecycleEvents.filter(event => event.type === 'transferred-to-worker').map(event => event.canvasId));
  const reported = [...new Set([...evictedCanvasTotals.keys(), ...canvasIds.filter(canvasId => transferred.has(canvasId) || windows.some(window => window.canvasId === canvasId))])];
  return reported.map(canvasId => {
    const retained = windows.filter(window => window.canvasId === canvasId);
    const evicted = evictedCanvasTotals.get(canvasId);
    const latest = retained[retained.length - 1];
    const commandStatuses = { ...(evicted?.commandStatuses ?? { same: 0, changed: 0, unknown: 0 }) };
    let rasterOperationCount = evicted?.rasterOperationCount ?? 0;
    let canvasApiSelfTimeMs = evicted?.canvasApiSelfTimeMs ?? 0;
    let maxWindowSelfTimeMs = evicted?.maxWindowSelfTimeMs ?? 0;
    const methodEvidence: Record<string, CanvasMethodEvidence> = copyEvidence(evicted?.methodEvidence ?? {});
    for (const window of retained) {
      commandStatuses[window.signatureStatus]++;
      rasterOperationCount += window.rasterOperationCount;
      canvasApiSelfTimeMs += window.canvasApiSelfTimeMs;
      maxWindowSelfTimeMs = Math.max(maxWindowSelfTimeMs, window.canvasApiSelfTimeMs);
      addEvidence(methodEvidence, window.methodEvidence);
    }
    // The newest window wins the attribution, and the evicted half supplies it
    // only when no window survives. Chosen by which half exists, not by which
    // value is nullish — an unattributed canvas has a real null owner.
    // A transferred canvas can have neither half: nothing drew through it here.
    const attributedFrom = latest ?? evicted;
    return {
      canvasId,
      nearestReactOwner: attributedFrom?.nearestReactOwner ?? null,
      attributionKind: attributedFrom?.attributionKind ?? 'unattributed',
      sourceLocation: attributedFrom?.sourceLocation ? { ...attributedFrom.sourceLocation } : null,
      activeWindowCount: (evicted?.activeWindowCount ?? 0) + retained.length,
      rasterOperationCount,
      canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), maxWindowSelfTimeMs: rounded(maxWindowSelfTimeMs), evidenceLevel: 'measured' as const, methodEvidence: roundedEvidence(methodEvidence),
      commandStatuses,
      windowDetailDropped: evicted !== undefined,
      observability: transferred.has(canvasId) ? 'unobservable' as const : 'observable' as const,
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
      // Three boundaries of stillness end an episode. Sampling makes reported
      // indices at least captureEvery apart, so the gap scales with it —
      // otherwise every reported window becomes its own episode at
      // captureEvery 3 and the per-episode heavy-work gate never fires.
      if (previousIndex === undefined || window.windowIndex - previousIndex >= 3 * captureEvery) {
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
    return { episodeId, firstWindowIndex: first.windowIndex, lastWindowIndex: last.windowIndex, startedAtTimestampMs: Math.min(...reports.map(report => report.startedAtTimestampMs)), endedAtTimestampMs: Math.max(...reports.map(report => report.endedAtTimestampMs)), activeWindowCount: new Set(reports.map(report => report.windowIndex)).size, rasterOperationCount, canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), methodEvidence: roundedEvidence(methodEvidence), canvases, resetEventCount: episodeResetEvents.length };
  });
  const findings: InvestigationFinding[] = [];
  for (const episode of episodes) for (const canvas of episode.canvases) if (canvas.canvasApiSelfTimeMs >= HEAVY_CANVAS_WORK_THRESHOLD_MS) {
    const maximum = episodeMaximumWindows.get(episode.episodeId)!.get(canvas.canvasId)!;
    findings.push({ type: 'heavy-canvas-work', evidenceLevel: 'candidate', canvasId: canvas.canvasId, episodeId: episode.episodeId, canvasApiSelfTimeMs: canvas.canvasApiSelfTimeMs, rasterOperationCount: canvas.rasterOperationCount, topMethods: topMethods(canvas.methodEvidence), maximumWindow: { windowIndex: maximum.windowIndex, timestampMs: maximum.timestampMs, canvasApiSelfTimeMs: maximum.canvasApiSelfTimeMs, rasterOperationCount: maximum.rasterOperationCount, followsCanvasReset: maximum.followsCanvasReset, methodEvidence: copyEvidence(maximum.methodEvidence) }, gateThresholdMs: HEAVY_CANVAS_WORK_THRESHOLD_MS, gateExcessMs: rounded(canvas.canvasApiSelfTimeMs - HEAVY_CANVAS_WORK_THRESHOLD_MS), claimBoundary: { ...HEAVY_CANVAS_WORK_CLAIM }, nextCheck: maximum.followsCanvasReset ? HEAVY_CANVAS_WORK_AFTER_RESET_NEXT_CHECK : HEAVY_CANVAS_WORK_NEXT_CHECK });
  }
  for (const episode of episodes) {
    const reports = windows.filter(window => window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex);
    for (const canvas of episode.canvases) {
      const canvasReports = reports.filter(window => window.canvasId === canvas.canvasId);
      const repeatedWindows = canvasReports
        .filter(window => window.signatureStatus === 'same' && window.rasterOperationCount >= minRepeatedRasterOps)
        .map(({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }) => ({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }));
      if (repeatedWindows.length === 0) continue;
      // Labeling only: back-to-back windows that drew the same command stream
      // and the same number of raster operations. Nothing is suppressed.
      //
      // This used to be called strictModeStyleDuplicates and also required the
      // two self-times to be equal. Neither part held up. Equality after
      // rounding to three decimals is trivially true for cheap draws, so the
      // field fired on applications with no Strict Mode in them; and React's
      // Strict Mode double-invokes inside one commit, so its duplicate draws
      // land in the same window rather than in two adjacent ones. What is left
      // is what can be measured: adjacent identical redraws.
      let adjacentIdenticalWindowPairs = 0;
      for (let index = 1; index < repeatedWindows.length; index++) {
        if (
          repeatedWindows[index].windowIndex - repeatedWindows[index - 1].windowIndex === 1 &&
          repeatedWindows[index].rasterOperationCount === repeatedWindows[index - 1].rasterOperationCount
        ) adjacentIdenticalWindowPairs++;
      }
      findings.push({ type: 'repeated-draw-work', evidenceLevel: 'candidate', canvasId: canvas.canvasId, episodeId: episode.episodeId, repeatedWindowCount: repeatedWindows.length, rasterOperationCount: repeatedWindows.reduce((total, window) => total + window.rasterOperationCount, 0), canvasApiSelfTimeMs: rounded(repeatedWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)), repeatedWindows, adjacentIdenticalWindowPairs, unknownCoverage: { unknownWindowCount: canvasReports.filter(window => window.signatureStatus === 'unknown').length, activeWindowCount: canvasReports.length }, claimBoundary: { ...REPEATED_DRAW_WORK_CLAIM }, nextCheck: REPEATED_DRAW_WORK_NEXT_CHECK });
    }
  }
  for (const canvasId of [...new Set(resetEvents.map(event => event.canvasId))]) {
    const observed = resetEvents.filter(event => event.canvasId === canvasId);
    const qualifying = observed.filter(event => event.activeRasterOverlap);
    // The gate wants resets in two windows the application actually drew in.
    // A reset flushed at the stop carries a window index no frame closed, so
    // it cannot be the second one — otherwise the finding exists because of
    // when the user pressed Stop.
    if (new Set(qualifying.filter(event => !event.flushedAtStop).map(event => event.windowIndex)).size < 2) continue;
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
    const dimensionChanges = { changed: 0, unchanged: 0, unavailable: 0 };
    for (const event of qualifying) dimensionChanges[event.dimensionChange]++;
    const finding: ResizeChurnFinding = { type: 'resize-churn', evidenceLevel: 'candidate', canvasId, observedResetCount: observed.length, activeResetCount: qualifying.length, resetEvents: qualifying.map(({ source, width, height, windowIndex, timestampMs }) => ({ source, width, height, windowIndex, timestampMs })), dimensionChanges, affectedEpisodeIds, commandStatuses, unknownReasons, canvasApiSelfTimeMs: rounded(qualifyingWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)), rasterOperationCount: qualifyingWindows.reduce((total, window) => total + window.rasterOperationCount, 0), claimBoundary: { ...RESIZE_CHURN_CLAIM }, nextCheck: RESIZE_CHURN_NEXT_CHECK };
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

function deriveAssociations(episodes: RecordedDrawEpisode[]): RecordedEpisodeAssociation[] {
  const associations: RecordedEpisodeAssociation[] = [];
  for (const entry of browserEntries) for (const episode of episodes) {
    if (entry.startedAtTimestampMs > episode.endedAtTimestampMs || episode.startedAtTimestampMs > entry.endedAtTimestampMs) continue;
    associations.push({ entryId: entry.entryId, entryKind: entry.kind, episodeId: episode.episodeId, startedAtTimestampMs: Math.max(entry.startedAtTimestampMs, episode.startedAtTimestampMs), endedAtTimestampMs: Math.min(entry.endedAtTimestampMs, episode.endedAtTimestampMs), evidenceLevel: 'associated' });
  }
  return associations;
}

function finish(stopReason: RecordingStopReason): InvestigationSessionV1 | undefined {
  if (state !== 'recording') return undefined;
  const explanation = activeExplanation;
  const detail = explanation ? finishCommandCapture(explanation.capture, getCurrentWindowIndex() + 1, now()) : null;
  if (explanation && detail?.boundary) resolveDrawCallsiteBoundary(explanation.callsites, detail.boundary.identity, detail.boundary.windowIndex);
  const callsites = explanation ? finishDrawCallsiteCapture(explanation.callsites) : null;
  drainAttributeRecords();
  const endedMonotonic = now();
  const browser = stopBrowserEvidence(endedMonotonic);
  browserEntries = browser.entries;
  browserFeatures = browser.features;
  browserDropped = browser.dropped;
  const pendingWindowIndex = getCurrentWindowIndex() + 1;
  for (const record of records) {
    const pending = takeResetEvents(record);
    if (!pending?.length) continue;
    // record.rasterOps holds the operations since the last window boundary, so
    // the recording-start offset only applies when the recording began inside
    // the window that is still open. Subtracting it otherwise takes a
    // start-of-recording total off a since-last-boundary count.
    const offset = getCurrentWindowIndex() === recordingStartWindowIndex ? recordingStartOffsets.get(record.id) : undefined;
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
      flushedAtStop: true,
    });
  }
  setMethodEvidenceCollectionEnabled(false);
  setResetEventCollectionEnabled(false);
  setRecordingWindowRangeTracking(false);
  recordingStartOffsets.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  unsubscribeResetEvents?.();
  unsubscribeResetEvents = undefined;
  unsubscribeLifecycleEvents?.();
  unsubscribeLifecycleEvents = undefined;
  if (explanation) explanation.unsubscribeDetail();
  const derived = episodesAndFindings();
  episodeAssociations = deriveAssociations(derived.episodes);
  // Episodes exist only now, so the measures that line them up with a
  // DevTools trace are written at stop rather than as they happen.
  derived.episodes.forEach((episode, index) => { try { performance.measure(`canvas-scan:episode-${index + 1}`, { start: episode.startedAtTimestampMs, end: episode.endedAtTimestampMs }); } catch {} });
  lastSession = {
    schemaVersion: 1, sessionId, startedAt, endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Number((endedMonotonic - startedMonotonic).toFixed(3))),
    stopReason, canvasScanVersion: '0.7.2', captureEvery, browserFeatures: { monotonicTime: typeof performance !== 'undefined', ...browserFeatures },
    timeOrigin: typeof performance === 'undefined' ? 0 : performance.timeOrigin,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    timerResolutionMs: measureTimerResolutionMs(),
    canvases: summaries(), windows: windows.map(copyWindow), resetEvents: resetEvents.map(copyResetEvent), lifecycleEvents: lifecycleEvents.map(copyLifecycleEvent), episodes: derived.episodes, browserEntries: browserEntries.map(copyBrowserEntry), episodeAssociations: episodeAssociations.map(association => ({ ...association })), findings: derived.findings,
    collectionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 },
    // canvasLifetimes counts only the canvases eviction could keep nothing
    // about — the ones with no window to summarize. A canvas that had windows
    // keeps its totals and says so with windowDetailDropped. Its folded
    // windows are not lost reports, so canvasWindowReports counts only the
    // frames the window cap dropped.
    droppedEntryCounts: { canvasWindowReports: droppedWindows, canvasLifetimes: droppedCanvases, resetEvents: droppedResetEvents, lifecycleEvents: droppedLifecycleEvents, ...browserDropped },
  };
  recordsForCompletedSession = recordsForRecordingSession;
  if (explanation) {
    const durationStops = stopReason === 'max-duration' ? 1 : 0;
    const limits = explanationLimits(detail!, callsites!, durationStops, explanation.selectedCanvasRejections);
    lastExplanation = {
      schemaVersion: 1,
      explanationId: explanation.explanationId,
      startedAt: lastSession.startedAt,
      endedAt: lastSession.endedAt,
      durationMs: lastSession.durationMs,
      stopReason: lastSession.stopReason,
      canvasScanVersion: lastSession.canvasScanVersion,
      source: {
        sessionId: explanation.sessionId,
        findingIndex: explanation.findingIndex,
        findingType: explanation.findingType,
        canvasId: explanation.canvasId,
      },
      followUp: { sessionId: lastSession.sessionId, canvasId: explanation.canvasId },
      windows: detail!.windows,
      comparisons: detail!.comparisons,
      firstDifference: detail!.firstDifference,
      stacks: callsites!.stacks,
      collectionLimits: {
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
      },
      droppedEntryCounts: { durationStops, selectedCanvasRejections: explanation.selectedCanvasRejections, ...detail!.droppedEntryCounts, ...callsites!.droppedEntryCounts },
      limitResults: limits.limitResults,
      callsiteCoverage: limits.callsiteCoverage,
      firstGap: detail!.firstGap,
    };
    activeExplanation = undefined;
  }
  state = 'complete';
  notify();
  return copySession(lastSession);
}

function startRecordingWithDuration(durationMs: number): void {
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
  try { performance.mark('canvas-scan:recording-start'); } catch {}
  sessionId = `canvas-scan-${Date.parse(startedAt)}-${++sequence}`;
  windows = [];
  resetEvents = [];
  lifecycleEvents = [];
  canvasIds = [];
  droppedWindows = 0;
  evictedCanvasTotals = new Map();
  droppedCanvases = 0;
  droppedResetEvents = 0;
  droppedLifecycleEvents = 0;
  state = 'recording';
  setRecordingWindowRangeTracking(true, startedMonotonic);
  browserEntries = [];
  episodeAssociations = [];
  browserFeatures = startBrowserEvidence(startedMonotonic);
  browserDropped = { documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 };
  recordsForRecordingSession = new Map();
  unsubscribe = subscribeToReports((report, canvas, metadata) => {
    if (!metadata) return;
    if (metadata.windowIndex <= recordingStartWindowIndex) return;
    const offset = recordingStartOffsets.get(report.canvasId);
    recordingStartOffsets.delete(report.canvasId);
    const copied = copyReport(report);
    if (offset && metadata.windowIndex === recordingStartWindowIndex + 1) {
      copied.rasterOperationCount = Math.max(0, copied.rasterOperationCount - offset.rasterOperationCount);
      copied.canvasApiSelfTimeMs = rounded(Math.max(0, copied.canvasApiSelfTimeMs - offset.canvasApiSelfTimeMs));
    }
    capture({ ...copied, ...metadata, startedAtTimestampMs: metadata.startedAtTimestampMs ?? metadata.timestampMs, endedAtTimestampMs: metadata.endedAtTimestampMs ?? metadata.timestampMs, geometry: collectCanvasGeometry(canvas) });
    const record = getRecord(canvas);
    if (record?.id === report.canvasId && canvasIds.includes(report.canvasId)) recordsForRecordingSession.set(report.canvasId, record);
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
  timer = setTimeout(() => { finish('max-duration'); }, durationMs);
  lastSession = undefined;
  // The stored explanation names a session that no longer exists once this
  // recording starts, so it goes with it. startExplanation clears it too, for
  // the run that is about to produce a new one.
  lastExplanation = undefined;
  notify();
}

export function startRecording(): void { startRecordingWithDuration(MAX_DURATION_MS); }

export function configureRecording(options: CanvasScanOptions): void {
  // minFlashRasterOps still sets this when nothing more specific is given, so
  // an existing installation keeps the findings it had.
  minRepeatedRasterOps = options.minRepeatedRasterOps ?? options.minFlashRasterOps ?? 2;
  captureEvery = Math.max(1, Math.trunc(options.captureEvery ?? 1));
}

export function stopRecording(): InvestigationSessionV1 | undefined { return finish('manual'); }
export function startExplanation(selection: ExplanationSelection): ExplanationStartResult {
  if (activeExplanation) {
    const sameSelection = activeExplanation.sessionId === selection.sessionId && activeExplanation.findingIndex === selection.findingIndex;
    const validAlternative = activeExplanation.sessionId === selection.sessionId && activeExplanation.selectableFindingIndexes.has(selection.findingIndex);
    if (!sameSelection && validAlternative) activeExplanation.selectedCanvasRejections++;
    return { status: 'already-active' };
  }
  if (state === 'recording') return { status: 'unavailable', reason: 'recording-active' };
  if (isKilled()) return { status: 'unavailable', reason: 'instrumentation-disabled' };
  if (!lastSession) return { status: 'unavailable', reason: 'no-session' };
  if (selection.sessionId !== lastSession.sessionId) return { status: 'unavailable', reason: 'session-mismatch' };
  if (!Number.isInteger(selection.findingIndex) || selection.findingIndex < 0 || selection.findingIndex >= lastSession.findings.length) return { status: 'unavailable', reason: 'finding-not-found' };
  const finding = lastSession.findings[selection.findingIndex];
  const completedRecord = recordsForCompletedSession.get(finding.canvasId);
  const record = completedRecord ?? [...records].find(candidate => candidate.id === finding.canvasId);
  if (!record) return { status: 'unavailable', reason: 'canvas-unavailable' };
  if (!getConnectionState(record)) return { status: 'unavailable', reason: 'canvas-unavailable' };
  const capture = createCommandCapture();
  if (!capture) return { status: 'unavailable', reason: 'instrumentation-disabled' };
  reactivateRecord(record);
  const callsites = createDrawCallsiteCapture();
  // The heavy card names its top method, and the only stacks used to come
  // from the first raster call and the first differing command. Neither is
  // that method unless by luck, so the code that actually draws the hot path
  // was never named. One sample per window for the first call of that method
  // stays inside the same cap.
  const heaviestMethod = finding.type === 'heavy-canvas-work' ? finding.topMethods[0]?.method ?? null : null;
  const started = new Date().toISOString();
  const unsubscribeDetail = subscribeToSelectedCommands(
    record,
    (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
    (windowIndex, timestampMs, active, sampled) => {
      const boundary = captureBoundary(capture, windowIndex, timestampMs, active, sampled);
      if (boundary) resolveDrawCallsiteBoundary(callsites, boundary.identity, boundary.windowIndex);
    },
    () => { disableCommandCapture(capture); disableDrawCallsiteCapture(callsites); },
    (command, rasterOperation, stackBoundary) => {
      const relationship = getLiveCommandRelationship(capture, command);
      if (!relationship) return;
      const reasons: Array<'first-raster' | 'first-difference' | 'heaviest-method'> = [];
      if (rasterOperation && shouldCaptureFirstRaster(callsites)) reasons.push('first-raster');
      if (relationship.firstDifference && shouldCaptureFirstDifference(callsites, relationship.identity)) reasons.push('first-difference');
      if (heaviestMethod !== null && command.name === heaviestMethod && shouldCaptureHeaviestMethod(callsites, relationship.identity)) reasons.push('heaviest-method');
      if (reasons.length) captureDrawCallsite(callsites, relationship.identity, command.ordinal, reasons, undefined, stackBoundary);
    },
  );
  lastExplanation = undefined;
  activeExplanation = {
    explanationId: `canvas-scan-explanation-${Date.parse(started)}-${++explanationSequence}`,
    sessionId: lastSession.sessionId,
    findingIndex: selection.findingIndex,
    findingType: finding.type,
    canvasId: finding.canvasId,
    record,
    capture,
    callsites,
    unsubscribeDetail,
    selectedCanvasRejections: 0,
    selectableFindingIndexes: new Set(lastSession.findings.flatMap((candidate, index) => {
      const completedRecord = recordsForCompletedSession.get(candidate.canvasId);
      const record = completedRecord ?? [...records].find(item => item.id === candidate.canvasId);
      return record && getConnectionState(record) ? [index] : [];
    })),
  };
  startRecordingWithDuration(EXPLANATION_MAX_DURATION_MS);
  return { status: 'started' };
}
export function stopExplanation(): ExplanationArtifactV1 | undefined {
  if (!activeExplanation) return undefined;
  finish('manual');
  return lastExplanation ? copyExplanation(lastExplanation) : undefined;
}
export function getLastExplanation(): ExplanationArtifactV1 | undefined { return lastExplanation ? copyExplanation(lastExplanation) : undefined; }
export function mark(label: string): void { markBrowserEvidence(label); }
export function getLastSession(): InvestigationSessionV1 | undefined { return lastSession ? copySession(lastSession) : undefined; }
export function getRecordingState(): RecordingState { return state; }
export function subscribeToRecordingState(listener: (next: RecordingState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function settleExplanationCallsitesForTests(): Promise<void> { if (activeExplanation) await settleDrawCallsiteCaptureForTests(activeExplanation.callsites); }
export function resetRecordingForTests(): void {
  resetBrowserEvidence();
  setMethodEvidenceCollectionEnabled(false);
  setResetEventCollectionEnabled(false);
  setRecordingWindowRangeTracking(false);
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  unsubscribeResetEvents?.();
  unsubscribeResetEvents = undefined;
  unsubscribeLifecycleEvents?.();
  unsubscribeLifecycleEvents = undefined;
  activeExplanation?.unsubscribeDetail();
  state = 'idle';
  lastSession = undefined;
  recordsForCompletedSession.clear();
  recordsForRecordingSession.clear();
  lastExplanation = undefined;
  activeExplanation = undefined;
  resetCommandCaptureForTests();
  resetDrawCallsiteForTests();
  windows = [];
  resetEvents = [];
  lifecycleEvents = [];
  browserEntries = [];
  episodeAssociations = [];
  browserFeatures = { eventTiming: false, longAnimationFrames: false };
  browserDropped = { documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 };
  canvasIds = [];
  droppedWindows = 0;
  evictedCanvasTotals = new Map();
  droppedCanvases = 0;
  droppedResetEvents = 0;
  droppedLifecycleEvents = 0;
  recordingStartWindowIndex = 0;
  recordingStartOffsets.clear();
  minRepeatedRasterOps = 2;
  captureEvery = 1;
  sequence = 0;
  explanationSequence = 0;
  listeners.clear();
}
