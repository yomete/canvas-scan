import { safelyInstallRDTHook } from 'bippy';
import { addSkippedOwners } from './attribution';
import { getHistory, latestReports, startFrameLoop } from './frame-loop';
import { mountOverlay } from './overlay';
import type { CanvasScanOptions } from './types';
import { installCanvasPatch } from './wrap-context';
import { installPath2DPatch } from './wrap-path2d';

let started = false;

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
