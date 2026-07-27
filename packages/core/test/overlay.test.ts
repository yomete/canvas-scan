// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitReport } from '../src/frame-loop';
import { mountOverlay, unmountOverlay } from '../src/overlay';
import type { DrawBatchReport } from '../src/types';

function makeReport(
  overrides: Partial<DrawBatchReport> = {},
): DrawBatchReport {
  return {
    canvasId: 'canvas-1',
    nearestReactOwner: 'EffectCanvas',
    attributionKind: 'jsx-owner',
    sourceLocation: null,
    rasterOperationCount: 2,
    canvasApiSelfTimeMs: 0.5,
    signatureStatus: 'same',
    unknownReason: null,
    sampled: false,
    comparisonGap: 1,
    ...overrides,
  };
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = vi.fn(
    () =>
      ({
        top: 10,
        left: 20,
        width: 100,
        height: 50,
      }) as any,
  );
  document.body.append(canvas);
  return canvas;
}

afterEach(() => {
  unmountOverlay();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('overlay', () => {
  it('mounts idempotently with an open shadow root and HUD', () => {
    mountOverlay();
    mountOverlay();

    const hosts = document.querySelectorAll('[data-canvas-scan]');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.shadowRoot?.querySelector('.hud')).not.toBeNull();
  });

  it('reuses and updates an outline for repeated same-signature windows', () => {
    mountOverlay();
    const canvas = makeCanvas();
    const host = document.querySelector('[data-canvas-scan]');

    emitReport(makeReport(), canvas);

    const outline = host?.shadowRoot?.querySelector<HTMLElement>('.outline');
    expect(outline?.style.top).toBe('8px');
    expect(outline?.style.left).toBe('18px');
    expect(outline?.style.width).toBe('104px');
    expect(outline?.style.height).toBe('54px');
    expect(outline?.querySelector('.label')?.textContent).toContain(
      'EffectCanvas',
    );
    expect(outline?.querySelector('.label')?.textContent).toContain('×1');

    emitReport(makeReport(), canvas);

    expect(host?.shadowRoot?.querySelector('.outline')).toBe(outline);
    expect(outline?.querySelector('.label')?.textContent).toContain('×2');
  });

  it('counts changed and unknown reports without outlining them', () => {
    mountOverlay();
    const canvas = makeCanvas();
    const host = document.querySelector('[data-canvas-scan]');

    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    emitReport(
      makeReport({
        signatureStatus: 'unknown',
        unknownReason: 'first-window',
      }),
      canvas,
    );

    expect(host?.shadowRoot?.querySelector('.outline')).toBeNull();
    expect(host?.shadowRoot?.querySelector('.hud')?.textContent).toContain(
      '1 canvases',
    );
    expect(host?.shadowRoot?.querySelector('.hud')?.textContent).toContain(
      '0 review candidates',
    );
  });

  it('counts a detached canvas without outlining it', () => {
    mountOverlay();
    const canvas = document.createElement('canvas');
    const host = document.querySelector('[data-canvas-scan]');

    expect(() => emitReport(makeReport(), canvas)).not.toThrow();

    expect(host?.shadowRoot?.querySelector('.outline')).toBeNull();
    expect(host?.shadowRoot?.querySelector('.hud')?.textContent).toContain(
      '1 canvases · 1 review candidates',
    );
  });

  it('toggles the HUD list with one item per canvas', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mountOverlay();
    const canvas = makeCanvas();
    const host = document.querySelector('[data-canvas-scan]');
    const hud = host?.shadowRoot?.querySelector<HTMLElement>('.hud');

    emitReport(makeReport(), canvas);
    vi.setSystemTime(500);
    emitReport(
      makeReport({
        canvasId: 'canvas-2',
        nearestReactOwner: 'ChartCanvas',
      }),
      canvas,
    );
    hud?.click();

    expect(hud?.classList.contains('open')).toBe(true);
    expect(hud?.querySelectorAll('.hud-list li')).toHaveLength(2);

    hud?.click();
    expect(hud?.classList.contains('open')).toBe(false);
  });

  it('unmounts and stops the survival interval', () => {
    vi.useFakeTimers();
    mountOverlay();
    const host = document.querySelector('[data-canvas-scan]');

    unmountOverlay();
    vi.advanceTimersByTime(2000);

    expect(host?.isConnected).toBe(false);
    expect(document.querySelector('[data-canvas-scan]')).toBeNull();
  });

  it('re-appends the host after it is removed', () => {
    vi.useFakeTimers();
    mountOverlay();
    const host = document.querySelector('[data-canvas-scan]');

    host?.remove();
    vi.advanceTimersByTime(1000);

    expect(host?.isConnected).toBe(true);
    expect(document.querySelector('[data-canvas-scan]')).toBe(host);
  });

  it('counts a one-op same window without outlining it by default', () => {
    mountOverlay();
    const canvas = makeCanvas();
    const host = document.querySelector('[data-canvas-scan]');

    emitReport(makeReport({ rasterOperationCount: 1 }), canvas);

    expect(host?.shadowRoot?.querySelector('.outline')).toBeNull();
    expect(host?.shadowRoot?.querySelector('.hud')?.textContent).toContain(
      '1 review candidates',
    );
  });

  it('outlines a two-op same window by default', () => {
    mountOverlay();
    const canvas = makeCanvas();
    const host = document.querySelector('[data-canvas-scan]');

    emitReport(makeReport({ rasterOperationCount: 2 }), canvas);

    expect(host?.shadowRoot?.querySelector('.outline')).not.toBeNull();
  });

  it('uses the configured minimum raster operations for outlines', () => {
    mountOverlay({ minFlashRasterOps: 5 });
    const canvas = makeCanvas();
    const host = document.querySelector('[data-canvas-scan]');

    emitReport(makeReport({ rasterOperationCount: 4 }), canvas);
    expect(host?.shadowRoot?.querySelector('.outline')).toBeNull();

    emitReport(makeReport({ rasterOperationCount: 5 }), canvas);
    expect(host?.shadowRoot?.querySelector('.outline')).not.toBeNull();
  });
});
