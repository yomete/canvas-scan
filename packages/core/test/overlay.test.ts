// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveSourceOutcome } = vi.hoisted(() => ({
  resolveSourceOutcome: vi.fn(),
}));

vi.mock('../src/symbolicate', () => ({ resolveSourceOutcome }));

import { droppedCanvasIds, emitLifecycleEvent, emitReport, emitResetEvent, latestReports, retiredCanvasIds } from '../src/frame-loop';
import { mountOverlay, unmountOverlay } from '../src/overlay';
import { getLastExplanation, getLastSession, getRecordingState, mark, resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { ComparisonArtifactV1, DrawBatchReport, InvestigationSessionV1 } from '../src/types';
import { getRecord, installCanvasPatch, notifySelectedCommandBoundary, records, type CanvasRecord } from '../src/wrap-context';

class OverlayExplanationContext {
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }
  save(..._args: unknown[]) {}
  restore(..._args: unknown[]) {}
  fillRect(..._args: unknown[]) {}
}

const overlayExplanationContexts = new WeakMap<HTMLCanvasElement, OverlayExplanationContext>();
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value(this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null;
    let context = overlayExplanationContexts.get(this);
    if (!context) {
      context = new OverlayExplanationContext(this);
      overlayExplanationContexts.set(this, context);
    }
    return context;
  },
});
installCanvasPatch({
  canvasProto: HTMLCanvasElement.prototype,
  contextProto: OverlayExplanationContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => [] },
});

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
    sampled: false, coveredWindowCount: 1,
    comparisonGap: 1,
    followsCanvasReset: false,
    methodEvidence: {},
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

function explanationRecord(id: string): CanvasRecord {
  return {
    canvas: makeCanvas(), creationSite: null, contentDirty: false, contentSig: { hash: 0, unknown: false, opCount: 0, unknownReason: null }, contentVersion: 0,
    id, serial: 1, sig: { hash: 0, unknown: false, opCount: 0, unknownReason: null }, rasterOps: 0, selfTimeMs: 0, carriedRasterOps: 0, carriedSelfTimeMs: 0, carriedWindows: 0,
    activeInWindow: false, prev: null, attribution: { nearestReactOwner: null, attributionKind: 'unattributed' }, lastStatus: null, props: new Map(),
    matrix: [1, 0, 0, 1, 0, 0], matrixUnknown: false, matrixHash: 0, pathHash: 0, pathUnknown: false, clipHash: 0,
    clipUnknown: false, resetPendingReason: null, modelUntrusted: false, resetVersion: 0, continuityLost: false, sourceResetVersions: new Map(),
    attributeObservationUnavailable: false, contextActivityInWindow: false, exactResetDepth: 0, inactiveBoundaries: 0, retired: false,
    lastConnected: true, activeLifecycleRecorded: false, pendingLifecycleEvents: [], stateStack: [],
  };
}

function explanationCanvas(id: string): {
  canvas: HTMLCanvasElement;
  context: OverlayExplanationContext;
  record: CanvasRecord;
} {
  const canvas = makeCanvas();
  canvas.id = id;
  const context = canvas.getContext('2d') as unknown as OverlayExplanationContext;
  const record = getRecord(canvas)!;
  return { canvas, context, record };
}

