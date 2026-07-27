import { getBuildSignature, trackBuild } from './build-registry';
import {
  captureHeadState,
  captureOp,
  captureSet,
  markUnknown,
  newWindowSignature,
} from './signature';
import type {
  AttributionKind,
  SignatureStatus,
} from './types';
import type { WindowSignature } from './signature';

export interface PatchTargets {
  canvasProto: any;
  contextProto: any;
}

export interface CanvasRecord {
  canvas: any;
  id: string;
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
  pathHash: number;
  clipHash: number;
  stateStack: Array<{
    matrix: CanvasRecord['matrix'];
    matrixUnknown: boolean;
    clipHash: number;
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

let installed = false;
let killed = false;
let nextCanvasId = 1;
let windowCaptured = true;

export function setWindowCaptured(captured: boolean): void {
  windowCaptured = captured;
}

function quantize(value: number): number {
  return Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
}

function mixIntoHash(hash: number, text: string): number {
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
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
  return { entries, matrixUnknown: record.matrixUnknown };
}

function clearPersistentState(record: CanvasRecord): void {
  record.props.clear();
  record.matrix = [1, 0, 0, 1, 0, 0];
  record.matrixUnknown = false;
  record.pathHash = 0x811c9dc5;
  record.clipHash = 0x811c9dc5;
  record.stateStack.length = 0;
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

function updateMatrix(
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

function updatePathHash(
  record: CanvasRecord,
  name: string,
  args: unknown[],
): void {
  let hash = mixIntoHash(record.pathHash, name);
  for (const arg of args) {
    hash = mixIntoHash(
      hash,
      typeof arg === 'number' ? String(quantize(arg)) : '?',
    );
  }
  // Canvas path points are transformed when they are added, not when they are drawn.
  for (const value of record.matrix) {
    hash = mixIntoHash(hash, String(quantize(value)));
  }
  record.pathHash = hash;
}

function updateClipHash(record: CanvasRecord, args: unknown[]): void {
  const pathArg = hasPath2DArgument(args) ? <object>args[0] : null;
  const build = pathArg ? getBuildSignature(pathArg) : undefined;
  const pathHash = pathArg
    ? String(build?.hash ?? 'untracked')
    : String(record.pathHash);
  const fillRule = String(args[pathArg ? 1 : 0] ?? 'nonzero');
  record.clipHash = mixIntoHash(
    mixIntoHash(record.clipHash, pathHash),
    fillRule,
  );
}

function updateMethodState(
  record: CanvasRecord,
  name: string,
  args: unknown[],
): void {
  if (updateMatrix(record, name, args)) {
    return;
  }
  if (name === 'save') {
    record.stateStack.push({
      matrix: <CanvasRecord['matrix']>[...record.matrix],
      matrixUnknown: record.matrixUnknown,
      clipHash: record.clipHash,
    });
  } else if (name === 'restore') {
    const state = record.stateStack.pop();
    if (state) {
      record.matrix = state.matrix;
      record.matrixUnknown = state.matrixUnknown;
      record.clipHash = state.clipHash;
    }
  } else if (name === 'clip') {
    updateClipHash(record, args);
  } else if (name === 'beginPath') {
    record.pathHash = 0x811c9dc5;
  } else if (BARE_PATH_OPS.has(name)) {
    updatePathHash(record, name, args);
  } else if (name === 'reset') {
    clearPersistentState(record);
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

  canvasProto.getContext = function (this: any, ...args: unknown[]) {
    const context = originalGetContext.apply(this, args);
    if (
      args[0] === '2d' &&
      context &&
      !recordByCanvas.has(this)
    ) {
      const elementId = this.getAttribute('id');
      const record: CanvasRecord = {
        canvas: this,
        id: elementId || `canvas:${nextCanvasId++}`,
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
        pathHash: 0x811c9dc5,
        clipHash: 0x811c9dc5,
        stateStack: [],
      };
      records.add(record);
      recordByCanvas.set(this, record);
      recordByContext.set(context, record);
    }
    return context;
  };

  for (const name of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(canvasProto, name);
    if (!descriptor?.get || !descriptor.set) continue;

    const originalSet = descriptor.set;
    Object.defineProperty(canvasProto, name, {
      ...descriptor,
      set(this: any, value: unknown) {
        originalSet.call(this, value);
        const record = recordByCanvas.get(this);
        if (!record || killed) return;
        // resize resets context state the signature can't model
        markUnknown(record.sig, 'canvas-resize');
        clearPersistentState(record);
        record.activeInWindow = true;
      },
    });
  }

  for (const name of CAPTURED_METHODS) {
    const original = contextProto[name];
    if (typeof original !== 'function') continue;

    contextProto[name] = function (this: any, ...args: unknown[]) {
      const record = recordByContext.get(this);
      if (!record || killed) return original.apply(this, args);

      const firstActivity = !record.activeInWindow;
      const start = performance.now();
      let result: unknown;
      try {
        result = original.apply(this, args);
        return result;
      } finally {
        record.selfTimeMs += performance.now() - start;
        record.activeInWindow = true;
        if (RASTER_OPS.has(name)) record.rasterOps++;
        const headEntries =
          windowCaptured && firstActivity
            ? headState(record)
            : null;
        updateMethodState(record, name, args);
        try {
          if (headEntries) {
            captureHeadState(record.sig, headEntries.entries);
            if (headEntries.matrixUnknown) {
              markUnknown(record.sig, 'transform-unmodeled');
            }
          }
          if (windowCaptured) {
            captureOp(record.sig, name, args);
          }
          if (
            GRADIENT_CREATORS.has(name) &&
            result &&
            typeof result === 'object'
          ) {
            trackGradient(result, name, args);
          }
        } catch (error) {
          kill(error);
        }
      }
    };
  }

  for (const name of CAPTURED_SETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(contextProto, name);
    if (!descriptor?.get || !descriptor.set) continue;

    const originalSet = descriptor.set;
    Object.defineProperty(contextProto, name, {
      ...descriptor,
      set(this: any, value: unknown) {
        originalSet.call(this, value);
        const record = recordByContext.get(this);
        if (!record || killed) return;
        const firstActivity = !record.activeInWindow;
        record.activeInWindow = true;
        const headEntries =
          windowCaptured && firstActivity
            ? headState(record)
            : null;
        record.props.set(name, value);
        try {
          if (headEntries) {
            captureHeadState(record.sig, headEntries.entries);
            if (headEntries.matrixUnknown) {
              markUnknown(record.sig, 'transform-unmodeled');
            }
          }
          if (windowCaptured) captureSet(record.sig, name, value);
        } catch (error) {
          kill(error);
        }
      },
    });
  }
}
