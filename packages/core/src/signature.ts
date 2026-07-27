import type { SignatureStatus } from './types';
import { getBuildSignature } from './build-registry';

export interface WindowSignature {
  hash: number;
  unknown: boolean;
  opCount: number;
  unknownReason: string | null;
}

const UNKNOWN_SOURCES = new Set([
  'HTMLVideoElement',
  'HTMLCanvasElement',
  'OffscreenCanvas',
  'ImageBitmap',
  'ImageData',
  'CanvasPattern',
  'CanvasGradient',
  'Path2D',
]);

function mixString(sig: WindowSignature, value: string) {
  for (let index = 0; index < value.length; index++) {
    sig.hash = Math.imul(sig.hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
}

function mixNumber(sig: WindowSignature, value: number) {
  const quantized = Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
  mixString(sig, String(quantized));
}

function mixValue(sig: WindowSignature, value: unknown) {
  if (typeof value === 'number') {
    mixNumber(sig, value);
    return;
  }

  if (typeof value === 'string') {
    mixString(sig, value);
    return;
  }

  if (typeof value === 'boolean') {
    mixString(sig, value ? 'boolean:true' : 'boolean:false');
    return;
  }

  if (value === null) {
    mixString(sig, 'null');
    return;
  }

  if (value === undefined) {
    mixString(sig, 'undefined');
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'number') {
        markUnknown(sig, 'array-element');
        return;
      }
      mixNumber(sig, item);
    }
    return;
  }

  if (typeof value !== 'object') {
    markUnknown(sig, `value:${typeof value}`);
    return;
  }

  const build = getBuildSignature(value);
  if (build) {
    if (build.unknown) {
      markUnknown(sig, `${value.constructor?.name ?? 'object'}:dirty`);
    } else {
      mixString(sig, `${value.constructor?.name ?? 'object'}#`);
      mixNumber(sig, build.hash);
    }
    return;
  }

  const constructorName = value.constructor?.name;
  if (constructorName && UNKNOWN_SOURCES.has(constructorName)) {
    markUnknown(sig, constructorName);
    return;
  }

  if (constructorName === 'HTMLImageElement') {
    type ImageSource = {
      currentSrc?: string;
      src?: string;
      naturalWidth?: number;
      naturalHeight?: number;
    };
    const image = <ImageSource>value;
    mixString(sig, image.currentSrc || image.src || '');
    mixNumber(sig, image.naturalWidth ?? 0);
    mixNumber(sig, image.naturalHeight ?? 0);
    return;
  }

  markUnknown(sig, `object:${constructorName ?? 'anonymous'}`);
}

export function newWindowSignature(): WindowSignature {
  return {
    hash: 0x811c9dc5,
    unknown: false,
    opCount: 0,
    unknownReason: null,
  };
}

export function markUnknown(sig: WindowSignature, reason: string): void {
  sig.unknown = true;
  sig.unknownReason ??= reason;
}

export function captureOp(
  sig: WindowSignature,
  method: string,
  args: readonly unknown[],
): void {
  mixString(sig, method);
  for (const arg of args) {
    mixValue(sig, arg);
  }
  sig.opCount++;
}

export function captureSet(
  sig: WindowSignature,
  prop: string,
  value: unknown,
): void {
  mixString(sig, prop);
  mixValue(sig, value);
  sig.opCount++;
}

export function computeStatus(
  prev: { hash: number; unknown: boolean } | null,
  cur: WindowSignature,
): SignatureStatus {
  if (prev === null || prev.unknown || cur.unknown) {
    return 'unknown';
  }
  return prev.hash === cur.hash ? 'same' : 'changed';
}
