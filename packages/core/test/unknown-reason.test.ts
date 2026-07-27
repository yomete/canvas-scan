import { describe, expect, it } from 'vitest';

import { captureOp, newWindowSignature } from '../src/signature';

class HTMLVideoElement {}
class ImageData {}
class Foo {}

describe('unknown reasons', () => {
  it('reports an unknown source constructor name', () => {
    const signature = newWindowSignature();

    captureOp(signature, 'drawImage', [new HTMLVideoElement()]);

    expect(signature.unknownReason).toBe('HTMLVideoElement');
  });

  it('reports an unrecognized object constructor name', () => {
    const signature = newWindowSignature();

    captureOp(signature, 'fillRect', [new Foo()]);

    expect(signature.unknownReason).toBe('object:Foo');
  });

  it('preserves the first poisoning reason', () => {
    const signature = newWindowSignature();

    captureOp(signature, 'drawImage', [new HTMLVideoElement()]);
    captureOp(signature, 'putImageData', [new ImageData()]);

    expect(signature.unknownReason).toBe('HTMLVideoElement');
  });
});
