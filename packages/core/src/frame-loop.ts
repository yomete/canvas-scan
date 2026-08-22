import { resolveAttribution } from './attribution';
import { computeStatus, newWindowSignature } from './signature';
import type {
  CanvasScanOptions,
  RecordedCanvasLifecycleEvent,
  DrawBatchReport,
  RecordedResetEvent,
  SourceLocation,
} from './types';
import type { CanvasRecord } from './wrap-context';
import {
  clearMethodEvidence,
  drainAttributeRecords,
  getMethodEvidence,
  isMethodEvidenceCollectionEnabled,
  refreshContentToken,
  records,
  getConnectionState,
  setWindowCaptured,
  takeResetEvents,
  takeLifecycleEvents,
  notifySelectedCommandBoundary,
} from './wrap-context';

export const latestReports = new Map<string, DrawBatchReport>();

const MAX_TRACKED_CANVASES = 64;
const histories = new Map<string, DrawBatchReport[]>();
const lastReportedWindows = new Map<string, number>();
const sourceLocations = new Map<string, SourceLocation | null>();
const EMPTY_METHOD_EVIDENCE = Object.freeze({}) as DrawBatchReport['methodEvidence'];

export interface PublishedWindowMetadata {
  windowIndex: number;
  timestampMs: number;
  startedAtTimestampMs?: number;
  endedAtTimestampMs?: number;
}

export type ReportListener = (
  report: DrawBatchReport,
  canvas: unknown,
  metadata?: PublishedWindowMetadata,
) => void;

const reportListeners = new Set<ReportListener>();
const resetEventListeners = new Set<(event: RecordedResetEvent) => void>();
const lifecycleEventListeners = new Set<(event: RecordedCanvasLifecycleEvent) => void>();

export const INACTIVE_BOUNDARIES_BEFORE_RETIREMENT = 120;

let windowIndex = 0;
let recordingWindowStartTimestampMs: number | undefined;

export function setRecordingWindowRangeTracking(
  enabled: boolean,
  startedAtTimestampMs?: number,
): void {
  recordingWindowStartTimestampMs = enabled ? startedAtTimestampMs : undefined;
}

export function getCurrentWindowIndex(): number {
  return windowIndex;
}

// `sourceLocation` is a nested object, so a shallow spread would hand callers a
// live handle on stored state.
export function copyReport(report: DrawBatchReport): DrawBatchReport {
  return {
    ...report,
    sourceLocation: report.sourceLocation
      ? { ...report.sourceLocation }
      : null,
    methodEvidence: Object.fromEntries(Object.entries(report.methodEvidence).map(([method, evidence]) => [method, { ...evidence }])),
  };
}

export function getHistory(canvasId: string): DrawBatchReport[] {
  return (histories.get(canvasId) ?? []).map(copyReport);
}

export function getLatestReport(canvasId: string): DrawBatchReport | null {
  const latest = latestReports.get(canvasId);
  return latest ? copyReport(latest) : null;
}

export function setSourceLocation(
  canvasId: string,
  location: SourceLocation | null,
): void {
  const history = histories.get(canvasId);
  if (!history) return;
  sourceLocations.set(canvasId, location);
  // The source belongs to the canvas, not to one frame: a canvas that stops
  // drawing before the lookup resolves would otherwise keep a null history.
  for (const [index, report] of history.entries()) {
    history[index] = { ...report, sourceLocation: location };
  }
  const latest = latestReports.get(canvasId);
  if (latest) {
    latestReports.set(canvasId, { ...latest, sourceLocation: location });
  }
}

export function subscribeToReports(listener: ReportListener): () => void {
  reportListeners.add(listener);
  return () => {
    reportListeners.delete(listener);
  };
}

export function emitReport(
  report: DrawBatchReport,
  canvas: unknown,
  metadata?: PublishedWindowMetadata,
): void {
  if (reportListeners.size === 0) return;
  const published = copyReport(report);
  for (const listener of reportListeners) {
    try {
      if (metadata === undefined) listener(published, canvas);
      else listener(published, canvas, metadata);
    } catch (error) {
      reportListeners.delete(listener);
      console.warn('[canvas-scan] report listener removed after error', error);
    }
  }
}

export function subscribeToResetEvents(listener: (event: RecordedResetEvent) => void): () => void {
  resetEventListeners.add(listener);
  return () => resetEventListeners.delete(listener);
}

export function emitResetEvent(event: RecordedResetEvent): void {
  for (const listener of resetEventListeners) listener({ ...event });
}

export function subscribeToLifecycleEvents(listener: (event: RecordedCanvasLifecycleEvent) => void): () => void {
  lifecycleEventListeners.add(listener);
  return () => lifecycleEventListeners.delete(listener);
}

export function emitLifecycleEvent(event: RecordedCanvasLifecycleEvent): void {
  for (const listener of lifecycleEventListeners) listener({ ...event });
}

