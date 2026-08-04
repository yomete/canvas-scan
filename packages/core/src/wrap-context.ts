import { getBuildSignature, trackBuild } from './build-registry';
import {
  captureHeadState,
  captureOp,
  captureSet,
  markUnknown,
  mixNumberTokenInto,
  mixTokenInto,
  mixUintInto,
  newWindowSignature,
} from './signature';
import type {
  AttributionKind,
  CanvasMethodEvidence,
  CanvasLifecycleEventType,
  CanvasResetSource,
  SignatureStatus,
} from './types';
import type { WindowSignature } from './signature';

export interface PatchTargets {
  canvasProto: any;
  contextProto: any;
  attributeObserver?: {
    observe(target: any, options: MutationObserverInit): void;
    takeRecords?(): MutationRecord[];
  } | null;
}

type ResetReason = 'canvas-reset' | 'canvas-attribute-reset';

export interface CanvasRecord {
  canvas: any;
  contentDirty: boolean;
  contentSig: WindowSignature;
  contentVersion: number;
  id: string;
  serial: number;
  sig: WindowSignature;
  rasterOps: number;
  selfTimeMs: number;
  activeInWindow: boolean;
  prev: { hash: number; unknown: boolean; windowIndex: number } | null;
  attribution: {
    nearestReactOwner: string | null;
    attributionKind: AttributionKind;
  } | null;
  lastStatus: SignatureStatus | null;
  props: Map<string, unknown>;
  matrix: [number, number, number, number, number, number];
  matrixUnknown: boolean;
  matrixHash: number;
  pathHash: number;
  pathUnknown: boolean;
  clipHash: number;
  clipUnknown: boolean;
  resetPendingReason: ResetReason | null;
  modelUntrusted: boolean;
  resetVersion: number;
  continuityLost: boolean;
  sourceResetVersions: Map<CanvasRecord, number>;
  attributeObservationUnavailable: boolean;
  contextActivityInWindow: boolean;
  exactResetDepth: number;
  inactiveBoundaries: number;
  retired: boolean;
  lastConnected: boolean;
  activeLifecycleRecorded: boolean;
  pendingLifecycleEvents: Array<{ type: CanvasLifecycleEventType; connected: boolean; activeRegistrySize: number }>;
  stateStack: Array<{
    matrix: CanvasRecord['matrix'];
    matrixUnknown: boolean;
    clipHash: number;
    clipUnknown: boolean;
    undo: Array<[name: string, prev: unknown, existed: boolean]>;
  }>;
}

const CAPTURED_METHODS = [
  'clearRect',
  'fillRect',
  'strokeRect',
  'fillText',
  'strokeText',
  'drawImage',
  'putImageData',
  'fill',
  'stroke',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'save',
  'restore',
  'translate',
  'rotate',
  'scale',
  'transform',
  'setTransform',
  'resetTransform',
  'clip',
  'setLineDash',
  'reset',
  'createLinearGradient',
  'createRadialGradient',
  'createConicGradient',
];
const GRADIENT_CREATORS = new Set([
  'createLinearGradient',
  'createRadialGradient',
  'createConicGradient',
]);
const RASTER_OPS = new Set([
  'clearRect',
  'fillRect',
  'strokeRect',
  'fillText',
  'strokeText',
  'drawImage',
  'putImageData',
  'fill',
  'stroke',
]);
const BARE_PATH_OPS = new Set([
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
]);
const MATRIX_OPS = new Set([
  'translate',
  'rotate',
  'scale',
  'transform',
  'setTransform',
  'resetTransform',
]);
const CAPTURED_SETTERS = [
  'fillStyle',
  'strokeStyle',
  'globalAlpha',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'font',
  'textAlign',
  'textBaseline',
  'globalCompositeOperation',
  'imageSmoothingEnabled',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'filter',
  'lineDashOffset',
  'direction',
  'letterSpacing',
  'wordSpacing',
  'fontKerning',
  'fontStretch',
  'fontVariantCaps',
  'textRendering',
  'imageSmoothingQuality',
];

export const records = new Set<CanvasRecord>();

const recordByCanvas = new WeakMap<object, CanvasRecord>();
const recordByContext = new WeakMap<object, CanvasRecord>();
const gradientDependents = new WeakMap<object, Set<CanvasRecord>>();

let installed = false;
let killed = false;
let nextCanvasSerial = 1;
let windowCaptured = true;
let methodEvidenceByRecord: Map<CanvasRecord, Record<string, CanvasMethodEvidence>> | null = null;
type PendingResetEvent = { source: CanvasResetSource; width: number | null; height: number | null };
let resetEventsByRecord: Map<CanvasRecord, PendingResetEvent[]> | null = null;
// Captured at install time: instance-level shadowing of getLineDash must
// never be invoked by the tracer (a Chrome probe showed a shadowed getter
// returning [] while native state was [5, 5]).
let nativeGetLineDash: ((this: any) => unknown) | null = null;
let nativeCanvasWidthGetter: ((this: any) => unknown) | null = null;
let nativeCanvasHeightGetter: ((this: any) => unknown) | null = null;
let nativeIsConnectedGetter: ((this: any) => unknown) | null = null;
let attributeObserverUnavailable = false;
let takeAttributeRecords: (() => MutationRecord[]) | null = null;

