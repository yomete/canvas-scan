import { safelyInstallRDTHook } from 'bippy';
import { latestReports, startFrameLoop } from './frame-loop';
import type { CanvasScanOptions } from './types';
import { installCanvasPatch } from './wrap-context';

let started = false;

export function start(options: CanvasScanOptions = {}): void {
  if (typeof window === 'undefined' || started) return;
  started = true;

  safelyInstallRDTHook();
  installCanvasPatch();
  startFrameLoop(options);
  (window as any).__CANVAS_SCAN__ = {
    version: '0.0.0',
    getReports: () => Object.fromEntries(latestReports),
  };
}

export type {
  AttributionKind,
  CanvasScanOptions,
  DrawBatchReport,
  SignatureStatus,
  SourceLocation,
} from './types';
