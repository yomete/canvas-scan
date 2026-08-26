export type AttributionKind =
  | 'react-host-no-owner'
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
  // How many active windows the counts above cover. Always 1 at captureEvery 1.
  // Above it, the windows sampling did not report are carried into this one and
  // counted here.
  coveredWindowCount: number;
  comparisonGap: number | null;
  followsCanvasReset: boolean;
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
  // The overlay's flash threshold. It also sets the repeated-draw-work minimum
  // when minRepeatedRasterOps is absent, which is the historical behaviour.
  minFlashRasterOps?: number;
  // The minimum raster operations a `same` window must clear to count towards a
  // repeated-draw-work finding. Set it to tune findings without touching the
  // flash, or the flash without touching findings.
  minRepeatedRasterOps?: number;
  overlay?: boolean;
  skipOwners?: readonly string[];
  // Writes the frame loop's per-canvas console.debug lines. Off by default.
  debug?: boolean;
}

export type RecordingStopReason = 'manual' | 'max-duration';
export type RecordingState = 'idle' | 'recording' | 'complete';

export interface ExplanationSelection {
  sessionId: string;
  findingIndex: number;
}

export type ExplanationStartResult =
  | { status: 'started' }
  | { status: 'already-active' }
  | {
      status: 'unavailable';
      reason:
        | 'no-session'
        | 'session-mismatch'
        | 'finding-not-found'
        | 'canvas-unavailable'
        | 'recording-active'
        | 'instrumentation-disabled';
    };

export type ExplanationUnknownReason =
  | 'unsupported-value'
  | 'argument-limit'
  | 'value-token-limit'
  | 'command-limit'
  | 'window-limit'
  | 'sampling-gap'
  | 'missing-reference'
  | 'instrumentation-disabled';

export interface NormalizedCommandArgument {
  position: number;
  kind: 'number' | 'string' | 'boolean' | 'null' | 'undefined' | 'array' | 'typed-array' | 'image' | 'canvas' | 'path' | 'gradient' | 'pattern' | 'object';
  token: string | null;
}

export interface NormalizedCanvasCommand {
  ordinal: number;
  operationKind: 'call' | 'set';
  name: string;
  argumentCount: number;
  arguments: NormalizedCommandArgument[];
  unknownReason: ExplanationUnknownReason | null;
}

export interface ExplanationCommandWindow {
  windowIndex: number;
  timestampMs: number;
  commands: NormalizedCanvasCommand[];
  complete: boolean;
  unknownReason: ExplanationUnknownReason | null;
}

export interface CommandDifference {
  referenceWindowIndex: number;
  targetWindowIndex: number;
  ordinal: number;
  reason: 'operation-kind' | 'operation-name' | 'argument-count' | 'argument-kind' | 'argument-token' | 'command-added' | 'command-removed';
  reference: NormalizedCanvasCommand | null;
  target: NormalizedCanvasCommand | null;
}

export interface ExplanationWindowComparison {
  referenceWindowIndex: number;
  targetWindowIndex: number;
  status: SignatureStatus;
  difference: CommandDifference | null;
  unknownReason: ExplanationUnknownReason | null;
}

export interface ExplanationStackFrame {
  functionName: string | null;
  generated: SourceLocation | null;
  mapped: SourceLocation | null;
  mappingStatus: 'mapped' | 'unresolved';
  unresolvedReason: 'no-source-map' | 'cross-origin-source-map' | 'source-map-lookup-limit' | 'source-map-too-large' | 'source-map-load-failed' | 'source-map-parse-failed' | 'mapping-missing' | null;
}

export interface ExplanationStackSample {
  windowIndex: number;
  commandOrdinal: number;
  reason: 'first-raster' | 'first-difference';
  frames: ExplanationStackFrame[];
  droppedFrameCount: number;
}

