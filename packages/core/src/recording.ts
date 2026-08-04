import { copyReport, getCurrentWindowIndex, subscribeToReports } from './frame-loop';
import { records, setMethodEvidenceCollectionEnabled } from './wrap-context';
import type {
  CanvasMethodEvidence,
  CanvasScanOptions,
  HeavyCanvasWorkFinding,
  InvestigationFinding,
  InvestigationSessionV1,
  RecordedDrawEpisode,
  RecordedEpisodeCanvasSummary,
  RecordedCanvasSummary,
  RecordedCanvasWindow,
  RecordedTopMethod,
  RepeatedDrawWorkFinding,
  RecordingState,
  RecordingStopReason,
} from './types';

const MAX_DURATION_MS = 30000;
const MAX_WINDOWS = 10000;
const MAX_CANVASES = 128;
const HEAVY_CANVAS_WORK_THRESHOLD_MS = 8;
const HEAVY_CANVAS_WORK_CLAIM = {
  observation: 'The canvas spent the measured Canvas2D API self-time in the named draw episode.',
  explanation: 'The episode contains concentrated synchronous Canvas2D API work and is a review candidate.',
  nonEstablishedFacts: 'The evidence does not establish GPU time, presentation or render time, or avoidable work.',
};
const HEAVY_CANVAS_WORK_NEXT_CHECK = 'Check the top measured methods and the application code that calls them.';
const REPEATED_DRAW_WORK_CLAIM = {
  observation: 'The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.',
  explanation: 'The repeated commands are a review candidate.',
  nonEstablishedFacts: 'The evidence does not establish that the output stayed unchanged or that the work can be removed.',
};
const REPEATED_DRAW_WORK_NEXT_CHECK = 'Check whether the application needs to send these repeated commands for the same scene and interaction.';

let state: RecordingState = 'idle';
let lastSession: InvestigationSessionV1 | undefined;
let startedAt = '';
let startedMonotonic = 0;
let sessionId = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let windows: RecordedCanvasWindow[] = [];
let canvasIds: string[] = [];
let droppedWindows = 0;
let droppedCanvases = 0;
let sequence = 0;
let unsubscribe: (() => void) | undefined;
let recordingStartWindowIndex = 0;
let minRepeatedRasterOps = 2;
let recordingStartOffsets = new Map<unknown, { rasterOperationCount: number; canvasApiSelfTimeMs: number }>();
const listeners = new Set<(state: RecordingState) => void>();

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function copyWindow(window: RecordedCanvasWindow): RecordedCanvasWindow {
  return { ...copyReport(window), windowIndex: window.windowIndex, timestampMs: window.timestampMs };
}

function copyEvidence(evidence: Record<string, CanvasMethodEvidence>): Record<string, CanvasMethodEvidence> {
  return Object.fromEntries(Object.entries(evidence).map(([method, value]) => [method, { ...value }]));
}

function addEvidence(target: Record<string, CanvasMethodEvidence>, source: Record<string, CanvasMethodEvidence>): void {
  for (const [method, value] of Object.entries(source)) {
    const current = target[method] ?? { count: 0, canvasApiSelfTimeMs: value.canvasApiSelfTimeMs === null ? null : 0 };
    current.count += value.count;
    if (current.canvasApiSelfTimeMs !== null && value.canvasApiSelfTimeMs !== null) current.canvasApiSelfTimeMs += value.canvasApiSelfTimeMs;
    target[method] = current;
  }
}

function rounded(value: number): number { return Number(value.toFixed(3)); }

function roundedEvidence(evidence: Record<string, CanvasMethodEvidence>): Record<string, CanvasMethodEvidence> {
  return Object.fromEntries(Object.entries(evidence).map(([method, value]) => [method, {
    count: value.count,
    canvasApiSelfTimeMs: value.canvasApiSelfTimeMs === null ? null : rounded(value.canvasApiSelfTimeMs),
  }]));
}

