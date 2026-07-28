import { safelyInstallRDTHook } from 'bippy';
import { addSkippedOwners } from './attribution';
import {
  copyReport,
  getHistory,
  latestReports,
  startFrameLoop,
} from './frame-loop';
import { mountOverlay } from './overlay';
import type {
  CanvasScanOptions,
  DrawBatchReport,
} from './types';
import { installCanvasPatch } from './wrap-context';
import { installPath2DPatch } from './wrap-path2d';

let started = false;

export function getReports(): Record<string, DrawBatchReport> {
  return Object.fromEntries(
    [...latestReports].map(([id, report]) => [id, copyReport(report)]),
  );
}

export function start(options: CanvasScanOptions = {}): void {
  if (typeof window === 'undefined' || started) return;
  started = true;

  safelyInstallRDTHook();
  installCanvasPatch();
  installPath2DPatch();
  if (options.skipOwners?.length) addSkippedOwners(options.skipOwners);
  startFrameLoop(options);
  if (options.overlay !== false) mountOverlay(options);
  (window as any).__CANVAS_SCAN__ = {
    version: '0.2.0',
    getHistory,
    getReports,
  };
}

export type {
  AttributionKind,
  CanvasScanOptions,
  DrawBatchReport,
  SignatureStatus,
  SourceLocation,
} from './types';
