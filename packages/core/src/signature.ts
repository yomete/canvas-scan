import type { NormalizedCanvasCommand, SignatureStatus } from './types';
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

export function fnvStep(hash: number, text: string): number {
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

export function mixTokenInto(
  hash: number,
  tag: string,
  body: string,
): number {
  hash = fnvStep(hash, tag);
  hash = fnvStep(hash, String(body.length));
  hash = fnvStep(hash, ':');
  return fnvStep(hash, body);
}

// Allocation-free fixed-width token: one tag byte + four value bytes is
// uniquely decodable without length framing. Used on always-on hot paths
// (per-op path/matrix tracking) where String() allocation dominates.
export function mixUintInto(hash: number, value: number): number {
  hash = Math.imul(hash ^ 0x75, 0x01000193) >>> 0; // 'u' tag byte
  hash = Math.imul(hash ^ (value & 0xff), 0x01000193) >>> 0;
  hash = Math.imul(hash ^ ((value >>> 8) & 0xff), 0x01000193) >>> 0;
  hash = Math.imul(hash ^ ((value >>> 16) & 0xff), 0x01000193) >>> 0;
  return Math.imul(hash ^ ((value >>> 24) & 0xff), 0x01000193) >>> 0;
}

export function mixNumberTokenInto(hash: number, value: number): number {
  const quantized = Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
  return mixTokenInto(hash, 'n', String(quantized));
}

function mixRaw(sig: WindowSignature, text: string) {
  sig.hash = fnvStep(sig.hash, text);
}

// Known one-char tags and length-prefixed bodies make the token stream uniquely decodable.
function mixToken(sig: WindowSignature, tag: string, body: string): void {
  sig.hash = mixTokenInto(sig.hash, tag, body);
}

function mixNumber(sig: WindowSignature, value: number) {
  sig.hash = mixNumberTokenInto(sig.hash, value);
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
    // Descriptor reads only: iterating or indexing the app's array would
    // invoke accessors/custom iterators — observable behavior the native
    // call may not perform, and a source of model/native divergence.
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor) {
        markUnknown(sig, 'array-hole');
        return;
      }
      if (!('value' in descriptor)) {
        markUnknown(sig, 'array-accessor');
        return;
      }
      if (typeof descriptor.value !== 'number') {
        markUnknown(sig, 'array-element');
        return;
      }
      mixNumber(sig, descriptor.value);
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

// Selected detail capture gives this helper only safe kinds and opaque,
// capture-scoped tokens. It never examines application values.
export function captureNormalizedCommand(
  sig: WindowSignature,
  command: NormalizedCanvasCommand,
): void {
  mixToken(sig, command.operationKind === 'call' ? 'C' : 'S', command.name);
  mixToken(sig, 'N', String(command.argumentCount));
  for (const argument of command.arguments) {
    mixToken(sig, 'K', argument.kind);
    mixToken(sig, 'T', argument.token ?? '?');
  }
  if (command.unknownReason) markUnknown(sig, command.unknownReason);
  sig.opCount++;
}

export function captureHeadState(
  sig: WindowSignature,
  entries: ReadonlyArray<readonly [string, unknown]>,
): void {
  mixToken(sig, 'H', String(entries.length));
  for (const [name, value] of entries) {
    mixToken(sig, 'P', name);
    mixValue(sig, value);
  }
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
