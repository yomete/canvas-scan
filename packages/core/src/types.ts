export type AttributionKind =
  | 'direct-host'
  | 'jsx-owner'
  | 'container-only'
  | 'unattributed';
export type SignatureStatus = 'same' | 'changed' | 'unknown';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface DrawBatchReport {
  canvasId: string;
  nearestReactOwner: string | null;
  attributionKind: AttributionKind;
  sourceLocation: SourceLocation | null;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  signatureStatus: SignatureStatus;
  unknownReason: string | null;
  sampled: boolean;
  comparisonGap: number | null;
  methodEvidence: Record<string, CanvasMethodEvidence>;
}

export interface CanvasMethodEvidence {
  count: number;
  canvasApiSelfTimeMs: number | null;
}

export interface RecordedTopMethod extends CanvasMethodEvidence {
  method: string;
}

export interface CanvasScanOptions {
  captureEvery?: number;
  minFlashRasterOps?: number;
  overlay?: boolean;
  skipOwners?: readonly string[];
}

export type RecordingStopReason = 'manual' | 'max-duration';
export type RecordingState = 'idle' | 'recording' | 'complete';

export interface RecordedCanvasWindow extends DrawBatchReport {
  windowIndex: number;
  timestampMs: number;
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  geometry: RecordedCanvasGeometry;
}

export interface RecordedDocumentEvent {
  entryId: string;
  kind: 'document-event';
  eventType: string;
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  targetTagName: string;
}

export interface RecordedEventTiming {
  entryId: string;
  kind: 'event-timing';
  eventType: string;
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  targetTagName: string;
  durationMs: number;
  interactionId: number | null;
}

export interface RecordedUserMark {
  entryId: string;
  kind: 'user-mark';
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  label: string;
}

export interface RecordedLongAnimationFrameScript {
  invoker: string | null;
  invokerType: string | null;
  sourceURL: string | null;
  sourceFunctionName: string | null;
  executionStartTimestampMs: number | null;
  durationMs: number | null;
  forcedStyleAndLayoutDurationMs: number | null;
  pauseDurationMs: number | null;
}

export interface RecordedLongAnimationFrame {
  entryId: string;
  kind: 'long-animation-frame';
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  durationMs: number;
  blockingDurationMs: number;
  scripts: RecordedLongAnimationFrameScript[];
  droppedScriptAttributionCount: number;
}

export type RecordedBrowserEvidenceEntry = RecordedDocumentEvent | RecordedEventTiming | RecordedUserMark | RecordedLongAnimationFrame;

export interface RecordedEpisodeAssociation {
  entryId: string;
  entryKind: RecordedBrowserEvidenceEntry['kind'];
  episodeId: string;
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  evidenceLevel: 'associated';
}

export type CanvasGeometryUnavailableReason = 'disconnected' | 'hidden' | 'zero-size' | 'unavailable';

export interface RecordedCanvasGeometry {
  backingWidth: number | null;
  backingHeight: number | null;
  cssWidth: number | null;
  cssHeight: number | null;
  devicePixelRatio: number | null;
  expectedBackingWidth: number | null;
  expectedBackingHeight: number | null;
  expectedPixelArea: number | null;
  actualToExpectedAreaRatio: number | null;
  unavailableReason: CanvasGeometryUnavailableReason | null;
}

export type CanvasResetSource = 'width-setter' | 'height-setter' | 'width-attribute' | 'height-attribute' | 'context-reset';

export type CanvasLifecycleEventType =
  | 'first-observed'
  | 'active'
  | 'detached'
  | 'retired'
  | 'reactivated';

export interface RecordedCanvasLifecycleEvent {
  canvasId: string;
  type: CanvasLifecycleEventType;
  windowIndex: number;
  timestampMs: number;
  connected: boolean;
  activeRegistrySize: number;
  evidenceLevel: 'measured';
}

export interface RecordedResetEvent {
  canvasId: string;
  windowIndex: number;
  timestampMs: number;
  source: CanvasResetSource;
  width: number | null;
  height: number | null;
  rasterOperationCount: number;
  activeRasterOverlap: boolean;
  commandStatus: SignatureStatus;
  unknownReason: string | null;
}

export interface RecordedCanvasSummary {
  canvasId: string;
  nearestReactOwner: string | null;
  attributionKind: AttributionKind;
  sourceLocation: SourceLocation | null;
  activeWindowCount: number;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  maxWindowSelfTimeMs: number;
  evidenceLevel: 'measured';
  methodEvidence: Record<string, CanvasMethodEvidence>;
  commandStatuses: { same: number; changed: number; unknown: number };
}