export interface ProcessedRecord {
  report: DrawBatchReport;
  shouldLog: boolean;
}

export function processRecord(
  record: CanvasRecord,
  currentWindowIndex: number,
  captureEvery: number,
): ProcessedRecord | null {
  if (!record.activeInWindow) return null;

  let processed: ProcessedRecord | null = null;

  if (currentWindowIndex % captureEvery === 0) {
    const resetBarrier = record.resetPendingReason !== null;
    let forcedUnknownReason: string | null = record.resetPendingReason;
    if (!forcedUnknownReason && record.modelUntrusted) {
      forcedUnknownReason = 'canvas-state-unmodeled';
    }
    if (!forcedUnknownReason) {
      for (const [source, resetVersion] of record.sourceResetVersions) {
        if (source.resetVersion !== resetVersion) {
          forcedUnknownReason = 'canvas-source-reset';
          break;
        }
      }
    }
    const computedStatus = computeStatus(record.prev, record.sig);
    if (
      !forcedUnknownReason &&
      record.continuityLost &&
      computedStatus !== 'unknown'
    ) {
      forcedUnknownReason = 'uncaptured-raster';
    }
    const signatureStatus =
      forcedUnknownReason === null ? computedStatus : 'unknown';
    // Only a reset source canvas can change output without a new command
    // stream, so only that still nulls the baseline. A plain reset clears
    // modeled state, but the next window's signature is self-contained (head
    // state + hashed commands), so comparing through the preserved baseline is
    // meaningful: identical redraws are 'same' again and real size changes are
    // 'changed' (width/height mix into head state). Reset-barrier windows keep
    // storing no baseline of their own — commands captured before a mid-window
    // reset must not become one.
    const invalidatesBaseline = forcedUnknownReason === 'canvas-source-reset';
    const comparisonGap = record.prev
      ? currentWindowIndex - record.prev.windowIndex
      : null;

    if (
      record.attribution === null ||
      record.attribution.attributionKind === 'unattributed'
    ) {
      record.attribution = resolveAttribution(record.canvas);
    }

    const report: DrawBatchReport = {
      canvasId: record.id,
      nearestReactOwner: record.attribution.nearestReactOwner,
      attributionKind: record.attribution.attributionKind,
      sourceLocation: sourceLocations.get(record.id) ?? null,
      rasterOperationCount: record.rasterOps,
      canvasApiSelfTimeMs: Number(record.selfTimeMs.toFixed(3)),
      signatureStatus,
      unknownReason:
        signatureStatus === 'unknown'
          ? forcedUnknownReason ??
            record.sig.unknownReason ??
            (record.prev === null
              ? 'first-window'
              : record.prev.unknown
                ? 'previous-window'
                : null)
          : null,
      sampled: captureEvery > 1,
      comparisonGap,
      followsCanvasReset: resetBarrier,
      methodEvidence: isMethodEvidenceCollectionEnabled()
        ? Object.fromEntries(Object.entries(getMethodEvidence(record)).map(([method, evidence]) => [method, { ...evidence, canvasApiSelfTimeMs: evidence.canvasApiSelfTimeMs === null ? null : Number(evidence.canvasApiSelfTimeMs.toFixed(3)) }]))
        : EMPTY_METHOD_EVIDENCE,
    };
    const shouldLog =
      record.lastStatus === null || record.lastStatus !== signatureStatus;
    record.lastStatus = signatureStatus;
    record.prev = invalidatesBaseline
      ? null
      : resetBarrier
        ? record.prev
        : {
            hash: record.sig.hash,
            unknown: record.sig.unknown,
            windowIndex: currentWindowIndex,
          };
    processed = { report, shouldLog };
    record.resetPendingReason = null;
    record.continuityLost = false;
  } else {
    if (record.rasterOps > 0) {
      // Any raster in an uncaptured window breaks continuity, not just a reset.
      // The skipped window's commands were never hashed, so we cannot know
      // whether it drew the same thing. If it drew something else, the next
      // captured redraw was NECESSARY, and calling it `same` would be a false
      // review candidate. (Narrowing this to resets was tried and reverted: it
      // reintroduced exactly that, caught by the captured-blue / uncaptured-red /
      // captured-blue regression in sampling-contract.test.ts.)
      record.continuityLost = true;
    }
  }

  if (record.rasterOps > 0) {
    // Identical captured raster streams preserve the source token; all other raster activity advances it.
    const provablySame =
      processed !== null && processed.report.signatureStatus === 'same';
    if (!provablySame) {
      record.contentVersion++;
    }
    record.contentDirty = false;
    refreshContentToken(record);
  }

  record.sig = newWindowSignature();
  record.rasterOps = 0;
  record.selfTimeMs = 0;
  clearMethodEvidence(record);
  record.activeInWindow = false;
  record.contextActivityInWindow = false;
  record.sourceResetVersions.clear();
  return processed;
}

