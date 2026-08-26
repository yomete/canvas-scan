// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case needs a fresh module graph, because start() latches after the
// first successful call.
async function freshStart() {
  vi.resetModules();
  return (await import('../src/index')).start;
}

// jsdom ships no Canvas2D implementation, so the global the patch needs is
// absent. Supply a stand-in for the cases that expect start() to proceed.
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
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  delete (window as unknown as Record<string, unknown>).__CANVAS_SCAN__;
});

describe('start() feature guards', () => {
  it('no-ops without requestAnimationFrame instead of throwing', async () => {
    const start = await freshStart();
    const original = window.requestAnimationFrame;
    // A throw here takes the whole application down: this runs at import time,
    // above everything else in the entry file.
    (window as unknown as Record<string, unknown>).requestAnimationFrame = undefined;
    try {
      expect(() => start({ overlay: false })).not.toThrow();
      expect((window as unknown as Record<string, unknown>).__CANVAS_SCAN__).toBeUndefined();
    } finally {
      window.requestAnimationFrame = original;
    }
  });

  it('no-ops without a Canvas2D prototype instead of throwing', async () => {
    const start = await freshStart();
    const original = (globalThis as Record<string, unknown>).CanvasRenderingContext2D;
    (globalThis as Record<string, unknown>).CanvasRenderingContext2D = undefined;
    try {
      expect(() => start({ overlay: false })).not.toThrow();
      expect((window as unknown as Record<string, unknown>).__CANVAS_SCAN__).toBeUndefined();
    } finally {
      (globalThis as Record<string, unknown>).CanvasRenderingContext2D = original;
    }
  });

  it('starts normally when both are present', async () => {
    const start = await freshStart();
    const restore = withCanvas2D();
    try {
      start({ overlay: false });
      expect((window as unknown as Record<string, unknown>).__CANVAS_SCAN__).toBeDefined();
    } finally {
      restore();
    }
  });
});

describe('start() late-load warning', () => {
  it('says so when canvases already exist', async () => {
    const start = await freshStart();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = withCanvas2D();
    document.body.append(document.createElement('canvas'));

    try { start({ overlay: false }); } finally { restore(); }

    // A late import produces canvases with no owner, or no canvases at all,
    // while the overlay still mounts and looks healthy. Nothing said so.
    const messages = warn.mock.calls.map(call => String(call[0]));
    expect(messages.some(message => message.includes('already existed'))).toBe(true);
    expect(messages.some(message => message.includes("import 'canvas-scan/auto'"))).toBe(true);
  });

  it('says so when React already rendered', async () => {
    const start = await freshStart();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map([[1, {}]]) };
    const restore = withCanvas2D();

    try { start({ overlay: false }); } finally { restore(); }

    expect(warn.mock.calls.map(call => String(call[0])).some(message => message.includes('after React rendered'))).toBe(true);
  });

  it('says nothing on a clean early load', async () => {
    const start = await freshStart();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = withCanvas2D();

    try { start({ overlay: false }); } finally { restore(); }

    expect(warn.mock.calls.map(call => String(call[0])).filter(message => message.startsWith('[canvas-scan] started'))).toEqual([]);
  });
});
