// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveSourceOutcome } = vi.hoisted(() => ({
  resolveSourceOutcome: vi.fn(),
}));

vi.mock('../src/symbolicate', () => ({ resolveSourceOutcome }));

import { emitReport, latestReports } from '../src/frame-loop';
import { mountOverlay, unmountOverlay } from '../src/overlay';
import { getRecordingState, startRecording, stopRecording } from '../src/recording';
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

function makeCanvas(connected = true): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = vi.fn(
    () =>
      ({
        top: 10,
        left: 20,
        width: 100,
        height: 50,
      }) as DOMRect,
  );
  if (connected) document.body.append(canvas);
  return canvas;
}

function setCanvasRect(
  canvas: HTMLCanvasElement,
  overrides: Partial<DOMRect>,
): void {
  const rect = {
    top: 10,
    left: 20,
    width: 100,
    height: 50,
    ...overrides,
  } as DOMRect;
  vi.mocked(canvas.getBoundingClientRect).mockReturnValue(rect);
}

function getShadowRoot(): ShadowRoot {
  return document.querySelector('[data-canvas-scan]')!.shadowRoot!;
}

function refreshOverlay(): void {
  vi.advanceTimersByTime(250);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resolveSourceOutcome.mockReset();
  resolveSourceOutcome.mockResolvedValue({ kind: 'unavailable' });
});

afterEach(() => {
  unmountOverlay();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  latestReports.clear();
});

describe('overlay toolbar', () => {
  it('uses the shared recording controls', () => {
    mountOverlay();
    const root = getShadowRoot();
    const record = root.querySelector<HTMLButtonElement>('.record')!;
    const stop = root.querySelector<HTMLButtonElement>('.stop-recording')!;
    expect(record.disabled).toBe(false);
    expect(stop.disabled).toBe(true);
    record.click();
    expect(getRecordingState()).toBe('recording');
    expect(record.classList).toContain('active');
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(getRecordingState()).toBe('complete');
    stopRecording();
  });
  it('keeps recording controls synchronized through both APIs and hydration', () => {
    mountOverlay();
    let root = getShadowRoot();
    const record = root.querySelector<HTMLButtonElement>('.record')!;
    const stop = root.querySelector<HTMLButtonElement>('.stop-recording')!;
    expect(record.getAttribute('aria-label')).toBe('Record investigation');
    expect(stop.getAttribute('aria-label')).toBe('Stop recording');
    expect(record.disabled).toBe(false); expect(stop.disabled).toBe(true);
    startRecording(); expect(stop.disabled).toBe(false); stop.click();
    record.click(); expect(getRecordingState()).toBe('recording');
    document.body.replaceChildren(); vi.advanceTimersByTime(1000);
    root = getShadowRoot(); expect(root.querySelector<HTMLButtonElement>('.stop-recording')?.disabled).toBe(false);
    stopRecording(); expect(root.querySelector<HTMLButtonElement>('.record')?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('.record')!.click();
    root.querySelector<HTMLButtonElement>('.stop-recording')!.click();
    expect(getRecordingState()).toBe('complete');
  });
  it('keeps the dock above the delegated outlines layer', () => {
    mountOverlay();
    refreshOverlay();
    const root = getShadowRoot();
    const style = root.querySelector('style')?.textContent;

    expect(style).toMatch(/\.dock\s*\{[^}]*z-index:\s*2/s);
    expect(style).toMatch(/\.outlines\s*\{[^}]*z-index:\s*1/s);
  });

  it('renders one toolbar with inspect, counts, and collapse controls', () => {
    mountOverlay();
    mountOverlay();
    refreshOverlay();
    const root = getShadowRoot();

    expect(document.querySelectorAll('[data-canvas-scan]')).toHaveLength(1);
    expect(root.querySelectorAll('.toolbar')).toHaveLength(1);
    expect(root.querySelector('.inspect')).not.toBeNull();
    expect(root.querySelector('.counts')?.textContent).toBe(
      '0 canvases · 0 review candidates',
    );
    expect(root.querySelector('.collapse')).not.toBeNull();
  });

  it('updates counts and accents review candidates only when positive', () => {
    mountOverlay();
    refreshOverlay();
    const root = getShadowRoot();
    const candidate = root.querySelector('.candidate-count')!;

    expect(candidate.classList.contains('accent')).toBe(false);
    emitReport(
      makeReport({ signatureStatus: 'changed' }),
      makeCanvas(false),
    );
    refreshOverlay();
    expect(root.querySelector('.counts')?.textContent).toBe(
      '1 canvas · 0 review candidates',
    );
    expect(candidate.classList.contains('accent')).toBe(false);

    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    expect(root.querySelector('.counts')?.textContent).toBe(
      '1 canvas · 1 review candidate',
    );
    expect(candidate.classList.contains('accent')).toBe(true);
    expect(root.querySelector('.collapsed-dot')?.classList).toContain('accent');

    emitReport(makeReport(), makeCanvas(false));
    emitReport(
      makeReport({
        canvasId: 'below-threshold',
        rasterOperationCount: 1,
      }),
      makeCanvas(false),
    );
    refreshOverlay();
    expect(root.querySelector('.counts')?.textContent).toBe(
      '2 canvases · 1 review candidate',
    );
  });

  it('collapses out of inspect mode and does not re-enter when expanded', () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    const toolbar = root.querySelector('.toolbar')!;

    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    expect(root.querySelector('.toolbar .inspect')?.classList).toContain(
      'active',
    );

    root.querySelector<HTMLButtonElement>('.collapse')!.click();
    refreshOverlay();
    expect(toolbar.classList.contains('collapsed')).toBe(true);
    expect(root.querySelector('.toolbar .inspect')?.classList).not.toContain(
      'active',
    );
    const collapsedOutline = root.querySelector<HTMLElement>('.outline');
    expect(
      collapsedOutline === null ||
        collapsedOutline.style.pointerEvents === 'none',
    ).toBe(true);

    root.querySelector<HTMLButtonElement>('.collapsed-dot')!.click();
    refreshOverlay();
    expect(toolbar.classList.contains('collapsed')).toBe(false);
    expect(root.querySelector('.toolbar .inspect')?.classList).not.toContain(
      'active',
    );
    const expandedOutline = root.querySelector<HTMLElement>('.outline');
    expect(
      expandedOutline === null ||
        expandedOutline.style.pointerEvents === 'none',
    ).toBe(true);
  });

  it('drags only from the toolbar background and resets on unmount', () => {
    mountOverlay();
    const root = getShadowRoot();
    const toolbar = root.querySelector<HTMLElement>('.toolbar')!;
    const dock = root.querySelector<HTMLElement>('.dock')!;

    toolbar.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 20 }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 35, clientY: 50 }),
    );
    document.dispatchEvent(new MouseEvent('pointerup'));
    refreshOverlay();

    expect(dock.style.transform).toBe('translate(25px, 30px)');

    unmountOverlay();
    mountOverlay();
    refreshOverlay();
    expect(getShadowRoot().querySelector<HTMLElement>('.dock')?.style.transform)
      .toBe('');
  });
});