export function setWindowCaptured(captured: boolean): void {
  windowCaptured = captured;
}

export function setMethodEvidenceCollectionEnabled(enabled: boolean): void {
  methodEvidenceByRecord = enabled ? new Map() : null;
}

export function setResetEventCollectionEnabled(enabled: boolean): void {
  resetEventsByRecord = enabled ? new Map() : null;
}

export function getResetEvents(record: CanvasRecord): PendingResetEvent[] {
  const events = resetEventsByRecord?.get(record) ?? [];
  resetEventsByRecord?.set(record, events);
  return events;
}

export function takeResetEvents(record: CanvasRecord): PendingResetEvent[] | null {
  if (!resetEventsByRecord) return null;
  const events = resetEventsByRecord.get(record) ?? [];
  resetEventsByRecord.delete(record);
  return events;
}

export function takeLifecycleEvents(record: CanvasRecord): Array<{ type: CanvasLifecycleEventType; connected: boolean; activeRegistrySize: number }> {
  const events = record.pendingLifecycleEvents ?? [];
  record.pendingLifecycleEvents = [];
  return events;
}

export function getConnectionState(record: CanvasRecord): boolean {
  try {
    const connected = nativeIsConnectedGetter?.call(record.canvas);
    if (typeof connected === 'boolean') return connected;
  } catch {}
  return record.canvas?.isConnected === true;
}

function queueLifecycleEvent(record: CanvasRecord, type: CanvasLifecycleEventType, connected = getConnectionState(record)): void {
  record.pendingLifecycleEvents.push({ type, connected, activeRegistrySize: records.size });
}

export function reactivateRecord(record: CanvasRecord): boolean {
  if (!record.retired) return false;
  record.retired = false;
  record.inactiveBoundaries = 0;
  record.prev = null;
  record.lastStatus = null;
  records.add(record);
  queueLifecycleEvent(record, 'reactivated');
  return true;
}

export function restoreRetirement(record: CanvasRecord): void {
  if (!record.retired) {
    records.delete(record);
    record.retired = true;
    record.pendingLifecycleEvents.pop();
  }
}

function markRecordActive(record: CanvasRecord): void {
  record.activeInWindow = true;
  record.contextActivityInWindow = true;
  record.inactiveBoundaries = 0;
  if (!record.activeLifecycleRecorded) {
    record.activeLifecycleRecorded = true;
    queueLifecycleEvent(record, 'active');
  }
}

function recordResetEvent(record: CanvasRecord, source: CanvasResetSource): void {
  if (!resetEventsByRecord) return;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const nextWidth = nativeCanvasWidthGetter?.call(record.canvas);
    width = typeof nextWidth === 'number' ? nextWidth : null;
  } catch {}
  try {
    const nextHeight = nativeCanvasHeightGetter?.call(record.canvas);
    height = typeof nextHeight === 'number' ? nextHeight : null;
  } catch {}
  getResetEvents(record).push({ source, width, height });
}

export function getMethodEvidence(record: CanvasRecord): Record<string, CanvasMethodEvidence> {
  if (!methodEvidenceByRecord) return {};
  const evidence = methodEvidenceByRecord.get(record) ?? {};
  methodEvidenceByRecord.set(record, evidence);
  return evidence;
}

export function clearMethodEvidence(record: CanvasRecord): void {
  methodEvidenceByRecord?.delete(record);
}

function addMethodEvidence(
  collection: Map<CanvasRecord, Record<string, CanvasMethodEvidence>>,
  record: CanvasRecord,
  name: string,
  duration: number | null,
): void {
  const recordEvidence = collection.get(record) ?? {};
  const evidence = recordEvidence[name] ?? { count: 0, canvasApiSelfTimeMs: duration === null ? null : 0 };
  evidence.count++;
  if (duration !== null && evidence.canvasApiSelfTimeMs !== null) evidence.canvasApiSelfTimeMs += duration;
  recordEvidence[name] = evidence;
  collection.set(record, recordEvidence);
}

function quantize(value: number): number {
  return Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
}

export function refreshContentToken(record: CanvasRecord): void {
  record.contentSig.hash = mixTokenInto(
    mixTokenInto(0x811c9dc5, 'K', String(record.serial)),
    'v',
    `${record.contentVersion}${record.contentDirty ? '+dirty' : ''}`,
  );
}

