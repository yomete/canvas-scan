import { resolveAttribution } from './attribution';
import { computeStatus, newWindowSignature } from './signature';
import type { CanvasScanOptions, DrawBatchReport } from './types';
import type { CanvasRecord } from './wrap-context';
import { records } from './wrap-context';

export const latestReports = new Map<string, DrawBatchReport>();

let windowIndex = 0;

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
      sourceLocation: null,
      rasterOperationCount: record.rasterOps,
      canvasApiSelfTimeMs: Number(record.selfTimeMs.toFixed(3)),
      signatureStatus,
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

  record.sig = newWindowSignature();
  record.rasterOps = 0;
  record.selfTimeMs = 0;
  record.activeInWindow = false;
  return processed;
}

export function startFrameLoop(options: CanvasScanOptions): void {
  const raf = window.requestAnimationFrame.bind(window);
  const captureEvery = options.captureEvery ?? 1;

  const tick = () => {
    windowIndex++;

    for (const record of records) {
      const processed = processRecord(record, windowIndex, captureEvery);
      if (!processed) continue;
      latestReports.set(processed.report.canvasId, processed.report);
      if (processed.shouldLog) console.debug('[canvas-scan]', processed.report);
    }

    if (windowIndex % 120 === 0) {
      for (const [canvasId, report] of latestReports) {
        console.debug('[canvas-scan] summary', canvasId, report);
      }
    }

    raf(tick);
  };

  raf(tick);
}
