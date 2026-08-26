import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitLifecycleEvent, emitReport, emitResetEvent } from '../src/frame-loop';
import { configureRecording, getLastSession, resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';

const report = (canvasId: string, selfTime: number, overrides: Partial<DrawBatchReport> = {}): DrawBatchReport => ({ canvasId, nearestReactOwner: null, attributionKind: 'unattributed', sourceLocation: null, rasterOperationCount: 1, canvasApiSelfTimeMs: selfTime, signatureStatus: 'same', unknownReason: null, sampled: false, coveredWindowCount: 1, comparisonGap: 1, followsCanvasReset: false, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: selfTime } }, ...overrides });
const publish = (canvasId: string, selfTime: number, windowIndex: number, overrides: Partial<DrawBatchReport> = {}, canvas: unknown = {}) => emitReport(report(canvasId, selfTime, overrides), canvas, { windowIndex, timestampMs: windowIndex * 10 });
afterEach(() => { resetRecordingForTests(); vi.unstubAllGlobals(); });

describe('investigation findings', () => {
  it('finds two raster-active windows at the inclusive backing-store ratio', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const oversized = { isConnected: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }) };
    startRecording(); publish('oversized', 2, 1, {}, oversized); publish('oversized', 3, 2, {}, oversized);
    const session = stopRecording()!;
    const finding = session.findings.find(item => item.type === 'backing-store-mismatch');
    expect(finding).toMatchObject({ canvasId: 'oversized', evidenceLevel: 'candidate', affectedWindowCount: 2, rasterOperationCount: 2, canvasApiSelfTimeMs: 5 });
    expect(finding?.affectedWindows).toEqual([
      { windowIndex: 1, timestampMs: 10, backingWidth: 960, backingHeight: 240, expectedBackingWidth: 480, expectedBackingHeight: 240, expectedPixelArea: 115200, actualToExpectedAreaRatio: 2, rasterOperationCount: 1, canvasApiSelfTimeMs: 2 },
      { windowIndex: 2, timestampMs: 20, backingWidth: 960, backingHeight: 240, expectedBackingWidth: 480, expectedBackingHeight: 240, expectedPixelArea: 115200, actualToExpectedAreaRatio: 2, rasterOperationCount: 1, canvasApiSelfTimeMs: 3 },
    ]);
    expect(finding?.affectedEpisodeIds).toEqual([session.episodes[0].episodeId]);
    expect(finding?.claimBoundary).toEqual({
      observation: 'The recorded backing area is larger than the DPR-adjusted expected area in the named active windows.',
      explanation: 'The recorded dimensions are a review candidate.',
      nonEstablishedFacts: 'The evidence does not establish GPU cost, render cost, or the required image quality. The displayed size includes any CSS transform on the canvas, so a scaled-down canvas raises this ratio without its backing store changing.',
    });
    expect(finding?.nextCheck).toBe('Check the canvas sizing policy, any CSS transform on the canvas, and the required image quality.');
    if (!finding || finding.type !== 'backing-store-mismatch') throw new Error('missing backing-store finding');
    finding.affectedWindows[0].backingWidth = 1;
    finding.affectedEpisodeIds[0] = 'changed';
    finding.claimBoundary.observation = 'changed';
    const copied = getLastSession()!.findings.find(item => item.type === 'backing-store-mismatch');
    expect(copied?.affectedWindows[0].backingWidth).toBe(960);
    expect(copied?.affectedEpisodeIds[0]).not.toBe('changed');
    expect(copied?.claimBoundary.observation).toContain('recorded backing area');
  });

  it('requires two qualifying backing-store windows', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const oversized = { isConnected: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }) };
    startRecording(); publish('one-window', 2, 1, {}, oversized);
    expect(stopRecording()!.findings.some(item => item.type === 'backing-store-mismatch')).toBe(false);
  });

  it('does not round a sub-threshold backing-store ratio into a finding', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 1);
    const almostOversized = { isConnected: true, width: 199.96, height: 1, getBoundingClientRect: () => ({ width: 100, height: 1 }) };
    startRecording(); publish('almost-oversized', 2, 1, {}, almostOversized); publish('almost-oversized', 3, 2, {}, almostOversized);
    const session = stopRecording()!;
    expect(session.windows[0].geometry.actualToExpectedAreaRatio).toBe(2);
    expect(session.findings.some(item => item.type === 'backing-store-mismatch')).toBe(false);
  });

  it('keeps unavailable and idle oversized windows out of backing-store findings', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const unavailable = { isConnected: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 0, height: 120 }) };
    const oversized = { isConnected: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }) };
    startRecording();
    publish('unavailable', 2, 1, {}, unavailable); publish('unavailable', 2, 2, {}, unavailable);
    publish('idle', 2, 3, { rasterOperationCount: 0 }, oversized); publish('idle', 2, 4, { rasterOperationCount: 0 }, oversized);
    expect(stopRecording()!.findings.some(item => item.type === 'backing-store-mismatch')).toBe(false);
  });

  it('keeps every unavailable geometry reason out of backing-store findings', () => {
    vi.stubGlobal('getComputedStyle', (element: { hidden?: boolean }) => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const canvases = [
      ['disconnected', { isConnected: false, width: 960, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }) }],
      ['hidden', { isConnected: true, hidden: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }) }],
      ['zero-size', { isConnected: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 0, height: 120 }) }],
      ['unavailable', { isConnected: true, width: 960, height: 240 }],
    ] as const;
    startRecording();
    canvases.forEach(([reason, canvas], index) => {
      publish(reason, 2, index * 2 + 1, {}, canvas);
      publish(reason, 2, index * 2 + 2, {}, canvas);
    });
    const session = stopRecording()!;
    expect(canvases.map(([reason]) => session.windows.find(window => window.canvasId === reason)?.geometry.unavailableReason)).toEqual(canvases.map(([reason]) => reason));
    expect(session.findings.some(item => item.type === 'backing-store-mismatch')).toBe(false);
  });

  it('keeps mixed backing-store finding order stable', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const oversized = { isConnected: true, width: 960, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }) };
    startRecording();
    publish('mixed-geometry', 4, 1, {}, oversized);
    publish('mixed-geometry', 4, 2, {}, oversized);
    expect(stopRecording()!.findings.map(finding => finding.type)).toEqual(['backing-store-mismatch', 'heavy-canvas-work']);
  });
  it('creates resize churn only across two active reset windows and counts each qualifying window once', () => {
    startRecording();
    publish('resize', 2, 1, { rasterOperationCount: 4, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    publish('resize', 3, 2, { rasterOperationCount: 5, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    const reset = (windowIndex: number, source: 'width-setter' | 'height-setter', activeRasterOverlap = true) => emitResetEvent({ canvasId: 'resize', windowIndex, timestampMs: windowIndex * 10, source, dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: activeRasterOverlap ? windowIndex === 1 ? 4 : 5 : 0, activeRasterOverlap, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    reset(1, 'width-setter'); reset(2, 'height-setter'); reset(3, 'width-setter', false); reset(4, 'height-setter', false);
    const finding = stopRecording()!.findings.find(item => item.type === 'resize-churn');
    expect(finding).toMatchObject({ canvasId: 'resize', observedResetCount: 4, activeResetCount: 2, rasterOperationCount: 9, canvasApiSelfTimeMs: 5, commandStatuses: { same: 0, changed: 0, unknown: 2 }, unknownReasons: { 'canvas-reset': 2 } });
    expect(finding?.resetEvents.map(event => event.source)).toEqual(['width-setter', 'height-setter']);
  });

  it.each([
    ['width-first', 'setup-a', 'width-setter', 'height-setter', 240, 120],
    ['height-first', 'setup-b', 'height-setter', 'width-setter', 91, 37],
    ['attributes', 'setup-c', 'width-attribute', 'height-attribute', 300, 88],
  ])('keeps one-shot paired setup evidence without resize churn: %s', (_name, canvasId, first, second, width, height) => {
    startRecording();
    publish(canvasId, 2, 1, { rasterOperationCount: 1 });
    emitResetEvent({ canvasId, windowIndex: 1, timestampMs: 10, source: first as 'width-setter', dimensionChange: 'changed', width, height, rasterOperationCount: 1, activeRasterOverlap: true, commandStatus: 'same', unknownReason: null, flushedAtStop: false });
    emitResetEvent({ canvasId, windowIndex: 1, timestampMs: 11, source: second as 'height-setter', dimensionChange: 'changed', width, height, rasterOperationCount: 1, activeRasterOverlap: true, commandStatus: 'same', unknownReason: null, flushedAtStop: false });
    emitLifecycleEvent({ canvasId, type: 'first-observed', windowIndex: 1, timestampMs: 10, evidenceLevel: 'measured', connected: true, activeRegistrySize: 1 });
    emitLifecycleEvent({ canvasId, type: 'active', windowIndex: 1, timestampMs: 10, evidenceLevel: 'measured', connected: true, activeRegistrySize: 1 });
    emitLifecycleEvent({ canvasId, type: 'retired', windowIndex: 2, timestampMs: 20, evidenceLevel: 'measured', connected: true, activeRegistrySize: 0 });
    const session = stopRecording()!;
    expect(session.findings.some(item => item.type === 'resize-churn' && item.canvasId === canvasId)).toBe(false);
    expect(session.resetEvents.filter(event => event.canvasId === canvasId)).toHaveLength(2);
    expect(session.windows.filter(window => window.canvasId === canvasId)).toMatchObject([{ rasterOperationCount: 1 }]);
    expect(session.lifecycleEvents.filter(event => event.canvasId === canvasId).map(event => event.type)).toEqual(['first-observed', 'active', 'retired']);
  });

  it('requires two active reset windows and reports exact mixed evidence', () => {
    startRecording();
    publish('mixed', 2, 1, { rasterOperationCount: 4, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    emitResetEvent({ canvasId: 'mixed', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    expect(stopRecording()!.findings.some(item => item.type === 'resize-churn')).toBe(false);

    startRecording();
    publish('mixed', 2, 1, { rasterOperationCount: 4, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    publish('mixed', 3, 2, { rasterOperationCount: 5, signatureStatus: 'changed', unknownReason: null });
    emitResetEvent({ canvasId: 'mixed', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'mixed', windowIndex: 2, timestampMs: 20, source: 'context-reset', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 5, activeRasterOverlap: true, commandStatus: 'changed', unknownReason: null, flushedAtStop: false });
    emitResetEvent({ canvasId: 'mixed', windowIndex: 3, timestampMs: 30, source: 'height-attribute', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-attribute-reset', flushedAtStop: false });
    const session = stopRecording()!;
    const finding = session.findings.find(item => item.type === 'resize-churn');
    expect(finding).toMatchObject({
      observedResetCount: 3, activeResetCount: 2,
      canvasApiSelfTimeMs: 5, rasterOperationCount: 9,
      resetEvents: [
        { source: 'width-setter', width: 240, height: 120, windowIndex: 1, timestampMs: 10 },
        { source: 'context-reset', width: 240, height: 120, windowIndex: 2, timestampMs: 20 },
      ],
      commandStatuses: { same: 0, changed: 1, unknown: 1 },
      unknownReasons: { 'canvas-reset': 1 },
      affectedEpisodeIds: [session.episodes[0].episodeId],
    });
    expect(finding?.claimBoundary.nonEstablishedFacts).toContain('does not show');
    expect(finding?.nextCheck).toContain('only when dimensions or state need to change');
  });

  it('keeps reset-only evidence without a resize churn finding', () => {
    startRecording();
    emitResetEvent({ canvasId: 'idle', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'changed', width: 40, height: 20, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'idle', windowIndex: 2, timestampMs: 20, source: 'height-setter', dimensionChange: 'changed', width: 40, height: 20, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const session = stopRecording()!;
    expect(session.resetEvents).toHaveLength(2);
    expect(session.findings.some(item => item.type === 'resize-churn')).toBe(false);
  });

  it('uses sampled-out reset metadata once per qualifying window', () => {
    startRecording();
    emitResetEvent({ canvasId: 'sampled', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'unchanged', width: 40, height: 20, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'sampled', windowIndex: 1, timestampMs: 10, source: 'height-setter', dimensionChange: 'unchanged', width: 40, height: 20, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const session = stopRecording()!;
    expect(session.findings.some(item => item.type === 'resize-churn')).toBe(false);
    expect(session.resetEvents).toHaveLength(2);
  });
  it('keeps one idle boundary in an episode and splits two idle boundaries', () => {
    startRecording(); publish('a', 1, 1); publish('a', 1, 3); publish('a', 1, 6);
    const session = stopRecording()!;
    expect(session.episodes.map(episode => [episode.firstWindowIndex, episode.lastWindowIndex])).toEqual([[1, 3], [6, 6]]);
  });

  it('keeps successive active boundaries together and splits indices 1 and 4', () => {
    startRecording(); publish('a', 1, 1); publish('a', 1, 2); publish('a', 1, 4); publish('a', 1, 7);
    const session = stopRecording()!;
    expect(session.episodes.map(episode => [episode.firstWindowIndex, episode.lastWindowIndex])).toEqual([[1, 4], [7, 7]]);
  });

  it('compares each boundary with the prior active boundary', () => {
    startRecording(); publish('a', 1, 1); publish('a', 1, 3); publish('a', 1, 5);
    const session = stopRecording()!;
    expect(session.episodes).toHaveLength(1);
    expect(session.episodes[0]).toMatchObject({ firstWindowIndex: 1, lastWindowIndex: 5, activeWindowCount: 3 });
  });

  it('creates heavy work only at the exact stored threshold', () => {
    startRecording(); publish('under', 7.999, 1); publish('at', 8, 1);
    const session = stopRecording()!;
    expect(session.findings).toHaveLength(1);
    expect(session.findings[0]).toMatchObject({ canvasId: 'at', evidenceLevel: 'candidate', type: 'heavy-canvas-work', topMethods: [{ method: 'fillRect', count: 2, canvasApiSelfTimeMs: 8 }] });
    expect(session.findings[0].claimBoundary.nonEstablishedFacts).toContain('does not establish GPU time');
  });

  it('counts active boundaries once and closes continuous work at the last real report', () => {
    startRecording();
    publish('a', 1, 10); publish('b', 2, 10); publish('a', 3, 11); publish('a', 4, 12);
    const session = stopRecording()!;
    expect(session.windows).toHaveLength(4);
    expect(session.episodes).toHaveLength(1);
    expect(session.episodes[0]).toMatchObject({ firstWindowIndex: 10, lastWindowIndex: 12, startedAtTimestampMs: 100, endedAtTimestampMs: 120, activeWindowCount: 3, canvasApiSelfTimeMs: 10, rasterOperationCount: 4 });
    expect(session.episodes[0].canvases.find(canvas => canvas.canvasId === 'a')).toMatchObject({ activeWindowCount: 3, canvasApiSelfTimeMs: 8, rasterOperationCount: 3 });
  });

  it('creates findings only for qualifying canvas contributions', () => {
    startRecording(); publish('heavy', 8, 1); publish('light', 7, 1);
    const session = stopRecording()!;
    expect(session.findings.map(finding => finding.canvasId)).toEqual(['heavy']);
  });

  it('orders findings by self-time, raster operations, and canvas ID', () => {
    startRecording();
    publish('zeta', 8, 1);
    publish('alpha', 8, 1);
    publish('more-raster', 8, 1, { rasterOperationCount: 2 });
    publish('higher-self-time', 9, 1);
    const session = stopRecording()!;
    expect(session.findings.filter(finding => finding.type === 'heavy-canvas-work').map(finding => finding.canvasId)).toEqual(['higher-self-time', 'more-raster', 'alpha', 'zeta']);
  });

  it('orders mixed findings by self-time, raster operations, type, and canvas ID', () => {
    startRecording();
    publish('high', 10, 1, { rasterOperationCount: 2 });
    publish('more-raster', 8, 2, { rasterOperationCount: 4 });
    publish('beta', 8, 3, { rasterOperationCount: 2 });
    publish('alpha', 8, 4, { rasterOperationCount: 2 });
    expect(stopRecording()!.findings.map(({ type, canvasId }) => ({ type, canvasId }))).toEqual([
      { type: 'heavy-canvas-work', canvasId: 'high' },
      { type: 'repeated-draw-work', canvasId: 'high' },
      { type: 'heavy-canvas-work', canvasId: 'more-raster' },
      { type: 'repeated-draw-work', canvasId: 'more-raster' },
      { type: 'heavy-canvas-work', canvasId: 'alpha' },
      { type: 'heavy-canvas-work', canvasId: 'beta' },
      { type: 'repeated-draw-work', canvasId: 'alpha' },
      { type: 'repeated-draw-work', canvasId: 'beta' },
    ]);
  });

  it('keeps equal-key findings in episode generation order', () => {
    startRecording();
    publish('stable-episode', 8, 1, { rasterOperationCount: 2 });
    publish('stable-episode', 8, 4, { rasterOperationCount: 2 });
    const session = stopRecording()!;
    expect(session.findings.filter(finding => finding.type === 'heavy-canvas-work').map(finding => finding.episodeId)).toEqual(session.episodes.map(episode => episode.episodeId));
  });

  it('reports ordered methods, maximum-window evidence, claim limits, and next check', () => {
    startRecording();
    publish('a', 5, 1, { rasterOperationCount: 2, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: 3 }, lineTo: { count: 5, canvasApiSelfTimeMs: null }, stroke: { count: 1, canvasApiSelfTimeMs: 2 } } });
    publish('a', 3, 2, { rasterOperationCount: 4, methodEvidence: { fillRect: { count: 1, canvasApiSelfTimeMs: 1 }, stroke: { count: 2, canvasApiSelfTimeMs: 2 } } });
    publish('b', 8, 2, { rasterOperationCount: 1, methodEvidence: { arc: { count: 1, canvasApiSelfTimeMs: 8 } } });
    const session = stopRecording()!;
    const findings = session.findings.filter(finding => finding.type === 'heavy-canvas-work');
    expect(findings.map(finding => finding.canvasId)).toEqual(['a', 'b']);
    expect(findings[0]).toMatchObject({
      canvasId: 'a', canvasApiSelfTimeMs: 8, rasterOperationCount: 6,
      topMethods: [
        { method: 'fillRect', count: 3, canvasApiSelfTimeMs: 4 },
        { method: 'stroke', count: 3, canvasApiSelfTimeMs: 4 },
        { method: 'lineTo', count: 5, canvasApiSelfTimeMs: null },
      ],
      maximumWindow: { windowIndex: 1, timestampMs: 10, canvasApiSelfTimeMs: 5, rasterOperationCount: 2 },
      evidenceLevel: 'candidate',
    });
    expect(findings[0].maximumWindow.methodEvidence.fillRect.count).toBe(2);
    expect(findings[0].claimBoundary).toEqual({
      observation: 'The canvas spent the measured Canvas2D API self-time in the named draw episode.',
      explanation: 'The episode contains concentrated synchronous Canvas2D API work and is a review candidate.',
      nonEstablishedFacts: 'The evidence does not establish GPU time, presentation or render time, or avoidable work.',
    });
    expect(findings[0].nextCheck).toBe('Check the top measured methods and the application code that calls them.');
  });

  it('records only same windows at the default repeated threshold', () => {
    startRecording();
    publish('candidate', 1.25, 1, { rasterOperationCount: 2, comparisonGap: 3 });
    publish('candidate', 5, 2, { rasterOperationCount: 9, signatureStatus: 'changed' });
    publish('candidate', 4, 3, { rasterOperationCount: 8, signatureStatus: 'unknown', unknownReason: 'uncaptured-raster' });
    const finding = stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work');
    expect(finding).toEqual({
      type: 'repeated-draw-work', evidenceLevel: 'candidate', canvasId: 'candidate',
      episodeId: expect.any(String), repeatedWindowCount: 1, rasterOperationCount: 2,
      canvasApiSelfTimeMs: 1.25,
      repeatedWindows: [{ windowIndex: 1, timestampMs: 10, rasterOperationCount: 2, canvasApiSelfTimeMs: 1.25, comparisonGap: 3 }],
      adjacentIdenticalWindowPairs: 0,
      unknownCoverage: { unknownWindowCount: 1, activeWindowCount: 3 },
      claimBoundary: {
        observation: 'The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.',
        explanation: 'The repeated commands are a review candidate.',
        nonEstablishedFacts: 'The evidence does not establish that the output stayed unchanged or that the work can be removed.',
      },
      nextCheck: 'Check whether the application needs to send these repeated commands for the same scene and interaction.',
    });
  });

  it('uses the configured repeated threshold exactly', () => {
    configureRecording({ minFlashRasterOps: 4 });
    startRecording();
    publish('candidate', 1, 1, { rasterOperationCount: 3 });
    publish('candidate', 2, 2, { rasterOperationCount: 4 });
    const finding = stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work');
    expect(finding?.repeatedWindows.map(window => window.windowIndex)).toEqual([2]);
    expect(finding?.rasterOperationCount).toBe(4);
  });

  it('does not create repeated work for a one-operation wake-up', () => {
    startRecording();
    publish('wake-up', 1, 1, { rasterOperationCount: 1 });
    expect(stopRecording()!.findings.some(finding => finding.type === 'repeated-draw-work')).toBe(false);
  });

  it('keeps changed, unknown, and below-threshold work out of another canvas finding', () => {
    startRecording();
    publish('untrusted', 9, 1, { rasterOperationCount: 8, signatureStatus: 'changed' });
    publish('untrusted', 7, 2, { rasterOperationCount: 7, signatureStatus: 'unknown', unknownReason: 'uncaptured-raster' });
    publish('untrusted', 3, 3, { rasterOperationCount: 1 });
    publish('trusted', 2.5, 1, { rasterOperationCount: 2 });
    const findings = stopRecording()!.findings.filter(finding => finding.type === 'repeated-draw-work');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ canvasId: 'trusted', rasterOperationCount: 2, canvasApiSelfTimeMs: 2.5 });
  });

  it('keeps an idle sampled gap only after trusted same evidence returns', () => {
    startRecording();
    publish('sampled', 2, 1, { rasterOperationCount: 4, sampled: true, signatureStatus: 'unknown', unknownReason: 'uncaptured-raster', comparisonGap: 3 });
    publish('sampled', 3, 4, { rasterOperationCount: 4, sampled: true, comparisonGap: 4 });
    const finding = stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work');
    expect(finding?.repeatedWindows).toEqual([{ windowIndex: 4, timestampMs: 40, rasterOperationCount: 4, canvasApiSelfTimeMs: 3, comparisonGap: 4 }]);
  });

  it('carries the reset-following flag of the maximum window into the heavy finding', () => {
    startRecording();
    publish('flagged', 5, 1);
    publish('flagged', 9, 2, { followsCanvasReset: true });
    const session = stopRecording()!;
    expect(session.windows.map(window => window.followsCanvasReset)).toEqual([false, true]);
    const finding = session.findings.find(item => item.type === 'heavy-canvas-work');
    expect(finding?.maximumWindow.windowIndex).toBe(2);
    expect(finding?.maximumWindow.followsCanvasReset).toBe(true);
  });

  it.each([
    ['8.8 ms sits 0.8 above the gate', 8.8, 8, 0.8],
    ['77.5 ms sits 69.5 above the gate', 77.5, 8, 69.5],
  ])('%s', (_name, selfTimeMs, thresholdMs, excessMs) => {
    startRecording();
    publish('gated', selfTimeMs, 1);
    const finding = stopRecording()!.findings.find(item => item.type === 'heavy-canvas-work');
    expect(finding).toMatchObject({ type: 'heavy-canvas-work', gateThresholdMs: thresholdMs, gateExcessMs: excessMs });
  });

  it('counts adjacent identical window pairs only for neighbouring windows of equal raster work', () => {
    startRecording();
    publish('pairs-adjacent', 1, 1, { rasterOperationCount: 2 });
    publish('pairs-adjacent', 1, 2, { rasterOperationCount: 2 });
    publish('pairs-adjacent', 1, 3, { rasterOperationCount: 2 });
    expect(stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work')?.adjacentIdenticalWindowPairs).toBe(2);

    startRecording();
    publish('pairs-gap', 1, 1, { rasterOperationCount: 2 });
    publish('pairs-gap', 1, 3, { rasterOperationCount: 2 });
    expect(stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work')?.adjacentIdenticalWindowPairs).toBe(0);

    startRecording();
    publish('pairs-raster', 1, 1, { rasterOperationCount: 2 });
    publish('pairs-raster', 1, 2, { rasterOperationCount: 4 });
    expect(stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work')?.adjacentIdenticalWindowPairs).toBe(0);

    // Self-time no longer takes part. Two neighbouring windows that drew the
    // same commands and the same raster count are one pair whether or not
    // their measured times agree, which is what stopped the old field firing
    // on cheap draws that merely rounded to the same number.
    startRecording();
    publish('pairs-time', 1, 1, { rasterOperationCount: 2 });
    publish('pairs-time', 9, 2, { rasterOperationCount: 2 });
    expect(stopRecording()!.findings.find(finding => finding.type === 'repeated-draw-work')?.adjacentIdenticalWindowPairs).toBe(1);
  });

  it('scales the episode-break gap with captureEvery so sampled grouping holds', () => {
    // Sampling at 3 reports windows 3, 6, 9 and 12. A fixed three-window gap
    // makes each its own episode, so the per-episode heavy-work gate sees 3 ms
    // four times instead of 12 ms once and no finding is ever raised.
    configureRecording({ captureEvery: 3 });
    startRecording();
    for (const windowIndex of [3, 6, 9, 12]) publish('sampled-episode', 3, windowIndex);
    const sampled = stopRecording()!;
    expect(sampled.captureEvery).toBe(3);
    expect(sampled.episodes).toHaveLength(1);
    expect(sampled.findings.some(finding => finding.type === 'heavy-canvas-work')).toBe(true);

    // A real pause is still a break: window 30 is far past 3 × captureEvery.
    configureRecording({ captureEvery: 3 });
    startRecording();
    for (const windowIndex of [3, 6, 30]) publish('sampled-pause', 1, windowIndex);
    expect(stopRecording()!.episodes).toHaveLength(2);

    configureRecording({});
  });

  it('keeps a reset flushed at the stop from completing the resize-churn gate', () => {
    // One real qualifying window is not two. The window index on a reset
    // flushed at the stop is one past the last window a frame closed, so it
    // must not supply the second one — the finding would exist because of when
    // the user pressed Stop.
    startRecording();
    publish('stop-flush', 2, 1, { rasterOperationCount: 4, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    emitResetEvent({ canvasId: 'stop-flush', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'stop-flush', windowIndex: 2, timestampMs: 20, source: 'height-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: true });
    const withFlush = stopRecording()!;
    expect(withFlush.resetEvents).toHaveLength(2);
    expect(withFlush.findings.some(finding => finding.type === 'resize-churn')).toBe(false);

    // Two real windows still qualify.
    startRecording();
    publish('two-real', 2, 1, { rasterOperationCount: 4, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    publish('two-real', 2, 2, { rasterOperationCount: 4, signatureStatus: 'unknown', unknownReason: 'canvas-reset' });
    emitResetEvent({ canvasId: 'two-real', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'two-real', windowIndex: 2, timestampMs: 20, source: 'height-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    expect(stopRecording()!.findings.some(finding => finding.type === 'resize-churn')).toBe(true);
  });
});