function sortedEntries(
  props: Map<string, unknown>,
): Array<[string, unknown]> {
  return [...props.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function headState(record: CanvasRecord) {
  const entries = sortedEntries(record.props);
  entries.push(['__matrix', record.matrix.map(quantize)]);
  entries.push(['__path', record.pathHash]);
  entries.push(['__clip', record.clipHash]);
  let dimensionsUnknown =
    attributeObserverUnavailable ||
    record.attributeObservationUnavailable;
  try {
    const width = nativeCanvasWidthGetter?.call(record.canvas);
    const height = nativeCanvasHeightGetter?.call(record.canvas);
    if (typeof width === 'number' && typeof height === 'number') {
      entries.push(['__width', width]);
      entries.push(['__height', height]);
    } else {
      dimensionsUnknown = true;
    }
  } catch {
    dimensionsUnknown = true;
  }
  return {
    entries,
    matrixUnknown: record.matrixUnknown,
    clipUnknown: record.clipUnknown,
    pathUnknown: record.pathUnknown,
    dimensionsUnknown,
  };
}

function clearPersistentState(record: CanvasRecord): void {
  record.props.clear();
  record.matrix = [1, 0, 0, 1, 0, 0];
  computeMatrixHash(record);
  record.matrixUnknown = false;
  record.pathHash = 0x811c9dc5;
  record.pathUnknown = false;
  record.clipHash = 0x811c9dc5;
  record.clipUnknown = false;
  record.stateStack.length = 0;
}

function recordExactReset(
  record: CanvasRecord,
  reason: ResetReason,
  reentrantActivity: boolean,
  source: CanvasResetSource,
): void {
  record.exactResetDepth--;
  record.contentVersion++;
  record.resetVersion++;
  record.contentDirty = false;
  refreshContentToken(record);
  clearPersistentState(record);
  record.modelUntrusted = reentrantActivity;
  record.resetPendingReason ??= reason;
  markRecordActive(record);
  record.contextActivityInWindow = record.exactResetDepth > 0 && reentrantActivity;
  recordResetEvent(record, source);
}

function beginExactReset(record: CanvasRecord): boolean {
  const previousActivity = record.contextActivityInWindow;
  record.contextActivityInWindow = false;
  record.exactResetDepth++;
  return previousActivity;
}

function restoreActivityAfterFailedReset(
  record: CanvasRecord,
  previousActivity: boolean,
): void {
  record.exactResetDepth--;
  record.contextActivityInWindow ||= previousActivity;
}

function recordLateAttributeReset(record: CanvasRecord, source: CanvasResetSource): void {
  const activityMayHaveOverlapped = record.contextActivityInWindow === true;
  record.contentVersion++;
  record.resetVersion++;
  if (!activityMayHaveOverlapped && !record.modelUntrusted) {
    record.contentDirty = false;
    clearPersistentState(record);
  } else {
    record.modelUntrusted = true;
  }
  refreshContentToken(record);
  record.resetPendingReason ??= 'canvas-attribute-reset';
  reactivateRecord(record);
  markRecordActive(record);
  recordResetEvent(record, source);
}

function setProp(
  record: CanvasRecord,
  name: string,
  value: unknown,
): void {
  const frame = record.stateStack.at(-1);
  if (frame) {
    // Konva saves/restores per shape, so undo logs stay O(mutations) instead of O(props).
    frame.undo.push([name, record.props.get(name), record.props.has(name)]);
  }
  record.props.set(name, value);
}

function finiteArgs(args: unknown[], count: number): number[] | null {
  if (
    args.length < count ||
    args.slice(0, count).some(
      (value) => typeof value !== 'number' || !Number.isFinite(value),
    )
  ) {
    return null;
  }
  return <number[]>args.slice(0, count);
}

// Recomputed only on matrix MUTATION; path ops mix the cached fold instead
// of re-tokenizing six numbers per op (the always-on tracker hot path).
function computeMatrixHash(record: CanvasRecord): void {
  let hash = 0x811c9dc5;
  for (const value of record.matrix) {
    hash = mixNumberTokenInto(hash, value);
  }
  record.matrixHash = hash;
}

function updateMatrix(
  record: CanvasRecord,
  name: string,
  args: unknown[],
): boolean {
  const changed = applyMatrixOp(record, name, args);
  if (changed) computeMatrixHash(record);
  return changed;
}

function applyMatrixOp(
  record: CanvasRecord,
  name: string,
  args: unknown[],
): boolean {
  if (
    name === 'resetTransform' ||
    (name === 'setTransform' && args.length === 0)
  ) {
    record.matrix = [1, 0, 0, 1, 0, 0];
    record.matrixUnknown = false;
    return true;
  }

  const required =
    name === 'translate' || name === 'scale'
      ? 2
      : name === 'rotate'
        ? 1
        : name === 'transform' || name === 'setTransform'
          ? 6
          : 0;
  if (required === 0) return false;

  const values = finiteArgs(args, required);
  if (!values) {
    record.matrixUnknown = true;
    return true;
  }

  if (name === 'setTransform') {
    record.matrix = <CanvasRecord['matrix']>values;
    record.matrixUnknown = false;
    return true;
  }

  const [a, b, c, d, e, f] = record.matrix;
  if (name === 'translate') {
    const [x, y] = values;
    record.matrix = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  } else if (name === 'scale') {
    const [x, y] = values;
    record.matrix = [a * x, b * x, c * y, d * y, e, f];
  } else if (name === 'rotate') {
    const cosine = Math.cos(values[0]);
    const sine = Math.sin(values[0]);
    record.matrix = [
      a * cosine + c * sine,
      b * cosine + d * sine,
      -a * sine + c * cosine,
      -b * sine + d * cosine,
      e,
      f,
    ];
  } else {
    const [nextA, nextB, nextC, nextD, nextE, nextF] = values;
    record.matrix = [
      a * nextA + c * nextB,
      b * nextA + d * nextB,
      a * nextC + c * nextD,
      b * nextC + d * nextD,
      a * nextE + c * nextF + e,
      b * nextE + d * nextF + f,
    ];
  }
  return true;
}

function mixPathValue(
  record: CanvasRecord,
  hash: number,
  value: unknown,
): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      const cents = Math.round(value * 100);
      // The allocation-free fold is exact only inside int32; beyond it the
      // |0 narrowing aliases values 2^32 cents apart (Codex reproduction:
      // 0 vs 42949672.96) — fall back to the framed token there.
      return cents >= -0x80000000 && cents <= 0x7fffffff
        ? mixUintInto(hash, cents | 0)
        : mixNumberTokenInto(hash, value);
    }
    return mixNumberTokenInto(hash, value);
  }
  if (typeof value !== 'object' || value === null) {
    // Non-number primitives coerce deterministically, so they stay
    // classifiable — type-tagged, never pathUnknown.
    return mixTokenInto(hash, 'p', `${typeof value}:${String(value)}`);
  }
  // Objects are only modeled from own DATA properties read via descriptors:
  // accessor-backed inputs can answer native conversion and the tracer
  // differently, and property reads here would be observable app behavior.
  if (Array.isArray(value)) {
    hash = mixTokenInto(hash, 'A', String(value.length));
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor) {
        // A hole: Web IDL conversion reads INHERITED indices (Chrome probe:
        // a prototype getter supplied radius 40) — the model cannot.
        record.pathUnknown = true;
        return mixTokenInto(hash, '?', 'hole');
      }
      if (!('value' in descriptor)) {
        record.pathUnknown = true;
        return mixTokenInto(hash, '?', 'accessor');
      }
      hash = mixPathValue(record, hash, descriptor.value);
    }
    return hash;
  }
  const point: Partial<Record<'x' | 'y' | 'z' | 'w', unknown>> = {};
  for (const key of ['x', 'y', 'z', 'w'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (!('value' in descriptor)) {
      record.pathUnknown = true;
      return mixTokenInto(hash, '?', 'accessor');
    }
    point[key] = descriptor.value;
  }
  if (typeof point.x === 'number' && typeof point.y === 'number') {
    hash = mixTokenInto(hash, 'P', '');
    hash = mixNumberTokenInto(hash, point.x);
    hash = mixNumberTokenInto(hash, point.y);
    hash = mixNumberTokenInto(hash, typeof point.z === 'number' ? point.z : 0);
    hash = mixNumberTokenInto(hash, typeof point.w === 'number' ? point.w : 1);
    return hash;
  }
  // Unmodelable path input: persist uncertainty instead of hashing a type tag.
  record.pathUnknown = true;
  return mixTokenInto(hash, '?', typeof value);
}

