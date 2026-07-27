import type { WindowSignature } from './signature';

const buildSignatures = new WeakMap<object, WindowSignature>();

export function getBuildSignature(value: object): WindowSignature | undefined {
  return buildSignatures.get(value);
}

export function trackBuild(value: object, signature: WindowSignature): void {
  buildSignatures.set(value, signature);
}
