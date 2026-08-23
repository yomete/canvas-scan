import { safelyInstallRDTHook } from 'bippy';
import { addSkippedOwners } from './attribution.js';
import {
  copyReport,
  getHistory,
  latestReports,
  startFrameLoop,
} from './frame-loop.js';
import { mountOverlay } from './overlay.js';
import { compareSessions } from './comparison.js';
import { configureRecording, getLastExplanation, getLastSession, mark, startExplanation, startRecording, stopExplanation, stopRecording } from './recording.js';
import type {
  CanvasScanOptions,
  DrawBatchReport,
} from './types.js';
import { installCanvasPatch } from './wrap-context.js';
import { installPath2DPatch } from './wrap-path2d.js';

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
    version: '0.6.1',
    getHistory,
    getReports,
    startRecording,
    stopRecording,
    mark,
    getLastSession,
    startExplanation,
    stopExplanation,
    getLastExplanation,
    compareSessions,
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
  CanvasLifecycleEventType,
  RecordedCanvasLifecycleEvent,
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
  RecordedDocumentEvent,
  RecordedEventTiming,
  RecordedUserMark,
  RecordedLongAnimationFrameScript,
  RecordedLongAnimationFrame,
  RecordedBrowserEvidenceEntry,
  RecordedEpisodeAssociation,
  ExplanationSelection,
  ExplanationStartResult,
  ExplanationUnknownReason,
  NormalizedCommandArgument,
  NormalizedCanvasCommand,
  ExplanationCommandWindow,
  CommandDifference,
  ExplanationWindowComparison,
  ExplanationStackFrame,
  ExplanationStackSample,
  ExplanationLimitName,
  ExplanationLimitReason,
  ExplanationLimitCoordinate,
  ExplanationLimitResult,
  ExplanationCallsiteLimitReason,
  ExplanationCallsiteCoverage,
  ExplanationArtifactV1,
  SessionFindingPairing,
  ComparisonMeasureId,
  ComparisonMeasure,
  ComparisonFindingRef,
  ComparisonArtifactV1,
} from './types.js';

export { getLastExplanation, getLastSession, mark, startExplanation, startRecording, stopExplanation, stopRecording } from './recording.js';
export { compareSessions } from './comparison.js';