function updatePathHash(
  record: CanvasRecord,
  name: string,
  args: unknown[],
): void {
  // Geometry added while the CTM is unmodeled stays unmodeled even after a
  // later numeric setTransform clears matrixUnknown.
  if (record.matrixUnknown) record.pathUnknown = true;
  let hash = mixTokenInto(record.pathHash, 'C', name);
  for (const arg of args) {
    hash = mixPathValue(record, hash, arg);
  }
  // Canvas path points are transformed when they are added, not when they
  // are drawn; the matrix contribution is the cached mutation-time fold.
  hash = mixUintInto(hash, record.matrixHash);
  record.pathHash = hash;
}

function updateClipHash(record: CanvasRecord, args: unknown[]): void {
  const pathArg = hasPath2DArgument(args) ? <object>args[0] : null;
  const build = pathArg ? getBuildSignature(pathArg) : undefined;
  if (pathArg && (!build || build.unknown)) record.clipUnknown = true;
  if (!pathArg && record.pathUnknown) record.clipUnknown = true;
  const pathHash = pathArg && build ? build.hash : record.pathHash;
  const fillRule = String(args[pathArg ? 1 : 0] ?? 'nonzero');
  let hash = mixTokenInto(
    mixTokenInto(record.clipHash, 'Q', String(pathHash)),
    's',
    fillRule,
  );
  if (pathArg) {
    // Path2D clip geometry depends on the CTM at clip time; bare paths bake
    // the CTM at build time instead.
    if (record.matrixUnknown) record.clipUnknown = true;
    hash = mixUintInto(hash, record.matrixHash);
  }
  record.clipHash = hash;
}

