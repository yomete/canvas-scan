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
  overlay?: boolean;
  skipOwners?: readonly string[];
}