describe('overlay flyout', () => {
  it('sorts rows, caps them at eight, expands the rest, and labels kinds', () => {
    mountOverlay();
    for (let index = 0; index < 10; index++) {
      emitReport(
        makeReport({
          canvasId: `canvas-${index}`,
          nearestReactOwner: `Owner${index}`,
          attributionKind: index === 9 ? 'container-only' : 'jsx-owner',
          signatureStatus: index >= 8 ? 'same' : 'changed',
          canvasApiSelfTimeMs: index,
        }),
        makeCanvas(false),
      );
    }
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();

    const firstRow = root.querySelector<HTMLButtonElement>('.row')!;
    expect(firstRow.dataset.canvasId).toBe('canvas-9');
    expect(firstRow.querySelector('.badge')?.textContent).toBe('co');
    expect(firstRow.querySelector('.badge')?.getAttribute('title')).toBe(
      'a library made this canvas inside the component’s markup, so the owner ' +
        'is the nearest one above it (container-only)',
    );
    expect(root.querySelectorAll('.row')).toHaveLength(8);
    expect(root.querySelector('.more')?.textContent).toBe('+2 more');

    root.querySelector<HTMLButtonElement>('.more')!.click();
    refreshOverlay();
    expect(root.querySelectorAll('.row')).toHaveLength(10);
    expect(root.querySelector('.more')).toBeNull();
  });

  it('shows the dominant unknown reason and mean self-time', () => {
    mountOverlay();
    const canvas = makeCanvas(false);
    emitReport(
      makeReport({
        signatureStatus: 'unknown',
        unknownReason: 'tainted-source',
        canvasApiSelfTimeMs: 0.2,
      }),
      canvas,
    );
    emitReport(
      makeReport({
        signatureStatus: 'unknown',
        unknownReason: 'tainted-source',
        canvasApiSelfTimeMs: 0.4,
      }),
      canvas,
    );
    emitReport(
      makeReport({
        signatureStatus: 'same',
        canvasApiSelfTimeMs: 0.3,
      }),
      canvas,
    );
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();

    expect(root.querySelector('.row')?.textContent).toContain(
      'unclear: something canvas-scan cannot read (tainted-source)',
    );
    expect(root.querySelector('.row')?.textContent).toContain(
      '0.3 ms per frame',
    );
  });

  it('locates a connected canvas on row hover and ignores a detached one', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'connected' }), makeCanvas());
    emitReport(makeReport({ canvasId: 'detached' }), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();

    root
      .querySelector<HTMLElement>('[data-canvas-id="connected"].row')!
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    refreshOverlay();
    expect(
      root.querySelector('[data-canvas-id="connected"].outline')?.classList,
    ).toContain('locate');

    expect(() =>
      root
        .querySelector<HTMLElement>('[data-canvas-id="detached"].row')!
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true })),
    ).not.toThrow();
    refreshOverlay();
    expect(
      root.querySelector('[data-canvas-id="detached"].outline'),
    ).toBeNull();
  });

  it('keeps flyout children stable across unchanged paint ticks', () => {
    mountOverlay();
    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const row = root.querySelector('.row');

    refreshOverlay();
    refreshOverlay();
    refreshOverlay();

    expect(root.querySelector('.row')).toBe(row);
  });

  it('keeps a focused row through reports for other canvases', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'canvas-a' }), makeCanvas(false));
    emitReport(makeReport({ canvasId: 'canvas-b' }), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const row = root.querySelector<HTMLButtonElement>(
      '[data-canvas-id="canvas-a"].row',
    )!;
    row.focus();

    emitReport(
      makeReport({ canvasId: 'canvas-b', canvasApiSelfTimeMs: 1 }),
      makeCanvas(false),
    );
    refreshOverlay();

    expect(
      root.querySelector('[data-canvas-id="canvas-a"].row'),
    ).toBe(row);
    expect(root.activeElement).toBe(row);
  });

  it('keeps a focused row alive when busier canvases push it past the eighth slot', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'quiet', signatureStatus: 'changed' }), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const row = root.querySelector<HTMLButtonElement>(
      '[data-canvas-id="quiet"].row',
    )!;
    row.focus();

    // Ten canvases that all outrank it on same-count push it out of the slice.
    for (let index = 0; index < 10; index++) {
      emitReport(makeReport({ canvasId: `busy-${index}` }), makeCanvas(false));
      emitReport(makeReport({ canvasId: `busy-${index}` }), makeCanvas(false));
    }
    refreshOverlay();

    expect(root.querySelector('[data-canvas-id="quiet"].row')).toBe(row);
    expect(root.activeElement).toBe(row);
  });

  it('keeps focus on the more control while it is being used', () => {
    mountOverlay();
    for (let index = 0; index < 10; index++) {
      emitReport(makeReport({ canvasId: `many-${index}` }), makeCanvas(false));
    }
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const more = root.querySelector<HTMLButtonElement>('.more')!;
    more.focus();

    emitReport(makeReport({ canvasId: 'many-3' }), makeCanvas(false));
    refreshOverlay();

    expect(root.querySelector('.more')).toBe(more);
    expect(root.activeElement).toBe(more);
  });

  it('keeps the row cap and the more count correct while a row is focused', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'quiet', signatureStatus: 'changed' }), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('[data-canvas-id="quiet"].row')!.focus();

    for (let index = 0; index < 10; index++) {
      emitReport(makeReport({ canvasId: `busy-${index}` }), makeCanvas(false));
      emitReport(makeReport({ canvasId: `busy-${index}` }), makeCanvas(false));
    }
    refreshOverlay();

    expect(root.querySelectorAll('.row')).toHaveLength(8);
    expect(root.querySelector('[data-canvas-id="quiet"].row')).not.toBeNull();
    expect(root.querySelector('.more')?.textContent).toBe('+3 more');
    // The retained row is still rendered from live data, not frozen.
    expect(
      root.querySelector('[data-canvas-id="quiet"] .row-text')?.textContent,
    ).toContain('same in 0 of');
  });

  it('hands focus to the revealed rows when more is activated', () => {
    mountOverlay();
    for (let index = 0; index < 10; index++) {
      emitReport(makeReport({ canvasId: `many-${index}` }), makeCanvas(false));
    }
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const more = root.querySelector<HTMLButtonElement>('.more')!;
    more.focus();
    more.click();
    refreshOverlay();

    expect(root.querySelector('.more')).toBeNull();
    expect(root.querySelectorAll('.row')).toHaveLength(10);
    expect(root.activeElement).toBe(root.querySelectorAll('.row')[8]);
  });

  it('resets the expanded rows when the flyout is reopened', () => {
    mountOverlay();
    for (let index = 0; index < 10; index++) {
      emitReport(makeReport({ canvasId: `many-${index}` }), makeCanvas(false));
    }
    refreshOverlay();
    const root = getShadowRoot();
    const counts = root.querySelector<HTMLButtonElement>('.counts')!;
    counts.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.more')!.click();
    refreshOverlay();
    expect(root.querySelectorAll('.row')).toHaveLength(10);

    counts.click();
    refreshOverlay();
    counts.click();
    refreshOverlay();

    expect(root.querySelectorAll('.row')).toHaveLength(8);
    expect(root.querySelector('.more')?.textContent).toBe('+2 more');
  });

  it("updates a reused row's text in place", () => {
    mountOverlay();
    const canvas = makeCanvas(false);
    emitReport(makeReport({ canvasId: 'reused-row' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const row = root.querySelector<HTMLButtonElement>(
      '[data-canvas-id="reused-row"].row',
    )!;

    emitReport(makeReport({ canvasId: 'reused-row' }), canvas);
    refreshOverlay();

    expect(
      root.querySelector('[data-canvas-id="reused-row"].row'),
    ).toBe(row);
    expect(row.querySelector('.row-text')?.textContent).toContain(
      'same in 2 of 2 frames',
    );
  });

  it('registers no row listeners while rebuilding ten rows', () => {
    mountOverlay();
    refreshOverlay();
    const addEventListener = vi.spyOn(EventTarget.prototype, 'addEventListener');

    for (let index = 0; index < 10; index++) {
      emitReport(
        makeReport({ canvasId: `listener-${index}` }),
        makeCanvas(false),
      );
    }
    refreshOverlay();
    getShadowRoot().querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();

    expect(addEventListener).not.toHaveBeenCalled();
  });
});

describe('overlay inspect mode and popover', () => {
  it('makes connected outlines interactive and exits on Escape', () => {
    mountOverlay();
    emitReport(
      makeReport({ signatureStatus: 'changed' }),
      makeCanvas(),
    );
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();

    const outline = root.querySelector<HTMLElement>('.outline')!;
    expect(outline.classList.contains('inspect')).toBe(true);
    expect(outline.style.pointerEvents).toBe('auto');

    outline.click();
    refreshOverlay();
    expect(root.querySelector('.popover-owner')?.textContent).toBe(
      'EffectCanvas',
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    refreshOverlay();
    expect(root.querySelector('.inspect')?.classList.contains('active')).toBe(
      false,
    );
    expect(outline.style.pointerEvents).toBe('none');
    expect(root.querySelector<HTMLElement>('.popover')?.hidden).toBe(true);
  });

  it('resolves source on demand and copies the latest report with aggregates', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    resolveSourceOutcome.mockResolvedValue({
      kind: 'found',
      location: {
        file: '/src/EffectCanvas.tsx',
        line: 42,
        column: 7,
      },
    });
    mountOverlay();
    const canvas = makeCanvas(false);
    const firstReport = makeReport({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
      sampled: true,
    });
    latestReports.set(firstReport.canvasId, firstReport);
    emitReport(firstReport, canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();

    expect(root.querySelector('.status')?.textContent).toBe(
      '1 frame seen\nsame 0 · changed 0 · unclear 1',
    );
    expect(root.querySelector<HTMLElement>('.sampling')?.hidden).toBe(false);
    expect(root.querySelector('.sampling')?.textContent).toBe(
      'checked every few frames (last check 1 frame apart)',
    );
    expect(root.querySelector('.unknown-reasons')?.textContent).toBe(
      '1 frame unclear: first frame seen — nothing to compare yet',
    );
    expect(
      root.querySelector('.unknown-reasons div')?.getAttribute('title'),
    ).toBe('first-window');
    expect(root.querySelector('.source')?.textContent).toBe(
      'source: resolving…',
    );
    expect(resolveSourceOutcome).toHaveBeenCalledOnce();

    await Promise.resolve();
    await Promise.resolve();
    refreshOverlay();

    const source = root.querySelector<HTMLElement>('.source')!;
    expect(source.textContent).toBe('source: EffectCanvas.tsx:42');
    expect(source.title).toBe('/src/EffectCanvas.tsx:42:7');

    const nextReport = makeReport();
    latestReports.set(nextReport.canvasId, nextReport);
    emitReport(nextReport, canvas);
    refreshOverlay();

    root.querySelector<HTMLButtonElement>('.copy')!.click();
    expect(writeText).toHaveBeenCalledOnce();
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied.latest.canvasId).toBe('canvas-1');
    expect(copied.latest.sourceLocation).toEqual({
      file: '/src/EffectCanvas.tsx',
      line: 42,
      column: 7,
    });
    expect(copied.aggregates.unknown).toBe(1);
  });

  it('opens detached canvases from rows and caches a resolved source', async () => {
    resolveSourceOutcome.mockResolvedValue({
      kind: 'found',
      location: { file: '/src/EffectCanvas.tsx', line: 42, column: 7 },
    });
    mountOverlay();
    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();
    await Promise.resolve();
    root.querySelector<HTMLButtonElement>('.close')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();

    expect(root.querySelector('.popover-owner')?.textContent).toBe(
      'EffectCanvas',
    );
    expect(resolveSourceOutcome).toHaveBeenCalledOnce();
  });

  it('asks again when the source was merely unavailable', async () => {
    // "Unavailable" is usually a sourcemap that was not ready yet, so a
    // reopened popover must retry rather than repeat a stale answer.
    resolveSourceOutcome.mockResolvedValue({ kind: 'unavailable' });
    mountOverlay();
    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();
    await Promise.resolve();
    root.querySelector<HTMLButtonElement>('.close')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();

    expect(resolveSourceOutcome).toHaveBeenCalledTimes(2);
  });

  it('retries a failed source lookup when the popover is reopened', async () => {
    resolveSourceOutcome
      .mockResolvedValueOnce({ kind: 'error' })
      .mockResolvedValueOnce({
        kind: 'found',
        location: {
          file: '/src/RetryCanvas.tsx',
          line: 8,
          column: 1,
        },
      });
    mountOverlay();
    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    await Promise.resolve();
    refreshOverlay();
    expect(root.querySelector('.source')?.textContent).toBe(
      'source: lookup failed — reopen to retry',
    );

    root.querySelector<HTMLButtonElement>('.close')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    await Promise.resolve();
    refreshOverlay();

    expect(resolveSourceOutcome).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.source')?.textContent).toBe(
      'source: RetryCanvas.tsx:8',
    );
  });

  it('deactivates failed placements and restores them when visible again', () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;

    setCanvasRect(canvas, { width: 0, height: 0 });
    refreshOverlay();
    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');

    setCanvasRect(canvas, { width: 100, height: 50 });
    refreshOverlay();
    expect(outline.hidden).toBe(false);
    expect(outline.style.pointerEvents).toBe('auto');
  });

  it('deactivates a visibility-hidden canvas and restores it', () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;

    canvas.style.visibility = 'hidden';
    refreshOverlay();
    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');

    canvas.style.visibility = 'visible';
    refreshOverlay();
    expect(outline.hidden).toBe(false);
    expect(outline.style.pointerEvents).toBe('auto');
  });

  it('deactivates a canvas inside a visibility-hidden ancestor', () => {
    mountOverlay();
    const parent = document.createElement('div');
    const canvas = makeCanvas(false);
    parent.append(canvas);
    document.body.append(parent);
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;

    parent.style.visibility = 'hidden';
    refreshOverlay();

    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('does not resurrect a canvas the core evicted while its lookup was in flight', async () => {
    let settle: (outcome: unknown) => void = () => {};
    resolveSourceOutcome.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    mountOverlay();
    latestReports.set('kept', makeReport({ canvasId: 'kept' }));
    latestReports.set('evicted', makeReport({ canvasId: 'evicted' }));
    emitReport(makeReport({ canvasId: 'kept' }), makeCanvas(false));
    emitReport(makeReport({ canvasId: 'evicted' }), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root
      .querySelector<HTMLButtonElement>('[data-canvas-id="evicted"].row')!
      .click();
    refreshOverlay();

    // Retention drops it while the lookup is still in flight; the next report
    // for a live canvas is what drives the commit that prunes it.
    latestReports.delete('evicted');
    emitReport(makeReport({ canvasId: 'kept' }), makeCanvas(false));
    refreshOverlay();
    expect(root.querySelector('[data-canvas-id="evicted"]')).toBeNull();

    settle({
      kind: 'found',
      location: { file: '/src/Gone.tsx', line: 3, column: 0 },
    });
    await Promise.resolve();
    await Promise.resolve();
    refreshOverlay();

    expect(root.querySelector('[data-canvas-id="evicted"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('.popover')?.hidden).toBe(true);
  });

  it('deactivates a canvas slotted into an inert subtree', () => {
    // A slotted canvas renders inside its slot, so the slot's ancestors decide
    // whether it can be clicked — not its DOM parent.
    mountOverlay();
    const inertBox = document.createElement('div');
    inertBox.inert = true;
    const shadowHost = document.createElement('div');
    inertBox.append(shadowHost);
    document.body.append(inertBox);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    shadow.append(document.createElement('slot'));

    const lightHost = document.createElement('div');
    const canvas = makeCanvas(false);
    lightHost.append(canvas);
    document.body.append(lightHost);
    // jsdom does not compute assignment, so state it directly.
    Object.defineProperty(canvas, 'assignedSlot', {
      configurable: true,
      value: shadow.querySelector('slot'),
    });

    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();

    const outline = root.querySelector<HTMLElement>('.outline')!;
    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('deactivates a canvas inside an inert subtree', () => {
    mountOverlay();
    const parent = document.createElement('div');
    const canvas = makeCanvas(false);
    parent.append(canvas);
    document.body.append(parent);
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;
    expect(outline.style.pointerEvents).toBe('auto');

    parent.inert = true;
    refreshOverlay();

    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('deactivates a canvas inside an inert attribute subtree', () => {
    mountOverlay();
    const parent = document.createElement('div');
    const canvas = makeCanvas(false);
    parent.append(canvas);
    document.body.append(parent);
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;
    expect(outline.style.pointerEvents).toBe('auto');

    parent.setAttribute('inert', '');
    refreshOverlay();

    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('walks through a shadow boundary when checking visibility', () => {
    mountOverlay();
    const parent = document.createElement('div');
    const shadowRoot = parent.attachShadow({ mode: 'open' });
    const canvas = makeCanvas(false);
    shadowRoot.append(canvas);
    document.body.append(parent);
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;
    expect(outline.style.pointerEvents).toBe('auto');

    parent.style.visibility = 'hidden';
    refreshOverlay();

    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('renders same-DOM-id canvases as distinct lifetime rows', () => {
    mountOverlay();
    const first = makeCanvas(false);
    const second = makeCanvas(false);
    first.id = 'shared';
    second.id = 'shared';
    emitReport(makeReport({ canvasId: 'shared#1' }), first);
    emitReport(makeReport({ canvasId: 'shared#2' }), second);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();

    expect(
      [...root.querySelectorAll<HTMLElement>('.row')].map(
        row => row.dataset.canvasId,
      ),
    ).toEqual(['shared#1', 'shared#2']);
  });

  it('deactivates a canvas the page has made click-through', () => {
    // If the page lets clicks pass through the canvas, our outline must not
    // catch them instead.
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;
    expect(outline.style.pointerEvents).toBe('auto');

    canvas.style.pointerEvents = 'none';
    refreshOverlay();

    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('deactivates a detached canvas on the next inspect commit', () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ signatureStatus: 'changed' }), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.inspect')!.click();
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline')!;

    canvas.remove();
    refreshOverlay();

    expect(outline.hidden).toBe(true);
    expect(outline.style.pointerEvents).toBe('none');
  });

  it('keeps focus on the stable copy button after an unchanged report', () => {
    mountOverlay();
    const canvas = makeCanvas(false);
    emitReport(makeReport(), canvas);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();
    const copy = root.querySelector<HTMLButtonElement>('.copy')!;
    copy.focus();

    emitReport(makeReport(), canvas);
    refreshOverlay();

    expect(root.activeElement).toBe(copy);
  });
});

describe('overlay copy', () => {
  // Internal vocabulary and raw reason codes are for bug reports, not for the
  // person reading the overlay while their app is slow. They may live in
  // tooltips; they may not reach the visible text.
  const JARGON = [
    /\bwindows?\b/i,
    /signature/i,
    /raster/i,
    /comparison gap/i,
    /self-?time/i,
    /\bsampled\b/i,
    /first-window/,
    /previous-window/,
    /:dirty/,
    /-unmodeled/,
  ];

  function visibleText(): string {
    return getShadowRoot().textContent ?? '';
  }

  it('keeps internal vocabulary out of every visible surface', async () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ sampled: true }), canvas);
    emitReport(
      makeReport({
        canvasId: 'unclear-canvas',
        nearestReactOwner: 'VideoLayer',
        signatureStatus: 'unknown',
        unknownReason: 'HTMLVideoElement',
        sampled: true,
      }),
      makeCanvas(false),
    );
    refreshOverlay();
    const root = getShadowRoot();

    expect(JARGON.filter((pattern) => pattern.test(visibleText()))).toEqual([]);

    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    expect(root.querySelector('.note')?.textContent).toContain(
      'canvas-scan watches what your app asks each canvas to draw',
    );
    expect(JARGON.filter((pattern) => pattern.test(visibleText()))).toEqual([]);

    root
      .querySelector<HTMLButtonElement>('[data-canvas-id="unclear-canvas"]')!
      .click();
    refreshOverlay();
    await Promise.resolve();
    refreshOverlay();
    expect(root.querySelector('.popover-body')?.textContent).toContain(
      'a video — its pixels can change at any time',
    );
    expect(JARGON.filter((pattern) => pattern.test(visibleText()))).toEqual([]);
  });

  it('hides sampling mechanics unless sampling is on', () => {
    mountOverlay();
    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();

    expect(root.querySelector<HTMLElement>('.sampling')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.unknown-reasons')?.hidden).toBe(
      true,
    );
  });

  it('translates every unknown reason the engine can emit', () => {
    mountOverlay();
    const root = getShadowRoot();
    const reasons = [
      'first-window',
      'previous-window',
      'canvas-reset',
      'canvas-resize',
      'canvas-dimensions-unmodeled',
      'canvas-attribute-reset',
      'canvas-state-unmodeled',
      'canvas-source-reset',
      'uncaptured-raster',
      'gradient-mutated',
      'transform-unmodeled',
      'clip-unmodeled',
      'path-unmodeled',
      'array-hole',
      'array-accessor',
      'array-element',
      'CanvasPattern',
      'HTMLVideoElement',
      'HTMLCanvasElement',
      'OffscreenCanvas',
      'ImageBitmap',
      'ImageData',
      'CanvasGradient',
      'Path2D',
      'Path2D:dirty',
      'CanvasGradient:dirty',
      'value:function',
      'object:anonymous',
    ];

    for (const [index, reason] of reasons.entries()) {
      emitReport(
        makeReport({
          canvasId: `reason-${index}`,
          signatureStatus: 'unknown',
          unknownReason: reason,
          // Sorts the canvas under test to the top of the capped row list.
          canvasApiSelfTimeMs: index + 1,
        }),
        makeCanvas(false),
      );
      refreshOverlay();
      root.querySelector<HTMLButtonElement>('.counts')!.click();
      refreshOverlay();
      root
        .querySelector<HTMLButtonElement>(`[data-canvas-id="reason-${index}"]`)!
        .click();
      refreshOverlay();

      const line = root.querySelector<HTMLElement>('.unknown-reasons div')!;
      expect(line.title).toBe(reason);
      expect(line.textContent).toBe(
        `1 frame unclear: ${describeReason(reason)}`,
      );
      root.querySelector<HTMLButtonElement>('.close')!.click();
      refreshOverlay();
    }
  });
});

// Expected phrasing, written independently of the overlay's table so a typo in
// either one fails the test.
function describeReason(reason: string): string {
  const phrases: Record<string, string> = {
    'first-window': 'first frame seen — nothing to compare yet',
    'previous-window': 'the last frame it was compared with was unclear',
    'canvas-reset': 'the canvas was reset',
    'canvas-resize': 'the canvas was resized',
    'canvas-dimensions-unmodeled': 'the canvas size could not be read',
    'canvas-attribute-reset':
      'the canvas was resized by a page attribute change',
    'canvas-state-unmodeled':
      'canvas state changed around a reset detected too late to place',
    'canvas-source-reset':
      'a source canvas was reset while this canvas was drawing it',
    'uncaptured-raster':
      'drawing happened in a frame canvas-scan did not capture',
    'gradient-mutated': 'a gradient changed while drawing',
    'transform-unmodeled': 'a transform canvas-scan cannot follow',
    'clip-unmodeled': 'a clipping shape canvas-scan cannot follow',
    'path-unmodeled': 'a path canvas-scan cannot follow',
    'array-hole': 'a list argument had missing entries',
    'array-accessor': 'a list argument computed its values',
    'array-element': 'a list argument held values that are not numbers',
    CanvasPattern: 'a pattern — its pixels can change at any time',
    HTMLVideoElement: 'a video — its pixels can change at any time',
    HTMLCanvasElement: 'another canvas that is not being tracked',
    ImageBitmap: 'an image bitmap — canvas-scan does not read pixels',
    CanvasGradient: 'a gradient canvas-scan did not see built',
    OffscreenCanvas: 'an offscreen canvas — not visible to canvas-scan',
    ImageData: 'raw pixel data — canvas-scan does not read pixels',
    Path2D: 'a shape object canvas-scan did not see built',
    'Path2D:dirty': 'a shape object changed after it was built',
    'CanvasGradient:dirty': 'a gradient changed after it was built',
    'value:function': 'an argument canvas-scan cannot read (function)',
    'object:anonymous': 'an argument canvas-scan cannot read (anonymous)',
  };
  return phrases[reason];
}

describe('overlay outline compatibility and cleanup', () => {
  it('uses the default two-raster-operation flash threshold', () => {
    mountOverlay();
    const canvas = makeCanvas();
    const root = getShadowRoot();

    emitReport(makeReport({ rasterOperationCount: 1 }), canvas);
    refreshOverlay();
    expect(root.querySelector('.outline')).toBeNull();

    emitReport(makeReport({ rasterOperationCount: 2 }), canvas);
    refreshOverlay();
    expect(root.querySelector('.outline')).not.toBeNull();
  });

  it('preserves same-signature flashes and minFlashRasterOps weighting', () => {
    mountOverlay({ minFlashRasterOps: 5 });
    const canvas = makeCanvas();
    const root = getShadowRoot();

    emitReport(makeReport({ rasterOperationCount: 4 }), canvas);
    refreshOverlay();
    expect(root.querySelector('.outline')).toBeNull();

    emitReport(makeReport({ rasterOperationCount: 5 }), canvas);
    refreshOverlay();
    const outline = root.querySelector<HTMLElement>('.outline');
    expect(outline?.style.top).toBe('8px');
    expect(outline?.style.left).toBe('18px');
    expect(outline?.style.width).toBe('104px');
    expect(outline?.style.height).toBe('54px');
    expect(outline?.querySelector('.label')?.textContent).toContain(
      'sent the same draw commands again ×2',
    );

    emitReport(makeReport({ rasterOperationCount: 5 }), canvas);
    refreshOverlay();
    expect(root.querySelector('.outline')).toBe(outline);
    expect(outline?.querySelector('.label')?.textContent).toContain(
      'sent the same draw commands again ×3',
    );
  });

  it('re-appends its host after removal', () => {
    mountOverlay();
    const host = document.querySelector('[data-canvas-scan]')!;
    host.remove();

    vi.advanceTimersByTime(1000);

    expect(host.isConnected).toBe(true);
  });

  it('removes all UI and document listeners on unmount', () => {
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    mountOverlay();
    emitReport(makeReport(), makeCanvas());
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    refreshOverlay();

    unmountOverlay();
    vi.advanceTimersByTime(1000);

    expect(document.querySelector('[data-canvas-scan]')).toBeNull();
    expect(root.querySelector('.toolbar')).toBeNull();
    expect(root.querySelector('.flyout')).toBeNull();
    expect(root.querySelector('.popover')).toBeNull();
    expect(removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
  });
});
