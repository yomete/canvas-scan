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
}

export interface RecordedCanvasSummary {
  canvasId: string;
  nearestReactOwner: string | null;
  attributionKind: AttributionKind;
  sourceLocation: SourceLocation | null;
  activeWindowCount: number;
  rasterOperationCount: number;
  canvasApiSelfTimeMs: number;
  commandStatuses: { same: number; changed: number; unknown: number };
}

export interface InvestigationSessionV1 {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stopReason: RecordingStopReason;
  canvasScanVersion: string;
  browserFeatures: { monotonicTime: boolean };
  canvases: RecordedCanvasSummary[];
  windows: RecordedCanvasWindow[];
  collectionLimits: {
    maxDurationMs: 30000;
    maxCanvasWindowReports: 10000;
    maxCanvasLifetimes: 128;
  };
  droppedEntryCounts: { canvasWindowReports: number; canvasLifetimes: number };
}
