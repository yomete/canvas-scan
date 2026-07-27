import { trackBuild } from './build-registry';
import {
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
];

export const records = new Set<CanvasRecord>();

const recordByCanvas = new WeakMap<object, CanvasRecord>();
const recordByContext = new WeakMap<object, CanvasRecord>();

let installed = false;
let killed = false;
let nextCanvasId = 1;

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

      const start = performance.now();
      let result: unknown;
      try {
        result = original.apply(this, args);
        return result;
      } finally {
        record.selfTimeMs += performance.now() - start;
        record.activeInWindow = true;
        if (RASTER_OPS.has(name)) record.rasterOps++;
        try {
          captureOp(record.sig, name, args);
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
        try {
          captureSet(record.sig, name, value);
        } catch (error) {
          kill(error);
        }
      },
    });
  }
}
