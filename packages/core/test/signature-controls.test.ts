import { describe, expect, it } from 'vitest';

import {
  captureOp,
  captureSet,
  computeStatus,
  newWindowSignature,
} from '../src/signature';

class HTMLImageElement {
  currentSrc: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;

  constructor(src: string) {
    this.currentSrc = src;
    this.src = src;
    this.naturalWidth = 640;
    this.naturalHeight = 480;
  }
}

class HTMLVideoElement {}

function imageSignature(src: string) {
  const signature = newWindowSignature();
  captureOp(signature, 'drawImage', [new HTMLImageElement(src), 0, 0]);
  return signature;
}

function tenOperationSignature(changedArgument: number) {
  const signature = newWindowSignature();

  for (let index = 0; index < 10; index++) {
    captureOp(signature, 'fillRect', [
      index,
      index === 5 ? changedArgument : 10,
      20,
      30,
    ]);
  }

  return signature;
}

describe('signature controls', () => {
  it('detects a translucency change', () => {
    const translucent = newWindowSignature();
    const opaque = newWindowSignature();

    captureSet(translucent, 'globalAlpha', 0.5);
    captureSet(opaque, 'globalAlpha', 1);

    expect(translucent.hash).not.toBe(opaque.hash);
    expect(computeStatus(translucent, opaque)).toBe('changed');
  });

  it('tracks stable image sources without marking them unknown', () => {
    const first = imageSignature('/chart.png');
    const same = imageSignature('/chart.png');
    const different = imageSignature('/other-chart.png');

    expect(first.hash).toBe(same.hash);
    expect(first.hash).not.toBe(different.hash);
    expect(first.unknown).toBe(false);
    expect(same.unknown).toBe(false);
    expect(different.unknown).toBe(false);
  });

  it('detects changed arguments above the quantization threshold', () => {
    const baseline = tenOperationSignature(10);
    const changed = tenOperationSignature(11);
    const belowQuantization = tenOperationSignature(10.001);

    expect(baseline.hash).not.toBe(changed.hash);
    expect(baseline.hash).toBe(belowQuantization.hash);
  });

  it('keeps a mutable-source window unknown for the next comparison', () => {
    const previous = newWindowSignature();
    captureOp(previous, 'drawImage', [new HTMLVideoElement(), 0, 0]);

    const current = {
      ...previous,
      unknown: false,
    };

    expect(previous.unknown).toBe(true);
    expect(current.hash).toBe(previous.hash);
    expect(computeStatus(previous, current)).toBe('unknown');
  });
});