export interface RecordedCanvasWindow extends DrawBatchReport {
  windowIndex: number;
  /** Monotonic time when the frame loop observed and closed this window. */
  timestampMs: number;
  /** The prior recorder observation boundary, or the recording start for the first window. */
  startedAtTimestampMs: number;
  /** The monotonic frame-loop observation time after this window's canvas work. */
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

export type ResetDimensionChange = 'changed' | 'unchanged' | 'unavailable';

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
  dimensionChange: ResetDimensionChange;
  width: number | null;
  height: number | null;
  rasterOperationCount: number;
  activeRasterOverlap: boolean;
  commandStatus: SignatureStatus;
  unknownReason: string | null;
  // True for a reset still queued when the recording stopped. Its windowIndex
  // is one past the last window a frame actually closed, so it falls inside no
  // draw episode and does not count towards the resize-churn distinct-window
  // gate. The reset itself was observed; only its window is synthetic.
  flushedAtStop: boolean;
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
  maximumWindow: Pick<RecordedCanvasWindow, 'windowIndex' | 'timestampMs' | 'canvasApiSelfTimeMs' | 'rasterOperationCount' | 'followsCanvasReset' | 'methodEvidence'>;
  gateThresholdMs: number;
  gateExcessMs: number;
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
  // Back-to-back repeated windows that also drew the same number of raster
  // operations. A label on the shape of the repetition, not a cause.
  adjacentIdenticalWindowPairs: number;
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
  dimensionChanges: { changed: number; unchanged: number; unavailable: number };
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
  // The sampling rate in force for the whole recording. Two sessions recorded
  // at different rates do not describe the same span of windows, so a
  // comparison checks this before pairing them.
  captureEvery: number;
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

export interface SessionFindingPairing {
  baselineFindingIndex: number;
  candidateFindingIndex: number;
}

export type ComparisonMeasureId =
  | 'active-window-count'
  | 'raster-operation-count'
  | 'canvas-api-self-time-ms'
  | 'maximum-window-self-time-ms'
  | 'unknown-command-window-count'
  | 'heavy-episode-operation-count'
  | 'heavy-episode-self-time-ms'
  | 'repeated-window-count'
  | 'repeated-raster-operation-count'
  | 'comparison-gap-count'
  | 'active-reset-count'
  | 'observed-reset-count'
  | 'affected-episode-count'
  | 'same-command-window-count'
  | 'changed-command-window-count'
  | 'affected-backing-window-count'
  | 'maximum-backing-area-ratio'
  | `method:${string}:operation-count`
  | `method:${string}:self-time-ms`;

export interface ComparisonMeasure {
  id: ComparisonMeasureId;
  unit: 'count' | 'ms' | 'ratio';
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  direction: 'increased' | 'decreased' | 'unchanged' | 'unknown';
  interpretation: 'structural' | 'observed-timing-pair';
  // The span each side of the measure covers. Per-method measures are episode
  // scoped for a heavy-canvas-work pairing and session scoped for the other
  // three finding types, so the same measure id can cover either.
  scope: 'session' | 'episode';
}

export interface ComparisonFindingRef {
  sessionId: string;
  findingIndex: number;
  findingType: InvestigationFinding['type'] | null;
  canvasId: string | null;
}

export interface ComparisonArtifactV1 {
  schemaVersion: 1;
  comparisonId: string;
  createdAt: string;
  canvasScanVersion: string;
  pairingMethod: 'user-selected';
  baseline: ComparisonFindingRef;
  candidate: ComparisonFindingRef;
  status: 'comparable' | 'incomparable';
  incomparableReasons: Array<
    | 'finding-not-found'
    | 'finding-type-mismatch'
    | 'unsupported-schema'
    | 'incomplete-evidence'
    | 'sampling-mismatch'
  >;
  measures: ComparisonMeasure[];
  improvementEstablished: false;
}

export interface ExplanationArtifactV1 {
  schemaVersion: 1;
  explanationId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stopReason: RecordingStopReason;
  canvasScanVersion: string;
  source: { sessionId: string; findingIndex: number; findingType: InvestigationFinding['type']; canvasId: string };
  followUp: { sessionId: string; canvasId: string };
  windows: ExplanationCommandWindow[];
  comparisons: ExplanationWindowComparison[];
  firstDifference: CommandDifference | null;
  stacks: ExplanationStackSample[];
  collectionLimits: {
    maxDurationMs: 10000;
    maxSelectedCanvases: 1;
    maxActiveWindows: 120;
    maxCommandEntries: 5000;
    maxArgumentsPerCommand: 20;
    maxValueTokens: 1024;
    maxStackSamples: 8;
    maxFramesPerStack: 20;
    maxSourceMapLookups: 8;
    maxSourceMapResponseBytes: 2097152;
  };
  droppedEntryCounts: { durationStops: number; selectedCanvasRejections: number; activeWindows: number; commandEntries: number; commandArguments: number; valueTokens: number; stackSamples: number; stackFrames: number; sourceMapLookups: number; sourceMapResponses: number };
  limitResults: ExplanationLimitResult[];
  callsiteCoverage: ExplanationCallsiteCoverage;
  firstGap: { windowIndex: number; commandOrdinal: number | null; reason: ExplanationUnknownReason } | null;
}

export type ExplanationLimitName =
  | 'duration-ms' | 'selected-canvases' | 'active-windows' | 'command-entries'
  | 'arguments-per-command' | 'value-tokens' | 'stack-samples' | 'frames-per-stack'
  | 'source-map-lookups' | 'source-map-response-bytes';

export type ExplanationLimitReason =
  | 'max-duration' | 'selected-canvas-limit' | 'window-limit' | 'command-limit'
  | 'argument-limit' | 'value-token-limit' | 'stack-sample-limit' | 'stack-frame-limit'
  | 'source-map-lookup-limit' | 'source-map-too-large';

export type ExplanationLimitCoordinate =
  | { scope: 'explanation'; windowIndex: null; commandOrdinal: null }
  | { scope: 'window'; windowIndex: number; commandOrdinal: null }
  | { scope: 'command'; windowIndex: number; commandOrdinal: number };

export interface ExplanationLimitResult {
  name: ExplanationLimitName;
  maximum: number;
  rejectedCount: number;
  reason: ExplanationLimitReason | null;
  firstAffected: ExplanationLimitCoordinate | null;
}

export type ExplanationCallsiteLimitReason = 'stack-sample-limit' | 'stack-frame-limit' | 'source-map-lookup-limit' | 'source-map-too-large';

export interface ExplanationCallsiteCoverage {
  status: 'complete' | 'incomplete';
  incompleteReasons: ExplanationCallsiteLimitReason[];
}
