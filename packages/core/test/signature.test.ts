import { describe, expect, it } from 'vitest';

import {
  captureOp,
  captureSet,
  computeStatus,
  newWindowSignature,
} from '../src/signature';

function signatureFor(method: string, args: readonly unknown[]) {
  const signature = newWindowSignature();
  captureOp(signature, method, args);
  return signature;
}

describe('window signatures', () => {
  it('produces equal hashes for the same operation sequence', () => {
    const first = newWindowSignature();
    const second = newWindowSignature();

    captureOp(first, 'beginPath', []);
    captureOp(first, 'fillRect', [1, 2, 3, 4]);
    captureOp(second, 'beginPath', []);
    captureOp(second, 'fillRect', [1, 2, 3, 4]);

    expect(first.hash).toBe(second.hash);
    expect(first.opCount).toBe(2);
    expect(second.opCount).toBe(2);
  });

  it('changes the hash when a numeric argument changes', () => {
    expect(signatureFor('fillRect', [1, 2, 3, 4]).hash).not.toBe(
      signatureFor('fillRect', [1, 2, 3, 5]).hash,
    );
  });

  it.each([
    [10.001, 10.0009],
    [0.3, 0.30000000000000004],
  ])('quantizes %s and %s to the same value', (first, second) => {
    expect(signatureFor('fillRect', [first]).hash).toBe(
      signatureFor('fillRect', [second]).hash,
    );
  });

  it('preserves differences at two decimal places', () => {
    expect(signatureFor('fillRect', [10.01]).hash).not.toBe(
      signatureFor('fillRect', [10.02]).hash,
    );
  });

  it('includes captured property assignments in the hash', () => {
    const red = newWindowSignature();
    const blue = newWindowSignature();

    captureSet(red, 'fillStyle', '#f00');
    captureSet(blue, 'fillStyle', '#00f');

    expect(red.hash).not.toBe(blue.hash);
    expect(red.opCount).toBe(1);
  });

  it.each([
    class HTMLVideoElement {},
    class ImageData {},
    class Path2D {},
  ])('marks a %s argument unknown', (UnknownSource) => {
    const signature = signatureFor('drawImage', [new UnknownSource()]);

    expect(signature.unknown).toBe(true);
  });
});

describe('computeStatus', () => {
  it('returns unknown without a previous signature', () => {
    expect(computeStatus(null, newWindowSignature())).toBe('unknown');
  });

  it('returns unknown when the previous signature is unknown', () => {
    expect(
      computeStatus(
        { hash: 1, unknown: true },
        { hash: 1, unknown: false, opCount: 1, unknownReason: null },
      ),
    ).toBe('unknown');
  });

  it('returns unknown when the current signature is unknown', () => {
    expect(
      computeStatus(
        { hash: 1, unknown: false },
        { hash: 1, unknown: true, opCount: 1, unknownReason: 'test' },
      ),
    ).toBe('unknown');
  });

  it('returns same for equal known hashes', () => {
    expect(
      computeStatus(
        { hash: 1, unknown: false },
        { hash: 1, unknown: false, opCount: 1, unknownReason: null },
      ),
    ).toBe('same');
  });

  it('returns changed for different known hashes', () => {
    expect(
      computeStatus(
        { hash: 1, unknown: false },
        { hash: 2, unknown: false, opCount: 1, unknownReason: null },
      ),
    ).toBe('changed');
  });
});
