import { afterEach, describe, expect, it, vi } from 'vitest';

import { startFrameLoop } from '../src/frame-loop';
import { resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import { installCanvasPatch, records } from '../src/wrap-context';

const transferredCanvas = Symbol('offscreen canvas');

class FakeContext {
  canvas: FakeCanvas;

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  fillRect(..._args: unknown[]) {}
}

class FakeCanvas {
  id = '';
  isConnected = true;
  private context: FakeContext | null = null;
  private transferred = false;

  getAttribute(name: string) {
    return name === 'id' ? this.id : null;
  }

  getContext(type: string) {
    if (this.transferred) throw new DOMException('Canvas was transferred', 'InvalidStateError');
    if (type !== '2d') return null;
    this.context ??= new FakeContext(this);
    return this.context;
  }

  transferControlToOffscreen() {
    if (this.context || this.transferred) throw new DOMException('Canvas already has a context or transfer', 'InvalidStateError');
    this.transferred = true;
    return transferredCanvas;
  }
}

installCanvasPatch({
  canvasProto: FakeCanvas.prototype,
  contextProto: FakeContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => [] },
});

const callbacks: FrameRequestCallback[] = [];
vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; } });
const tick = () => callbacks.shift()!(performance.now());

afterEach(() => { resetRecordingForTests(); records.clear(); callbacks.length = 0; });

describe('transferControlToOffscreen', () => {
  it('preserves the native error after a context exists without marking a transfer', () => {
    const canvas = new FakeCanvas();
    canvas.id = 'scene';
    startRecording();
    startFrameLoop({});
    tick();
    canvas.getContext('2d')!.fillRect(0, 0, 10, 10);
    tick();
    expect(() => canvas.transferControlToOffscreen()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    tick();
    const session = stopRecording()!;

    const record = [...records].find(item => item.canvas === canvas)!;
    expect(session.lifecycleEvents.filter(event => event.canvasId === record.id).map(event => event.type)).toEqual(['first-observed', 'active']);
    expect(session.canvases.find(item => item.canvasId === record.id)).toMatchObject({ observability: 'observable', rasterOperationCount: 1 });
  });

  it('keeps a canvas that never drew here, so the worker is not reported as zero-cost', () => {
    const canvas = new FakeCanvas();
    startRecording();
    startFrameLoop({});
    tick();
    expect(canvas.transferControlToOffscreen()).toBe(transferredCanvas);
    expect(() => canvas.transferControlToOffscreen()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    tick();
    const session = stopRecording()!;

    const record = [...records].find(item => item.canvas === canvas)!;
    expect([...records].filter(item => item.canvas === canvas)).toHaveLength(1);
    expect(session.lifecycleEvents.filter(event => event.canvasId === record.id).map(event => event.type)).toEqual(['first-observed', 'transferred-to-worker']);
    expect(session.canvases).toEqual([expect.objectContaining({ canvasId: record.id, observability: 'unobservable', activeWindowCount: 0, rasterOperationCount: 0, attributionKind: 'unattributed', windowDetailDropped: false })]);
  });
});
