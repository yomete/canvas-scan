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

// A missing `window` already made start() a silent no-op, which is what makes
// server rendering safe. These two were not checked at all, so an environment
// that has a window but lacks either threw from an import — the one position
// where a throw takes the whole application down. They no-op the same way.
function canObserve(): boolean {
  if (typeof (window as any).requestAnimationFrame !== 'function') return false;
  if (typeof (globalThis as any).CanvasRenderingContext2D !== 'function') return false;
  return true;
}

// canvas-scan patches getContext and reads React's DevTools hook, and neither
// can be applied to work that already happened. Loaded too late, it produces
// canvases with no owner, or no canvases at all, and the overlay still mounts
// and looks healthy. Nothing said so, and it is the first thing the README
// warns about, so say it once, plainly, where the developer will see it.
function warnIfLate(): void {
  try {
    if (typeof document === 'undefined') return;
    const canvases = document.querySelectorAll('canvas').length;
    if (canvases > 0) {
      console.warn(
        `[canvas-scan] started after ${canvases} canvas element${canvases === 1 ? '' : 's'} already existed. ` +
        'Any 2D context taken before now is not tracked, and owner names may be missing. ' +
        "Move `import 'canvas-scan/auto'` to the first line of your entry file, above React.",
      );
    }
    const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook?.renderers?.size > 0) {
      console.warn(
        '[canvas-scan] started after React rendered. Owner names may be missing. ' +
        "Move `import 'canvas-scan/auto'` above your React import.",
      );
    }
  } catch {
    // Reporting a late load must never be the thing that breaks the page.
  }
}

export function start(options: CanvasScanOptions = {}): void {
  if (typeof window === 'undefined' || started) return;
  if (!canObserve()) return;
  started = true;
  warnIfLate();

  safelyInstallRDTHook();
  installCanvasPatch();
  installPath2DPatch();
  if (options.skipOwners?.length) addSkippedOwners(options.skipOwners);
  configureRecording(options);
  startFrameLoop(options);
  if (options.overlay !== false) mountOverlay(options);
  (window as any).__CANVAS_SCAN__ = {
    version: '0.6.2',
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