function copySession(session: InvestigationSessionV1): InvestigationSessionV1 {
  return {
    ...session,
    browserFeatures: { ...session.browserFeatures },
    canvases: session.canvases.map(canvas => ({
      ...canvas,
      sourceLocation: canvas.sourceLocation ? { ...canvas.sourceLocation } : null,
      commandStatuses: { ...canvas.commandStatuses },
      methodEvidence: copyEvidence(canvas.methodEvidence),
    })),
    windows: session.windows.map(copyWindow),
    episodes: session.episodes.map(episode => ({ ...episode, methodEvidence: copyEvidence(episode.methodEvidence), canvases: episode.canvases.map(canvas => ({ ...canvas, methodEvidence: copyEvidence(canvas.methodEvidence) })) })),
    findings: session.findings.map(finding => finding.type === 'heavy-canvas-work'
      ? { ...finding, topMethods: finding.topMethods.map(method => ({ ...method })), maximumWindow: { ...finding.maximumWindow, methodEvidence: copyEvidence(finding.maximumWindow.methodEvidence) }, claimBoundary: { ...finding.claimBoundary } }
      : { ...finding, repeatedWindows: finding.repeatedWindows.map(window => ({ ...window })), unknownCoverage: { ...finding.unknownCoverage }, claimBoundary: { ...finding.claimBoundary } }),
    collectionLimits: { ...session.collectionLimits },
    droppedEntryCounts: { ...session.droppedEntryCounts },
  };
}

function notify(): void {
  for (const listener of listeners) listener(state);
}

function removeCanvas(canvasId: string): void {
  canvasIds = canvasIds.filter(id => id !== canvasId);
  const kept: RecordedCanvasWindow[] = [];
  for (const window of windows) {
    if (window.canvasId === canvasId) droppedWindows++;
    else kept.push(window);
  }
  windows = kept;
}

function capture(report: RecordedCanvasWindow): void {
  if (state !== 'recording') return;
  if (windows.length === MAX_WINDOWS) {
    const removed = windows.shift()!;
    droppedWindows++;
    if (!windows.some(window => window.canvasId === removed.canvasId)) {
      canvasIds = canvasIds.filter(canvasId => canvasId !== removed.canvasId);
    }
  }
  if (!canvasIds.includes(report.canvasId)) {
    if (canvasIds.length === MAX_CANVASES) {
      removeCanvas(canvasIds[0]);
      droppedCanvases++;
    }
    canvasIds.push(report.canvasId);
  }
  windows.push(copyWindow(report));
}

function summaries(): RecordedCanvasSummary[] {
  return canvasIds.map(canvasId => {
    const retained = windows.filter(window => window.canvasId === canvasId);
    const latest = retained[retained.length - 1];
    const commandStatuses = { same: 0, changed: 0, unknown: 0 };
    let rasterOperationCount = 0;
    let canvasApiSelfTimeMs = 0;
    let maxWindowSelfTimeMs = 0;
    const methodEvidence: Record<string, CanvasMethodEvidence> = {};
    for (const window of retained) {
      commandStatuses[window.signatureStatus]++;
      rasterOperationCount += window.rasterOperationCount;
      canvasApiSelfTimeMs += window.canvasApiSelfTimeMs;
      maxWindowSelfTimeMs = Math.max(maxWindowSelfTimeMs, window.canvasApiSelfTimeMs);
      addEvidence(methodEvidence, window.methodEvidence);
    }
    return {
      canvasId,
      nearestReactOwner: latest.nearestReactOwner,
      attributionKind: latest.attributionKind,
      sourceLocation: latest.sourceLocation ? { ...latest.sourceLocation } : null,
      activeWindowCount: retained.length,
      rasterOperationCount,
      canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), maxWindowSelfTimeMs: rounded(maxWindowSelfTimeMs), evidenceLevel: 'measured' as const, methodEvidence: roundedEvidence(methodEvidence),
      commandStatuses,
    };
  }).sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs || right.maxWindowSelfTimeMs - left.maxWindowSelfTimeMs || right.rasterOperationCount - left.rasterOperationCount || left.canvasId.localeCompare(right.canvasId));
}

function episodeCanvasSummary(canvasId: string, reports: RecordedCanvasWindow[]): RecordedEpisodeCanvasSummary {
  let rasterOperationCount = 0; let canvasApiSelfTimeMs = 0; let maxWindowSelfTimeMs = 0;
  const methodEvidence: Record<string, CanvasMethodEvidence> = {};
  for (const report of reports) { rasterOperationCount += report.rasterOperationCount; canvasApiSelfTimeMs += report.canvasApiSelfTimeMs; maxWindowSelfTimeMs = Math.max(maxWindowSelfTimeMs, report.canvasApiSelfTimeMs); addEvidence(methodEvidence, report.methodEvidence); }
  return { canvasId, activeWindowCount: reports.length, rasterOperationCount, canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), maxWindowSelfTimeMs: rounded(maxWindowSelfTimeMs), methodEvidence: roundedEvidence(methodEvidence) };
}

