import { copyReport, subscribeToReports } from './frame-loop';
import type {
  InvestigationSessionV1,
  RecordedCanvasSummary,
  RecordedCanvasWindow,
  RecordingState,
  RecordingStopReason,
} from './types';

const MAX_DURATION_MS = 30000;
const MAX_WINDOWS = 10000;
const MAX_CANVASES = 128;

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
const listeners = new Set<(state: RecordingState) => void>();

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function copyWindow(window: RecordedCanvasWindow): RecordedCanvasWindow {
  return { ...copyReport(window), windowIndex: window.windowIndex, timestampMs: window.timestampMs };
}

function copySession(session: InvestigationSessionV1): InvestigationSessionV1 {
  return {
    ...session,
    browserFeatures: { ...session.browserFeatures },
    canvases: session.canvases.map(canvas => ({
      ...canvas,
      sourceLocation: canvas.sourceLocation ? { ...canvas.sourceLocation } : null,
      commandStatuses: { ...canvas.commandStatuses },
    })),
    windows: session.windows.map(copyWindow),
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
    for (const window of retained) {
      commandStatuses[window.signatureStatus]++;
      rasterOperationCount += window.rasterOperationCount;
      canvasApiSelfTimeMs += window.canvasApiSelfTimeMs;
    }
    return {
      canvasId,
      nearestReactOwner: latest.nearestReactOwner,
      attributionKind: latest.attributionKind,
      sourceLocation: latest.sourceLocation ? { ...latest.sourceLocation } : null,
      activeWindowCount: retained.length,
      rasterOperationCount,
      canvasApiSelfTimeMs: Number(canvasApiSelfTimeMs.toFixed(3)),
      commandStatuses,
    };
  });
}

function finish(stopReason: RecordingStopReason): InvestigationSessionV1 | undefined {
  if (state !== 'recording') return undefined;
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  const endedMonotonic = now();
  lastSession = {
    schemaVersion: 1, sessionId, startedAt, endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Number((endedMonotonic - startedMonotonic).toFixed(3))),
    stopReason, canvasScanVersion: '0.3.1', browserFeatures: { monotonicTime: typeof performance !== 'undefined' },
    canvases: summaries(), windows: windows.map(copyWindow),
    collectionLimits: { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128 },
    droppedEntryCounts: { canvasWindowReports: droppedWindows, canvasLifetimes: droppedCanvases },
  };
  state = 'complete';
  notify();
  return copySession(lastSession);
}

export function startRecording(): void {
  if (state === 'recording') return;
  startedAt = new Date().toISOString();
  startedMonotonic = now();
  sessionId = `canvas-scan-${Date.parse(startedAt)}-${++sequence}`;
  windows = [];
  canvasIds = [];
  droppedWindows = 0;
  droppedCanvases = 0;
  state = 'recording';
  unsubscribe = subscribeToReports((report, _canvas, metadata) => {
    if (!metadata) return;
    capture({ ...copyReport(report), ...metadata });
  });
  timer = setTimeout(() => { finish('max-duration'); }, MAX_DURATION_MS);
  lastSession = undefined;
  notify();
}

export function stopRecording(): InvestigationSessionV1 | undefined { return finish('manual'); }
export function getLastSession(): InvestigationSessionV1 | undefined { return lastSession ? copySession(lastSession) : undefined; }
export function getRecordingState(): RecordingState { return state; }
export function subscribeToRecordingState(listener: (next: RecordingState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRecordingForTests(): void {
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
  sequence = 0;
  listeners.clear();
}
