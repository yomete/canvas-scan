import { resolveAttribution } from './attribution';
import { computeStatus, newWindowSignature } from './signature';
import type {
  CanvasScanOptions,
  DrawBatchReport,
  SourceLocation,
} from './types';
import type { CanvasRecord } from './wrap-context';
import {
  refreshContentToken,
  records,
  setWindowCaptured,
} from './wrap-context';

export const latestReports = new Map<string, DrawBatchReport>();

const MAX_TRACKED_CANVASES = 64;
const histories = new Map<number, DrawBatchReport[]>();
const historyKeys = new Map<string, number>();
const lastReportedWindows = new Map<number, number>();
// Keyed by canvas LIFETIME (record.serial), never by DOM id: a reused id must
// not inherit the retired canvas's source location, and a retired record that
// is still in `records` must not be able to clear the new lifetime's entry.
const sourceLocations = new Map<number, SourceLocation | null>();

export type ReportListener = (report: DrawBatchReport, canvas: unknown) => void;

const reportListeners = new Set<ReportListener>();

let windowIndex = 0;

// `sourceLocation` is a nested object, so a shallow spread would hand callers a
// live handle on stored state.
export function copyReport(report: DrawBatchReport): DrawBatchReport {
  return {
    ...report,
    sourceLocation: report.sourceLocation
      ? { ...report.sourceLocation }
      : null,
  };
}

export function getHistory(canvasId: string): DrawBatchReport[] {
  const serial = historyKeys.get(canvasId);
  if (serial === undefined) return [];
  return (histories.get(serial) ?? []).map(copyReport);
}

export function getLatestReport(canvasId: string): DrawBatchReport | null {
  const latest = latestReports.get(canvasId);
  return latest ? copyReport(latest) : null;
}

export function setSourceLocation(
  canvasId: string,
  location: SourceLocation | null,
): void {
  const serial = historyKeys.get(canvasId);
  if (serial !== undefined) {
    sourceLocations.set(serial, location);
    // The source belongs to the canvas, not to one frame: a canvas that stops
    // drawing before the lookup resolves would otherwise keep a null history.
    const history = histories.get(serial);
    if (history) {
      for (const [index, report] of history.entries()) {
        history[index] = { ...report, sourceLocation: location };
      }
    }
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
): void {
  for (const listener of reportListeners) {
    try {
      listener(report, canvas);
    } catch (error) {
      reportListeners.delete(listener);
      console.warn('[canvas-scan] report listener removed after error', error);
    }
  }
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
    const signatureStatus = computeStatus(record.prev, record.sig);
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
      sourceLocation: sourceLocations.get(record.serial) ?? null,
      rasterOperationCount: record.rasterOps,
      canvasApiSelfTimeMs: Number(record.selfTimeMs.toFixed(3)),
      signatureStatus,
      unknownReason:
        signatureStatus === 'unknown'
          ? record.sig.unknownReason ??
            (record.prev === null
              ? 'first-window'
              : record.prev.unknown
                ? 'previous-window'
                : null)
          : null,
      sampled: captureEvery > 1,
      comparisonGap,
    };
    const shouldLog =
      record.lastStatus === null || record.lastStatus !== signatureStatus;
    record.lastStatus = signatureStatus;
    record.prev = {
      hash: record.sig.hash,
      unknown: record.sig.unknown,
      windowIndex: currentWindowIndex,
    };
    processed = { report, shouldLog };
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
  record.activeInWindow = false;
  return processed;
}

export function startFrameLoop(options: CanvasScanOptions): void {
  const raf = window.requestAnimationFrame.bind(window);
  const captureEvery = options.captureEvery ?? 1;
  setWindowCaptured((windowIndex + 1) % captureEvery === 0);

  const tick = () => {
    windowIndex++;

    for (const record of records) {
      // Ownership of a DOM id belongs to the NEWEST lifetime that drew, and
      // transfers on activity rather than on capture: `records` is never
      // pruned, so an older duplicate that still draws must not retire its
      // successor, and sampling must not leave a retired canvas standing in
      // for the live one.
      const drew = record.activeInWindow;
      const processed = processRecord(record, windowIndex, captureEvery);
      if (drew) {
        const owner = historyKeys.get(record.id);
        if (owner === undefined || record.serial > owner) {
          if (owner !== undefined) {
            histories.delete(owner);
            lastReportedWindows.delete(owner);
            sourceLocations.delete(owner);
            // The id now belongs to a lifetime that has not reported yet; the
            // predecessor's last report must not stand in for it.
            latestReports.delete(record.id);
          }
          historyKeys.set(record.id, record.serial);
        }
      }
      if (!processed) continue;
      // An older duplicate still reports to subscribers, but the public
      // per-id state belongs to the owner.
      if (historyKeys.get(record.id) !== record.serial) {
        emitReport(processed.report, record.canvas);
        continue;
      }
      latestReports.set(processed.report.canvasId, processed.report);
      const history = histories.get(record.serial) ?? [];
      history.push(processed.report);
      if (history.length > 120) history.shift();
      histories.set(record.serial, history);
      lastReportedWindows.set(record.serial, windowIndex);
      if (histories.size > MAX_TRACKED_CANVASES) {
        let oldestSerial: number | undefined;
        let oldestWindow = Infinity;
        for (const [serial, lastWindow] of lastReportedWindows) {
          if (lastWindow < oldestWindow) {
            oldestSerial = serial;
            oldestWindow = lastWindow;
          }
        }
        if (oldestSerial !== undefined) {
          histories.delete(oldestSerial);
          lastReportedWindows.delete(oldestSerial);
          sourceLocations.delete(oldestSerial);
          for (const [canvasId, serial] of historyKeys) {
            if (serial !== oldestSerial) continue;
            historyKeys.delete(canvasId);
            latestReports.delete(canvasId);
            break;
          }
        }
      }
      if (processed.shouldLog) console.debug('[canvas-scan]', processed.report);
      emitReport(processed.report, record.canvas);
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
