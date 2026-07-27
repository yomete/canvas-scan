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

function mixRaw(sig: WindowSignature, text: string) {
  for (let index = 0; index < text.length; index++) {
    sig.hash = Math.imul(sig.hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
}

// Known one-char tags and length-prefixed bodies make the token stream uniquely decodable.
function mixToken(sig: WindowSignature, tag: string, body: string): void {
  mixRaw(sig, tag);
  mixRaw(sig, String(body.length));
  mixRaw(sig, ':');
  mixRaw(sig, body);
}

function mixNumber(sig: WindowSignature, value: number) {
  const quantized = Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
  mixToken(sig, 'n', String(quantized));
}

function mixValue(sig: WindowSignature, value: unknown) {
  if (typeof value === 'number') {
    mixNumber(sig, value);
    return;
  }

  if (typeof value === 'string') {
    mixToken(sig, 's', value);
    return;
  }

  if (typeof value === 'boolean') {
    mixToken(sig, 'b', value ? '1' : '0');
    return;
  }

  if (value === null) {
    mixToken(sig, 'z', '');
    return;
  }

  if (value === undefined) {
    mixToken(sig, 'u', '');
    return;
  }

  if (Array.isArray(value)) {
    mixToken(sig, 'A', String(value.length));
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
      mixToken(
        sig,
        'k',
        `${value.constructor?.name ?? 'object'}#${build.hash}`,
      );
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
    mixToken(sig, 'i', image.currentSrc || image.src || '');
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
  mixToken(sig, 'C', method);
  mixRaw(sig, `/${args.length};`);
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
  mixToken(sig, 'S', prop);
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
