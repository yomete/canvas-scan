import { afterEach, describe, expect, it, vi } from 'vitest';

import { startFrameLoop } from '../src/frame-loop';
import { resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import { installCanvasPatch, observationCoverage, records } from '../src/wrap-context';

class FakeContext {
  canvas: FakeCanvas;
  constructor(canvas: FakeCanvas) { this.canvas = canvas; }
  fillRect(..._args: unknown[]) {}
}

class FakeCanvas {
  id = '';
  isConnected = true;
  private context: object | null = null;
  getAttribute(name: string) { return name === 'id' ? this.id : null; }
  getContext(type: string) {
    if (this.context) return (this.context as { type?: string }).type === type || (type === '2d' && this.context instanceof FakeContext) ? this.context : null;
    this.context = type === '2d' ? new FakeContext(this) : { type };
    return this.context;
  }
  transferControlToOffscreen() { return {}; }
}

installCanvasPatch({
  canvasProto: FakeCanvas.prototype,
  contextProto: FakeContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => [] },
});

const inDocument: FakeCanvas[] = [];
vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector === 'canvas' ? inDocument : [], addEventListener() {}, removeEventListener() {} });
const callbacks: FrameRequestCallback[] = [];
vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; } });
const tick = () => callbacks.shift()!(performance.now());

afterEach(() => { resetRecordingForTests(); records.clear(); callbacks.length = 0; inDocument.length = 0; });

describe('observation coverage', () => {
  it('counts canvases drawn through APIs canvas-scan does not wrap, by reason', () => {
    const drawn = new FakeCanvas(); const gl = new FakeCanvas(); const gl2 = new FakeCanvas(); const bitmap = new FakeCanvas(); const quiet = new FakeCanvas(); const worker = new FakeCanvas();
    inDocument.push(drawn, gl, gl2, bitmap, quiet, worker);
    drawn.getContext('2d');
    gl.getContext('webgl'); gl.getContext('webgl');
    gl2.getContext('webgl2');
    bitmap.getContext('bitmaprenderer');
    worker.transferControlToOffscreen();
    expect(observationCoverage()).toMatchObject({
      observedScope: 'main-thread-canvas2d',
      unobservedCanvases: [{ reason: 'webgl', count: 1 }, { reason: 'webgl2', count: 1 }, { reason: 'bitmaprenderer', count: 1 }, { reason: 'transferred-to-worker', count: 1 }],
      unobservedCanvasCount: 4,
      // A canvas with no context seen is not called unobserved: it may simply
      // not have drawn.
      undeterminedCanvasCount: 1,
    });
    expect(observationCoverage().limit).toMatch(/not a cheap one/);
  });

  it('writes the coverage into the session at stop', () => {
    const gl = new FakeCanvas(); inDocument.push(gl); gl.getContext('webgl2');
    startRecording(); startFrameLoop({}); tick(); tick();
    const session = stopRecording()!;
    expect(session.observationCoverage).toMatchObject({ unobservedCanvases: [{ reason: 'webgl2', count: 1 }], unobservedCanvasCount: 1, undeterminedCanvasCount: 0 });
  });
});