export function processRecordWithResetEvents(
  record: CanvasRecord,
  currentWindowIndex: number,
  captureEvery: number,
  publishedResetEvents: RecordedResetEvent[],
): ProcessedRecord | null {
  if (!record.activeInWindow) return null;
  const pendingResetEvents = takeResetEvents(record);
  const rasterOperationCount = record.rasterOps;
  const unknownReason = record.resetPendingReason;
  const processed = processRecord(record, currentWindowIndex, captureEvery);
  if (!pendingResetEvents?.length) return processed;
  const report = processed?.report;
  publishedResetEvents.push(...pendingResetEvents.map(event => ({
    ...event,
    canvasId: record.id,
    windowIndex: currentWindowIndex,
    timestampMs: 0,
    rasterOperationCount,
    activeRasterOverlap: rasterOperationCount > 0,
    commandStatus: report?.signatureStatus ?? 'unknown',
    unknownReason: report?.unknownReason ?? unknownReason,
  })));
  return processed;
}

export function startFrameLoop(options: CanvasScanOptions): void {
  const raf = window.requestAnimationFrame.bind(window);
  const captureEvery = options.captureEvery ?? 1;
  setWindowCaptured((windowIndex + 1) % captureEvery === 0);

  const tick = () => {
    const observedAtTimestampMs = performance.now();
    const recordedStart = recordingWindowStartTimestampMs;
    if (recordedStart !== undefined) recordingWindowStartTimestampMs = observedAtTimestampMs;
    windowIndex++;
    drainAttributeRecords();

    const processedRecords: Array<[CanvasRecord, ProcessedRecord]> = [];
    const processedResetEvents: RecordedResetEvent[] = [];
    const lifecycleEvents: RecordedCanvasLifecycleEvent[] = [];
    for (const record of records) {
      const connected = getConnectionState(record);
      if (record.lastConnected && !connected) {
        record.pendingLifecycleEvents.push({ type: 'detached', connected, activeRegistrySize: records.size });
      }
      record.lastConnected = connected;
      const hadActivity = record.activeInWindow;
      notifySelectedCommandBoundary(record, windowIndex, observedAtTimestampMs, hadActivity, windowIndex % captureEvery === 0);
      const processed = resetEventListeners.size === 0
        ? processRecord(record, windowIndex, captureEvery)
        : processRecordWithResetEvents(record, windowIndex, captureEvery, processedResetEvents);
      if (processed) processedRecords.push([record, processed]);
      if (hadActivity) record.inactiveBoundaries = 0;
      else record.inactiveBoundaries++;
      if (record.inactiveBoundaries === INACTIVE_BOUNDARIES_BEFORE_RETIREMENT) {
        records.delete(record);
        record.retired = true;
        record.pendingLifecycleEvents.push({ type: 'retired', connected, activeRegistrySize: records.size });
      }
      for (const event of takeLifecycleEvents(record)) {
        lifecycleEvents.push({
          canvasId: record.id,
          type: event.type,
          windowIndex,
          timestampMs: observedAtTimestampMs,
          connected: event.connected,
          activeRegistrySize: event.activeRegistrySize,
          evidenceLevel: 'measured',
        });
      }
    }
    for (const event of lifecycleEvents) emitLifecycleEvent(event);
    for (const event of processedResetEvents) emitResetEvent({ ...event, timestampMs: observedAtTimestampMs });

    for (const [record, processed] of processedRecords) {
      latestReports.set(processed.report.canvasId, processed.report);
      const history = histories.get(record.id) ?? [];
      history.push(processed.report);
      if (history.length > 120) history.shift();
      histories.set(record.id, history);
      lastReportedWindows.set(record.id, windowIndex);
      if (histories.size > MAX_TRACKED_CANVASES) {
        let oldestCanvasId: string | undefined;
        let oldestWindow = Infinity;
        for (const [canvasId, lastWindow] of lastReportedWindows) {
          if (lastWindow < oldestWindow) {
            oldestCanvasId = canvasId;
            oldestWindow = lastWindow;
          }
        }
        if (oldestCanvasId !== undefined) {
          histories.delete(oldestCanvasId);
          lastReportedWindows.delete(oldestCanvasId);
          latestReports.delete(oldestCanvasId);
          sourceLocations.delete(oldestCanvasId);
        }
      }
      if (processed.shouldLog) console.debug('[canvas-scan]', processed.report);
      emitReport(processed.report, record.canvas, recordedStart === undefined
        ? { windowIndex, timestampMs: observedAtTimestampMs }
        : {
            windowIndex,
            timestampMs: observedAtTimestampMs,
            startedAtTimestampMs: recordedStart,
            endedAtTimestampMs: observedAtTimestampMs,
          });
    }
    setWindowCaptured((windowIndex + 1) % captureEvery === 0);

    if (windowIndex % 120 === 0) {
      for (const [canvasId, report] of latestReports) {
        console.debug('[canvas-scan] summary', canvasId, report);
      }
    }

    raf(tick);
  };

  raf(tick);
}