function updateMethodState(
  record: CanvasRecord,
  name: string,
  args: unknown[],
  context?: any,
  matrixOperation = false,
  barePathOperation = false,
): void {
  if (matrixOperation && updateMatrix(record, name, args)) {
    return;
  }
  if (name === 'save') {
    record.stateStack.push({
      matrix: <CanvasRecord['matrix']>[...record.matrix],
      matrixUnknown: record.matrixUnknown,
      clipHash: record.clipHash,
      clipUnknown: record.clipUnknown,
      undo: [],
    });
  } else if (name === 'restore') {
    const state = record.stateStack.pop();
    if (state) {
      record.matrix = state.matrix;
      computeMatrixHash(record);
      record.matrixUnknown = state.matrixUnknown;
      record.clipHash = state.clipHash;
      record.clipUnknown = state.clipUnknown;
      for (let index = state.undo.length - 1; index >= 0; index--) {
        const [prop, prev, existed] = state.undo[index];
        if (existed) record.props.set(prop, prev);
        else record.props.delete(prop);
      }
    }
  } else if (name === 'clip') {
    updateClipHash(record, args);
  } else if (name === 'beginPath') {
    record.pathHash = 0x811c9dc5;
    record.pathUnknown = false;
  } else if (barePathOperation) {
    updatePathHash(record, name, args);
  } else if (name === 'setLineDash') {
    // The native call consumes one-shot iterables, so re-reading the
    // argument is wrong (a generator re-reads as []); the ORIGINAL
    // prototype getLineDash is the authoritative post-call snapshot.
    const native =
      nativeGetLineDash && context
        ? nativeGetLineDash.call(context)
        : null;
    setProp(
      record,
      '__lineDash',
      Array.isArray(native) ? native : { unmodeledDash: true },
    );
  }
}

function hasPath2DArgument(args: unknown[]): boolean {
  const first = args[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    first.constructor?.name === 'Path2D'
  );
}

function kill(error: unknown) {
  if (killed) return;
  killed = true;
  console.warn('[canvas-scan] instrumentation disabled', error);
}

function trackGradient(gradient: any, creator: string, args: unknown[]) {
  const sig = newWindowSignature();
  captureOp(sig, creator, args);
  trackBuild(gradient, sig);
  const originalAdd = gradient.addColorStop;
  if (typeof originalAdd !== 'function') return;
  // per-instance shadow: CanvasGradient.prototype isn't injectable in tests,
  // and every gradient is born here anyway
  Object.defineProperty(gradient, 'addColorStop', {
    configurable: true,
    writable: true,
    value(this: any, ...stopArgs: unknown[]) {
      const result = originalAdd.apply(this, stopArgs);
      try {
        captureOp(sig, 'addColorStop', stopArgs);
        if (windowCaptured) {
          for (const record of gradientDependents.get(this) ?? []) {
            // Dependents stay registered after reassignment; a false unknown is conservative-safe.
            markUnknown(record.sig, 'gradient-mutated');
            reactivateRecord(record);
            markRecordActive(record);
          }
        }
      } catch (error) {
        kill(error);
      }
      return result;
    },
  });
}

export function getRecord(canvas: unknown): CanvasRecord | undefined {
  return recordByCanvas.get(canvas as object);
}

export function markAttributeReset(canvas: unknown, source: CanvasResetSource): void {
  const record = recordByCanvas.get(canvas as object);
  if (!record) return;
  recordLateAttributeReset(record, source);
}

function isDimensionalAttributeRecord(
  entry: MutationRecord,
): boolean {
  return (
    entry.attributeName === 'width' ||
    entry.attributeName === 'height'
  );
}

function applyAttributeRecords(
  entries: MutationRecord[],
  suppressedTarget?: unknown,
  suppressedAttribute?: string,
): void {
  let suppressedIndex = -1;
  if (suppressedTarget !== undefined && suppressedAttribute !== undefined) {
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (
        entry.target === suppressedTarget &&
        entry.attributeName === suppressedAttribute
      ) {
        suppressedIndex = index;
        break;
      }
    }
  }
  for (const [index, entry] of entries.entries()) {
    if (index !== suppressedIndex && isDimensionalAttributeRecord(entry)) {
      markAttributeReset(entry.target, entry.attributeName === 'width' ? 'width-attribute' : 'height-attribute');
    }
  }
}

function markAttributeDrainUnavailable(): void {
  attributeObserverUnavailable = true;
  for (const record of records) {
    if (record.activeInWindow) {
      markUnknown(record.sig, 'canvas-dimensions-unmodeled');
    }
  }
}