function topMethods(evidence: Record<string, CanvasMethodEvidence>): RecordedTopMethod[] {
  return Object.entries(evidence).map(([method, value]) => ({ method, ...value })).sort((left, right) => (right.canvasApiSelfTimeMs ?? -Infinity) - (left.canvasApiSelfTimeMs ?? -Infinity) || right.count - left.count || left.method.localeCompare(right.method));
}

function episodesAndFindings(): { episodes: RecordedDrawEpisode[]; findings: InvestigationFinding[] } {
  const groups: RecordedCanvasWindow[][] = [];
  let group: RecordedCanvasWindow[] | undefined;
  let previousIndex: number | undefined;
  let boundaryIndex: number | undefined;
  for (const window of windows) {
    if (window.windowIndex !== boundaryIndex) {
      if (previousIndex === undefined || window.windowIndex - previousIndex >= 3) {
        group = [];
        groups.push(group);
      }
      previousIndex = window.windowIndex;
      boundaryIndex = window.windowIndex;
    }
    group!.push(window);
  }
  const episodeMaximumWindows = new Map<string, Map<string, RecordedCanvasWindow>>();
  const episodes = groups.map((reports, index) => {
    const first = reports[0]; const last = reports.at(-1)!; const methodEvidence: Record<string, CanvasMethodEvidence> = {};
    let rasterOperationCount = 0; let canvasApiSelfTimeMs = 0;
    for (const report of reports) { rasterOperationCount += report.rasterOperationCount; canvasApiSelfTimeMs += report.canvasApiSelfTimeMs; addEvidence(methodEvidence, report.methodEvidence); }
    const reportsByCanvas = new Map<string, RecordedCanvasWindow[]>();
    for (const report of reports) {
      const canvasReports = reportsByCanvas.get(report.canvasId) ?? [];
      canvasReports.push(report);
      reportsByCanvas.set(report.canvasId, canvasReports);
    }
    const maximumWindows = new Map<string, RecordedCanvasWindow>();
    for (const [canvasId, canvasReports] of reportsByCanvas) {
      maximumWindows.set(canvasId, canvasReports.reduce((largest, report) => report.canvasApiSelfTimeMs > largest.canvasApiSelfTimeMs ? report : largest));
    }
    const canvases = [...reportsByCanvas].map(([canvasId, canvasReports]) => episodeCanvasSummary(canvasId, canvasReports));
    const episodeId = `${sessionId}:episode:${index + 1}`;
    episodeMaximumWindows.set(episodeId, maximumWindows);
    return { episodeId, firstWindowIndex: first.windowIndex, lastWindowIndex: last.windowIndex, startedAtTimestampMs: first.timestampMs, endedAtTimestampMs: last.timestampMs, activeWindowCount: new Set(reports.map(report => report.windowIndex)).size, rasterOperationCount, canvasApiSelfTimeMs: rounded(canvasApiSelfTimeMs), methodEvidence: roundedEvidence(methodEvidence), canvases };
  });
  const findings: InvestigationFinding[] = [];
  for (const episode of episodes) for (const canvas of episode.canvases) if (canvas.canvasApiSelfTimeMs >= HEAVY_CANVAS_WORK_THRESHOLD_MS) {
    const maximum = episodeMaximumWindows.get(episode.episodeId)!.get(canvas.canvasId)!;
    findings.push({ type: 'heavy-canvas-work', evidenceLevel: 'candidate', canvasId: canvas.canvasId, episodeId: episode.episodeId, canvasApiSelfTimeMs: canvas.canvasApiSelfTimeMs, rasterOperationCount: canvas.rasterOperationCount, topMethods: topMethods(canvas.methodEvidence), maximumWindow: { windowIndex: maximum.windowIndex, timestampMs: maximum.timestampMs, canvasApiSelfTimeMs: maximum.canvasApiSelfTimeMs, rasterOperationCount: maximum.rasterOperationCount, methodEvidence: copyEvidence(maximum.methodEvidence) }, claimBoundary: { ...HEAVY_CANVAS_WORK_CLAIM }, nextCheck: HEAVY_CANVAS_WORK_NEXT_CHECK });
  }
  for (const episode of episodes) {
    const reports = windows.filter(window => window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex);
    for (const canvas of episode.canvases) {
      const canvasReports = reports.filter(window => window.canvasId === canvas.canvasId);
      const repeatedWindows = canvasReports
        .filter(window => window.signatureStatus === 'same' && window.rasterOperationCount >= minRepeatedRasterOps)
        .map(({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }) => ({ windowIndex, timestampMs, rasterOperationCount, canvasApiSelfTimeMs, comparisonGap }));
      if (repeatedWindows.length === 0) continue;
      findings.push({ type: 'repeated-draw-work', evidenceLevel: 'candidate', canvasId: canvas.canvasId, episodeId: episode.episodeId, repeatedWindowCount: repeatedWindows.length, rasterOperationCount: repeatedWindows.reduce((total, window) => total + window.rasterOperationCount, 0), canvasApiSelfTimeMs: rounded(repeatedWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)), repeatedWindows, unknownCoverage: { unknownWindowCount: canvasReports.filter(window => window.signatureStatus === 'unknown').length, activeWindowCount: canvasReports.length }, claimBoundary: { ...REPEATED_DRAW_WORK_CLAIM }, nextCheck: REPEATED_DRAW_WORK_NEXT_CHECK });
    }
  }
  findings.sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs || right.rasterOperationCount - left.rasterOperationCount || left.type.localeCompare(right.type) || left.canvasId.localeCompare(right.canvasId));
  return { episodes, findings };
}

