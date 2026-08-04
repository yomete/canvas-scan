import { afterEach, describe, expect, it } from 'vitest';
import { emitReport } from '../src/frame-loop';
import { resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';

const report = (canvasId: string, selfTime: number, overrides: Partial<DrawBatchReport> = {}): DrawBatchReport => ({ canvasId, nearestReactOwner: null, attributionKind: 'unattributed', sourceLocation: null, rasterOperationCount: 1, canvasApiSelfTimeMs: selfTime, signatureStatus: 'same', unknownReason: null, sampled: false, comparisonGap: 1, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: selfTime } }, ...overrides });
const publish = (canvasId: string, selfTime: number, windowIndex: number, overrides: Partial<DrawBatchReport> = {}) => emitReport(report(canvasId, selfTime, overrides), {}, { windowIndex, timestampMs: windowIndex * 10 });
afterEach(resetRecordingForTests);

describe('investigation findings', () => {
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
    expect(session.findings.map(finding => finding.canvasId)).toEqual(['higher-self-time', 'more-raster', 'alpha', 'zeta']);
  });

  it('reports ordered methods, maximum-window evidence, claim limits, and next check', () => {
    startRecording();
    publish('a', 5, 1, { rasterOperationCount: 2, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: 3 }, lineTo: { count: 5, canvasApiSelfTimeMs: null }, stroke: { count: 1, canvasApiSelfTimeMs: 2 } } });
    publish('a', 3, 2, { rasterOperationCount: 4, methodEvidence: { fillRect: { count: 1, canvasApiSelfTimeMs: 1 }, stroke: { count: 2, canvasApiSelfTimeMs: 2 } } });
    publish('b', 8, 2, { rasterOperationCount: 1, methodEvidence: { arc: { count: 1, canvasApiSelfTimeMs: 8 } } });
    const session = stopRecording()!;
    expect(session.findings.map(finding => finding.canvasId)).toEqual(['a', 'b']);
    expect(session.findings[0]).toMatchObject({
      canvasId: 'a', canvasApiSelfTimeMs: 8, rasterOperationCount: 6,
      topMethods: [
        { method: 'fillRect', count: 3, canvasApiSelfTimeMs: 4 },
        { method: 'stroke', count: 3, canvasApiSelfTimeMs: 4 },
        { method: 'lineTo', count: 5, canvasApiSelfTimeMs: null },
      ],
      maximumWindow: { windowIndex: 1, timestampMs: 10, canvasApiSelfTimeMs: 5, rasterOperationCount: 2 },
      evidenceLevel: 'candidate',
    });
    expect(session.findings[0].maximumWindow.methodEvidence.fillRect.count).toBe(2);
    expect(session.findings[0].claimBoundary).toEqual({
      observation: 'The canvas spent the measured Canvas2D API self-time in the named draw episode.',
      explanation: 'The episode contains concentrated synchronous Canvas2D API work and is a review candidate.',
      nonEstablishedFacts: 'The evidence does not establish GPU time, presentation or render time, or avoidable work.',
    });
    expect(session.findings[0].nextCheck).toBe('Check the top measured methods and the application code that calls them.');
  });
});