export interface RecordedEpisodeCanvasSummary {
  canvasId: string;
  activeWindowCount: number;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  maxWindowSelfTimeMs: number;
  methodEvidence: Record<string, CanvasMethodEvidence>;
  resetEventCount: number;
}

export interface RecordedDrawEpisode {
  episodeId: string;
  firstWindowIndex: number;
  lastWindowIndex: number;
  startedAtTimestampMs: number;
  endedAtTimestampMs: number;
  activeWindowCount: number;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  methodEvidence: Record<string, CanvasMethodEvidence>;
  canvases: RecordedEpisodeCanvasSummary[];
  resetEventCount: number;
}

export interface HeavyCanvasWorkFinding {
  type: 'heavy-canvas-work';
  evidenceLevel: 'candidate';
  canvasId: string;
  episodeId: string;
  canvasApiSelfTimeMs: number;
  rasterOperationCount: number;
  topMethods: RecordedTopMethod[];
  maximumWindow: Pick<RecordedCanvasWindow, 'windowIndex' | 'timestampMs' | 'canvasApiSelfTimeMs' | 'rasterOperationCount' | 'methodEvidence'>;
  claimBoundary: { observation: string; explanation: string; nonEstablishedFacts: string };
  nextCheck: string;
}

export interface RecordedRepeatedWindow {
  windowIndex: number;
  timestampMs: number;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  comparisonGap: number | null;
}

export interface RepeatedDrawWorkFinding {
  type: 'repeated-draw-work';
  evidenceLevel: 'candidate';
  canvasId: string;
  episodeId: string;
  repeatedWindowCount: number;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  repeatedWindows: RecordedRepeatedWindow[];
  unknownCoverage: { unknownWindowCount: number; activeWindowCount: number };
  claimBoundary: { observation: string; explanation: string; nonEstablishedFacts: string };
  nextCheck: string;
}

export interface ResizeChurnFinding {
  type: 'resize-churn';
  evidenceLevel: 'candidate';
  canvasId: string;
  observedResetCount: number;
  activeResetCount: number;
  resetEvents: Array<Pick<RecordedResetEvent, 'source' | 'width' | 'height' | 'windowIndex' | 'timestampMs'>>;
  affectedEpisodeIds: string[];
  commandStatuses: { same: number; changed: number; unknown: number };
  unknownReasons: Record<string, number>;
  canvasApiSelfTimeMs: number;
  rasterOperationCount: number;
  claimBoundary: { observation: string; explanation: string; nonEstablishedFacts: string };
  nextCheck: string;
}

export interface BackingStoreMismatchFinding {
  type: 'backing-store-mismatch';
  evidenceLevel: 'candidate';
  canvasId: string;
  affectedWindowCount: number;
  affectedWindows: Array<Pick<RecordedCanvasWindow, 'windowIndex' | 'timestampMs' | 'rasterOperationCount' | 'canvasApiSelfTimeMs'> & Pick<RecordedCanvasGeometry, 'backingWidth' | 'backingHeight' | 'expectedBackingWidth' | 'expectedBackingHeight' | 'expectedPixelArea' | 'actualToExpectedAreaRatio'>>;
  affectedEpisodeIds: string[];
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  claimBoundary: { observation: string; explanation: string; nonEstablishedFacts: string };
  nextCheck: string;
}

export type InvestigationFinding = HeavyCanvasWorkFinding | RepeatedDrawWorkFinding | ResizeChurnFinding | BackingStoreMismatchFinding;

export interface InvestigationSessionV1 {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stopReason: RecordingStopReason;
  canvasScanVersion: string;
  browserFeatures: { monotonicTime: boolean; eventTiming: boolean; longAnimationFrames: boolean };
  canvases: RecordedCanvasSummary[];
  windows: RecordedCanvasWindow[];
  resetEvents: RecordedResetEvent[];
  lifecycleEvents: RecordedCanvasLifecycleEvent[];
  episodes: RecordedDrawEpisode[];
  browserEntries: RecordedBrowserEvidenceEntry[];
  episodeAssociations: RecordedEpisodeAssociation[];
  findings: InvestigationFinding[];
  collectionLimits: {
    maxDurationMs: 30000;
    maxCanvasWindowReports: 10000;
    maxCanvasLifetimes: 128;
    maxResetEvents: 10000;
    maxLifecycleEvents: 10000;
    maxBrowserEvidenceEntries: 2000;
    maxLongFrameScriptAttributions: 20;
  };
  droppedEntryCounts: { canvasWindowReports: number; canvasLifetimes: number; resetEvents: number; lifecycleEvents: number; documentEvents: number; eventTiming: number; userMarks: number; longAnimationFrames: number };
}