function finish(stopReason: RecordingStopReason): InvestigationSessionV1 | undefined {
  if (state !== 'recording') return undefined;
  setMethodEvidenceCollectionEnabled(false);
  recordingStartOffsets.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  const endedMonotonic = now();
  const derived = episodesAndFindings();
  lastSession = {
    schemaVersion: 1, sessionId, startedAt, endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Number((endedMonotonic - startedMonotonic).toFixed(3))),
    stopReason, canvasScanVersion: '0.3.1', browserFeatures: { monotonicTime: typeof performance !== 'undefined' },
    canvases: summaries(), windows: windows.map(copyWindow), episodes: derived.episodes, findings: derived.findings,
    collectionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128 },
    droppedEntryCounts: { canvasWindowReports: droppedWindows, canvasLifetimes: droppedCanvases },
  };
  state = 'complete';
  notify();
  return copySession(lastSession);
}

export function startRecording(): void {
  if (state === 'recording') return;
  recordingStartWindowIndex = getCurrentWindowIndex();
  recordingStartOffsets = new Map([...records].map(record => [record.canvas, {
    rasterOperationCount: record.rasterOps,
    canvasApiSelfTimeMs: record.selfTimeMs,
  }]));
  setMethodEvidenceCollectionEnabled(true);
  startedAt = new Date().toISOString();
  startedMonotonic = now();
  sessionId = `canvas-scan-${Date.parse(startedAt)}-${++sequence}`;
  windows = [];
  canvasIds = [];
  droppedWindows = 0;
  droppedCanvases = 0;
  state = 'recording';
  unsubscribe = subscribeToReports((report, canvas, metadata) => {
    if (!metadata) return;
    const offset = recordingStartOffsets.get(canvas);
    recordingStartOffsets.delete(canvas);
    const copied = copyReport(report);
    if (offset && metadata.windowIndex === recordingStartWindowIndex + 1) {
      copied.rasterOperationCount = Math.max(0, copied.rasterOperationCount - offset.rasterOperationCount);
      copied.canvasApiSelfTimeMs = rounded(Math.max(0, copied.canvasApiSelfTimeMs - offset.canvasApiSelfTimeMs));
    }
    capture({ ...copied, ...metadata });
  });
  timer = setTimeout(() => { finish('max-duration'); }, MAX_DURATION_MS);
  lastSession = undefined;
  notify();
}

export function configureRecording(options: CanvasScanOptions): void {
  minRepeatedRasterOps = options.minFlashRasterOps ?? 2;
}

export function stopRecording(): InvestigationSessionV1 | undefined { return finish('manual'); }
export function getLastSession(): InvestigationSessionV1 | undefined { return lastSession ? copySession(lastSession) : undefined; }
export function getRecordingState(): RecordingState { return state; }
export function subscribeToRecordingState(listener: (next: RecordingState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRecordingForTests(): void {
  setMethodEvidenceCollectionEnabled(false);
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  state = 'idle';
  lastSession = undefined;
  windows = [];
  canvasIds = [];
  droppedWindows = 0;
  droppedCanvases = 0;
  recordingStartWindowIndex = 0;
  recordingStartOffsets.clear();
  minRepeatedRasterOps = 2;
  sequence = 0;
  listeners.clear();
}
