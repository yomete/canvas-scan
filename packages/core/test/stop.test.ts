// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case needs a fresh module graph, because start() latches after the
// first successful call.
async function freshModule() {
  vi.resetModules();
  return import('../src/index');
}

// jsdom ships no Canvas2D implementation, so the global the patch needs is
// absent. Supply a stand-in so start() proceeds.
function withCanvas2D(): () => void {
  const original = (globalThis as Record<string, unknown>).CanvasRenderingContext2D;
  class StandInContext { fillRect() {} }
  (globalThis as Record<string, unknown>).CanvasRenderingContext2D = StandInContext;
  return () => { (globalThis as Record<string, unknown>).CanvasRenderingContext2D = original; };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
  delete (window as unknown as Record<string, unknown>).__CANVAS_SCAN__;
});

describe('stop()', () => {
  it('cancels the pending frame, removes the overlay, and clears the global', async () => {
    const { start, stop } = await freshModule();
    const restore = withCanvas2D();
    let nextHandle = 0;
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => ++nextHandle);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    try {
      start();
      const handle = requestAnimationFrame.mock.results[0]!.value as number;
      expect(document.querySelector('[data-canvas-scan]')).not.toBeNull();
      const global = (window as unknown as Record<string, Record<string, unknown>>).__CANVAS_SCAN__!;
      expect(global.stop).toBe(stop);

      stop();

      expect(cancelAnimationFrame).toHaveBeenCalledWith(handle);
      expect(document.querySelector('[data-canvas-scan]')).toBeNull();
      expect((window as unknown as Record<string, unknown>).__CANVAS_SCAN__).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('is a no-op before start()', async () => {
    const { stop } = await freshModule();
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    expect(() => stop()).not.toThrow();
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });
});