function openExplanationSource(canvas: HTMLCanvasElement, canvasId: string): HTMLButtonElement {
  startRecording();
  emitReport(makeReport({ canvasId, rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
  stopRecording();
  refreshOverlay();
  const root = getShadowRoot();
  root.querySelector<HTMLButtonElement>('.counts')!.click();
  refreshOverlay();
  const action = root.querySelector<HTMLButtonElement>('.explanation-action')!;
  if (action.hidden) throw new Error('explanation action is hidden');
  return action;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resolveSourceOutcome.mockReset();
  resolveSourceOutcome.mockResolvedValue({ kind: 'unavailable' });
});

afterEach(() => {
  unmountOverlay();
  resetRecordingForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  latestReports.clear();
  records.clear();
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
      '0 canvases · 0 canvases repeating',
    );
    expect(root.querySelector('.collapse')).not.toBeNull();
  });

  it('updates counts and accents repeating canvases only when positive', () => {
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
      '1 canvas · 0 canvases repeating',
    );
    expect(candidate.classList.contains('accent')).toBe(false);

    emitReport(makeReport(), makeCanvas(false));
    refreshOverlay();
    expect(root.querySelector('.counts')?.textContent).toBe(
      '1 canvas · 1 canvas repeating',
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
      '2 canvases · 1 canvas repeating',
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
  it('auto-opens empty and nonempty completed sessions without moving focus from Stop', () => {
    mountOverlay();
    const root = getShadowRoot();
    const record = root.querySelector<HTMLButtonElement>('.record')!;
    const stop = root.querySelector<HTMLButtonElement>('.stop-recording')!;
    record.click(); stop.focus(); stop.click(); refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')?.hidden).toBe(false);
    expect(root.querySelector('.session-empty')?.textContent).toBe('No canvas activity in this recording. Record again and interact with the canvas.');
    expect(root.activeElement).toBe(stop);

    record.click();
    emitReport(makeReport({ canvasId: 'completed' }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stop.focus(); stop.click(); refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')?.hidden).toBe(false);
    expect(root.querySelector('.session-empty')).toBeNull();
    expect(root.activeElement).toBe(stop);
  });

  it('keeps recording and completed evidence before current activity', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'already-live' }), makeCanvas());
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click(); refreshOverlay();
    root.querySelector<HTMLButtonElement>('.record')!.click(); refreshOverlay();
    let children = [...root.querySelector<HTMLElement>('.flyout')!.children];
    expect(children.indexOf(root.querySelector('.recording-session')!)).toBeLessThan(children.indexOf(root.querySelector('.live-heading')!));
    emitReport(makeReport({ canvasId: 'recorded-live' }), makeCanvas(), { windowIndex: 2, timestampMs: 20 });
    root.querySelector<HTMLButtonElement>('.stop-recording')!.click(); refreshOverlay();
    children = [...root.querySelector<HTMLElement>('.flyout')!.children];
    expect(children.indexOf(root.querySelector('.completed-session')!)).toBeLessThan(children.indexOf(root.querySelector('.live-heading')!));
    expect(children.indexOf(root.querySelector('.live-heading')!)).toBeLessThan(children.indexOf(root.querySelector('.row')!));
  });

  it('opens only the first completed finding and keeps it closed after refresh', () => {
    mountOverlay();
    const heavy = makeCanvas();
    const repeated = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'first-finding', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), heavy, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'second-finding', rasterOperationCount: 2, comparisonGap: 3 }), repeated, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'second-finding', rasterOperationCount: 3, comparisonGap: 2 }), repeated, { windowIndex: 2, timestampMs: 20 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const controls = [...root.querySelectorAll<HTMLButtonElement>('.finding-toggle')];
    expect(controls.length).toBeGreaterThanOrEqual(2);
    expect(controls[0].getAttribute('aria-expanded')).toBe('true');
    expect(controls[0].closest('.finding-card')?.querySelector<HTMLElement>('.finding-evidence')?.hidden).toBe(false);
    expect(controls[1].getAttribute('aria-expanded')).toBe('false');
    expect(controls[1].closest('.finding-card')?.querySelector<HTMLElement>('.finding-evidence')?.hidden).toBe(true);
    controls[0].click(); refreshOverlay(); refreshOverlay();
    expect(controls[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('labels saved and current evidence scopes with owner-first copy', () => {
    mountOverlay();
    const attributed = makeCanvas();
    const unattributed = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'saved-attributed', canvasApiSelfTimeMs: 9 }), attributed, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'saved-unattributed', nearestReactOwner: null, attributionKind: 'unattributed', canvasApiSelfTimeMs: 9 }), unattributed, { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    emitReport(makeReport({ canvasId: 'current-attributed' }), makeCanvas(), { windowIndex: 2, timestampMs: 20 });
    refreshOverlay();
    const root = getShadowRoot();
    const text = root.querySelector<HTMLElement>('.flyout')!.textContent!;
    expect(text.indexOf('SAVED RECORDING')).toBeLessThan(text.indexOf('CANVAS WORK'));
    expect(text.indexOf('SAVED RECORDING')).toBeLessThan(text.indexOf('FINDINGS'));
    expect(text.indexOf('CURRENT CANVAS ACTIVITY')).toBeLessThan(text.indexOf('EffectCanvas · Canvas ID: current-attributed'));
    const attributedSummary = root.querySelector<HTMLElement>('[data-session-canvas-id="saved-attributed"]')!.textContent!;
    expect(attributedSummary.indexOf('EffectCanvas')).toBeLessThan(attributedSummary.indexOf('Canvas ID: saved-attributed'));
    const unattributedSummary = root.querySelector<HTMLElement>('[data-session-canvas-id="saved-unattributed"]')!.textContent!;
    expect(unattributedSummary).toContain('No owner found');
    expect(unattributedSummary.indexOf('No owner found')).toBeLessThan(unattributedSummary.indexOf('Canvas ID: saved-unattributed'));
  });

  // Found on excalidraw.com: a production build renamed every component, and a
  // finding headed `mRe` looked exactly like one that had worked. The symbol
  // stays — it is searchable in the bundle — but it never stands where a
  // component name stands.
  it('never heads a summary with a bare minified symbol', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'minified', nearestReactOwner: 'mRe', attributionKind: 'minified-owner', canvasApiSelfTimeMs: 9 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    refreshOverlay();
    const summary = getShadowRoot().querySelector<HTMLElement>('[data-session-canvas-id="minified"]')!.textContent!;
    expect(summary).toContain('Minified owner · mRe');
    expect(summary.startsWith('mRe')).toBe(false);
    expect(summary.indexOf('Minified owner')).toBeLessThan(summary.indexOf('Canvas ID: minified'));
  });

  it('badges a minified owner as its own state, and says why', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'live-minified', nearestReactOwner: 'fRe', attributionKind: 'minified-owner' }), makeCanvas(false), { windowIndex: 1, timestampMs: 10 });
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const row = root.querySelector<HTMLButtonElement>('.row[data-canvas-id="live-minified"]')!;
    expect(row.querySelector('.badge')?.textContent).toBe('min');
    expect(row.querySelector('.badge')?.getAttribute('title')).toContain('the build renamed it');
    expect(row.querySelector<HTMLElement>('.row-text')!.textContent).toContain('Owner: Minified owner · fRe');
  });

  it('uses plain finding copy and a neutral focus background', () => {
    mountOverlay(); startRecording();
    emitReport(makeReport({ canvasId: 'candidate-copy', canvasApiSelfTimeMs: 9 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const card = root.querySelector<HTMLElement>('.finding-card')!;
    expect(card.textContent).toMatch(/1\s+Heavy frame · EffectCanvas/);
    // The plain copy the reader meets first stays plain. The claim boundary
    // lives behind the collapsed disclosure, so it is excluded here and
    // asserted on its own below.
    const plain = card.cloneNode(true) as HTMLElement;
    plain.querySelectorAll('.finding-boundary').forEach(node => node.remove());
    expect(plain.textContent).not.toMatch(/confirmed problem|confirmed defect|review candidate/i);
    const boundary = card.querySelector<HTMLDetailsElement>('.finding-boundary')!;
    expect(boundary.open).toBe(false);
    expect(boundary.textContent).toContain('Evidence level: candidate');
    expect(boundary.textContent).toContain('does not establish');
    expect(boundary.textContent).toContain('Next check:');
    const style = root.querySelector('style')?.textContent ?? '';
    const focusRule = style.match(/\.finding-card:focus-visible,[\s\S]*?\.canvas-summary:focus-visible \{[^}]*\}/)?.[0] ?? '';
    expect(focusRule).toContain('background: rgba(255, 255, 255, 0.18)');
    expect(focusRule).not.toContain('#ef4444');
  });

  it('renders every finding type in the canonical saved order', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    mountOverlay();
    const heavy = makeCanvas();
    const repeated = makeCanvas();
    const resize = makeCanvas();
    const backing = makeCanvas();
    backing.width = 400; backing.height = 200;
    startRecording();
    emitReport(makeReport({ canvasId: 'heavy', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), heavy, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'repeated', canvasApiSelfTimeMs: 2, rasterOperationCount: 2 }), repeated, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'resize', signatureStatus: 'unknown', unknownReason: 'canvas-reset' }), resize, { windowIndex: 1, timestampMs: 10 });
    emitResetEvent({ canvasId: 'resize', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'unchanged', width: 100, height: 50, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitReport(makeReport({ canvasId: 'resize', signatureStatus: 'unknown', unknownReason: 'canvas-reset' }), resize, { windowIndex: 2, timestampMs: 20 });
    emitResetEvent({ canvasId: 'resize', windowIndex: 2, timestampMs: 20, source: 'height-setter', dimensionChange: 'unchanged', width: 100, height: 50, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitReport(makeReport({ canvasId: 'backing', canvasApiSelfTimeMs: 2 }), backing, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'backing', canvasApiSelfTimeMs: 3 }), backing, { windowIndex: 2, timestampMs: 20 });
    const session = stopRecording()!;
    refreshOverlay();
    const root = getShadowRoot();
    const rawTypes = [...root.querySelectorAll<HTMLElement>('.finding-card')].map(node => node.dataset.findingId?.split(':')[0]);
    expect(new Set(rawTypes)).toEqual(new Set(['heavy-canvas-work', 'repeated-draw-work', 'resize-churn', 'backing-store-mismatch']));
    expect(rawTypes).toEqual(session.findings.map(finding => finding.type));
    expect(root.querySelectorAll('.raw-evidence')).toHaveLength(0);
    expect(root.querySelector('.canvas-summaries')?.textContent).toContain('ms in Canvas2D');
    expect(root.querySelector('.candidate-count')?.textContent).toBe(`${session.findings.length} review candidates`);
  });

  it('keeps finding controls stable and exports only the shown session snapshot', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'stable-finding', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const control = root.querySelector<HTMLButtonElement>('.finding-toggle')!;
    const expected = JSON.stringify(getLastSession());
    root.querySelector<HTMLButtonElement>('.session-copy')!.click();
    await Promise.resolve();
    emitReport(makeReport({ canvasId: 'later-live-work', canvasApiSelfTimeMs: 12 }), makeCanvas(), { windowIndex: 2, timestampMs: 20 });
    refreshOverlay();
    expect(root.querySelector('.finding-toggle')).toBe(control);
    root.querySelector<HTMLButtonElement>('.session-copy')!.click();
    await Promise.resolve();
    expect(writeText.mock.calls.map(call => call[0])).toEqual([expected, expected]);
  });

  it('keeps a finding control stable after a source result', async () => {
    resolveSourceOutcome.mockResolvedValue({ kind: 'found', location: { file: '/src/Stable.tsx', line: 4, column: 2 } });
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'stable-source', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const control = root.querySelector<HTMLButtonElement>('.finding-toggle')!;
    control.click(); refreshOverlay();
    root.querySelector<HTMLButtonElement>('[data-action="inspect-current"]')!.click();
    await Promise.resolve(); await Promise.resolve(); refreshOverlay();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); refreshOverlay();
    expect(root.querySelector('.finding-toggle')).toBe(control);
    expect(control.isConnected).toBe(true);
  });

  it('keeps saved summary hover and click separate from live inspection', () => {
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'saved-summary', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    vi.mocked(canvas.getBoundingClientRect).mockClear();
    const summary = root.querySelector<HTMLElement>('.canvas-summary')!;
    summary.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    summary.click();
    expect(canvas.getBoundingClientRect).not.toHaveBeenCalled();
    refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.popover')?.hidden).toBe(true);
    expect(root.querySelector('.outline[data-canvas-id="saved-summary"]')?.classList).not.toContain('locate');
  });

  it('reports one stable not-visible status for hidden Locate', () => {
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'hidden-locate', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const card = root.querySelector<HTMLElement>('.finding-card[data-canvas-id="hidden-locate"]')!;
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click(); refreshOverlay();
    canvas.style.visibility = 'hidden';
    const locate = card.querySelector<HTMLButtonElement>('[data-action="locate-current"]')!;
    locate.click(); locate.click(); refreshOverlay();
    expect(card.querySelector('.finding-status')?.textContent).toBe('The canvas is connected but is not visible.');
    expect(card.querySelectorAll('.finding-status')).toHaveLength(1);
    expect(root.querySelectorAll('.outline[data-canvas-id="hidden-locate"]')).toHaveLength(1);
    canvas.style.visibility = 'visible';
    canvas.style.pointerEvents = 'none';
    root.querySelector<HTMLButtonElement>('.inspect')!.click(); refreshOverlay();
    locate.click(); refreshOverlay();
    expect(card.querySelector('.finding-status')?.textContent).toBe('');
    expect(root.querySelector('.outline[data-canvas-id="hidden-locate"]')?.classList).toContain('locate');
  });

  it('keeps retired evidence while current actions follow live connectivity', () => {
    mountOverlay();
    const canvas = makeCanvas(false);
    startRecording();
    emitReport(makeReport({ canvasId: 'retired-card', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitLifecycleEvent({ canvasId: 'retired-card', type: 'retired', windowIndex: 2, timestampMs: 20, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const card = root.querySelector<HTMLElement>('.finding-card[data-canvas-id="retired-card"]')!;
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click(); refreshOverlay();
    expect(card.textContent).toContain('This canvas closed during the recording.');
    expect(card.textContent).not.toContain('Capture cannot start now.');
    expect(card.querySelector<HTMLElement>('.finding-actions')?.hidden).toBe(true);
    document.body.append(canvas);
    emitReport(makeReport({ canvasId: 'retired-card', rasterOperationCount: 2 }), canvas, { windowIndex: 3, timestampMs: 30 });
    refreshOverlay();
    expect(card.querySelector<HTMLElement>('.finding-actions')?.hidden).toBe(false);
    expect(card.textContent).toContain('This canvas closed during the recording.');
    expect(card.textContent).not.toContain('Capture cannot start now.');
  });

  it('supports finding keys and returns focus from both saved and live details', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'keyboard-a', rasterOperationCount: 2 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'keyboard-b', rasterOperationCount: 2 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const controls = [...root.querySelectorAll<HTMLButtonElement>('.finding-toggle')];
    controls[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(root.activeElement).toBe(controls[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(root.activeElement).toBe(controls[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(root.activeElement).toBe(controls.at(-1));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); refreshOverlay();
    expect(controls.at(-1)?.getAttribute('aria-expanded')).toBe('true');
    expect(root.activeElement).toBe(controls.at(-1));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); refreshOverlay();
    expect(controls.at(-1)?.getAttribute('aria-expanded')).toBe('false');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')?.hidden).toBe(true);
    expect(root.activeElement).toBe(root.querySelector('.counts'));

    root.querySelector<HTMLButtonElement>('.counts')!.click(); refreshOverlay();
    const row = root.querySelector<HTMLButtonElement>('.row')!;
    row.click(); refreshOverlay();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); refreshOverlay();
    expect(root.activeElement).toBe(row);
  });

  it('opens and focuses matching saved evidence from an inspect outline', () => {
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'saved-outline', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    const control = root.querySelector<HTMLButtonElement>('.finding-toggle')!;
    const session = JSON.stringify(getLastSession());
    root.querySelector<HTMLButtonElement>('.counts')!.click(); refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')?.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('.inspect')!.click(); refreshOverlay();
    root.querySelector<HTMLElement>('.outline[data-canvas-id="saved-outline"]')!.click();
    refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')?.hidden).toBe(false);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(root.activeElement).toBe(control);
    expect(JSON.stringify(getLastSession())).toBe(session);
  });

  it('removes stale finding nodes on a new session and unmount', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'stale-finding', rasterOperationCount: 2 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const control = getShadowRoot().querySelector<HTMLButtonElement>('.finding-toggle')!;
    startRecording(); refreshOverlay();
    expect(control.isConnected).toBe(false);
    stopRecording(); refreshOverlay();
    unmountOverlay();
    expect(control.isConnected).toBe(false);
  });

  it('shows Copy failed when the Clipboard API is absent', () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    mountOverlay(); startRecording(); stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.session-copy')!.click(); refreshOverlay();
    expect(root.querySelector('.session-copy-status')?.textContent).toBe('Copy failed');
  });

  it('shows Copy failed when the Clipboard promise rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay(); startRecording(); stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.session-copy')!.click();
    await Promise.resolve(); await Promise.resolve(); refreshOverlay();
    expect(root.querySelector('.session-copy-status')?.textContent).toBe('Copy failed');
  });

  it('shows plain collection-limit details and keeps raw counts in the JSON', () => {
    mountOverlay(); startRecording();
    for (let index = 0; index < 2001; index++) mark(`limit ${index}`);
    stopRecording(); refreshOverlay();
    const coverage = getShadowRoot().querySelector('.session-coverage')?.textContent ?? '';
    expect(coverage).toContain('1 user mark dropped');
    expect(coverage).not.toContain('droppedEntryCounts');
    expect(JSON.stringify(getLastSession())).toContain('"userMarks":1');
  });

  it('names the canvases kept as a summary only on the coverage line', () => {
    mountOverlay(); startRecording();
    for (let index = 1; index <= 129; index++) {
      emitReport(makeReport({ canvasId: `summary-only-${index}` }), makeCanvas(), { windowIndex: index, timestampMs: index * 10 });
    }
    stopRecording(); refreshOverlay();
    const coverage = getShadowRoot().querySelector('.session-coverage')?.textContent ?? '';
    // The summary list and the findings no longer cover the same set of
    // canvases, and a reader has to be told rather than left to assume.
    expect(coverage).toContain('1 canvas is kept as a summary only');
    expect(coverage).toContain('no finding covers them');
    expect(getLastSession()!.canvases.filter(canvas => canvas.windowDetailDropped)).toHaveLength(1);
  });

  it('keeps completed-session plain copy within the approved claim boundary', () => {
    mountOverlay(); startRecording();
    emitReport(makeReport({ canvasId: 'plain-copy', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const copy = getShadowRoot().querySelector('.completed-session')!.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.raw-evidence, .finding-boundary').forEach(node => node.remove());
    const text = copy.textContent ?? '';
    expect(text).toContain('ms in Canvas2D');
    expect(text).not.toMatch(/caused|wasted|pixel-identical|avoidable|does not establish/i);
  });

  it('keeps associations out of the card and in the exported session', () => {
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    mountOverlay(); const canvas = makeCanvas(); startRecording(); clock = 20; mark(' shared mark '); clock = 35; mark(' hidden mark ');
    emitReport(makeReport({ canvasId: 'association-a' }), canvas, { windowIndex: 1, timestampMs: 20, startedAtTimestampMs: 10, endedAtTimestampMs: 20 });
    emitReport(makeReport({ canvasId: 'association-b' }), canvas, { windowIndex: 4, timestampMs: 30, startedAtTimestampMs: 20, endedAtTimestampMs: 30 });
    clock = 40;
    stopRecording(); refreshOverlay(); const root = getShadowRoot(); root.querySelector<HTMLButtonElement>('.counts')!.click(); refreshOverlay();
    const text = root.querySelector('.flyout')!.textContent!;
    expect(text).not.toContain('shared mark');
    expect(text).not.toContain('hidden mark');
    expect(JSON.stringify(getLastSession())).toContain('shared mark');
    expect(text).toContain('Event Timing is unavailable in this browser.'); expect(text).toContain('Long Animation Frames are unavailable in this browser.');
    expect(text).not.toMatch(/caused|triggered|responsible/i);
  });

  it('shows reset-churn evidence and opens the connected canvas', () => {
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'resize-seeded', signatureStatus: 'unknown', unknownReason: 'canvas-reset', rasterOperationCount: 3, canvasApiSelfTimeMs: 2 }), canvas, { windowIndex: 101, timestampMs: 10 });
    emitResetEvent({ canvasId: 'resize-seeded', windowIndex: 101, timestampMs: 10, source: 'width-setter', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'resize-seeded', windowIndex: 102, timestampMs: 20, source: 'context-reset', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    stopRecording();
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const card = root.querySelector<HTMLElement>('.repeated-finding[data-canvas-id="resize-seeded"]')!;
    expect(card.textContent).toContain('Canvas resets while drawing · EffectCanvas');
    expect(card.textContent).toContain('2 canvas resets · 2 didn\'t change the size');
    expect(card.textContent).not.toMatch(/caused|wasted|avoidable|render time|GPU time|pixel|episode|width-setter/i);
    expect(JSON.stringify(getLastSession())).toContain('width-setter');
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click();
    refreshOverlay();
    card.querySelector<HTMLButtonElement>('[data-action="locate-current"]')!.click();
    refreshOverlay();
    expect(root.querySelector('.outline[data-canvas-id="resize-seeded"]')?.classList).toContain('locate');
    card.querySelector<HTMLButtonElement>('[data-action="inspect-current"]')!.click();
    refreshOverlay();
    expect(root.querySelector('.popover-owner')?.textContent).toBe('EffectCanvas');
  });

  it('shows backing-store evidence and opens the connected canvas', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    mountOverlay();
    const canvas = makeCanvas();
    canvas.width = 400; canvas.height = 200;
    startRecording();
    emitReport(makeReport({ canvasId: 'backing-seeded', rasterOperationCount: 1, canvasApiSelfTimeMs: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'backing-seeded', rasterOperationCount: 1, canvasApiSelfTimeMs: 3 }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording();
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const card = root.querySelector<HTMLElement>('.repeated-finding[data-canvas-id="backing-seeded"]')!;
    expect(card.textContent).toContain('Oversized canvas · EffectCanvas');
    expect(card.textContent).toContain('2 frames · backing store up to 4× larger than displayed');
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click();
    refreshOverlay();
    card.querySelector<HTMLButtonElement>('[data-action="locate-current"]')!.click();
    refreshOverlay();
    expect(root.querySelector('.outline[data-canvas-id="backing-seeded"]')?.classList).toContain('locate');
    card.querySelector<HTMLButtonElement>('[data-action="inspect-current"]')!.click();
    refreshOverlay();
    expect(root.querySelector('.popover-owner')?.textContent).toBe('EffectCanvas');
  });

  it('keeps detached reset-churn evidence without a locate outline', () => {
    mountOverlay();
    const canvas = makeCanvas(false);
    startRecording();
    emitReport(makeReport({ canvasId: 'detached-resize', signatureStatus: 'unknown', unknownReason: 'canvas-reset' }), canvas, { windowIndex: 101, timestampMs: 10 });
    emitResetEvent({ canvasId: 'detached-resize', windowIndex: 101, timestampMs: 10, source: 'width-setter', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitReport(makeReport({ canvasId: 'detached-resize', signatureStatus: 'unknown', unknownReason: 'canvas-reset' }), canvas, { windowIndex: 102, timestampMs: 20 });
    emitResetEvent({ canvasId: 'detached-resize', windowIndex: 102, timestampMs: 20, source: 'height-setter', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    stopRecording();
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const card = root.querySelector<HTMLElement>('.repeated-finding[data-canvas-id="detached-resize"]')!;
    expect(card.textContent).toContain('Canvas resets while drawing');
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    refreshOverlay();
    expect(root.querySelector('.outline[data-canvas-id="detached-resize"]')).toBeNull();
  });

  it('shows completed repeated-work evidence and opens the seeded canvas', () => {
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'seeded', rasterOperationCount: 2, canvasApiSelfTimeMs: 1.5, comparisonGap: 3 }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'seeded', rasterOperationCount: 3, canvasApiSelfTimeMs: 2, comparisonGap: 2 }), canvas, { windowIndex: 2, timestampMs: 20 });
    emitReport(makeReport({ canvasId: 'seeded', signatureStatus: 'unknown', unknownReason: 'uncaptured-raster' }), canvas, { windowIndex: 3, timestampMs: 30 });
    stopRecording();
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const card = [...root.querySelectorAll<HTMLElement>('.repeated-finding[data-canvas-id="seeded"]')]
      .find(candidate => candidate.dataset.findingId?.startsWith('repeated-draw-work'))!;
    expect(card.textContent).toContain('Repeated drawing · EffectCanvas');
    expect(card.textContent).toContain('2 near-identical frames · 5 draw calls · 3.5 ms');
    expect(card.textContent).not.toMatch(/wasted|pixel-identical|avoidable|gap/i);
    expect(JSON.stringify(getLastSession())).toContain('"comparisonGap":2');
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click();
    refreshOverlay();
    card.querySelector<HTMLButtonElement>('[data-action="locate-current"]')!.click();
    refreshOverlay();
    expect(root.querySelector('.outline[data-canvas-id="seeded"]')?.classList).toContain('locate');
    card.querySelector<HTMLButtonElement>('[data-action="inspect-current"]')!.click();
    refreshOverlay();
    expect(root.querySelector('.popover-owner')?.textContent).toBe('EffectCanvas');
  });

  it('keeps detached repeated-work evidence without a locate outline', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'detached-repeated', rasterOperationCount: 2 }), makeCanvas(false), { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const card = root.querySelector<HTMLElement>('.repeated-finding[data-canvas-id="detached-repeated"]')!;
    expect(card.textContent).toContain('Repeated drawing');
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    refreshOverlay();
    expect(root.querySelector('.outline[data-canvas-id="detached-repeated"]')).toBeNull();
  });

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
  it('reads geometry only during recording or explicit inspection', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    mountOverlay();
    const canvas = makeCanvas();
    canvas.width = 480; canvas.height = 240;
    const rect = vi.mocked(canvas.getBoundingClientRect);
    const passiveReport = makeReport({ signatureStatus: 'changed', rasterOperationCount: 1 });
    rect.mockClear();
    emitReport(passiveReport, canvas, { windowIndex: 1, timestampMs: 10 });
    refreshOverlay();
    expect(rect).not.toHaveBeenCalled();
    startRecording();
    emitReport(passiveReport, canvas, { windowIndex: 2, timestampMs: 20 });
    refreshOverlay();
    expect(rect).toHaveBeenCalledTimes(1);
    stopRecording();
    emitReport(passiveReport, canvas, { windowIndex: 3, timestampMs: 30 });
    refreshOverlay();
    expect(rect).toHaveBeenCalledTimes(1);
    refreshOverlay();
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    rect.mockClear();
    root.querySelector<HTMLButtonElement>('.row')!.click();
    expect(rect).toHaveBeenCalledTimes(1);
    refreshOverlay();
    expect(root.querySelector('.geometry')?.textContent).toContain('480×240 backing');
  });

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
    expect(copied.geometry).toMatchObject({ unavailableReason: 'disconnected' });
    expect(root.querySelector('.geometry')?.textContent).toBe('geometry: disconnected');
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
    expect(root.querySelector('.note')).toBeNull();
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
      'sampling-gap',
      'instrumentation-disabled',
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
    'sampling-gap': 'frames in between were skipped by sampling',
    'instrumentation-disabled': 'command capture was off for this frame',
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

describe('overlay session comparison', () => {
  function recordFinding(canvasId: string, rasterOperationCount = 2): void {
    startRecording();
    const canvas = makeCanvas();
    canvas.width = 100; canvas.height = 50;
    emitReport(makeReport({ canvasId, rasterOperationCount }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId, rasterOperationCount }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording(); refreshOverlay();
  }

  function activateWithKeyboard(button: HTMLButtonElement, key: 'Enter' | ' '): void {
    button.focus();
    expect(button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))).toBe(true);
    button.click();
    expect((button.getRootNode() as ShadowRoot).activeElement).toBe(button);
  }

  function openCompletedSession(): ShadowRoot {
    const root = getShadowRoot();
    const counts = root.querySelector<HTMLButtonElement>('.counts')!;
    if (counts.getAttribute('aria-expanded') !== 'true') counts.click();
    refreshOverlay();
    return root;
  }

  function recordMixedCandidates(): void {
    startRecording();
    for (const [canvasId, rasterOperationCount] of [['candidate-a', 3], ['candidate-b', 5]] as const) {
      const canvas = makeCanvas();
      canvas.width = 100; canvas.height = 50;
      emitReport(makeReport({ canvasId, rasterOperationCount }), canvas, { windowIndex: 1, timestampMs: 10 });
      emitReport(makeReport({ canvasId, rasterOperationCount }), canvas, { windowIndex: 2, timestampMs: 20 });
    }
    const backing = makeCanvas();
    backing.width = 1000; backing.height = 1000; setCanvasRect(backing, { width: 10, height: 10 });
    emitReport(makeReport({ canvasId: 'candidate-backing', rasterOperationCount: 1, signatureStatus: 'changed' }), backing, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'candidate-backing', rasterOperationCount: 1, signatureStatus: 'changed' }), backing, { windowIndex: 2, timestampMs: 20 });
    stopRecording(); refreshOverlay();
  }

  function recordIncompleteFinding(canvasId: string): void {
    startRecording();
    for (let index = 0; index < 128; index++) emitResetEvent({ canvasId: `eviction-${index}`, windowIndex: 1, timestampMs: index, source: 'width-setter', dimensionChange: 'changed', width: 10, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const canvas = makeCanvas();
    canvas.width = 100; canvas.height = 50;
    emitReport(makeReport({ canvasId, rasterOperationCount: 4 }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId, rasterOperationCount: 4 }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording(); refreshOverlay();
  }

  it('deep-copies an explicit baseline and uses the exact selected same-type index', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay(); recordFinding('baseline-canvas');
    const root = openCompletedSession();
    const keep = root.querySelector<HTMLButtonElement>('.baseline-action')!;
    expect(keep.type).toBe('button'); expect(keep.textContent).toBe('Keep as baseline');
    const stringify = vi.spyOn(JSON, 'stringify');
    keep.click();
    const source = stringify.mock.calls.find(call => Array.isArray((call[0] as InvestigationSessionV1)?.findings))?.[0] as InvestigationSessionV1;
    expect(source.findings[0].canvasId).toBe('baseline-canvas');
    source.findings[0].canvasId = 'mutated-source';
    stringify.mockRestore();
    refreshOverlay();
    expect(keep.textContent).toBe('Baseline kept'); expect(keep.getAttribute('aria-pressed')).toBe('true');
    recordMixedCandidates();
    const candidates = [...root.querySelectorAll<HTMLButtonElement>('.comparison-action')];
    const visible = candidates.filter(button => !button.hidden);
    expect(visible.map(button => button.closest<HTMLElement>('.finding-card')?.dataset.canvasId).sort()).toEqual(['candidate-a', 'candidate-b']);
    expect(candidates.find(button => button.closest<HTMLElement>('.finding-card')?.dataset.canvasId === 'candidate-backing')?.hidden).toBe(true);
    const compare = visible.find(button => button.closest<HTMLElement>('.finding-card')?.dataset.canvasId === 'candidate-b')!;
    expect(compare.type).toBe('button');
    compare.click(); refreshOverlay();
    root.querySelector<HTMLButtonElement>('.comparison-copy')!.click();
    await Promise.resolve();
    const artifact = JSON.parse(writeText.mock.calls[0][0]) as ComparisonArtifactV1;
    expect(artifact.baseline.canvasId).toBe('baseline-canvas');
    expect(artifact.candidate.canvasId).toBe('candidate-b');
    expect(artifact.candidate.findingIndex).toBe(Number(compare.dataset.findingIndex));
    const panel = root.querySelector<HTMLElement>('.comparison-panel')!;
    expect(panel.textContent).toContain('Baseline: Finding 1');
    expect(panel.textContent).toContain('Candidate: Finding');
  });

  it('renders every comparable measure with neutral pair wording', () => {
    mountOverlay(); recordFinding('first');
    const root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    recordFinding('second', 4); root.querySelector<HTMLButtonElement>('.comparison-action')!.click(); refreshOverlay();
    const text = root.querySelector('.comparison-panel')?.textContent ?? '';
    for (const label of ['Active window count', 'Raster operation count', 'Canvas2D API self-time', 'Maximum window Canvas2D API self-time', 'Unknown command window count', 'Repeated window count', 'Repeated raster operation count', 'Comparison gap count']) expect(text).toMatch(new RegExp(`${label}: [\\d.]+ → [\\d.]+`));
    expect(text).not.toMatch(/\b(fixed|faster|improved|regressed)\b|same pixels|pixel identity|caused by|wasted work|auto.?match|in this pair|observed-timing-pair|improvementEstablished/i);
  });

  it('shows exact incomplete evidence without measures and keeps the baseline for a later recording', () => {
    mountOverlay(); recordFinding('baseline-incomplete');
    const root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    recordIncompleteFinding('candidate-incomplete');
    const compare = root.querySelector<HTMLButtonElement>('.comparison-action')!;
    activateWithKeyboard(compare, ' '); refreshOverlay();
    const text = root.querySelector('.comparison-panel')?.textContent ?? '';
    expect(text).toContain("Couldn't compare: incomplete evidence");
    expect(text).not.toMatch(/\bdelta\b|higher in this pair|lower in this pair|equal in this pair|unknown in this pair/);
    root.querySelector<HTMLButtonElement>('.record')!.click(); refreshOverlay();
    expect(root.querySelector('.comparison-panel')?.textContent ?? '').not.toContain('COMPARISON COMPLETE');
    const next = makeCanvas();
    next.width = 100; next.height = 50;
    emitReport(makeReport({ canvasId: 'candidate-after-clear', rasterOperationCount: 3 }), next, { windowIndex: 3, timestampMs: 30 });
    emitReport(makeReport({ canvasId: 'candidate-after-clear', rasterOperationCount: 3 }), next, { windowIndex: 4, timestampMs: 40 });
    root.querySelector<HTMLButtonElement>('.stop-recording')!.click(); refreshOverlay();
    expect(root.querySelector<HTMLButtonElement>('.comparison-action')?.hidden).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('.baseline-action')?.textContent).toBe('Replace baseline');
  });

  it('reports copy success and failure and ignores a stale copy result', async () => {
    let pending: Promise<void> | undefined;
    let resolvePending = () => {};
    const writeText = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
      .mockImplementationOnce(() => pending = new Promise<void>(resolve => { resolvePending = resolve; }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay(); recordFinding('copy-baseline');
    const root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    recordFinding('copy-candidate', 4); root.querySelector<HTMLButtonElement>('.comparison-action')!.click(); refreshOverlay();
    const copy = root.querySelector<HTMLButtonElement>('.comparison-copy')!;
    activateWithKeyboard(copy, 'Enter'); await Promise.resolve(); refreshOverlay();
    expect(root.querySelector('.comparison-copy-status')?.textContent).toBe('Comparison JSON copied');
    copy.click(); await Promise.resolve(); await Promise.resolve(); refreshOverlay();
    expect(root.querySelector('.comparison-copy-status')?.textContent).toBe('Copy failed');
    copy.click();
    const replace = root.querySelector<HTMLButtonElement>('.baseline-action')!;
    activateWithKeyboard(replace, 'Enter'); refreshOverlay();
    resolvePending(); await pending; await Promise.resolve(); refreshOverlay();
    expect(root.querySelector('.comparison-panel')?.textContent).not.toContain('Comparison JSON copied');
    expect(root.querySelector('.comparison-panel')?.textContent).not.toContain('Copy failed');
  });

  it('reports copy failure for an absent or throwing Clipboard API', () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    mountOverlay(); recordFinding('copy-failure-baseline');
    const root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    recordFinding('copy-failure-candidate', 4); root.querySelector<HTMLButtonElement>('.comparison-action')!.click(); refreshOverlay();
    const copy = root.querySelector<HTMLButtonElement>('.comparison-copy')!;
    copy.click(); refreshOverlay();
    expect(root.querySelector('.comparison-copy-status')?.textContent).toBe('Copy failed');
    const writeText = vi.fn(() => { throw new Error('blocked'); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    copy.click(); refreshOverlay();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.comparison-copy-status')?.textContent).toBe('Copy failed');
  });

  it('keeps baseline, comparison, copy, and focus behavior after host reattachment', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay(); recordFinding('hydrate-baseline');
    const root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    recordFinding('hydrate-candidate', 4); root.querySelector<HTMLButtonElement>('.comparison-action')!.click(); refreshOverlay();
    const host = document.querySelector<HTMLElement>('[data-canvas-scan]')!;
    host.remove(); vi.advanceTimersByTime(1000);
    expect(document.querySelectorAll('[data-canvas-scan]')).toHaveLength(1);
    expect(host.isConnected).toBe(true);
    expect(root.querySelector('.comparison-panel')?.textContent).toContain('COMPARISON COMPLETE');
    const copy = root.querySelector<HTMLButtonElement>('.comparison-copy')!;
    activateWithKeyboard(copy, 'Enter'); await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('clears a completed comparison only after an explicit replacement', () => {
    mountOverlay(); recordFinding('first');
    const root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    recordFinding('second', 4); root.querySelector<HTMLButtonElement>('.comparison-action')!.click(); refreshOverlay();
    expect(root.querySelector('.comparison-panel')?.textContent).toContain('COMPARISON COMPLETE');
    const replace = root.querySelector<HTMLButtonElement>('.baseline-action')!;
    expect(replace.textContent).toBe('Replace baseline'); activateWithKeyboard(replace, 'Enter'); refreshOverlay();
    expect(root.querySelector('.comparison-panel')?.textContent).not.toContain('COMPARISON COMPLETE');
    expect(replace.getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the baseline across an explicit unmount and remount', () => {
    mountOverlay(); recordFinding('unmount-baseline');
    let root = openCompletedSession();
    root.querySelector<HTMLButtonElement>('.baseline-action')!.click(); refreshOverlay();
    expect(root.querySelector('.comparison-panel')?.textContent).toContain('BASELINE KEPT');
    unmountOverlay(); mountOverlay(); recordFinding('after-unmount'); root = openCompletedSession();
    expect(root.querySelector('.comparison-panel')?.textContent ?? '').not.toContain('BASELINE KEPT');
    expect(root.querySelector<HTMLButtonElement>('.baseline-action')?.textContent).toBe('Keep as baseline');
    expect(root.querySelector<HTMLButtonElement>('.comparison-action')?.hidden).toBe(true);
  });
});

describe('overlay explanation action', () => {
  it('starts from the saved selection and keeps its copy button stable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay();
    const { canvas, record } = explanationCanvas('explain-selected');
    startRecording();
    emitReport(makeReport({ canvasId: record.id, rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    records.delete(record);
    record.retired = true;
    refreshOverlay();
    const root = getShadowRoot();
    const action = root.querySelector<HTMLButtonElement>('.explanation-action')!;
    const sourceSessionId = getLastSession()!.sessionId;
    expect(root.querySelectorAll('.explanation-action')).toHaveLength(1);
    expect(action.hidden).toBe(false);
    expect(action.textContent).toBe('Explain next interaction');
    expect(action.dataset.sessionId).toBe(sourceSessionId);
    expect(action.dataset.findingIndex).toBe('0');
    action.click();
    refreshOverlay();
    expect(getRecordingState()).toBe('recording');
    expect(root.querySelector('.explanation-panel')?.textContent).toContain('EXPLANATION ACTIVE');
    expect(root.querySelector('.explanation-panel')?.textContent).toContain('Repeat the interaction now — stops after 10 s, or press Stop.');
    expect(action.getAttribute('aria-pressed')).toBe('true');
    root.querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();
    expect(action.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.explanation-panel')?.textContent).toContain("Couldn't compare the frames");
    expect(root.querySelector('.explanation-panel')?.textContent).toContain('no two frames were available to compare');
    expect(getLastExplanation()).toMatchObject({
      source: { sessionId: sourceSessionId, findingIndex: 0, canvasId: record.id },
      followUp: { canvasId: record.id },
    });
    const copy = root.querySelector<HTMLButtonElement>('.explanation-copy')!;
    copy.click();
    await Promise.resolve();
    emitReport(makeReport({ canvasId: 'unrelated-after-explanation' }), makeCanvas(), { windowIndex: 2, timestampMs: 20 });
    refreshOverlay();
    expect(root.querySelector('.explanation-copy')).toBe(copy);
    expect(copy.isConnected).toBe(true);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(getLastExplanation()));
    const copyStatus = root.querySelector<HTMLElement>('.explanation-copy-status')!;
    expect(copyStatus.textContent).toBe('Explanation JSON copied');

    writeText.mockRejectedValueOnce(new Error('denied'));
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    refreshOverlay();
    expect(root.querySelector('.explanation-copy-status')).toBe(copyStatus);
    expect(copyStatus.textContent).toBe('Copy failed');

    writeText.mockImplementationOnce(() => { throw new Error('unavailable'); });
    copy.click();
    refreshOverlay();
    expect(root.querySelector('.explanation-copy-status')).toBe(copyStatus);
    expect(copyStatus.textContent).toBe('Copy failed');

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    copy.click();
    refreshOverlay();
    expect(root.querySelector('.explanation-copy-status')).toBe(copyStatus);
    expect(copyStatus.textContent).toBe('Copy failed');

    startRecording();
    emitReport(makeReport({ canvasId: record.id, rasterOperationCount: 2 }), canvas, { windowIndex: 3, timestampMs: 30 });
    stopRecording();
    refreshOverlay();
    expect(root.querySelector('.explanation-panel')?.textContent).not.toContain('EXPLANATION COMPLETE');
    const nextAction = root.querySelector<HTMLButtonElement>('.explanation-action')!;
    nextAction.click();
    refreshOverlay();
    expect(getRecordingState()).toBe('recording');
    expect(root.querySelector('.explanation-panel')?.textContent).toContain('EXPLANATION ACTIVE');
    stopRecording();
  });

  it('uses the exact saved finding index across multiple native actions', () => {
    mountOverlay();
    const firstCanvas = makeCanvas();
    const secondCanvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'explain-first', rasterOperationCount: 2 }), firstCanvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'explain-second', rasterOperationCount: 2 }), secondCanvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    refreshOverlay();
    records.add(explanationRecord('explain-first'));
    records.add(explanationRecord('explain-second'));
    const root = getShadowRoot();
    const actions = [...root.querySelectorAll<HTMLButtonElement>('.explanation-action')];
    expect(actions).toHaveLength(2);
    expect(actions.map(action => action.dataset.findingIndex)).toEqual(['0', '1']);
    expect(actions.every(action => action.type === 'button')).toBe(true);
    actions[1].focus();
    expect(root.activeElement).toBe(actions[1]);
    actions[1].click();
    refreshOverlay();
    expect(root.querySelector('.explanation-panel')?.textContent).toContain('Finding 2 ·');
    expect(actions[0].getAttribute('aria-pressed')).toBe('false');
    expect(actions[1].getAttribute('aria-pressed')).toBe('true');
    stopRecording();
  });

  it('confirms activation inline near the action and scrolls the panel into view', () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollSpy as unknown as Element['scrollIntoView'] });
    try {
      mountOverlay();
      const { canvas, record } = explanationCanvas('explain-inline-canvas');
      const action = openExplanationSource(canvas, record.id);
      scrollSpy.mockClear();
      action.click();
      refreshOverlay();
      const status = getShadowRoot().querySelector<HTMLElement>('.finding-status');
      expect(status?.textContent).toContain('Explaining now');
      expect(status?.textContent).toContain('stops after 10 s');
      expect(scrollSpy).toHaveBeenCalled();
      stopRecording();
      refreshOverlay();
      expect(getShadowRoot().querySelector<HTMLElement>('.finding-status')?.textContent).toBe('');
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('reports a stale selection instead of failing silently', () => {
    mountOverlay();
    const { canvas, record } = explanationCanvas('explain-stale-canvas');
    const action = openExplanationSource(canvas, record.id);
    action.dataset.sessionId = 'stale-session';
    action.click();
    refreshOverlay();
    expect(getShadowRoot().querySelector<HTMLElement>('.finding-status')?.textContent).toContain('Recording changed');
    expect(getRecordingState()).not.toBe('recording');
  });

  it('uses the same completed panel structure for manual and automatic stop', () => {
    mountOverlay();
    const { canvas, record } = explanationCanvas('stop-structure');
    openExplanationSource(canvas, record.id).click();
    getShadowRoot().querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();
    const manual = getShadowRoot().querySelector<HTMLElement>('.explanation-panel')!;
    const structure = (panel: HTMLElement) => [...panel.children].map(child => `${child.tagName}.${child.className}`);
    const manualStructure = structure(manual);
    expect(manual.textContent).toContain('EXPLANATION COMPLETE');

    startRecording();
    emitReport(makeReport({ canvasId: record.id, rasterOperationCount: 2 }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording();
    refreshOverlay();
    getShadowRoot().querySelector<HTMLButtonElement>('.explanation-action')!.click();
    refreshOverlay();
    vi.advanceTimersByTime(10000);
    const automatic = getShadowRoot().querySelector<HTMLElement>('.explanation-panel')!;
    expect(automatic.textContent).toContain('EXPLANATION COMPLETE');
    expect(structure(automatic)).toEqual(manualStructure);
  });

  it('keeps an automatic explanation through host reattachment', () => {
    mountOverlay();
    const { canvas, record } = explanationCanvas('automatic-explanation');
    const action = openExplanationSource(canvas, record.id);
    expect(action.tagName).toBe('BUTTON');
    expect(action.type).toBe('button');
    action.focus();
    expect(getShadowRoot().activeElement).toBe(action);
    action.click();
    refreshOverlay();
    expect(getShadowRoot().querySelector('.explanation-panel')?.textContent).toContain('EXPLANATION ACTIVE');

    const host = document.querySelector<HTMLElement>('[data-canvas-scan]')!;
    host.remove();
    vi.advanceTimersByTime(1000);
    expect(host.isConnected).toBe(true);
    expect(getShadowRoot().querySelector('.explanation-panel')?.textContent).toContain('EXPLANATION ACTIVE');

    vi.advanceTimersByTime(10000);
    const panel = getShadowRoot().querySelector<HTMLElement>('.explanation-panel')!;
    expect(panel.textContent).toContain('EXPLANATION COMPLETE');
    expect(panel.textContent).toContain("Couldn't compare the frames");
    expect(panel.textContent).toContain('no two frames were available to compare');
    const copy = panel.querySelector('.explanation-copy');
    refreshOverlay();
    expect(getShadowRoot().querySelector('.explanation-copy')).toBe(copy);
  });

  it('ignores a clipboard result from a prior explanation', async () => {
    let finishCopy!: () => void;
    const writeText = vi.fn().mockReturnValue(new Promise<void>(resolve => { finishCopy = resolve; }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'stale-copy', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    refreshOverlay();
    records.add(explanationRecord('stale-copy'));
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.explanation-action')!.click();
    root.querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.explanation-copy')!.click();

    startRecording();
    emitReport(makeReport({ canvasId: 'stale-copy', rasterOperationCount: 2 }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording();
    refreshOverlay();
    root.querySelector<HTMLButtonElement>('.explanation-action')!.click();
    root.querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();
    const currentStatus = root.querySelector<HTMLElement>('.explanation-copy-status')!;
    expect(currentStatus.textContent).toBe('');

    finishCopy();
    await Promise.resolve();
    refreshOverlay();
    expect(root.querySelector('.explanation-copy-status')).toBe(currentStatus);
    expect(currentStatus.textContent).toBe('');
  });

  it('shows changed command evidence without visible values or tokens', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountOverlay();
    const { canvas, context, record } = explanationCanvas('changed-explanation');
    openExplanationSource(canvas, record.id).click();
    context.fillRect(918273.645, 0, 10, 10);
    notifySelectedCommandBoundary(record, 10, 10, true, true);
    context.fillRect(918273.645, 0, 10, 10);
    notifySelectedCommandBoundary(record, 11, 11, true, true);
    context.fillRect(771928.125, 0, 10, 10);
    notifySelectedCommandBoundary(record, 12, 12, true, true);
    getShadowRoot().querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();

    const artifact = getLastExplanation()!;
    const panel = getShadowRoot().querySelector<HTMLElement>('.explanation-panel')!;
    const visible = panel.textContent ?? '';
    const tokens = artifact.windows.flatMap(window => window.commands).flatMap(command => command.arguments).map(argument => argument.token).filter((token): token is string => token !== null);
    expect(artifact.firstDifference).toMatchObject({ ordinal: 0, reason: 'argument-token' });
    expect(artifact.stacks.map(sample => sample.reason)).toEqual(['first-raster', 'first-difference']);
    expect(artifact.stacks[1]).toMatchObject({ windowIndex: 12, commandOrdinal: 0 });
    expect(visible).toContain('fillRect was called with different arguments');
    expect(visible).toContain('Callsite captured but not mapped to app source');
    expect(visible).toContain('+9 framework frames');
    expect(visible).not.toMatch(/caused by|responsible|wasted work|same pixels|Reference command|Target command/i);
    expect(visible).not.toContain('918273.645');
    expect(visible).not.toContain('771928.125');
    for (const token of tokens) expect(visible).not.toContain(token);

    panel.querySelector<HTMLButtonElement>('.explanation-copy')!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(artifact));
  });

  it('shows the exact dropped-frame count for a bounded callsite', () => {
    const error = Error as ErrorConstructor & { stackTraceLimit: number };
    const previousLimit = error.stackTraceLimit;
    error.stackTraceLimit = 50;
    try {
      mountOverlay();
      const { canvas, context, record } = explanationCanvas('dropped-callsite-frames');
      openExplanationSource(canvas, record.id).click();
      function nestedDraw(depth: number): void {
        if (depth > 0) nestedDraw(depth - 1);
        else context.fillRect(1, 0, 10, 10);
      }
      nestedDraw(30);
      notifySelectedCommandBoundary(record, 10, 10, true, true);
      getShadowRoot().querySelector<HTMLButtonElement>('.stop-recording')!.click();
      refreshOverlay();

      const artifact = getLastExplanation()!;
      const dropped = artifact.stacks[0].droppedFrameCount;
      const visible = getShadowRoot().querySelector('.explanation-panel')?.textContent ?? '';
      expect(dropped).toBeGreaterThan(0);
      expect(artifact.stacks[0].frames).toHaveLength(20);
      expect(artifact.droppedEntryCounts.stackFrames).toBe(dropped);
      expect(visible).toContain('+20 framework frames');
      expect(visible).not.toContain(`stackFrames=${dropped}`);
      expect(JSON.stringify(artifact)).toContain(`"stackFrames":${dropped}`);
      expect(visible).toContain("Couldn't compare the frames");
    } finally {
      error.stackTraceLimit = previousLimit;
    }
  });

  it('shows the final same pair after the initial sampling gap', () => {
    mountOverlay();
    const { canvas, context, record } = explanationCanvas('same-explanation');
    openExplanationSource(canvas, record.id).click();
    for (const windowIndex of [10, 11, 12]) {
      context.fillRect(1, 0, 10, 10);
      notifySelectedCommandBoundary(record, windowIndex, windowIndex, true, true);
    }
    getShadowRoot().querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();

    const artifact = getLastExplanation()!;
    const visible = getShadowRoot().querySelector('.explanation-panel')?.textContent ?? '';
    expect(artifact.comparisons.map(comparison => comparison.status)).toEqual(['unknown', 'same']);
    expect(visible).toContain('The same commands ran again — nothing changed between the frames.');
    expect(visible).not.toContain('normalized');
  });

  it('shows an unknown limit, drop count, and gap without raw arguments', () => {
    mountOverlay();
    const { canvas, context, record } = explanationCanvas('unknown-explanation');
    openExplanationSource(canvas, record.id).click();
    context.fillRect(1, 0, 10, 10);
    notifySelectedCommandBoundary(record, 10, 10, true, true);
    context.fillRect(1, 0, 10, 10);
    notifySelectedCommandBoundary(record, 11, 11, true, true);
    context.save(...Array.from({ length: 21 }, (_, index) => 400000 + index));
    notifySelectedCommandBoundary(record, 12, 12, true, true);
    getShadowRoot().querySelector<HTMLButtonElement>('.stop-recording')!.click();
    refreshOverlay();

    const artifact = getLastExplanation()!;
    const visible = getShadowRoot().querySelector('.explanation-panel')?.textContent ?? '';
    expect(artifact.comparisons.at(-1)).toMatchObject({ status: 'unknown', unknownReason: 'argument-limit' });
    expect(artifact.droppedEntryCounts.commandArguments).toBe(1);
    expect(visible).toContain("Couldn't compare the frames — too many arguments to record.");
    expect(visible).not.toContain('argument-limit');
    expect(visible).not.toContain('maxArgumentsPerCommand');
    expect(visible).not.toContain('400000');
    expect(JSON.stringify(artifact)).toContain('"commandArguments":1');
  });

  it('hides the action for a detached finding and keeps one unavailable message', () => {
    mountOverlay();
    const canvas = makeCanvas(false);
    startRecording();
    emitReport(makeReport({ canvasId: 'detached-explanation', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    refreshOverlay();
    const card = getShadowRoot().querySelector<HTMLElement>('.finding-card')!;
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click();
    refreshOverlay();
    expect(card.querySelector<HTMLButtonElement>('.explanation-action')?.hidden).toBe(true);
    expect(card.textContent).toContain('Canvas not on the page.');
    expect(card.querySelectorAll('.finding-unavailable')).toHaveLength(1);
    document.body.append(canvas);
    emitReport(makeReport({ canvasId: 'detached-explanation', rasterOperationCount: 2 }), canvas, { windowIndex: 2, timestampMs: 20 });
    refreshOverlay();
    expect(card.querySelector<HTMLButtonElement>('.explanation-action')?.hidden).toBe(false);
  });

  it('keeps a connected saved finding when its canvas record is unavailable', () => {
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    emitReport(makeReport({ canvasId: 'unavailable-explanation', rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording();
    refreshOverlay();
    const root = getShadowRoot();
    const action = root.querySelector<HTMLButtonElement>('.explanation-action')!;
    action.click();
    refreshOverlay();
    expect(getRecordingState()).toBe('complete');
    expect(root.querySelector('.finding-status')?.textContent).toBe('Canvas is no longer on the page.');
    expect(root.querySelector('.explanation-panel')?.textContent).toContain('Canvas is no longer on the page.');
    expect(root.querySelectorAll('.finding-status')).toHaveLength(1);
  });
});

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

describe('overlay saved-session trims and export', () => {
  function openCompletedFlyout(): ShadowRoot {
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    return root;
  }

  it('keeps heavy reset context in the JSON and off the card', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'flagged-heavy', canvasApiSelfTimeMs: 9, rasterOperationCount: 3, followsCanvasReset: true }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'clean-heavy', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), makeCanvas(false), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    openCompletedFlyout();
    expect(getShadowRoot().querySelector<HTMLElement>('.finding-card[data-canvas-id="flagged-heavy"]')?.textContent).not.toContain('canvas reset');
    expect(JSON.stringify(getLastSession())).toContain('"followsCanvasReset":true');
  });

  it('keeps the heavy-work gate numbers in the JSON', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'gated', canvasApiSelfTimeMs: 8.8, rasterOperationCount: 3 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    openCompletedFlyout();
    const card = getShadowRoot().querySelector<HTMLElement>('.finding-card[data-canvas-id="gated"]')!;
    expect(card.textContent).toContain('Slowest frame');
    expect(card.textContent).not.toContain('threshold');
    const finding = getLastSession()!.findings.find(candidate => candidate.canvasId === 'gated')!;
    expect(finding.type === 'heavy-canvas-work' && finding.gateExcessMs === 0.8).toBe(true);
  });

  it('keeps adjacent identical window pair counts in the JSON and off the card', () => {
    mountOverlay();
    const canvas = makeCanvas();
    canvas.width = 100; canvas.height = 50;
    startRecording();
    for (const windowIndex of [1, 2, 3]) {
      emitReport(makeReport({ canvasId: 'strict-duplicates', rasterOperationCount: 2 }), canvas, { windowIndex, timestampMs: windowIndex * 10 });
    }
    stopRecording(); refreshOverlay();
    openCompletedFlyout();
    const card = getShadowRoot().querySelector<HTMLElement>('.finding-card[data-canvas-id="strict-duplicates"]')!;
    expect(card.textContent).not.toContain('adjacentIdenticalWindowPairs');
    const finding = getLastSession()!.findings.find(candidate => candidate.canvasId === 'strict-duplicates')!;
    expect(finding.type === 'repeated-draw-work' && finding.adjacentIdenticalWindowPairs === 2).toBe(true);
  });

  it('downloads the session JSON under a deterministic filename', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    window.URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      mountOverlay();
      startRecording();
      emitReport(makeReport({ canvasId: 'downloadable' }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
      stopRecording(); refreshOverlay();
      const root = getShadowRoot();
      const sessionId = getLastSession()!.sessionId;
      root.querySelector<HTMLButtonElement>('[data-action="download-session"]')!.click();
      refreshOverlay();
      expect(createObjectURL).toHaveBeenCalledOnce();
      const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe(`${sessionId}.json`);
      expect(anchor.href).toBe('blob:mock');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
      // "started", not "downloaded": the overlay hands the file to the browser
      // and cannot see whether the browser accepted or blocked it.
      expect(root.querySelector('.session-copy-status')?.textContent).toBe('Session JSON download started');
    } finally {
      window.URL.createObjectURL = originalCreate;
      window.URL.revokeObjectURL = originalRevoke;
      clickSpy.mockRestore();
    }
  });

  it('keeps one merged header and the download control in the session header structure', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'header-download' }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = openCompletedFlyout();
    const completedText = root.querySelector<HTMLElement>('.completed-session')!.textContent!;
    expect(completedText).toContain('SAVED RECORDING');
    expect(completedText.match(/SAVED RECORDING/g)).toHaveLength(1);
    expect(completedText).not.toContain('Recording complete');
    const header = root.querySelector<HTMLElement>('.session-header')!;
    const download = header.querySelector<HTMLButtonElement>('[data-action="download-session"]')!;
    expect(download.type).toBe('button');
    expect(download.textContent).toBe('Download session JSON');
    expect(download.dataset.action).toBe('download-session');
    const children = [...header.children];
    expect(children.indexOf(header.querySelector<HTMLElement>('[data-action="copy-session"]')!)).toBeLessThan(children.indexOf(download));
    expect(children.indexOf(download)).toBeLessThan(children.indexOf(header.querySelector<HTMLElement>('.session-copy-status')!));
  });

  it('shows the empty-findings line only when findings are absent', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'with-finding' }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const list = getShadowRoot().querySelector<HTMLElement>('.findings-list')!.cloneNode(true) as HTMLElement;
    list.querySelectorAll('.finding-boundary').forEach(node => node.remove());
    let text = list.textContent!;
    expect(text).not.toContain('No findings in this recording.');
    expect(text).not.toContain('review candidate');
    startRecording();
    stopRecording(); refreshOverlay();
    text = getShadowRoot().querySelector<HTMLElement>('.findings-list')!.textContent!;
    expect(text.match(/No findings in this recording\./g)).toHaveLength(1);
  });

  it('shows the owner once in the summaries and once in each finding headline', () => {
    mountOverlay();
    startRecording();
    emitReport(makeReport({ canvasId: 'dedupe-owner', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = openCompletedFlyout();
    const card = root.querySelector<HTMLElement>('.finding-card[data-canvas-id="dedupe-owner"]')!;
    card.querySelector<HTMLButtonElement>('.finding-toggle')!.click();
    refreshOverlay();
    expect(card.textContent).not.toContain('Owner:');
    expect(card.textContent).not.toContain('Canvas ID:');
    expect(card.textContent).not.toContain('Episode ID:');
    expect(card.textContent).toContain('Heavy frame · EffectCanvas');
    const summariesText = root.querySelector<HTMLElement>('.canvas-summaries')!.textContent!;
    expect(summariesText.match(/EffectCanvas/g)).toHaveLength(1);
    expect(summariesText).toContain('Canvas ID: dedupe-owner');
  });

  it('keeps the reset-event list in the JSON and off the card', () => {
    vi.stubGlobal('devicePixelRatio', 4);
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    for (const windowIndex of [101, 102] as const) {
      emitReport(makeReport({ canvasId: 'capped-resets', signatureStatus: 'unknown', unknownReason: 'canvas-reset', rasterOperationCount: 3 }), canvas, { windowIndex, timestampMs: windowIndex });
    }
    const sources = ['width-setter', 'height-setter', 'context-reset', 'width-setter', 'height-setter'] as const;
    sources.forEach((source, index) => emitResetEvent({ canvasId: 'capped-resets', windowIndex: index < 3 ? 101 : 102, timestampMs: (index + 1) * 10, source, dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false }));
    stopRecording(); refreshOverlay();
    openCompletedFlyout();
    const text = getShadowRoot().querySelector<HTMLElement>('.repeated-finding[data-canvas-id="capped-resets"]')!.textContent!;
    expect(text).toContain('5 canvas resets · 5 didn\'t change the size');
    expect(text).not.toContain('width-setter');
    expect(JSON.stringify(getLastSession())).toContain('"source":"width-setter"');
  });

  it('keeps association lines in the JSON and off the card', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    mountOverlay();
    const canvas = makeCanvas();
    startRecording();
    clock = 20; mark(' mark one ');
    clock = 21; mark(' mark two ');
    clock = 22; mark(' mark three ');
    clock = 23; mark(' mark four ');
    emitReport(makeReport({ canvasId: 'association-cap' }), canvas, { windowIndex: 1, timestampMs: 20, startedAtTimestampMs: 10, endedAtTimestampMs: 30 });
    emitReport(makeReport({ canvasId: 'association-cap' }), canvas, { windowIndex: 2, timestampMs: 25, startedAtTimestampMs: 20, endedAtTimestampMs: 30 });
    clock = 40;
    stopRecording(); refreshOverlay();
    openCompletedFlyout();
    const text = getShadowRoot().querySelector<HTMLElement>('.finding-card[data-canvas-id="association-cap"]')!.textContent!;
    expect(text).not.toContain('associated with');
    expect(JSON.stringify(getLastSession()).match(/mark one/g)).toHaveLength(1);
  });
});

describe('overlay honesty about what the live views show', () => {
  function openFlyout(): ShadowRoot {
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    return root;
  }

  it('marks a retired canvas rather than leaving its row looking live', () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ canvasId: 'goes-quiet' }), canvas, { windowIndex: 1, timestampMs: 10 });
    const root = openFlyout();
    const row = () => root.querySelector<HTMLElement>('.row[data-canvas-id="goes-quiet"]')!;
    expect(row().textContent).not.toContain('stopped drawing');
    expect(row().classList).not.toContain('stale');

    retiredCanvasIds.add('goes-quiet');
    refreshOverlay();
    // The row keeps its figures — they were really measured — but says the
    // canvas stopped drawing, so a still row is not read as a live one.
    expect(row().textContent).toContain('stopped drawing');
    expect(row().classList).toContain('stale');
    expect(row().title).toContain('Drawing again brings it back');

    retiredCanvasIds.delete('goes-quiet');
    refreshOverlay();
    expect(row().textContent).not.toContain('stopped drawing');
  });

  it('says in the counts when the canvas ceiling is dropping canvases', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'tracked' }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    refreshOverlay();
    const counts = () => getShadowRoot().querySelector<HTMLElement>('.canvas-count')!;
    expect(counts().textContent).toBe('1 canvas · ');

    droppedCanvasIds.add('evicted-one');
    droppedCanvasIds.add('evicted-two');
    refreshOverlay();
    // Without this the list reads as complete while canvases are missing.
    expect(counts().textContent).toBe('1 canvas (+2 not tracked) · ');
    expect(counts().title).toContain('at most 64 canvases');
    droppedCanvasIds.clear();
  });

  it('counts a run of identical frames, not a lifetime total', () => {
    mountOverlay();
    const canvas = makeCanvas();
    for (const windowIndex of [1, 2, 3]) {
      emitReport(makeReport({ canvasId: 'streak', rasterOperationCount: 4 }), canvas, { windowIndex, timestampMs: windowIndex * 10 });
    }
    refreshOverlay();
    const label = () => getShadowRoot().querySelector<HTMLElement>('.outline[data-canvas-id="streak"] .label')!.textContent!;
    expect(label()).toContain('again ×3');

    // A changed frame ends the run. The label used to keep counting straight
    // through the change it appears to be counting.
    emitReport(makeReport({ canvasId: 'streak', signatureStatus: 'changed', rasterOperationCount: 4 }), canvas, { windowIndex: 4, timestampMs: 40 });
    emitReport(makeReport({ canvasId: 'streak', rasterOperationCount: 4 }), canvas, { windowIndex: 5, timestampMs: 50 });
    refreshOverlay();
    expect(label()).toContain('again ×1');
  });

  it('reaches the claim boundary and the top methods from the finding card', () => {
    mountOverlay();
    startRecording();
    const boundaryCanvas = makeCanvas();
    boundaryCanvas.width = 100; boundaryCanvas.height = 50;
    emitReport(makeReport({ canvasId: 'boundary', canvasApiSelfTimeMs: 9, rasterOperationCount: 3, methodEvidence: { fillRect: { count: 3, canvasApiSelfTimeMs: 9 } } }), boundaryCanvas, { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = openFlyout();
    const boundary = root.querySelector<HTMLDetailsElement>('.finding-card[data-canvas-id="boundary"] .finding-boundary')!;
    expect(boundary.open).toBe(false);
    const text = boundary.textContent!;
    const finding = getLastSession()!.findings[0];
    expect(text).toContain(finding.claimBoundary.observation);
    expect(text).toContain(finding.claimBoundary.nonEstablishedFacts);
    expect(text).toContain(finding.nextCheck);
    expect(text).toContain(`Evidence level: ${finding.evidenceLevel}`);
    // The next check names the top measured methods, so they are reachable
    // here rather than only in the exported JSON.
    expect(text).toContain('Top measured methods');
    expect(text).toContain('fillRect');
  });

  it('separates the slowest frame from the whole episode on a heavy card', () => {
    mountOverlay();
    const canvas = makeCanvas();
    canvas.width = 100; canvas.height = 50;
    startRecording();
    emitReport(makeReport({ canvasId: 'two-spans', canvasApiSelfTimeMs: 9, rasterOperationCount: 100 }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'two-spans', canvasApiSelfTimeMs: 1, rasterOperationCount: 500 }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording(); refreshOverlay();
    const root = openFlyout();
    const text = root.querySelector<HTMLElement>('.finding-card[data-canvas-id="two-spans"]')!.textContent!;
    // 9 ms belongs to one frame and 100 draw calls belong with it; 600 belongs
    // to the episode. Neither number may be read as the other's.
    expect(text).toContain('Slowest frame 9 ms, 100 draw calls');
    expect(text).toContain('this episode 10 ms, 600 draw calls');
  });

  it('marks a truncated recording on the finding card, not only in the coverage line', () => {
    mountOverlay();
    startRecording();
    for (let index = 0; index <= 2000; index++) mark(`mark-${index}`);
    emitReport(makeReport({ canvasId: 'truncated', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    stopRecording(); refreshOverlay();
    const root = openFlyout();
    expect(root.querySelector<HTMLElement>('.finding-card[data-canvas-id="truncated"] .finding-truncated')?.textContent)
      .toContain('hit a collection limit');
  });

  it('reports the result of a popover copy either way', async () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ canvasId: 'copyable' }), canvas, { windowIndex: 1, timestampMs: 10 });
    const root = openFlyout();
    root.querySelector<HTMLButtonElement>('.row[data-canvas-id="copyable"]')!.click();
    refreshOverlay();
    const popover = root.querySelector<HTMLElement>('.popover')!;
    // A named dialog, so a screen reader announces what opened.
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(root.getElementById(popover.getAttribute('aria-labelledby')!)).not.toBeNull();
    const status = () => popover.querySelector<HTMLElement>('.popover-copy-status')!;
    expect(status().hidden).toBe(true);

    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    popover.querySelector<HTMLButtonElement>('.copy')!.click();
    await vi.waitFor(() => {
      refreshOverlay();
      expect(status().textContent).toBe('Copy failed');
    });
    expect(status().hidden).toBe(false);
  });
});

describe('overlay reacts to the page without waiting for an unrelated re-render', () => {
  function openFlyout(): ShadowRoot {
    const root = getShadowRoot();
    root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    return root;
  }

  it('corrects a finding card when its canvas leaves the page', () => {
    mountOverlay();
    const canvas = makeCanvas();
    canvas.width = 100; canvas.height = 50;
    document.body.append(canvas);
    startRecording();
    emitReport(makeReport({ canvasId: 'leaves', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), canvas, { windowIndex: 1, timestampMs: 10 });
    // A completed recording opens the flyout on its own; the card is on screen.
    stopRecording(); refreshOverlay();
    const root = getShadowRoot();
    expect(root.querySelector<HTMLElement>('.flyout')!.hidden).toBe(false);
    const card = () => root.querySelector<HTMLElement>('.finding-card[data-canvas-id="leaves"]')!;
    expect(card().querySelector<HTMLElement>('.finding-unavailable')!.hidden).toBe(true);
    expect(card().querySelector<HTMLElement>('.finding-actions')!.hidden).toBe(false);

    // No flyout toggle, no click, nothing else: only the canvas leaving. The
    // card used to keep offering actions against a canvas that is not there.
    canvas.remove();
    // Two ticks: the interval marks the overlay dirty and the commit it
    // schedules runs on the next animation frame.
    refreshOverlay(); refreshOverlay();
    expect(card().querySelector<HTMLElement>('.finding-unavailable')!.hidden).toBe(false);
    expect(card().querySelector<HTMLElement>('.finding-actions')!.hidden).toBe(true);
    expect(card().querySelector<HTMLButtonElement>('.explanation-action')!.hidden).toBe(true);

    document.body.append(canvas);
    refreshOverlay(); refreshOverlay();
    expect(card().querySelector<HTMLElement>('.finding-unavailable')!.hidden).toBe(true);
  });

  it('ranks findings by measured self-time across types', () => {
    mountOverlay();
    const light = makeCanvas();
    light.width = 100; light.height = 50;
    const heavy = makeCanvas();
    heavy.width = 100; heavy.height = 50;
    startRecording();
    // A repeated-draw-work finding is derived after heavy-canvas-work, so if
    // the list followed derivation order the milder one would come second.
    emitReport(makeReport({ canvasId: 'mild', canvasApiSelfTimeMs: 9, rasterOperationCount: 3 }), light, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: 'severe', canvasApiSelfTimeMs: 40, rasterOperationCount: 3 }), heavy, { windowIndex: 1, timestampMs: 10 });
    const session = stopRecording()!;
    const selfTimes = session.findings.map(finding => finding.canvasApiSelfTimeMs);
    expect(selfTimes).toEqual([...selfTimes].sort((left, right) => right - left));
    expect(session.findings[0].canvasId).toBe('severe');
    refreshOverlay();
    const root = openFlyout();
    const first = root.querySelector<HTMLElement>('.finding-card')!;
    expect(first.dataset.canvasId).toBe('severe');
    expect(first.querySelector('.finding-toggle')!.textContent).toMatch(/^1\s/);
  });

  it('hides the live list overflow control when there is nothing to reveal', () => {
    mountOverlay();
    emitReport(makeReport({ canvasId: 'only-one' }), makeCanvas(), { windowIndex: 1, timestampMs: 10 });
    const root = openFlyout();
    const more = root.querySelector<HTMLElement>('.more:not(.summary-more)');
    // A hidden element must not be rendered. A CSS display rule used to
    // override the hidden attribute and show "+0 more" at full width.
    if (more) {
      expect(more.hidden).toBe(false);
    }
    const style = root.querySelector('style')!.textContent!;
    expect(style).toMatch(/\.more\[hidden\][^{]*\{\s*display:\s*none/);
  });

  it('keeps Escape inside the overlay and out of the host application', () => {
    mountOverlay();
    const canvas = makeCanvas();
    emitReport(makeReport({ canvasId: 'escapable' }), canvas, { windowIndex: 1, timestampMs: 10 });
    const root = openFlyout();
    expect(root.querySelector<HTMLElement>('.flyout')!.hidden).toBe(false);

    // Focus sits in the host application, so Escape belongs to it.
    const hostInput = document.createElement('input');
    document.body.append(hostInput);
    hostInput.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')!.hidden).toBe(false);

    // Focus inside the overlay, so Escape closes the flyout as before.
    root.querySelector<HTMLButtonElement>('.row[data-canvas-id="escapable"]')!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    refreshOverlay();
    expect(root.querySelector<HTMLElement>('.flyout')!.hidden).toBe(true);
    hostInput.remove();
  });

  it('says a run is open while the overlay is collapsed', () => {
    mountOverlay();
    const root = getShadowRoot();
    startRecording();
    refreshOverlay();
    const dot = () => root.querySelector<HTMLElement>('.collapsed-dot')!;
    expect(dot().classList).toContain('recording');
    expect(dot().getAttribute('aria-label')).toContain('Expand canvas-scan to stop');
    stopRecording();
    refreshOverlay();
    expect(dot().classList).not.toContain('recording');
  });

  it('keeps the dock reachable however far it is dragged', () => {
    mountOverlay();
    const root = getShadowRoot();
    const toolbar = root.querySelector<HTMLElement>('.toolbar')!;
    const dock = root.querySelector<HTMLElement>('.dock')!;
    dock.getBoundingClientRect = () => ({ top: 100, left: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    toolbar.setPointerCapture = () => {};
    toolbar.releasePointerCapture = () => {};

    // jsdom has no PointerEvent; the handlers read only the mouse fields.
    toolbar.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 99999, clientY: 99999, bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    refreshOverlay();

    // Some of the dock has to stay on screen. An unbounded drag left it
    // unreachable until a reload.
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(dock.style.transform);
    expect(match).not.toBeNull();
    const [, x, y] = match!;
    expect(Number(x) + 100).toBeLessThanOrEqual(window.innerWidth);
    expect(Number(y) + 100).toBeLessThanOrEqual(window.innerHeight);
  });
});

describe('overlay baseline after an explanation', () => {
  it('keeps the session being investigated, not the explanation follow-up', () => {
    // An explanation runs a recording of its own, so getLastSession() moves to
    // a follow-up session while the panel still shows the one being
    // investigated. Keep as baseline must act on what the user is reading.
    mountOverlay();
    // A canvas with a tracked record, so the explanation action is offered.
    const { canvas, record } = explanationCanvas('baseline-after-explanation');
    canvas.width = 100; canvas.height = 50;
    records.add(record);
    startRecording();
    emitReport(makeReport({ canvasId: record.id, rasterOperationCount: 2 }), canvas, { windowIndex: 1, timestampMs: 10 });
    emitReport(makeReport({ canvasId: record.id, rasterOperationCount: 2 }), canvas, { windowIndex: 2, timestampMs: 20 });
    stopRecording(); refreshOverlay();
    const investigated = getLastSession()!.sessionId;

    const root = getShadowRoot();
    if (root.querySelector<HTMLElement>('.flyout')!.hidden) root.querySelector<HTMLButtonElement>('.counts')!.click();
    refreshOverlay();
    const explain = root.querySelector<HTMLButtonElement>('.explanation-action')!;
    expect(explain.hidden).toBe(false);
    explain.click();
    refreshOverlay();
    emitReport(makeReport({ canvasId: record.id, rasterOperationCount: 2 }), canvas, { windowIndex: 3, timestampMs: 30 });
    stopRecording(); refreshOverlay();

    const followUp = getLastSession()!.sessionId;
    expect(followUp).not.toBe(investigated);

    const keep = root.querySelector<HTMLButtonElement>('.baseline-action')!;
    // The control carries the session it was rendered for, and that is the one
    // the click handler checks against before keeping anything.
    expect(keep.dataset.sessionId).toBe(investigated);
    const stringify = vi.spyOn(JSON, 'stringify');
    keep.click();
    const kept = stringify.mock.calls
      .map(call => call[0] as InvestigationSessionV1)
      .find(value => Array.isArray(value?.findings) && typeof value?.sessionId === 'string');
    stringify.mockRestore();
    expect(kept?.sessionId).toBe(investigated);
  });
});
