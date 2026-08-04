import { safelyInstallRDTHook } from 'bippy';
import { addSkippedOwners } from './attribution';
import {
  copyReport,
  getHistory,
  latestReports,
  startFrameLoop,
} from './frame-loop';
import { mountOverlay } from './overlay';
import { configureRecording, getLastSession, startRecording, stopRecording } from './recording';
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
  configureRecording(options);
  startFrameLoop(options);
  if (options.overlay !== false) mountOverlay(options);
  (window as any).__CANVAS_SCAN__ = {
    version: '0.3.1',
    getHistory,
    getReports,
    startRecording,
    stopRecording,
    getLastSession,
  };
}

export type {
  AttributionKind,
  CanvasMethodEvidence,
  CanvasScanOptions,
  DrawBatchReport,
  SignatureStatus,
  SourceLocation,
  InvestigationSessionV1,
  RecordedCanvasSummary,
  RecordedCanvasWindow,
  RecordedCanvasGeometry,
  CanvasGeometryUnavailableReason,
  RecordedResetEvent,
  CanvasResetSource,
  RecordedDrawEpisode,
  RecordedEpisodeCanvasSummary,
  RecordedTopMethod,
  HeavyCanvasWorkFinding,
  InvestigationFinding,
  RepeatedDrawWorkFinding,
  ResizeChurnFinding,
  BackingStoreMismatchFinding,
  RecordedRepeatedWindow,
  RecordingState,
  RecordingStopReason,
} from './types';

export { getLastSession, startRecording, stopRecording } from './recording';
