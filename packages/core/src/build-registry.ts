import type { WindowSignature } from './signature.js';

const buildSignatures = new WeakMap<object, WindowSignature>();
const buildKinds = new WeakMap<object, 'path' | 'gradient'>();

export function getBuildSignature(value: object): WindowSignature | undefined {
  return buildSignatures.get(value);
}

export function trackBuild(value: object, signature: WindowSignature, kind?: 'path' | 'gradient'): void {
  buildSignatures.set(value, signature);
  if (kind) buildKinds.set(value, kind);
}

export function getBuildKind(value: object): 'path' | 'gradient' | undefined { return buildKinds.get(value); }