function drainAttributeRecordsForExactReset(
  canvas: unknown,
  attribute: string,
): void {
  if (!takeAttributeRecords) {
    markAttributeDrainUnavailable();
    return;
  }
  try {
    applyAttributeRecords(
      takeAttributeRecords(),
      canvas,
      attribute,
    );
  } catch {
    markAttributeDrainUnavailable();
  }
}

export function drainAttributeRecords(): void {
  if (!takeAttributeRecords) {
    markAttributeDrainUnavailable();
    return;
  }
  try {
    applyAttributeRecords(takeAttributeRecords());
  } catch {
    markAttributeDrainUnavailable();
  }
}

export function isKilled(): boolean {
  return killed;
}

export function installCanvasPatch(targets?: PatchTargets): void {
  if (installed) return;
  installed = true;

  const canvasProto =
    targets?.canvasProto ?? HTMLCanvasElement.prototype;
  const contextProto =
    targets?.contextProto ?? CanvasRenderingContext2D.prototype;
  const originalGetContext = canvasProto.getContext;
  const originalSetAttribute = canvasProto.setAttribute;
  const originalRemoveAttribute = canvasProto.removeAttribute;
  const originalHasAttribute = canvasProto.hasAttribute;
  nativeGetLineDash =
    typeof contextProto.getLineDash === 'function'
      ? contextProto.getLineDash
      : null;
  nativeIsConnectedGetter =
    typeof Node !== 'undefined'
      ? Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected')?.get ?? null
      : null;
  // The DOM reports every width/height attribute mutation, regardless of
  // which API made it. takeRecords() moves late delivery to the comparison
  // boundary so the affected window is refused.
  const attributeObserver =
    targets?.attributeObserver !== undefined
      ? targets.attributeObserver
      : typeof MutationObserver === 'function'
        ? new MutationObserver((entries) => {
            applyAttributeRecords(entries);
          })
        : null;
  const observeAttributes =
    attributeObserver &&
    typeof attributeObserver.observe === 'function'
      ? attributeObserver.observe.bind(attributeObserver)
      : null;
  takeAttributeRecords =
    attributeObserver &&
    typeof attributeObserver.takeRecords === 'function'
      ? attributeObserver.takeRecords.bind(attributeObserver)
      : null;
  attributeObserverUnavailable =
    observeAttributes === null || takeAttributeRecords === null;

  canvasProto.getContext = function (this: any, ...args: unknown[]) {
    const context = originalGetContext.apply(this, args);
    if (
      args[0] === '2d' &&
      context &&
      !recordByCanvas.has(this)
    ) {
      const elementId = this.getAttribute('id');
      const serial = nextCanvasSerial++;
      const record: CanvasRecord = {
        canvas: this,
        contentDirty: false,
        contentSig: newWindowSignature(),
        contentVersion: 0,
        id: elementId ? `${elementId}#${serial}` : `canvas:${serial}`,
        serial,
        sig: newWindowSignature(),
        rasterOps: 0,
        selfTimeMs: 0,
        activeInWindow: false,
        prev: null,
        attribution: null,
        lastStatus: null,
        props: new Map(),
        matrix: [1, 0, 0, 1, 0, 0],
        matrixUnknown: false,
        matrixHash: 0,
        pathHash: 0x811c9dc5,
        pathUnknown: false,
        clipHash: 0x811c9dc5,
        clipUnknown: false,
        resetPendingReason: null,
        modelUntrusted: false,
        resetVersion: 0,
        continuityLost: false,
        sourceResetVersions: new Map(),
        attributeObservationUnavailable: attributeObserverUnavailable,
        contextActivityInWindow: false,
        exactResetDepth: 0,
        inactiveBoundaries: 0,
        retired: false,
        lastConnected: false,
        activeLifecycleRecorded: false,
        pendingLifecycleEvents: [],
        stateStack: [],
      };
      record.lastConnected = getConnectionState(record);
      computeMatrixHash(record);
      refreshContentToken(record);
      trackBuild(this, record.contentSig);
      records.add(record);
      queueLifecycleEvent(record, 'first-observed', record.lastConnected);
      recordByCanvas.set(this, record);
      recordByContext.set(context, record);
      if (observeAttributes) {
        try {
          observeAttributes(this, {
            attributes: true,
            attributeFilter: ['width', 'height'],
          });
          record.attributeObservationUnavailable =
            takeAttributeRecords === null;
        } catch {
          record.attributeObservationUnavailable = true;
        }
      }
    }
    return context;
  };

  const widthDescriptor = Object.getOwnPropertyDescriptor(
    canvasProto,
    'width',
  );
  const heightDescriptor = Object.getOwnPropertyDescriptor(
    canvasProto,
    'height',
  );
  nativeCanvasWidthGetter = widthDescriptor?.get ?? null;
  nativeCanvasHeightGetter = heightDescriptor?.get ?? null;

  if (typeof originalSetAttribute === 'function') {
    canvasProto.setAttribute = function (
      this: any,
      name: unknown,
      ...args: unknown[]
    ) {
      // A symbol name must reach the native call unconverted: WebIDL DOMString
      // conversion throws for symbols, and swallowing that would let a call
      // that should fail quietly set an attribute instead.
      if (typeof name === 'symbol') {
        return originalSetAttribute.call(this, name as any, ...args);
      }
      // Otherwise convert ONCE and hand the result to the native call. Two
      // independent conversions let a stateful toString resize the canvas
      // while telling us it touched some other attribute.
      const raw = String(name);
      const record = recordByCanvas.get(this);
      const attribute = raw.toLowerCase();
      const dimensional = attribute === 'width' || attribute === 'height';
      const previousActivity =
        record && !killed && dimensional
          ? beginExactReset(record)
          : null;
      let result;
      try {
        result = originalSetAttribute.call(this, raw, ...args);
      } catch (error) {
        if (record && previousActivity !== null) {
          restoreActivityAfterFailedReset(record, previousActivity);
        }
        throw error;
      }
      if (!record || killed) return result;
      if (dimensional) {
        reactivateRecord(record);
        drainAttributeRecordsForExactReset(this, attribute);
        recordExactReset(
          record,
          'canvas-reset',
          record.contextActivityInWindow,
          attribute === 'width' ? 'width-attribute' : 'height-attribute',
        );
      }
      return result;
    };
  }

  if (typeof originalRemoveAttribute === 'function') {
    canvasProto.removeAttribute = function (
      this: any,
      name: unknown,
      ...args: unknown[]
    ) {
      if (typeof name === 'symbol') {
        return originalRemoveAttribute.call(this, name as any, ...args);
      }
      const raw = String(name);
      const attribute = raw.toLowerCase();
      const record = recordByCanvas.get(this);
      const dimensional = attribute === 'width' || attribute === 'height';
      // Removing an attribute that is not there is a no-op: the browser resets
      // nothing. Treating it as a resize would clear modelled state the canvas
      // still has, which is a false `same` waiting to happen. Presence has to
      // be read BEFORE the removal.
      let wasPresent = false;
      if (record && !killed && dimensional) {
        try {
          wasPresent =
            originalHasAttribute?.call(this, raw) !== false;
        } catch {
          wasPresent = true;
        }
      }
      const previousActivity =
        record && !killed && dimensional && wasPresent
          ? beginExactReset(record)
          : null;
      let result;
      try {
        result = originalRemoveAttribute.call(this, raw, ...args);
      } catch (error) {
        if (record && previousActivity !== null) {
          restoreActivityAfterFailedReset(record, previousActivity);
        }
        throw error;
      }
      if (!record || killed) return result;
      if (dimensional && wasPresent) {
        reactivateRecord(record);
        drainAttributeRecordsForExactReset(this, attribute);
        recordExactReset(
          record,
          'canvas-reset',
          record.contextActivityInWindow,
          attribute === 'width' ? 'width-attribute' : 'height-attribute',
        );
      }
      return result;
    };
  }

  for (const name of ['width', 'height']) {
    const descriptor =
      name === 'width' ? widthDescriptor : heightDescriptor;
    if (!descriptor?.get || !descriptor.set) continue;

    const originalSet = descriptor.set;
    Object.defineProperty(canvasProto, name, {
      ...descriptor,
      set(this: any, value: unknown) {
        const record = recordByCanvas.get(this);
        const previousActivity =
          record && !killed
            ? beginExactReset(record)
            : null;
        try {
          originalSet.call(this, value);
        } catch (error) {
          if (record && previousActivity !== null) {
            restoreActivityAfterFailedReset(record, previousActivity);
          }
          throw error;
        }
        if (!record || killed) return;
        reactivateRecord(record);
        drainAttributeRecordsForExactReset(this, name);
        recordExactReset(
          record,
          'canvas-reset',
          record.contextActivityInWindow,
          name === 'width' ? 'width-setter' : 'height-setter',
        );
      },
    });
  }

  for (const name of CAPTURED_METHODS) {
    const original = contextProto[name];
    if (typeof original !== 'function') continue;
    const resetsContext = name === 'reset';
    const rasterOperation = RASTER_OPS.has(name);
    const gradientCreator = GRADIENT_CREATORS.has(name);
    const matrixOperation = MATRIX_OPS.has(name);
    const barePathOperation = BARE_PATH_OPS.has(name);

    contextProto[name] = function (this: any, ...args: unknown[]) {
      const record = recordByContext.get(this);
      if (!record || killed) return original.apply(this, args);

      const reactivated = reactivateRecord(record);
      const firstActivity = !record.activeInWindow;
      const headEntries =
        !resetsContext && windowCaptured && firstActivity
          ? headState(record)
          : null;
      // Uncaptured windows discard selfTimeMs at reset, so skip the two
      // performance.now() calls there — they dominate count-only overhead.
      const timed = windowCaptured;
      const start = timed ? performance.now() : 0;
      // A throwing native call must leave the model untouched: every state
      // mutation happens after the call returns. Canvas calls are
      // synchronous, so a later same-window consumer still sees the dirty
      // token before it can read this source.
      const previousActivity =
        resetsContext
          ? beginExactReset(record)
          : null;
      let result;
      try {
        result = original.apply(this, args);
      } catch (error) {
        if (reactivated) restoreRetirement(record);
        if (previousActivity !== null) {
          restoreActivityAfterFailedReset(record, previousActivity);
        }
        throw error;
      }
      if (timed) {
        const duration = performance.now() - start;
        record.selfTimeMs += duration;
        if (methodEvidenceByRecord) {
          addMethodEvidence(methodEvidenceByRecord, record, name, duration);
        }
      } else if (methodEvidenceByRecord) {
        addMethodEvidence(methodEvidenceByRecord, record, name, null);
      }
      if (resetsContext) {
        drainAttributeRecords();
        recordExactReset(
          record,
          'canvas-reset',
          record.contextActivityInWindow,
          'context-reset',
        );
      } else {
        markRecordActive(record);
        if (rasterOperation) {
          record.rasterOps++;
          if (!record.contentDirty) {
            record.contentDirty = true;
            refreshContentToken(record);
          }
        }
      }
      try {
        if (headEntries) {
          captureHeadState(record.sig, headEntries.entries);
          if (headEntries.matrixUnknown) {
            markUnknown(record.sig, 'transform-unmodeled');
          }
          if (headEntries.clipUnknown) {
            markUnknown(record.sig, 'clip-unmodeled');
          }
          if (headEntries.pathUnknown) {
            markUnknown(record.sig, 'path-unmodeled');
          }
          if (headEntries.dimensionsUnknown) {
            markUnknown(record.sig, 'canvas-dimensions-unmodeled');
          }
        }
        if (!resetsContext) {
          updateMethodState(record, name, args, this, matrixOperation, barePathOperation);
        }
        if (windowCaptured && !resetsContext) {
          if (name === 'clip' && record.clipUnknown) {
            markUnknown(record.sig, 'clip-unmodeled');
          }
          if (name === 'drawImage') {
            const source = args[0];
            if (
              (typeof source === 'object' && source !== null) ||
              typeof source === 'function'
            ) {
              const sourceRecord = recordByCanvas.get(source as object);
              if (sourceRecord) {
                if (!record.sourceResetVersions.has(sourceRecord)) {
                  record.sourceResetVersions.set(
                    sourceRecord,
                    sourceRecord.resetPendingReason === null
                      ? sourceRecord.resetVersion
                      : sourceRecord.resetVersion - 1,
                  );
                }
              }
            }
          }
          captureOp(record.sig, name, args);
        }
        if (gradientCreator && result && typeof result === 'object') {
          trackGradient(result, name, args);
        }
      } catch (error) {
        kill(error);
      }
      return result;
    };
  }

  for (const name of CAPTURED_SETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(contextProto, name);
    if (!descriptor?.get || !descriptor.set) continue;

    const originalSet = descriptor.set;
    Object.defineProperty(contextProto, name, {
      ...descriptor,
      set(this: any, value: unknown) {
        const record = recordByContext.get(this);
        const firstActivity = record
          ? !record.activeInWindow
          : false;
        const headEntries =
          record && !killed && windowCaptured && firstActivity
            ? headState(record)
            : null;
        originalSet.call(this, value);
        if (!record || killed) return;
        reactivateRecord(record);
        if (methodEvidenceByRecord) {
          addMethodEvidence(methodEvidenceByRecord, record, name, null);
        }
        markRecordActive(record);
        if (headEntries) {
          try {
            captureHeadState(record.sig, headEntries.entries);
            if (headEntries.matrixUnknown) {
              markUnknown(record.sig, 'transform-unmodeled');
            }
            if (headEntries.clipUnknown) {
              markUnknown(record.sig, 'clip-unmodeled');
            }
            if (headEntries.pathUnknown) {
              markUnknown(record.sig, 'path-unmodeled');
            }
            if (headEntries.dimensionsUnknown) {
              markUnknown(record.sig, 'canvas-dimensions-unmodeled');
            }
          } catch (error) {
            kill(error);
          }
          if (killed) return;
        }
        setProp(record, name, value);
        if (typeof value === 'object' && value !== null) {
          const build = getBuildSignature(value);
          if (build) {
            let dependents = gradientDependents.get(value);
            if (!dependents) {
              dependents = new Set();
              gradientDependents.set(value, dependents);
            }
            dependents.add(record);
          }
        }
        try {
          if (windowCaptured) captureSet(record.sig, name, value);
        } catch (error) {
          kill(error);
        }
      },
    });
  }
}
