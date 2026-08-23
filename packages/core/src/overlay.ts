import {
  getHistory,
  getLatestReport,
  latestReports,
  setSourceLocation,
  subscribeToReports,
} from './frame-loop.js';
import {
  getLastSession,
  getLastExplanation,
  getRecordingState,
  startExplanation,
  startRecording,
  stopRecording,
  subscribeToRecordingState,
} from './recording.js';
import { collectCanvasGeometry } from './geometry.js';
import { compareSessions } from './comparison.js';
import { resolveSourceOutcome } from './symbolicate.js';
import type {
  AttributionKind,
  CanvasScanOptions,
  CommandDifference,
  DrawBatchReport,
  ExplanationArtifactV1,
  ExplanationStartResult,
  ExplanationUnknownReason,
  ComparisonArtifactV1,
  ComparisonMeasure,
  ComparisonMeasureId,
  InvestigationFinding,
  InvestigationSessionV1,
  RecordedCanvasGeometry,
  SourceLocation,
} from './types.js';

interface CanvasStats {
  candidate: boolean;
  changed: number;
  kind: AttributionKind;
  latest: DrawBatchReport;
  owner: string | null;
  same: number;
  selfTimeMs: number;
  unknown: number;
  unknownReasons: Map<string, number>;
  windows: number;
}

interface Aggregate {
  changed: number;
  meanSelfTimeMs: number;
  same: number;
  selfTimeMs: number;
  unknown: number;
  unknownReasons: Array<[string, number]>;
  windows: number;
}

type SourceState =
  | { status: 'resolving' }
  | { location: SourceLocation | null; status: 'resolved' };

const stats = new Map<string, CanvasStats>();
const canvases = new Map<string, unknown>();
const outlines = new Map<string, HTMLDivElement>();
const flyoutRows = new Map<string, HTMLButtonElement>();
const findingNodes = new Map<string, HTMLElement>();
const locateTimeouts = new Map<string, number>();
const locatingCanvases = new Set<string>();
const flashAnimationFrames = new Map<string, number>();
const flashTimeouts = new Map<string, number>();
const fadingFlashes = new Set<string>();
const expiredFlashes = new Set<string>();
const sourceStates = new Map<string, SourceState>();
const sourceErrors = new Set<string>();
const pendingFlashes: Array<{
  canvasId: string;
  report: DrawBatchReport;
  same: number;
}> = [];

let host: HTMLDivElement | null = null;
let outlineLayer: HTMLDivElement | null = null;
let dock: HTMLDivElement | null = null;
let toolbar: HTMLDivElement | null = null;
let inspectButton: HTMLButtonElement | null = null;
let countsButton: HTMLButtonElement | null = null;
let recordButton: HTMLButtonElement | null = null;
let stopRecordingButton: HTMLButtonElement | null = null;
let canvasCount: HTMLSpanElement | null = null;
let candidateCount: HTMLSpanElement | null = null;
let flyout: HTMLDivElement | null = null;
let popover: HTMLDivElement | null = null;
let collapsed = false;
let flyoutOpen = false;
let showAllRows = false;
let inspectMode = false;
let selectedCanvasId: string | null = null;
let selectedGeometry: RecordedCanvasGeometry | null = null;
let shownSession: InvestigationSessionV1 | null = null;
let renderedSession: InvestigationSessionV1 | null = null;
let expandedFindingId: string | null = null;
let copySessionStatus = '';
let explanationSelection: { sessionId: string; findingIndex: number; key: string } | null = null;
let explanationRecordingActive = false;
let completedExplanation: ExplanationArtifactV1 | null = null;
let explanationStartFailure = '';
let copyExplanationStatus = '';
let copyExplanationRequest = 0;
let baseline: { findingIndex: number; session: InvestigationSessionV1 } | null = null;
let completedComparison: ComparisonArtifactV1 | null = null;
let copyComparisonStatus = '';
let copyComparisonRequest = 0;
let flyoutInvoker: HTMLElement | null = null;
let showAllSessionCanvases = false;
let minFlashRasterOps = 2;
let refreshInterval: number | null = null;
let survivalInterval: number | null = null;
let commitAnimationFrame: number | null = null;
let dirty = false;
let flyoutRevision = 0;
let renderedFlyoutRevision = -1;
let unsubscribe: (() => void) | null = null;
let unsubscribeRecording: (() => void) | null = null;
let dragStart: { pointerX: number; pointerY: number; x: number; y: number } | null =
  null;
let dragX = 0;
let dragY = 0;
let mountGeneration = 0;

const styles = `
:host { color-scheme: dark; }
button { font: inherit; }
.dock {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  color: #fff;
  font: 11px/16px ui-monospace, monospace;
  pointer-events: none;
}
.outlines {
  position: fixed;
  inset: 0;
  z-index: 1;
  color: #fff;
  font: 11px/16px ui-monospace, monospace;
  pointer-events: none;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 32px;
  padding: 0 4px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  user-select: none;
}
.control {
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
}
.control:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
.control:disabled, .control[aria-disabled="true"] { cursor: default; opacity: 0.45; }
.record.active { background: #ef4444; color: #fff; }
.inspect {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 15px;
}
.inspect.active { background: #ef4444; color: #fff; }
.counts {
  min-height: 24px;
  padding: 0 5px;
  white-space: nowrap;
}
.candidate-count { color: rgba(255, 255, 255, 0.48); }
.candidate-count.accent { color: #ef4444; }
.collapse {
  width: 22px;
  height: 24px;
  padding: 0;
}
.collapsed-dot {
  display: none;
  width: 12px;
  height: 12px;
  margin: 4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.42);
  cursor: pointer;
}
.collapsed-dot.accent { background: #ef4444; }
.toolbar.collapsed {
  min-height: 0;
  padding: 1px;
  border-radius: 50%;
}
.toolbar.collapsed > :not(.collapsed-dot) { display: none; }
.toolbar.collapsed .collapsed-dot { display: block; }
.flyout,
.popover {
  position: absolute;
  right: 0;
  bottom: 40px;
  width: 440px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 5px;
  background: rgba(0, 0, 0, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}
.flyout[hidden],
.popover[hidden] { display: none; }
.row,
.more {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 27px;
  padding: 3px 5px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  text-align: left;
  cursor: pointer;
}
.row:hover,
.more:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
.repeated-finding {
  width: 100%;
  margin: 4px 0;
  padding: 6px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  border-radius: 5px;
  background: rgba(239, 68, 68, 0.08);
  color: rgba(255, 255, 255, 0.78);
  text-align: left;
}
.finding-card { border-color: rgba(255, 255, 255, 0.16); background: transparent; }
.finding-card:focus-visible,
.finding-toggle:focus-visible,
.session-copy:focus-visible,
.current-action:focus-visible,
.explanation-action:focus-visible,
.explanation-copy:focus-visible,
.baseline-action:focus-visible,
.comparison-action:focus-visible,
.comparison-copy:focus-visible,
.canvas-summary:focus-visible { outline: 2px solid #fff; outline-offset: 2px; background: rgba(255, 255, 255, 0.18); }
.finding-heading, .session-heading { color: #fff; font: 12px/16px ui-monospace, monospace; }
.finding-line, .session-line { margin-top: 2px; font: 11px/16px ui-monospace, monospace; }
.session-owner { color: #fff; }
.session-identifier { color: rgba(255, 255, 255, 0.48); }
.finding-actions { display: flex; gap: 4px; margin-top: 5px; }
.finding-toggle, .current-action, .session-copy { border: 1px solid rgba(255,255,255,.16); border-radius: 4px; background: transparent; color: rgba(255,255,255,.72); cursor: pointer; font: inherit; padding: 2px 5px; }
.explanation-action, .explanation-copy { border: 1px solid rgba(255,255,255,.16); border-radius: 4px; background: transparent; color: rgba(255,255,255,.72); cursor: pointer; font: inherit; padding: 2px 5px; }
.explanation-panel { border-top: 1px solid rgba(255,255,255,.1); margin-top: 4px; padding: 6px 5px; }
.explanation-panel.active { border-left: 2px solid #ef4444; }
.explanation-panel.complete { border-left: 2px solid #fff; }
.explanation-panel.failure { border-left: 2px solid rgba(239,68,68,.7); }
.finding-toggle { width: 100%; color: #fff; font: 12px/16px ui-monospace, monospace; text-align: left; }
.finding-evidence[hidden], .finding-actions[hidden], .finding-unavailable[hidden], .session-section[hidden] { display: none; }
.session-section { border-top: 1px solid rgba(255,255,255,.1); margin-top: 4px; padding: 6px 5px; }
.session-header { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center; }
.session-copy-status { grid-column: 1 / -1; color: rgba(255, 255, 255, 0.72); }
.repeated-finding-title { color: #fff; }
.repeated-finding-line { margin-top: 2px; }
.badge {
  flex: 0 0 auto;
  margin-right: 6px;
  padding: 0 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 9px;
  line-height: 14px;
}
.row-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.popover { width: 280px; }
.popover-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 3px 6px;
  color: #fff;
}
.popover-owner {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  width: 20px;
  height: 20px;
  padding: 0;
}
.popover-body {
  padding: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}
.popover-line { min-height: 17px; }
.popover-line[hidden] { display: none; }
.status { white-space: pre-line; }
.note {
  padding: 3px 5px 7px;
  margin-bottom: 3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
}
.copy {
  margin-top: 5px;
  padding: 2px 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.outline {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid #ef4444;
  border-radius: 3px;
  pointer-events: none;
  opacity: 0;
}
.outline.inspect {
  border-width: 1px;
  border-style: dashed;
  cursor: crosshair;
  opacity: 0.4;
}
.outline.inspect:hover,
.outline.selected,
.outline.locate,
.outline.flash { opacity: 1; }
.outline.selected,
.outline.locate,
.outline.flash {
  border-width: 2px;
  border-style: solid;
}
.outline.flash.fading {
  opacity: 0;
  transition: opacity 700ms ease-out 300ms;
}
.outline.inspect.flash.fading { opacity: 0.4; }
.outline .label {
  display: none;
  position: absolute;
  top: -18px;
  left: -2px;
  padding: 1px 5px;
  border-radius: 2px;
  background: #ef4444;
  color: #fff;
  white-space: nowrap;
}
.outline.flash .label { display: block; }
.outline.inspect:hover .label { display: block; }
.outline.inspect.selected .label { display: block; }
`;

// User-facing copy. A beginner reads this while their app is slow, so the
// visible strings avoid the internal vocabulary (window, signature, raster op)
// and the diagnostic reason codes. The precise terms stay in tooltips, and the
// raw codes stay one hover away so a bug report can still quote them.
const EXPLAINER =
  'canvas-scan watches what your app asks each canvas to draw. When a canvas ' +
  'sends repeated commands, that work is a review candidate.';

const UNKNOWN_PHRASES = new Map([
  ['first-window', 'first frame seen — nothing to compare yet'],
  ['previous-window', 'the last frame it was compared with was unclear'],
  ['canvas-reset', 'the canvas was reset'],
  ['canvas-resize', 'the canvas was resized'],
  ['canvas-dimensions-unmodeled', 'the canvas size could not be read'],
  [
    'canvas-attribute-reset',
    'the canvas was resized by a page attribute change',
  ],
  [
    'canvas-state-unmodeled',
    'canvas state changed around a reset detected too late to place',
  ],
  [
    'canvas-source-reset',
    'a source canvas was reset while this canvas was drawing it',
  ],
  [
    'uncaptured-raster',
    'drawing happened in a frame canvas-scan did not capture',
  ],
  ['gradient-mutated', 'a gradient changed while drawing'],
  ['transform-unmodeled', 'a transform canvas-scan cannot follow'],
  ['clip-unmodeled', 'a clipping shape canvas-scan cannot follow'],
  ['path-unmodeled', 'a path canvas-scan cannot follow'],
  ['array-hole', 'a list argument had missing entries'],
  ['array-accessor', 'a list argument computed its values'],
  ['array-element', 'a list argument held values that are not numbers'],
  ['Path2D', 'a shape object canvas-scan did not see built'],
  ['CanvasGradient', 'a gradient canvas-scan did not see built'],
  ['CanvasPattern', 'a pattern — its pixels can change at any time'],
  ['HTMLVideoElement', 'a video — its pixels can change at any time'],
  ['HTMLCanvasElement', 'another canvas that is not being tracked'],
  ['OffscreenCanvas', 'an offscreen canvas — not visible to canvas-scan'],
  ['ImageBitmap', 'an image bitmap — canvas-scan does not read pixels'],
  ['ImageData', 'raw pixel data — canvas-scan does not read pixels'],
]);

const OBJECT_NOUNS = new Map([
  ['Path2D', 'a shape object'],
  ['CanvasGradient', 'a gradient'],
]);

function describeUnknownReason(reason: string): string {
  const phrase = UNKNOWN_PHRASES.get(reason);
  if (phrase) return phrase;
  const separator = reason.indexOf(':');
  if (separator === -1) return `something canvas-scan cannot read (${reason})`;
  const head = reason.slice(0, separator);
  const tail = reason.slice(separator + 1);
  if (tail === 'dirty') {
    return `${OBJECT_NOUNS.get(head) ?? 'an object'} changed after it was built`;
  }
  return `an argument canvas-scan cannot read (${tail})`;
}

function frames(count: number): string {
  return `${count} ${count === 1 ? 'frame' : 'frames'}`;
}

function badgeText(kind: AttributionKind): string {
  if (kind === 'jsx-owner') return 'jsx';
  if (kind === 'direct-host') return 'dh';
  if (kind === 'container-only') return 'co';
  return 'un';
}

const BADGE_TITLES: Record<AttributionKind, string> = {
  'jsx-owner': 'this canvas is written in the component’s JSX',
  'direct-host': 'a canvas with no owning component above it',
  'container-only':
    'a library made this canvas inside the component’s markup, so the owner is the nearest one above it',
  unattributed: 'canvas-scan could not find an owning React component',
};

function badgeTitle(kind: AttributionKind): string {
  return `${BADGE_TITLES[kind]} (${kind})`;
}

function makeBadge(kind: AttributionKind): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.title = badgeTitle(kind);
  badge.textContent = badgeText(kind);
  return badge;
}

function aggregateReports(reports: DrawBatchReport[]): Aggregate {
  let same = 0;
  let changed = 0;
  let unknown = 0;
  let selfTimeMs = 0;
  const unknownReasons = new Map<string, number>();

  for (const report of reports) {
    if (report.signatureStatus === 'same') same++;
    if (report.signatureStatus === 'changed') changed++;
    if (report.signatureStatus === 'unknown') unknown++;
    selfTimeMs += report.canvasApiSelfTimeMs;
    if (report.unknownReason) {
      unknownReasons.set(
        report.unknownReason,
        (unknownReasons.get(report.unknownReason) ?? 0) + 1,
      );
    }
  }

  return {
    changed,
    meanSelfTimeMs: reports.length === 0 ? 0 : selfTimeMs / reports.length,
    same,
    selfTimeMs,
    unknown,
    unknownReasons: [...unknownReasons].sort(
      ([reasonA, countA], [reasonB, countB]) =>
        countB - countA || reasonA.localeCompare(reasonB),
    ),
    windows: reports.length,
  };
}

function getAggregate(canvasId: string): Aggregate {
  const history = getHistory(canvasId);
  if (history.length > 0) return aggregateReports(history);

  const canvasStats = stats.get(canvasId);
  if (!canvasStats) return aggregateReports([]);
  return {
    changed: canvasStats.changed,
    meanSelfTimeMs:
      canvasStats.windows === 0
        ? 0
        : canvasStats.selfTimeMs / canvasStats.windows,
    same: canvasStats.same,
    selfTimeMs: canvasStats.selfTimeMs,
    unknown: canvasStats.unknown,
    unknownReasons: [...canvasStats.unknownReasons].sort(
      ([reasonA, countA], [reasonB, countB]) =>
        countB - countA || reasonA.localeCompare(reasonB),
    ),
    windows: canvasStats.windows,
  };
}

function placeOutline(
  outline: HTMLDivElement,
  canvas: Element,
  requireHitTest = inspectMode,
): boolean {
  if (!canvas.isConnected) {
    outline.hidden = true;
    outline.style.pointerEvents = 'none';
    return false;
  }
  // Only inspect mode makes an outline catch clicks, so only inspect mode needs
  // the hit-testability answer. Asking for it on every flash commit costs a
  // forced style recalculation per outline per frame, which the release bench
  // measures. A flash over a visibility:hidden canvas stays possible; that is
  // cosmetic, and input safety is unaffected.
  if (requireHitTest && !isVisiblyHitTestable(canvas)) {
    outline.hidden = true;
    outline.style.pointerEvents = 'none';
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    outline.hidden = true;
    outline.style.pointerEvents = 'none';
    return false;
  }
  outline.hidden = false;
  outline.style.top = `${rect.top - 2}px`;
  outline.style.left = `${rect.left - 2}px`;
  outline.style.width = `${rect.width + 4}px`;
  outline.style.height = `${rect.height + 4}px`;
  return true;
}

function isVisiblyPlaced(canvas: Element): boolean {
  if (typeof getComputedStyle !== 'function') return true;
  for (let el: Element | null = canvas; el;) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.display === 'none') return false;
    const root = el.getRootNode() as ShadowRoot;
    el = (el as HTMLElement).assignedSlot ?? el.parentElement ?? root.host ?? null;
  }
  return true;
}

function isVisiblyHitTestable(canvas: Element): boolean {
  if (typeof getComputedStyle !== 'function') return true;
  if (!isVisiblyPlaced(canvas)) return false;
  // Computed pointer-events already resolves inheritance, so the canvas's own
  // value is the answer: if the page lets clicks pass through it, our outline
  // must not catch them instead.
  if (getComputedStyle(canvas).pointerEvents === 'none') return false;
  for (let el: Element | null = canvas; el;) {
    const style = getComputedStyle(el);
    // An inert subtree cannot receive input, so neither should our outline.
    if ((el as HTMLElement).inert === true || el.hasAttribute('inert')) {
      return false;
    }
    // Follow the flat tree, not just the DOM parent chain: a slotted canvas is
    // rendered inside its slot, so the slot's ancestors decide whether it can
    // be clicked. Falling back to the shadow host covers the unslotted case.
    const root = el.getRootNode() as ShadowRoot;
    el =
      (el as HTMLElement).assignedSlot ?? el.parentElement ?? root.host ?? null;
  }
  return true;
}

function ensureOutline(
  canvasId: string,
  canvas: Element,
  requireHitTest = inspectMode,
): HTMLDivElement | null {
  if (!outlineLayer) return null;
  let outline = outlines.get(canvasId);
  if (!outline) {
    outline = document.createElement('div');
    outline.className = 'outline';
    outline.dataset.canvasId = canvasId;
    const label = document.createElement('span');
    label.className = 'label';
    outline.append(label);
    outlineLayer.append(outline);
    outlines.set(canvasId, outline);
  }
  return placeOutline(outline, canvas, requireHitTest) ? outline : null;
}

function clearOutline(canvasId: string): void {
  const outline = outlines.get(canvasId);
  if (!outline) return;
  if (
    !inspectMode &&
    !locatingCanvases.has(canvasId) &&
    !outline.classList.contains('flash')
  ) {
    outline.remove();
    outlines.delete(canvasId);
  }
}

function flashOutline(report: DrawBatchReport, canvas: Element, same: number): void {
  const outline = ensureOutline(report.canvasId, canvas);
  if (!outline) return;
  const label = outline.querySelector('.label');
  if (label) {
    label.textContent =
      `${report.nearestReactOwner ?? report.canvasId} · ` +
      `sent the same draw commands again ×${same}`;
  }

  outline.classList.remove('flash', 'fading');
  void outline.offsetWidth;
  outline.classList.add('flash');
  const previousAnimationFrame = flashAnimationFrames.get(report.canvasId);
  if (previousAnimationFrame !== undefined) {
    cancelAnimationFrame(previousAnimationFrame);
  }
  const previousTimeout = flashTimeouts.get(report.canvasId);
  if (previousTimeout !== undefined) window.clearTimeout(previousTimeout);
  flashAnimationFrames.set(report.canvasId, requestAnimationFrame(() => {
    flashAnimationFrames.delete(report.canvasId);
    fadingFlashes.add(report.canvasId);
    flashTimeouts.set(
      report.canvasId,
      window.setTimeout(() => {
        flashTimeouts.delete(report.canvasId);
        expiredFlashes.add(report.canvasId);
        markDirty();
      }, 1000),
    );
    markDirty();
  }));
}

function locateCanvas(canvasId: string): 'located' | 'not-visible' | 'unavailable' {
  const canvas = canvases.get(canvasId);
  if (!(canvas instanceof Element) || !canvas.isConnected) return 'unavailable';
  if (!isVisiblyPlaced(canvas)) return 'not-visible';
  if (!ensureOutline(canvasId, canvas, false)) return 'not-visible';
  locatingCanvases.add(canvasId);
  const currentTimeout = locateTimeouts.get(canvasId);
  if (currentTimeout !== undefined) window.clearTimeout(currentTimeout);
  locateTimeouts.set(
    canvasId,
    window.setTimeout(() => {
      locatingCanvases.delete(canvasId);
      locateTimeouts.delete(canvasId);
      markDirty();
    }, 700),
  );
  markDirty();
  return 'located';
}

function updateInspectOutlines(): void {
  // Placement reads layout and computed style, so each outline is placed at
  // most once per commit and the result is reused below.
  const placements = new Map<string, boolean>();
  for (const [canvasId, canvas] of canvases) {
    if (!(canvas instanceof Element)) continue;
    if (!inspectMode && !locatingCanvases.has(canvasId)) continue;
    placements.set(
      canvasId,
      ensureOutline(canvasId, canvas, inspectMode && !locatingCanvases.has(canvasId)) !== null,
    );
  }

  for (const [canvasId, outline] of outlines) {
    const canvas = canvases.get(canvasId);
    const active = placements.get(canvasId) === true;
    const locating = locatingCanvases.has(canvasId);
    const placed =
      placements.get(canvasId) ??
      (canvas instanceof Element && placeOutline(outline, canvas, inspectMode && !locating));
    const interactive = inspectMode && placed && (!locating || canvas instanceof Element && isVisiblyHitTestable(canvas));
    if (interactive) {
      const label = outline.querySelector('.label');
      if (label && !outline.classList.contains('flash')) {
        label.textContent = stats.get(canvasId)?.owner ?? canvasId;
      }
    }
    outline.classList.toggle('inspect', interactive);
    outline.classList.toggle('selected', canvasId === selectedCanvasId);
    outline.classList.toggle('locate', locating && placed);
    outline.style.pointerEvents = interactive ? 'auto' : 'none';
    if (!placed || !active) clearOutline(canvasId);
  }
}

function closePopover(): void {
  selectedCanvasId = null;
  selectedGeometry = null;
}

function sourceLabel(state: SourceState | undefined, failed: boolean): {
  text: string;
  title: string;
} {
  if (failed) {
    return { text: 'lookup failed — reopen to retry', title: '' };
  }
  if (!state || state.status === 'resolving') {
    return { text: 'resolving…', title: '' };
  }
  if (!state.location) return { text: 'unavailable', title: '' };
  const file = state.location.file;
  const basename = file.split(/[\\/]/).pop() || file;
  return {
    text: `${basename}:${state.location.line}`,
    title: `${file}:${state.location.line}:${state.location.column}`,
  };
}

function copyPopoverJson(canvasId: string): void {
  const canvasStats = stats.get(canvasId);
  if (!canvasStats) return;
  // Prefer the canonical report (it carries a source resolved after this canvas
  // last drew), but never copy less than the popover is showing: retention can
  // evict the canonical entry while the popover still displays the location.
  const latest = getLatestReport(canvasId) ?? canvasStats.latest;
  const state = sourceStates.get(canvasId);
  const shown = state?.status === 'resolved' ? state.location : null;
  const payload = JSON.stringify({
    latest: { ...latest, sourceLocation: latest.sourceLocation ?? shown },
    aggregates: getAggregate(canvasId),
    geometry: selectedGeometry ? { ...selectedGeometry } : null,
  });
  try {
    const copied = navigator.clipboard?.writeText(payload);
    void copied?.catch(() => {});
  } catch {}
}

function renderPopover(): void {
  if (!popover) return;
  popover.hidden = selectedCanvasId === null;
  if (!selectedCanvasId) return;
  const canvasStats = stats.get(selectedCanvasId);
  if (!canvasStats) {
    closePopover();
    popover.hidden = true;
    return;
  }
  const canvasId = selectedCanvasId;
  const aggregate = getAggregate(canvasId);
  const badge = popover.querySelector<HTMLElement>('.popover-badge');
  if (badge) {
    badge.title = badgeTitle(canvasStats.kind);
    badge.textContent = badgeText(canvasStats.kind);
  }
  const owner = popover.querySelector<HTMLElement>('.popover-owner');
  if (owner) owner.textContent = canvasStats.owner ?? canvasId;
  const status = popover.querySelector<HTMLElement>('.status');
  if (status) {
    status.textContent =
      `${frames(aggregate.windows)} seen\n` +
      `same ${aggregate.same} · changed ${aggregate.changed} · ` +
      `unclear ${aggregate.unknown}`;
    status.title = 'how the draw commands compared with the frame before';
  }
  const rasterOps = popover.querySelector<HTMLElement>('.raster-ops');
  if (rasterOps) {
    rasterOps.textContent =
      `${canvasStats.latest.rasterOperationCount} draw calls in the last frame`;
    rasterOps.title = 'operations that can change pixels';
  }
  const selfTime = popover.querySelector<HTMLElement>('.self-time');
  if (selfTime) {
    selfTime.textContent =
      `${aggregate.meanSelfTimeMs.toFixed(1)} ms in canvas calls per frame`;
    selfTime.title =
      'average JavaScript time spent calling canvas functions — not GPU time';
  }
  const sampling = popover.querySelector<HTMLElement>('.sampling');
  if (sampling) {
    // Sampling mechanics only earn a line when sampling is actually on.
    sampling.hidden = !canvasStats.latest.sampled;
    const gap = canvasStats.latest.comparisonGap;
    sampling.textContent =
      'checked every few frames' +
      (gap === null ? '' : ` (last check ${frames(gap)} apart)`);
    sampling.title = 'canvas-scan is sampling, so some frames are not compared';
  }
  const unknownReasons = popover.querySelector<HTMLElement>('.unknown-reasons');
  if (unknownReasons) {
    unknownReasons.hidden = aggregate.unknownReasons.length === 0;
    unknownReasons.replaceChildren(
      ...aggregate.unknownReasons.slice(0, 3).map(([reason, count]) => {
        const line = document.createElement('div');
        // The raw code stays reachable for bug reports.
        line.title = reason;
        line.textContent =
          `${frames(count)} unclear: ${describeUnknownReason(reason)}`;
        return line;
      }),
    );
  }

  const source = popover.querySelector<HTMLElement>('.source');
  const label = sourceLabel(
    sourceStates.get(canvasId),
    sourceErrors.has(canvasId),
  );
  if (source) {
    source.textContent = `source: ${label.text}`;
    source.title = label.title;
  }
  const geometry = popover.querySelector<HTMLElement>('.geometry');
  if (geometry) {
    geometry.textContent = !selectedGeometry ? 'geometry: unavailable' : selectedGeometry.unavailableReason
      ? `geometry: ${selectedGeometry.unavailableReason}`
      : `geometry: ${selectedGeometry.backingWidth}×${selectedGeometry.backingHeight} backing · ${selectedGeometry.cssWidth}×${selectedGeometry.cssHeight} CSS · ${selectedGeometry.actualToExpectedAreaRatio}× expected area`;
  }
}

function openPopover(canvasId: string): void {
  const canvasStats = stats.get(canvasId);
  if (!canvasStats) return;
  selectedCanvasId = canvasId;
  selectedGeometry = collectCanvasGeometry(canvases.get(canvasId));
  flyoutOpen = false;
  flyoutRevision++;

  // Retry when the last answer was "unavailable": that is usually a sourcemap
  // that was not ready yet, and the user reopening the popover is a request to
  // ask again. A resolved location is kept.
  const known = sourceStates.get(canvasId);
  if (!known || (known.status === 'resolved' && known.location === null)) {
    sourceErrors.delete(canvasId);
    sourceStates.set(canvasId, { status: 'resolving' });
    const canvas = canvases.get(canvasId);
    const generation = mountGeneration;
    void resolveSourceOutcome(canvas).then((outcome) => {
      if (!host || mountGeneration !== generation) return;
      // Retention can evict this canvas while the lookup is in flight. Writing
      // a source state back for a canvas the overlay has already pruned would
      // create an entry nothing prunes again.
      if (!stats.has(canvasId)) return;
      if (outcome.kind === 'error') {
        sourceStates.delete(canvasId);
        sourceErrors.add(canvasId);
        markDirty();
        return;
      }
      const location = outcome.kind === 'found' ? outcome.location : null;
      sourceErrors.delete(canvasId);
      sourceStates.set(canvasId, { location, status: 'resolved' });
      setSourceLocation(canvasId, location);
      markDirty();
    });
  }
  markDirty();
}

function findingLabel(type: InvestigationFinding['type']): string {
  return { 'heavy-canvas-work': 'Concentrated canvas work', 'repeated-draw-work': 'Repeated draw commands', 'resize-churn': 'Resets during active work', 'backing-store-mismatch': 'Large canvas backing store' }[type];
}

function findingEpisodeIds(finding: InvestigationFinding): string[] {
  return finding.type === 'resize-churn' || finding.type === 'backing-store-mismatch'
    ? finding.affectedEpisodeIds
    : [finding.episodeId];
}

function findingKey(finding: InvestigationFinding): string {
  return `${finding.type}:${finding.canvasId}:${findingEpisodeIds(finding).join(',')}`;
}

function lifecycleEndsRetired(
  session: InvestigationSessionV1,
  canvasId: string,
): boolean {
  const events = session.lifecycleEvents.filter(event => event.canvasId === canvasId);
  return events.at(-1)?.type === 'retired';
}

function appendLine(card: HTMLElement, label: string, text: string): void {
  const line = document.createElement('div');
  line.className = 'finding-line';
  line.textContent = label ? `${label}: ${text}` : text;
  card.append(line);
}

function findingMeasurements(finding: InvestigationFinding): string[] {
  if (finding.type === 'heavy-canvas-work') return [
    `Canvas2D API self-time: ${finding.canvasApiSelfTimeMs} ms`, `Raster operations: ${finding.rasterOperationCount}`,
    `Maximum frame: ${finding.maximumWindow.canvasApiSelfTimeMs} ms, ${finding.maximumWindow.rasterOperationCount} raster operations${finding.maximumWindow.followsCanvasReset ? ', after canvas reset' : ''}`,
    `Top methods: ${finding.topMethods.map(method => `${method.method} ${method.count} ${method.canvasApiSelfTimeMs ?? 'unknown'} ms`).join(', ')}`,
    `Gate distance: ${finding.gateExcessMs} ms above the ${finding.gateThresholdMs} ms threshold`,
  ];
  if (finding.type === 'repeated-draw-work') return [`${finding.repeatedWindowCount} repeated frames`, `Repeated raster operations: ${finding.rasterOperationCount}`, `Canvas2D API self-time: ${finding.canvasApiSelfTimeMs} ms`, `Comparison gaps: ${finding.repeatedWindows.map(window => window.comparisonGap ?? 'none').join(', ')}`, `StrictMode-style consecutive duplicates: ${finding.strictModeStyleDuplicates}`];
  if (finding.type === 'resize-churn') {
    const resets = finding.resetEvents.slice(0, 3).map(event => `${event.source} (${event.width ?? 'unknown'}×${event.height ?? 'unknown'})`).join(', ');
    return [`${finding.activeResetCount} active resets of ${finding.observedResetCount} observed resets`, `Resets: ${finding.resetEvents.length > 3 ? `${resets}, +${finding.resetEvents.length - 3} more` : resets}`, `Affected episodes: ${finding.affectedEpisodeIds.join(', ') || 'none'}`, `Command statuses: same ${finding.commandStatuses.same}, changed ${finding.commandStatuses.changed}, unknown ${finding.commandStatuses.unknown}`, `Dimension changes: changed ${finding.dimensionChanges.changed}, unchanged ${finding.dimensionChanges.unchanged}, unavailable ${finding.dimensionChanges.unavailable}`, `Unknown reasons: ${Object.entries(finding.unknownReasons).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'none'}`, `Canvas2D API self-time: ${finding.canvasApiSelfTimeMs} ms`, `Raster operations: ${finding.rasterOperationCount}`];
  }
  return [`${finding.affectedWindowCount} affected frames`, ...finding.affectedWindows.map(window => `Actual ${window.backingWidth}×${window.backingHeight}; expected ${window.expectedBackingWidth}×${window.expectedBackingHeight}; area ratio ${window.actualToExpectedAreaRatio}`), `Canvas2D API self-time: ${finding.canvasApiSelfTimeMs} ms`, `Raster operations: ${finding.rasterOperationCount}`];
}

function findingWindows(
  session: InvestigationSessionV1,
  finding: InvestigationFinding,
) {
  const episodes = session.episodes.filter(episode =>
    findingEpisodeIds(finding).includes(episode.episodeId));
  return session.windows.filter(window =>
    window.canvasId === finding.canvasId && episodes.some(episode =>
      window.windowIndex >= episode.firstWindowIndex &&
      window.windowIndex <= episode.lastWindowIndex));
}

function findingUnknowns(
  session: InvestigationSessionV1,
  finding: InvestigationFinding,
): { active: number; reasons: Record<string, number>; unknown: number } {
  if (finding.type === 'repeated-draw-work') {
    const reasons: Record<string, number> = {};
    for (const window of findingWindows(session, finding)) {
      if (window.unknownReason) reasons[window.unknownReason] = (reasons[window.unknownReason] ?? 0) + 1;
    }
    return { active: finding.unknownCoverage.activeWindowCount, reasons, unknown: finding.unknownCoverage.unknownWindowCount };
  }
  if (finding.type === 'resize-churn') {
    return {
      active: Object.values(finding.commandStatuses).reduce((total, count) => total + count, 0),
      reasons: finding.unknownReasons,
      unknown: finding.commandStatuses.unknown,
    };
  }
  const windows = findingWindows(session, finding);
  const reasons: Record<string, number> = {};
  for (const window of windows) {
    if (window.unknownReason) reasons[window.unknownReason] = (reasons[window.unknownReason] ?? 0) + 1;
  }
  return {
    active: windows.length,
    reasons,
    unknown: windows.filter(window => window.signatureStatus === 'unknown').length,
  };
}

function droppedEntries(session: InvestigationSessionV1): Array<[string, number]> {
  return Object.entries(session.droppedEntryCounts).filter(([, count]) => count > 0);
}

const explanationStartCopy: Record<Exclude<ExplanationStartResult, { status: 'started' } | { status: 'already-active' }>['reason'], string> = {
  'no-session': 'Explain next interaction cannot start because the saved recording changed. Select a finding from the current saved recording.',
  'session-mismatch': 'Explain next interaction cannot start because the saved recording changed. Select the finding again.',
  'finding-not-found': 'Explain next interaction cannot start because the selected finding changed. Select a current finding.',
  'canvas-unavailable': 'Explain next interaction cannot start because the recorded canvas is not available. Saved evidence remains available.',
  'recording-active': 'Explain next interaction cannot start while a recording is active. Stop the recording first.',
  'instrumentation-disabled': 'Explain next interaction cannot start because canvas-scan instrumentation is unavailable. Reload the page before you try again.',
};

const differenceCopy: Record<CommandDifference['reason'], string> = {
  'operation-kind': 'The command operation kind changed.',
  'operation-name': 'The command operation name changed.',
  'argument-count': 'The command argument count changed.',
  'argument-kind': 'A command argument kind changed.',
  'argument-token': 'A normalized command argument changed.',
  'command-added': 'A command was added.',
  'command-removed': 'A command was removed.',
};

const explanationUnknownCopy: Record<ExplanationUnknownReason, string> = {
  'unsupported-value': 'Canvas-scan cannot safely compare an unsupported command value.',
  'argument-limit': 'Canvas-scan reached the argument collection limit.',
  'value-token-limit': 'Canvas-scan reached the value token limit.',
  'command-limit': 'Canvas-scan reached the command collection limit.',
  'window-limit': 'Canvas-scan reached the active window limit.',
  'sampling-gap': 'Canvas-scan found a sampling gap.',
  'missing-reference': 'No two active captured frames were available to compare.',
  'instrumentation-disabled': 'Canvas-scan instrumentation became unavailable.',
};

function appendExplanationLine(root: HTMLElement, text: string, title?: string): void {
  const line = document.createElement('div');
  line.className = 'finding-line';
  line.textContent = text;
  if (title) line.title = title;
  root.append(line);
}

function commandSummary(command: CommandDifference['reference']): string {
  if (!command) return 'No command exists at this ordinal.';
  return `${command.operationKind} ${command.name} · ${command.argumentCount} arguments · ${command.arguments.map(argument => argument.kind).join(', ') || 'none'}`;
}

function selectedComparison(artifact: ExplanationArtifactV1) {
  if (artifact.firstDifference) return artifact.comparisons.find(comparison => comparison.difference?.ordinal === artifact.firstDifference?.ordinal && comparison.difference?.reason === artifact.firstDifference?.reason) ?? artifact.comparisons.find(comparison => comparison.status === 'changed');
  return artifact.comparisons.at(-1);
}

function copySession(session: InvestigationSessionV1): InvestigationSessionV1 {
  return JSON.parse(JSON.stringify(session)) as InvestigationSessionV1;
}

function comparisonMeasureLabel(id: ComparisonMeasureId): string {
  const labels: Record<Exclude<ComparisonMeasureId, `method:${string}:operation-count` | `method:${string}:self-time-ms`>, string> = {
    'active-window-count': 'Active window count', 'raster-operation-count': 'Raster operation count',
    'canvas-api-self-time-ms': 'Canvas2D API self-time', 'maximum-window-self-time-ms': 'Maximum window Canvas2D API self-time',
    'unknown-command-window-count': 'Unknown command window count', 'heavy-episode-operation-count': 'Heavy episode operation count',
    'heavy-episode-self-time-ms': 'Heavy episode Canvas2D API self-time', 'repeated-window-count': 'Repeated window count',
    'repeated-raster-operation-count': 'Repeated raster operation count', 'comparison-gap-count': 'Comparison gap count',
    'active-reset-count': 'Active reset count', 'observed-reset-count': 'Observed reset count', 'affected-episode-count': 'Affected episode count',
    'same-command-window-count': 'Same command window count', 'changed-command-window-count': 'Changed command window count',
    'affected-backing-window-count': 'Affected backing window count', 'maximum-backing-area-ratio': 'Maximum backing area ratio',
  };
  if (id.startsWith('method:')) {
    const [, method, kind] = id.split(':');
    return `${method} ${kind === 'operation-count' ? 'operation count' : 'Canvas2D API self-time'}`;
  }
  return labels[id as Exclude<ComparisonMeasureId, `method:${string}:operation-count` | `method:${string}:self-time-ms`>];
}

function comparisonDirection(measure: ComparisonMeasure): string {
  if (measure.interpretation === 'structural') return measure.direction;
  return ({ increased: 'higher in this pair', decreased: 'lower in this pair', unchanged: 'equal in this pair', unknown: 'unknown in this pair' } as const)[measure.direction];
}

function updateComparisonPanel(): void {
  const panel = flyout?.querySelector<HTMLElement>('.comparison-panel');
  if (!panel) return;
  const signature = `${baseline?.session.sessionId ?? ''}:${baseline?.findingIndex ?? ''}:${completedComparison?.comparisonId ?? ''}`;
  if (panel.dataset.signature === signature) {
    const status = panel.querySelector<HTMLElement>('.comparison-copy-status');
    if (status) status.textContent = copyComparisonStatus;
    return;
  }
  panel.dataset.signature = signature;
  panel.replaceChildren();
  if (baseline) {
    const finding = baseline.session.findings[baseline.findingIndex];
    appendExplanationLine(panel, 'BASELINE KEPT');
    appendExplanationLine(panel, `Session: ${baseline.session.sessionId}`);
    if (finding) appendExplanationLine(panel, `Finding ${baseline.findingIndex + 1}: ${findingLabel(finding.type)}`);
  }
  const artifact = completedComparison;
  if (!artifact) return;
  appendExplanationLine(panel, 'COMPARISON COMPLETE');
  appendExplanationLine(panel, `Baseline: Session ${artifact.baseline.sessionId} · Finding ${artifact.baseline.findingIndex + 1}: ${artifact.baseline.findingType ? findingLabel(artifact.baseline.findingType) : 'Selected finding'}`);
  appendExplanationLine(panel, `Candidate: Session ${artifact.candidate.sessionId} · Finding ${artifact.candidate.findingIndex + 1}: ${artifact.candidate.findingType ? findingLabel(artifact.candidate.findingType) : 'Selected finding'}`);
  appendExplanationLine(panel, 'Pairing: user-selected');
  appendExplanationLine(panel, 'Canvas IDs and owner names are session-local labels and were not used to pair the findings.');
  appendExplanationLine(panel, `Comparison status: ${artifact.status}`);
  appendExplanationLine(panel, 'One selected pair does not establish a performance improvement.');
  appendExplanationLine(panel, 'improvementEstablished: false');
  if (artifact.status === 'comparable') {
    for (const measure of artifact.measures) appendExplanationLine(panel, `${comparisonMeasureLabel(measure.id)}: baseline ${measure.baseline} · candidate ${measure.candidate} · delta ${measure.delta} · ${measure.unit} · ${comparisonDirection(measure)} · ${measure.interpretation}`);
  } else for (const reason of artifact.incomparableReasons) appendExplanationLine(panel, `Incomparable reason: ${reason}`);
  const copy = document.createElement('button');
  copy.className = 'comparison-copy'; copy.type = 'button'; copy.dataset.action = 'copy-comparison'; copy.textContent = 'Copy comparison JSON';
  const status = document.createElement('div');
  status.className = 'comparison-copy-status'; status.setAttribute('aria-live', 'polite'); status.textContent = copyComparisonStatus;
  panel.append(copy, status);
}

function updateExplanationPanel(): void {
  const panel = flyout?.querySelector<HTMLElement>('.explanation-panel');
  if (!panel) return;
  const signature = [
    explanationSelection?.sessionId ?? '',
    explanationSelection?.findingIndex ?? '',
    getRecordingState(),
    completedExplanation?.explanationId ?? '',
    explanationStartFailure,
  ].join(':');
  if (panel.dataset.signature === signature) {
    const copyStatus = panel.querySelector<HTMLElement>('.explanation-copy-status');
    if (copyStatus) copyStatus.textContent = copyExplanationStatus;
    return;
  }
  panel.dataset.signature = signature;
  panel.replaceChildren();
  panel.className = 'explanation-panel';
  const selection = explanationSelection;
  if (selection && getRecordingState() === 'recording') {
    panel.classList.add('active');
    const finding = shownSession?.findings[selection.findingIndex];
    appendExplanationLine(panel, 'EXPLANATION ACTIVE');
    appendExplanationLine(panel, `Finding ${selection.findingIndex + 1}: ${finding ? findingLabel(finding.type) : 'Selected finding'}`);
    appendExplanationLine(panel, 'Repeat the interaction now. Capture stops after 10 seconds.');
    appendExplanationLine(panel, 'The toolbar Stop button ends capture now.');
    return;
  }
  if (completedExplanation) {
    panel.classList.add('complete');
    const artifact = completedExplanation;
    const comparison = selectedComparison(artifact);
    appendExplanationLine(panel, 'EXPLANATION COMPLETE');
    appendExplanationLine(panel, `Source finding: ${artifact.source.findingIndex + 1} · ${findingLabel(artifact.source.findingType)}`);
    appendExplanationLine(panel, `Stop reason: ${artifact.stopReason}`);
    const status = comparison?.status ?? 'unknown';
    appendExplanationLine(panel, `Command result: ${status}`);
    if (status === 'changed' && artifact.firstDifference) {
      const difference = artifact.firstDifference;
      appendExplanationLine(panel, 'First normalized command difference');
      appendExplanationLine(panel, `Command ${difference.ordinal}: ${differenceCopy[difference.reason]}`, difference.reason);
      appendExplanationLine(panel, `Reference command: ${commandSummary(difference.reference)}`);
      appendExplanationLine(panel, `Target command: ${commandSummary(difference.target)}`);
    } else if (status === 'same' && comparison) {
      appendExplanationLine(panel, 'No normalized command difference was observed.');
      const reference = artifact.windows.find(window => window.windowIndex === comparison.referenceWindowIndex);
      const target = artifact.windows.find(window => window.windowIndex === comparison.targetWindowIndex);
      appendExplanationLine(panel, `Compared windows: ${comparison.referenceWindowIndex} (${reference?.commands.length ?? 0} commands) and ${comparison.targetWindowIndex} (${target?.commands.length ?? 0} commands).`);
    } else {
      appendExplanationLine(panel, 'Command difference is unknown.');
      const reason = comparison?.unknownReason ?? artifact.firstGap?.reason ?? 'missing-reference';
      appendExplanationLine(panel, `Unknown reason: ${reason}`);
      appendExplanationLine(panel, explanationUnknownCopy[reason]);
      if (comparison) appendExplanationLine(panel, `Compared windows: ${comparison.referenceWindowIndex} and ${comparison.targetWindowIndex}.`);
    }
    appendExplanationLine(panel, `Compared frame indices: ${comparison ? `${comparison.referenceWindowIndex} and ${comparison.targetWindowIndex}` : 'none'}`);
    appendExplanationLine(panel, 'Draw callsite');
    if (!artifact.stacks.length) appendExplanationLine(panel, 'No bounded draw callsite was captured.');
    for (const sample of artifact.stacks) {
      appendExplanationLine(panel, sample.reason === 'first-raster' ? 'First selected raster' : 'First command difference');
      appendExplanationLine(panel, `Window ${sample.windowIndex}, command ${sample.commandOrdinal}`);
      for (const frame of sample.frames) {
        if (frame.functionName) appendExplanationLine(panel, `callsite ${frame.functionName}`);
        if (frame.mapped) appendExplanationLine(panel, `mapped ${frame.mapped.file}:${frame.mapped.line}:${frame.mapped.column}`);
        if (frame.generated) appendExplanationLine(panel, `generated ${frame.generated.file}:${frame.generated.line}:${frame.generated.column}`);
        appendExplanationLine(panel, frame.mappingStatus);
        if (frame.mappingStatus === 'unresolved') appendExplanationLine(panel, `unresolved ${frame.unresolvedReason}`);
      }
      if (sample.droppedFrameCount) appendExplanationLine(panel, `Dropped frames: ${sample.droppedFrameCount}`);
    }
    appendExplanationLine(panel, `Limits: ${Object.entries(artifact.collectionLimits).map(([name, value]) => `${name}=${value}`).join(' · ')}`);
    const drops = Object.entries(artifact.droppedEntryCounts).filter(([, value]) => value > 0);
    appendExplanationLine(panel, `Drops: ${drops.length ? drops.map(([name, value]) => `${name}=${value}`).join(' · ') : 'none'}`);
    appendExplanationLine(panel, 'Explanation limits');
    for (const limit of artifact.limitResults) {
      const coordinate = limit.firstAffected ? `${limit.firstAffected.scope}:${limit.firstAffected.windowIndex ?? 'none'}:${limit.firstAffected.commandOrdinal ?? 'none'}` : 'none';
      appendExplanationLine(panel, `${limit.name}: maximum=${limit.maximum}, rejected=${limit.rejectedCount}, reason=${limit.reason ?? 'none'}, first=${coordinate}`);
    }
    appendExplanationLine(panel, `Callsite coverage: ${artifact.callsiteCoverage.status}`);
    if (artifact.callsiteCoverage.incompleteReasons.length) appendExplanationLine(panel, `Callsite limits: ${artifact.callsiteCoverage.incompleteReasons.join(', ')}`);
    if (artifact.firstGap) appendExplanationLine(panel, `First gap: window ${artifact.firstGap.windowIndex}, command ${artifact.firstGap.commandOrdinal ?? 'none'} (${artifact.firstGap.reason})`);
    const copy = document.createElement('button');
    copy.className = 'explanation-copy'; copy.type = 'button'; copy.dataset.action = 'copy-explanation'; copy.textContent = 'Copy explanation JSON';
    const copyStatus = document.createElement('div');
    copyStatus.className = 'explanation-copy-status'; copyStatus.setAttribute('aria-live', 'polite'); copyStatus.textContent = copyExplanationStatus;
    panel.append(copy, copyStatus);
    return;
  }
  if (explanationStartFailure) {
    panel.classList.add('failure');
    appendExplanationLine(panel, explanationStartFailure);
  }
}

function createFinding(
  session: InvestigationSessionV1,
  finding: InvestigationFinding,
  index: number,
): HTMLElement {
  const episodes = findingEpisodeIds(finding);
  const key = findingKey(finding);
  const id = `canvas-scan-finding-${key.replaceAll(':', '-')}`;
  const card = document.createElement('section');
  card.className = 'repeated-finding finding-card';
  card.dataset.canvasId = finding.canvasId;
  card.dataset.findingId = key;
  card.dataset.sessionId = session.sessionId;
  card.dataset.findingIndex = String(index);
  card.id = id;

  const control = document.createElement('button');
  control.className = 'finding-toggle';
  control.type = 'button';
  control.dataset.findingId = key;
  control.setAttribute('aria-controls', `${id}-evidence`);
  control.textContent = `${index + 1}  ${findingLabel(finding.type)} · Review candidate — inspect evidence`;
  card.append(control);

  const identifiers = document.createElement('div');
  identifiers.className = 'finding-line session-identifier';
  identifiers.textContent = `Episode ID: ${episodes.join(', ') || 'none'}`;
  card.append(identifiers);

  const evidence = document.createElement('div');
  evidence.className = 'finding-evidence';
  evidence.id = `${id}-evidence`;
  const associations = session.episodeAssociations.filter(item => episodes.includes(item.episodeId));
  for (const association of associations.slice(0, 3)) {
    const entry = session.browserEntries.find(item => item.entryId === association.entryId);
    const label = entry?.kind === 'user-mark' ? ` ${entry.label}` : '';
    appendLine(evidence, '', `${entry?.kind ?? association.entryKind}${label} associated with Episode ${association.episodeId} · overlapped ${association.startedAtTimestampMs.toFixed(1)}–${association.endedAtTimestampMs.toFixed(1)} ms`);
  }
  if (associations.length > 3) appendLine(evidence, '', `+${associations.length - 3} more associations`);

  appendLine(evidence, 'Observed', finding.claimBoundary.observation);
  for (const line of findingMeasurements(finding)) appendLine(evidence, '', line);
  appendLine(evidence, 'Explanation', finding.claimBoundary.explanation);
  appendLine(evidence, 'Does not establish', finding.claimBoundary.nonEstablishedFacts);
  const unknown = findingUnknowns(session, finding);
  appendLine(evidence, 'Unknown coverage', `${unknown.unknown} of ${unknown.active} active frames`);
  const limits = droppedEntries(session);
  if (limits.length) {
    appendLine(evidence, 'Collection limit', limits.map(([name, count]) => `droppedEntryCounts.${name}=${count}`).join(' · '));
  }
  appendLine(evidence, 'Next check', finding.nextCheck);

  if (lifecycleEndsRetired(session, finding.canvasId)) {
    const retired = document.createElement('div');
    retired.className = 'finding-line finding-retired';
    retired.textContent = 'The recorded canvas retired during the saved recording. Saved evidence remains available.';
    evidence.append(retired);
  }
  const unavailable = document.createElement('div');
  unavailable.className = 'finding-line finding-unavailable';
  unavailable.textContent = 'Capture cannot start because the canvas is not on the page. Saved evidence remains available.';
  evidence.append(unavailable);

  const actions = document.createElement('div');
  actions.className = 'finding-actions';
  for (const [actionName, text] of [['inspect-current', 'Inspect current canvas'], ['locate-current', 'Locate current canvas']] as const) {
    const action = document.createElement('button');
    action.className = 'current-action';
    action.type = 'button';
    action.dataset.action = actionName;
    action.dataset.canvasId = finding.canvasId;
    action.textContent = text;
    actions.append(action);
  }
  evidence.append(actions);
  const explanation = document.createElement('button');
  explanation.className = 'explanation-action';
  explanation.type = 'button';
  explanation.dataset.action = 'start-explanation';
  explanation.dataset.sessionId = session.sessionId;
  explanation.dataset.findingIndex = String(index);
  explanation.textContent = 'Explain next interaction';
  evidence.append(explanation);
  const baselineAction = document.createElement('button');
  baselineAction.className = 'baseline-action'; baselineAction.type = 'button'; baselineAction.dataset.action = 'keep-baseline';
  baselineAction.dataset.sessionId = session.sessionId; baselineAction.dataset.findingIndex = String(index);
  evidence.append(baselineAction);
  const comparisonAction = document.createElement('button');
  comparisonAction.className = 'comparison-action'; comparisonAction.type = 'button'; comparisonAction.dataset.action = 'compare-baseline';
  comparisonAction.dataset.sessionId = session.sessionId; comparisonAction.dataset.findingIndex = String(index); comparisonAction.textContent = 'Compare with baseline';
  evidence.append(comparisonAction);
  const status = document.createElement('div');
  status.className = 'finding-line finding-status';
  status.setAttribute('aria-live', 'polite');
  evidence.append(status);

  card.append(evidence);
  findingNodes.set(key, card);
  return card;
}

function updateFinding(session: InvestigationSessionV1, finding: InvestigationFinding, index: number): void {
  const card = findingNodes.get(findingKey(finding));
  if (!card) return;
  const expanded = expandedFindingId === findingKey(finding);
  const control = card.querySelector<HTMLButtonElement>('.finding-toggle');
  const evidence = card.querySelector<HTMLElement>('.finding-evidence');
  if (control) control.setAttribute('aria-expanded', String(expanded));
  if (evidence) evidence.hidden = !expanded;
  const live = canvases.get(finding.canvasId);
  const connected = live instanceof Element && live.isConnected;
  const actions = card.querySelector<HTMLElement>('.finding-actions');
  const unavailable = card.querySelector<HTMLElement>('.finding-unavailable');
  const explanation = card.querySelector<HTMLButtonElement>('.explanation-action');
  if (actions) actions.hidden = !connected;
  if (unavailable) unavailable.hidden = connected;
  if (explanation) {
    explanation.hidden = !connected;
    explanation.disabled = getRecordingState() === 'recording';
    const selected = getRecordingState() === 'recording' && explanationSelection?.key === findingKey(finding);
    explanation.setAttribute('aria-pressed', String(selected));
  }
  const baselineAction = card.querySelector<HTMLButtonElement>('.baseline-action');
  const comparisonAction = card.querySelector<HTMLButtonElement>('.comparison-action');
  const selectedBaseline = baseline?.session.sessionId === session.sessionId && baseline.findingIndex === index;
  if (baselineAction) {
    baselineAction.textContent = selectedBaseline ? 'Baseline kept' : baseline ? 'Replace baseline' : 'Keep as baseline';
    if (selectedBaseline) baselineAction.setAttribute('aria-pressed', 'true'); else baselineAction.removeAttribute('aria-pressed');
  }
  if (comparisonAction) comparisonAction.hidden = !baseline || selectedBaseline || session.sessionId === baseline.session.sessionId || finding.type !== baseline.session.findings[baseline.findingIndex]?.type;
}

function coverageLabel(name: string): string {
  return ({
    canvasWindowReports: 'canvas frame reports',
    canvasLifetimes: 'canvas lifetimes',
    resetEvents: 'reset events',
    lifecycleEvents: 'lifecycle events',
    documentEvents: 'document events',
    eventTiming: 'Event Timing entries',
    userMarks: 'user marks',
    longAnimationFrames: 'Long Animation Frame entries',
  } as Record<string, string>)[name] ?? name;
}

function createSessionView(session: InvestigationSessionV1): HTMLElement {
  if (session.findings.length && expandedFindingId === null) expandedFindingId = findingKey(session.findings[0]);
  const root = document.createElement('div');
  root.className = 'completed-session';
  const header = document.createElement('div');
  header.className = 'session-section session-header';
  const heading = document.createElement('div');
  heading.className = 'session-heading';
  heading.textContent = 'SAVED RECORDING';
  const copy = document.createElement('button');
  copy.className = 'session-copy';
  copy.type = 'button';
  copy.dataset.action = 'copy-session';
  copy.textContent = 'Copy session JSON';
  const download = document.createElement('button');
  download.className = 'session-copy';
  download.type = 'button';
  download.dataset.action = 'download-session';
  download.textContent = 'Download session JSON';
  const copyStatus = document.createElement('div');
  copyStatus.className = 'session-copy-status';
  copyStatus.setAttribute('aria-live', 'polite');
  header.append(heading, copy, download, copyStatus);
  root.append(header);

  const coverage = document.createElement('div');
  coverage.className = 'session-section session-coverage';
  if (!session.browserFeatures.eventTiming) appendLine(coverage, '', 'This browser did not provide Event Timing. Canvas-scan still recorded supported document events. browserFeatures.eventTiming=false');
  if (!session.browserFeatures.longAnimationFrames) appendLine(coverage, '', 'This browser did not provide Long Animation Frame entries. browserFeatures.longAnimationFrames=false');
  for (const [name, count] of droppedEntries(session)) {
    appendLine(coverage, 'Coverage', `${count} ${coverageLabel(name)} were dropped (droppedEntryCounts.${name}=${count}).`);
  }
  coverage.hidden = coverage.childElementCount === 0;
  root.append(coverage);

  if (session.windows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-section session-empty';
    empty.textContent = 'No Canvas2D activity occurred during this recording. Record again and reproduce the canvas interaction before you stop.';
    root.append(empty);
  }

  if (session.canvases.length) {
    const summaries = document.createElement('div');
    summaries.className = 'session-section canvas-summaries';
    const summaryHeading = document.createElement('div');
    summaryHeading.className = 'session-heading';
    summaryHeading.textContent = 'CANVAS WORK';
    summaries.append(summaryHeading);
    for (const [index, canvas] of session.canvases.entries()) {
      const line = document.createElement('div');
      line.className = 'session-line canvas-summary';
      line.tabIndex = 0;
      line.dataset.summaryIndex = String(index);
      line.dataset.sessionCanvasId = canvas.canvasId;
      const owner = document.createElement('div');
      owner.className = 'session-owner';
      owner.textContent = `Owner: ${canvas.nearestReactOwner ?? 'Not attributed'} · ${canvas.canvasApiSelfTimeMs} ms Canvas2D API self-time · ${canvas.maxWindowSelfTimeMs} ms maximum frame · ${canvas.rasterOperationCount} raster operations · ${canvas.evidenceLevel}`;
      const identifier = document.createElement('div');
      identifier.className = 'session-identifier';
      identifier.textContent = `Canvas ID: ${canvas.canvasId}`;
      line.append(owner, identifier);
      summaries.append(line);
    }
    const more = document.createElement('button');
    more.className = 'more summary-more';
    more.type = 'button';
    more.dataset.action = 'show-session-canvases';
    summaries.append(more);
    root.append(summaries);
  }

  const findings = document.createElement('div');
  findings.className = 'session-section findings-list';
  const findingsHeading = document.createElement('div');
  findingsHeading.className = 'session-heading';
  findingsHeading.textContent = 'FINDINGS';
  findings.append(findingsHeading);
  if (session.findings.length > 0) appendLine(findings, '', 'A review candidate is a place to inspect. It is not a confirmed problem.');
  if (session.findings.length === 0) appendLine(findings, '', 'No review candidates met the finding thresholds in this recording.');
  for (const [index, finding] of session.findings.entries()) findings.append(createFinding(session, finding, index));
  root.append(findings);
  const explanation = document.createElement('div');
  explanation.className = 'explanation-panel';
  const comparison = document.createElement('div');
  comparison.className = 'comparison-panel';
  root.append(explanation, comparison);
  return root;
}

function updateSessionView(session: InvestigationSessionV1): void {
  const root = flyout?.querySelector<HTMLElement>('.completed-session');
  if (!root) return;
  const copyStatus = root.querySelector<HTMLElement>('.session-copy-status');
  if (copyStatus) copyStatus.textContent = copySessionStatus;
  const summaries = [...root.querySelectorAll<HTMLElement>('.canvas-summary')];
  for (const [index, summary] of summaries.entries()) summary.hidden = !showAllSessionCanvases && index >= 8;
  const more = root.querySelector<HTMLButtonElement>('.summary-more');
  if (more) {
    const hidden = Math.max(0, summaries.length - 8);
    more.hidden = showAllSessionCanvases || hidden === 0;
    more.textContent = `+${hidden} more`;
  }
  for (const [index, finding] of session.findings.entries()) updateFinding(session, finding, index);
  updateExplanationPanel();
  updateComparisonPanel();
}

function renderFlyout(): void {
  if (!flyout) return;
  flyout.hidden = !flyoutOpen || collapsed || selectedCanvasId !== null;
  if (flyout.hidden) return;
  if (renderedFlyoutRevision === flyoutRevision) return;

  const rows = [...stats].map(([canvasId, canvasStats]) => ({
    aggregate: getAggregate(canvasId),
    canvasId,
    canvasStats,
  }));
  rows.sort(
    (a, b) =>
      b.aggregate.same - a.aggregate.same ||
      b.aggregate.selfTimeMs - a.aggregate.selfTimeMs,
  );

  const active = (flyout.getRootNode() as ShadowRoot).activeElement;
  const visibleRows = showAllRows ? rows : rows.slice(0, 8);
  // A row the user is on stays rendered even if a busier canvas overtakes it
  // in the sort — but it stays as a real row, kept in order and up to date,
  // rather than as an orphan the render loop no longer touches.
  const activeCanvasId =
    active instanceof HTMLElement ? active.dataset.canvasId : undefined;
  if (activeCanvasId && !visibleRows.some(row => row.canvasId === activeCanvasId)) {
    const focused = rows.find(row => row.canvasId === activeCanvasId);
    if (focused) visibleRows[visibleRows.length - 1] = focused;
  }
  const visibleCanvasIds = new Set(visibleRows.map(row => row.canvasId));
  for (const [canvasId, row] of flyoutRows) {
    if (visibleCanvasIds.has(canvasId)) continue;
    row.remove();
    flyoutRows.delete(canvasId);
  }
  let note = flyout.querySelector<HTMLDivElement>('.note');
  if (!note) {
    note = document.createElement('div');
    note.className = 'note';
    note.textContent = EXPLAINER;
  }
  if (!note.isConnected) flyout.append(note);
  let recording = flyout.querySelector<HTMLElement>('.recording-session');
  if (getRecordingState() === 'recording') {
    if (!recording) {
      recording = document.createElement('div');
      recording.className = 'session-section recording-session';
      recording.textContent = 'Recording…';
    }
    if (!recording.isConnected) {
      const liveHeading = flyout.querySelector('.live-heading');
      if (liveHeading) flyout.insertBefore(recording, liveHeading);
      else flyout.append(recording);
    }
  } else recording?.remove();
  if (renderedSession !== shownSession) {
    flyout.querySelector('.completed-session')?.remove();
    findingNodes.clear();
    renderedSession = shownSession;
    if (shownSession) {
      const completed = createSessionView(shownSession);
      const liveHeading = flyout.querySelector('.live-heading');
      if (liveHeading) flyout.insertBefore(completed, liveHeading);
      else flyout.append(completed);
    }
  }
  if (shownSession) {
    updateSessionView(shownSession);
  }
  let liveHeading = flyout.querySelector<HTMLElement>('.live-heading');
  if (rows.length) {
    if (!liveHeading) {
      liveHeading = document.createElement('div');
      liveHeading.className = 'session-heading session-section live-heading';
      liveHeading.textContent = 'CURRENT CANVAS ACTIVITY';
    }
    if (!liveHeading.isConnected) flyout.append(liveHeading);
  } else liveHeading?.remove();
  for (const { aggregate, canvasId, canvasStats } of visibleRows) {
    let row = flyoutRows.get(canvasId);
    if (!row) {
      row = document.createElement('button');
      row.className = 'row';
      row.type = 'button';
      row.dataset.canvasId = canvasId;
      row.append(makeBadge(canvasStats.kind));
      const text = document.createElement('span');
      text.className = 'row-text';
      row.append(text);
      flyoutRows.set(canvasId, row);
    }
    const badge = row.querySelector<HTMLElement>('.badge')!;
    badge.textContent = badgeText(canvasStats.kind);
    badge.title = badgeTitle(canvasStats.kind);
    const text = row.querySelector<HTMLElement>('.row-text')!;
    const owner = canvasStats.owner ?? 'Not attributed';
    let content =
      `Owner: ${owner} · Canvas ID: ${canvasId} · same in ${aggregate.same} of ${frames(aggregate.windows)}`;
    // The row ellipsizes, so the title carries the whole sentence.
    let title =
      `${owner} sent the same draw commands in ${aggregate.same} of the ` +
      `last ${frames(aggregate.windows)}.`;
    if (aggregate.unknown > aggregate.windows / 2) {
      const reason = aggregate.unknownReasons[0]?.[0];
      if (reason) {
        content += ` · unclear: ${describeUnknownReason(reason)}`;
        title += ` Most frames were unclear: ${describeUnknownReason(reason)}.`;
      }
    }
    if (aggregate.meanSelfTimeMs >= 0.1) {
      content += ` · ${aggregate.meanSelfTimeMs.toFixed(1)} ms per frame`;
      title +=
        ` It spent ${aggregate.meanSelfTimeMs.toFixed(1)} ms per frame in ` +
        'canvas calls.';
    }
    text.textContent = content;
    row.title = title;
    flyout.append(row);
  }

  // Reused, not recreated: rebuilding it would drop focus mid-click.
  let more = flyout.querySelector<HTMLButtonElement>('.more:not(.summary-more)');
  const hiddenCount = rows.length - visibleRows.length;
  if (!showAllRows && hiddenCount > 0) {
    if (!more) {
      more = document.createElement('button');
      more.className = 'more';
      more.type = 'button';
    }
    more.textContent = `+${hiddenCount} more`;
    flyout.append(more);
  } else if (more) {
    // Expanding removes the control the user just pressed, so hand focus to
    // the rows it revealed rather than dropping it on the document.
    const wasActive = more === active;
    more.remove();
    if (wasActive) {
      flyout.querySelectorAll<HTMLButtonElement>('.row')[8]?.focus();
    }
  }
  if (
    active instanceof HTMLButtonElement &&
    (active.classList.contains('row') || active.classList.contains('more')) &&
    active.isConnected
  ) {
    active.focus();
  }
  renderedFlyoutRevision = flyoutRevision;
}

function refresh(): void {
  if (host && !host.isConnected) {
    (document.body ?? document.documentElement).append(host);
  }
  // Per-canvas overlay state must not outlive the core's retention. Read the
  // core's map directly rather than copying its keys: this runs on every
  // commit, and the copy showed up in the release bench. An empty map means the
  // frame loop is not feeding this overlay (before the first report, or when
  // reports are pushed directly), so there is nothing to prune against.
  if (latestReports.size > 0 && stats.size > latestReports.size) {
    for (const canvasId of [...stats.keys()]) {
      if (latestReports.has(canvasId)) continue;
      stats.delete(canvasId);
      canvases.delete(canvasId);
      sourceStates.delete(canvasId);
      sourceErrors.delete(canvasId);
      outlines.get(canvasId)?.remove();
      outlines.delete(canvasId);
      flyoutRows.get(canvasId)?.remove();
      flyoutRows.delete(canvasId);
      if (selectedCanvasId === canvasId) closePopover();
    }
  }
  if (!canvasCount || !candidateCount || !countsButton || !toolbar) return;
  let totalCandidates = shownSession?.findings.length ?? 0;
  if (!shownSession) for (const canvasStats of stats.values()) {
    if (canvasStats.candidate) totalCandidates++;
  }
  canvasCount.textContent = `${stats.size} ${stats.size === 1 ? 'canvas' : 'canvases'} · `;
  candidateCount.textContent =
    `${totalCandidates} review ` +
    `${totalCandidates === 1 ? 'candidate' : 'candidates'}`;
  candidateCount.classList.toggle('accent', totalCandidates > 0);
  toolbar.classList.toggle('collapsed', collapsed);
  toolbar
    .querySelector('.collapsed-dot')
    ?.classList.toggle('accent', totalCandidates > 0);
  countsButton.setAttribute('aria-expanded', String(flyoutOpen));
  inspectButton?.classList.toggle('active', inspectMode);
  inspectButton?.setAttribute('aria-pressed', String(inspectMode));
  updateDockTransform();

  for (const { canvasId, report, same } of pendingFlashes.splice(0)) {
    const canvas = canvases.get(canvasId);
    if (canvas instanceof Element) flashOutline(report, canvas, same);
  }
  updateInspectOutlines();
  for (const canvasId of fadingFlashes) {
    outlines.get(canvasId)?.classList.add('fading');
  }
  fadingFlashes.clear();
  for (const canvasId of expiredFlashes) {
    const outline = outlines.get(canvasId);
    outline?.classList.remove('flash', 'fading');
    clearOutline(canvasId);
  }
  expiredFlashes.clear();
  renderFlyout();
  renderPopover();
}

function renderRecordingState(): void {
  if (!recordButton || !stopRecordingButton) return;
  const state = getRecordingState();
  const recording = state === 'recording';
  recordButton.disabled = recording;
  const stopRoot = stopRecordingButton.getRootNode();
  const stopFocused = stopRoot instanceof ShadowRoot &&
    stopRoot.activeElement === stopRecordingButton;
  stopRecordingButton.disabled = !recording && !stopFocused;
  stopRecordingButton.setAttribute('aria-disabled', String(!recording));
  recordButton.classList.toggle('active', recording);
  recordButton.setAttribute('aria-pressed', String(recording));
  if (state === 'complete' && shownSession) flyoutOpen = true;
}

function commit(): void {
  commitAnimationFrame = null;
  if (!dirty) return;
  dirty = false;
  refresh();
}

function scheduleCommit(): void {
  if (commitAnimationFrame !== null) return;
  commitAnimationFrame = requestAnimationFrame(commit);
}

function markDirty(): void {
  dirty = true;
  scheduleCommit();
}

function exitInspectMode(): void {
  inspectMode = false;
  closePopover();
  markDirty();
}

function toggleInspectMode(): void {
  if (inspectMode) {
    exitInspectMode();
    return;
  }
  inspectMode = true;
  markDirty();
}

function handleKeydown(event: KeyboardEvent): void {
  const root = host?.shadowRoot;
  const controls = [...(root?.querySelectorAll<HTMLButtonElement>('.finding-toggle') ?? [])];
  const active = root?.activeElement;
  const index = active instanceof HTMLButtonElement ? controls.indexOf(active) : -1;
  if (index !== -1 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); controls[event.key === 'ArrowDown' ? Math.min(index + 1, controls.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : controls.length - 1]?.focus(); return;
  }
  if (index !== -1 && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); const id = controls[index].dataset.findingId ?? null; expandedFindingId = expandedFindingId === id ? null : id; flyoutRevision++; markDirty(); return; }
  if (event.key === 'Escape') {
    if (selectedCanvasId !== null) {
      closePopover();
      if (inspectMode) inspectMode = false;
      if (flyoutInvoker) flyoutOpen = true;
      const invoker = flyoutInvoker;
      markDirty();
      requestAnimationFrame(() => invoker?.focus());
      flyoutInvoker = null;
      return;
    }
    if (flyoutOpen) { flyoutOpen = false; countsButton?.focus(); flyoutRevision++; markDirty(); return; }
    if (inspectMode) exitInspectMode();
  }
}

function updateDockTransform(): void {
  if (!dock) return;
  dock.style.transform =
    dragX === 0 && dragY === 0 ? '' : `translate(${dragX}px, ${dragY}px)`;
}

function handlePointerMove(event: PointerEvent): void {
  if (!dragStart) return;
  dragX = dragStart.x + event.clientX - dragStart.pointerX;
  dragY = dragStart.y + event.clientY - dragStart.pointerY;
  markDirty();
}

function handlePointerUp(): void {
  dragStart = null;
  document.removeEventListener('pointermove', handlePointerMove);
  document.removeEventListener('pointerup', handlePointerUp);
}

function handleToolbarPointerDown(event: PointerEvent): void {
  if (event.target !== toolbar) return;
  dragStart = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    x: dragX,
    y: dragY,
  };
  document.addEventListener('pointermove', handlePointerMove);
  document.addEventListener('pointerup', handlePointerUp);
}

function findCanvasId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-canvas-id]')?.dataset.canvasId ?? null;
}

function handleOutlineClick(event: MouseEvent): void {
  if (!inspectMode) return;
  const canvasId = findCanvasId(event.target);
  if (!canvasId) return;
  event.stopPropagation();
  const matching = [...(host?.shadowRoot?.querySelectorAll<HTMLElement>('.finding-card') ?? [])].find(card => card.dataset.canvasId === canvasId);
  if (matching) {
    flyoutOpen = true;
    expandedFindingId = matching.dataset.findingId ?? null;
    flyoutRevision++;
    markDirty();
    const control = matching.querySelector<HTMLButtonElement>('.finding-toggle');
    requestAnimationFrame(() => control?.focus());
    return;
  }
  openPopover(canvasId);
}

function handleFlyoutClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.more')) {
    if (event.target.closest('[data-action="show-session-canvases"]')) {
      showAllSessionCanvases = true;
      flyoutRevision++;
      markDirty();
      return;
    }
    showAllRows = true;
    flyoutRevision++;
    markDirty();
    return;
  }
  const action = event.target.closest<HTMLElement>('[data-action]');
  if (action?.dataset.action === 'keep-baseline') {
    const findingIndex = Number(action.dataset.findingIndex);
    const source = shownSession;
    const finding = source?.findings[findingIndex];
    if (!source || !finding || action.dataset.sessionId !== source.sessionId) return;
    baseline = { session: copySession(source), findingIndex };
    completedComparison = null;
    copyComparisonStatus = '';
    copyComparisonRequest++;
    updateSessionView(source);
    flyoutRevision++; markDirty();
    return;
  }
  if (action?.dataset.action === 'compare-baseline') {
    const findingIndex = Number(action.dataset.findingIndex);
    const source = shownSession;
    const candidate = source?.findings[findingIndex];
    const baselineFinding = baseline?.session.findings[baseline.findingIndex];
    if (!baseline || !source || !candidate || !baselineFinding || action.dataset.sessionId !== source.sessionId || source.sessionId === baseline.session.sessionId || candidate.type !== baselineFinding.type) return;
    completedComparison = compareSessions(baseline.session, source, { baselineFindingIndex: baseline.findingIndex, candidateFindingIndex: findingIndex });
    copyComparisonStatus = '';
    copyComparisonRequest++;
    updateSessionView(source);
    flyoutRevision++; markDirty();
    return;
  }
  if (action?.dataset.action === 'copy-comparison' && completedComparison) {
    const comparisonId = completedComparison.comparisonId;
    const request = ++copyComparisonRequest;
    const copied = (status: string) => {
      if (request !== copyComparisonRequest || completedComparison?.comparisonId !== comparisonId) return;
      copyComparisonStatus = status; flyoutRevision++; markDirty();
    };
    try {
      if (!navigator.clipboard?.writeText) copied('Copy failed');
      else void navigator.clipboard.writeText(JSON.stringify(completedComparison)).then(() => copied('Comparison JSON copied')).catch(() => copied('Copy failed'));
    } catch { copied('Copy failed'); }
    return;
  }
  if (action?.dataset.action === 'start-explanation') {
    const findingIndex = Number(action.dataset.findingIndex);
    const source = shownSession;
    const finding = source?.findings[findingIndex];
    if (!source || !finding || action.dataset.sessionId !== source.sessionId) return;
    const key = findingKey(finding);
    explanationSelection = { sessionId: source.sessionId, findingIndex, key };
    explanationRecordingActive = true;
    explanationStartFailure = '';
    completedExplanation = null;
    copyExplanationStatus = '';
    const result = startExplanation({ sessionId: source.sessionId, findingIndex });
    if (result.status === 'started' || result.status === 'already-active') {
      expandedFindingId = key;
      flyoutOpen = true;
    } else {
      explanationSelection = null;
      explanationRecordingActive = false;
      explanationStartFailure = explanationStartCopy[result.reason];
      const status = action.closest<HTMLElement>('.finding-card')?.querySelector<HTMLElement>('.finding-status');
      if (status) status.textContent = explanationStartFailure;
    }
    flyoutRevision++;
    markDirty();
    return;
  }
  if (action?.dataset.action === 'copy-explanation' && completedExplanation) {
    const explanationId = completedExplanation.explanationId;
    const request = ++copyExplanationRequest;
    const copied = (status: string) => {
      if (request !== copyExplanationRequest || completedExplanation?.explanationId !== explanationId) return;
      copyExplanationStatus = status; flyoutRevision++; markDirty();
    };
    try {
      if (!navigator.clipboard?.writeText) copied('Copy failed');
      else void navigator.clipboard.writeText(JSON.stringify(completedExplanation)).then(() => copied('Explanation JSON copied')).catch(() => copied('Copy failed'));
    } catch { copied('Copy failed'); }
    return;
  }
  if (action?.dataset.action === 'copy-session' && shownSession) {
    const copied = (status: string) => { copySessionStatus = status; flyoutRevision++; markDirty(); };
    try {
      if (!navigator.clipboard?.writeText) copied('Copy failed');
      else void navigator.clipboard.writeText(JSON.stringify(shownSession)).then(() => copied('Session JSON copied')).catch(() => copied('Copy failed'));
    } catch { copied('Copy failed'); }
    return;
  }
  if (action?.dataset.action === 'download-session' && shownSession) {
    const blob = new Blob([JSON.stringify(shownSession)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${shownSession.sessionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    copySessionStatus = 'Session JSON downloaded';
    flyoutRevision++;
    markDirty();
    return;
  }
  if (action?.dataset.action === 'inspect-current' && action.dataset.canvasId) { flyoutInvoker = action; openPopover(action.dataset.canvasId); return; }
  if (action?.dataset.action === 'locate-current' && action.dataset.canvasId) {
    const result = locateCanvas(action.dataset.canvasId);
    const status = action.closest<HTMLElement>('.finding-card')?.querySelector<HTMLElement>('.finding-status');
    if (status) status.textContent = result === 'not-visible' ? 'The canvas is connected but is not visible.' : '';
    return;
  }
  const finding = event.target.closest<HTMLElement>('.finding-toggle');
  if (finding) { expandedFindingId = expandedFindingId === finding.dataset.findingId ? null : finding.dataset.findingId ?? null; flyoutRevision++; markDirty(); return; }
  const canvasId = findCanvasId(event.target);
  if (canvasId && !event.target.closest('.finding-card')) {
    flyoutInvoker = event.target.closest<HTMLElement>('.row');
    openPopover(canvasId);
  }
}

function handleFlyoutMouseover(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('.finding-card')) return;
  const canvasId = findCanvasId(event.target);
  if (canvasId) locateCanvas(canvasId);
}

function handlePopoverClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.close')) {
    closePopover();
    markDirty();
    return;
  }
  if (event.target.closest('.copy') && selectedCanvasId) {
    copyPopoverJson(selectedCanvasId);
  }
}

function handleReport(report: DrawBatchReport, canvas: unknown): void {
  const canvasStats = stats.get(report.canvasId) ?? {
    candidate: false,
    changed: 0,
    kind: report.attributionKind,
    latest: report,
    owner: report.nearestReactOwner,
    same: 0,
    selfTimeMs: 0,
    unknown: 0,
    unknownReasons: new Map(),
    windows: 0,
  };
  canvasStats.kind = report.attributionKind;
  canvasStats.latest = report;
  canvasStats.owner = report.nearestReactOwner;
  canvasStats.windows++;
  canvasStats[report.signatureStatus]++;
  canvasStats.selfTimeMs += report.canvasApiSelfTimeMs;
  if (report.unknownReason) {
    canvasStats.unknownReasons.set(
      report.unknownReason,
      (canvasStats.unknownReasons.get(report.unknownReason) ?? 0) + 1,
    );
  }
  stats.set(report.canvasId, canvasStats);
  canvases.set(report.canvasId, canvas);
  flyoutRevision++;

  if (
    report.signatureStatus === 'same' &&
    report.rasterOperationCount >= minFlashRasterOps &&
    canvas instanceof Element
  ) {
    canvasStats.candidate = true;
    pendingFlashes.push({
      canvasId: report.canvasId,
      report,
      same: canvasStats.same,
    });
  }
  markDirty();
}

export function mountOverlay(options: CanvasScanOptions = {}): void {
  if (typeof document === 'undefined' || host) return;
  mountGeneration++;
  minFlashRasterOps = options.minFlashRasterOps ?? 2;

  // Keep overlay rendering DOM-only so it is never captured by canvas instrumentation.
  host = document.createElement('div');
  host.setAttribute('data-canvas-scan', '');
  host.setAttribute(
    'style',
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646',
  );
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = styles;
  shadowRoot.append(style);

  outlineLayer = document.createElement('div');
  outlineLayer.className = 'outlines';
  outlineLayer.addEventListener('click', handleOutlineClick);

  dock = document.createElement('div');
  dock.className = 'dock';
  toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.addEventListener('pointerdown', handleToolbarPointerDown);

  inspectButton = document.createElement('button');
  inspectButton.className = 'control inspect';
  inspectButton.type = 'button';
  inspectButton.setAttribute('aria-label', 'Inspect canvases');
  inspectButton.title = 'Click a canvas on the page to see what it drew';
  inspectButton.setAttribute('aria-pressed', 'false');
  inspectButton.textContent = '◎';
  inspectButton.addEventListener('click', toggleInspectMode);

  countsButton = document.createElement('button');
  countsButton.className = 'control counts';
  countsButton.type = 'button';
  countsButton.title =
    `${EXPLAINER} A completed recording can also show concentrated work, ` +
    'active resets, and large backing stores as review candidates.';
  countsButton.setAttribute('aria-expanded', 'false');
  canvasCount = document.createElement('span');
  canvasCount.className = 'canvas-count';
  candidateCount = document.createElement('span');
  candidateCount.className = 'candidate-count';
  countsButton.append(canvasCount, candidateCount);
  countsButton.addEventListener('click', () => {
    flyoutOpen = !flyoutOpen;
    closePopover();
    showAllRows = false;
    flyoutRevision++;
    markDirty();
  });

  recordButton = document.createElement('button');
  recordButton.className = 'control record';
  recordButton.type = 'button';
  recordButton.setAttribute('aria-label', 'Record investigation');
  recordButton.textContent = 'Record';
  recordButton.addEventListener('click', () => {
    if (getRecordingState() === 'recording') return;
    startRecording();
    if (getRecordingState() === 'recording') {
      explanationSelection = null;
      completedExplanation = null;
      explanationStartFailure = '';
      copyExplanationStatus = '';
      completedComparison = null;
      copyComparisonStatus = '';
      copyComparisonRequest++;
      shownSession = null;
      expandedFindingId = null;
      copySessionStatus = '';
      showAllSessionCanvases = false;
      findingNodes.clear();
      flyoutRevision++;
      requestAnimationFrame(() => stopRecordingButton?.focus());
    }
  });

  stopRecordingButton = document.createElement('button');
  stopRecordingButton.className = 'control stop-recording';
  stopRecordingButton.type = 'button';
  stopRecordingButton.setAttribute('aria-label', 'Stop recording');
  stopRecordingButton.textContent = 'Stop';
  stopRecordingButton.addEventListener('click', () => {
    if (getRecordingState() === 'recording') stopRecording();
  });
  stopRecordingButton.addEventListener('blur', () => {
    if (getRecordingState() !== 'recording') stopRecordingButton!.disabled = true;
  });

  const collapseButton = document.createElement('button');
  collapseButton.className = 'control collapse';
  collapseButton.type = 'button';
  collapseButton.setAttribute('aria-label', 'Collapse canvas-scan');
  collapseButton.textContent = '−';
  collapseButton.addEventListener('click', () => {
    collapsed = true;
    flyoutOpen = false;
    flyoutRevision++;
    inspectMode = false;
    closePopover();
    markDirty();
  });

  const collapsedDot = document.createElement('button');
  collapsedDot.className = 'collapsed-dot';
  collapsedDot.type = 'button';
  collapsedDot.setAttribute('aria-label', 'Expand canvas-scan');
  collapsedDot.addEventListener('click', () => {
    collapsed = false;
    markDirty();
  });

  toolbar.append(
    inspectButton,
    countsButton,
    recordButton,
    stopRecordingButton,
    collapseButton,
    collapsedDot,
  );

  flyout = document.createElement('div');
  flyout.className = 'flyout';
  flyout.hidden = true;
  flyout.addEventListener('click', handleFlyoutClick);
  flyout.addEventListener('mouseover', handleFlyoutMouseover);
  popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  popover.addEventListener('click', handlePopoverClick);

  const popoverHeader = document.createElement('div');
  popoverHeader.className = 'popover-header';
  const popoverBadge = document.createElement('span');
  popoverBadge.className = 'badge popover-badge';
  const popoverOwner = document.createElement('span');
  popoverOwner.className = 'popover-owner';
  const close = document.createElement('button');
  close.className = 'control close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close canvas details');
  close.textContent = '×';
  popoverHeader.append(popoverBadge, popoverOwner, close);

  const popoverBody = document.createElement('div');
  popoverBody.className = 'popover-body';
  for (const className of [
    'status',
    'raster-ops',
    'self-time',
    'sampling',
    'unknown-reasons',
    'source',
    'geometry',
  ]) {
    const line = document.createElement('div');
    line.className = `popover-line ${className}`;
    popoverBody.append(line);
  }
  const copy = document.createElement('button');
  copy.className = 'control copy';
  copy.type = 'button';
  copy.textContent = 'copy json';
  popoverBody.append(copy);
  popover.append(popoverHeader, popoverBody);

  dock.append(flyout, popover, toolbar);
  shadowRoot.append(outlineLayer, dock);

  (document.body ?? document.documentElement).append(host);
  document.addEventListener('keydown', handleKeydown);
  unsubscribe = subscribeToReports(handleReport);
  if (getRecordingState() === 'complete') {
    shownSession = getLastSession() ?? null;
    expandedFindingId = shownSession?.findings[0] ? findingKey(shownSession.findings[0]) : null;
  }
  unsubscribeRecording = subscribeToRecordingState((state) => {
    if (state === 'recording') {
      if (!explanationRecordingActive) {
        shownSession = null;
        expandedFindingId = null;
        completedExplanation = null;
        explanationStartFailure = '';
        copyExplanationStatus = '';
        completedComparison = null;
        copyComparisonStatus = '';
        copyComparisonRequest++;
        copySessionStatus = '';
        showAllSessionCanvases = false;
        findingNodes.clear();
      }
    } else if (state === 'complete') {
      const explanation = getLastExplanation();
      const explanationCompleted = explanationRecordingActive;
      explanationRecordingActive = false;
      if (explanationCompleted && explanationSelection && explanation?.source.sessionId === explanationSelection.sessionId && explanation.source.findingIndex === explanationSelection.findingIndex) {
        completedExplanation = explanation;
      } else {
        shownSession = getLastSession() ?? null;
        expandedFindingId = shownSession?.findings[0] ? findingKey(shownSession.findings[0]) : null;
        completedExplanation = null;
        explanationSelection = null;
        copyExplanationStatus = '';
        showAllSessionCanvases = false;
      }
    }
    renderRecordingState();
    flyoutRevision++;
    markDirty();
  });
  renderRecordingState();
  refreshInterval = window.setInterval(() => {
    if (inspectMode || outlines.size > 0) dirty = true;
    if (dirty) scheduleCommit();
  }, 250);
  survivalInterval = window.setInterval(() => {
    if (host && !host.isConnected) {
      markDirty();
    }
  }, 1000);
  markDirty();
}

export function unmountOverlay(): void {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeRecording?.();
  unsubscribeRecording = null;
  if (refreshInterval !== null) window.clearInterval(refreshInterval);
  refreshInterval = null;
  if (survivalInterval !== null) window.clearInterval(survivalInterval);
  survivalInterval = null;
  if (commitAnimationFrame !== null) cancelAnimationFrame(commitAnimationFrame);
  commitAnimationFrame = null;
  for (const timeout of locateTimeouts.values()) window.clearTimeout(timeout);
  locateTimeouts.clear();
  for (const animationFrame of flashAnimationFrames.values()) {
    cancelAnimationFrame(animationFrame);
  }
  flashAnimationFrames.clear();
  for (const timeout of flashTimeouts.values()) window.clearTimeout(timeout);
  flashTimeouts.clear();
  mountGeneration++;
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('pointermove', handlePointerMove);
  document.removeEventListener('pointerup', handlePointerUp);
  host?.shadowRoot?.replaceChildren();
  host?.remove();
  host = null;
  outlineLayer = null;
  dock = null;
  toolbar = null;
  inspectButton = null;
  countsButton = null;
  recordButton = null;
  stopRecordingButton = null;
  canvasCount = null;
  candidateCount = null;
  flyout = null;
  popover = null;
  collapsed = false;
  flyoutOpen = false;
  showAllRows = false;
  inspectMode = false;
  selectedCanvasId = null;
  selectedGeometry = null;
  shownSession = null;
  renderedSession = null;
  expandedFindingId = null;
  copySessionStatus = '';
  explanationSelection = null;
  explanationRecordingActive = false;
  completedExplanation = null;
  explanationStartFailure = '';
  copyExplanationStatus = '';
  copyExplanationRequest = 0;
  baseline = null;
  completedComparison = null;
  copyComparisonStatus = '';
  copyComparisonRequest = 0;
  flyoutInvoker = null;
  showAllSessionCanvases = false;
  minFlashRasterOps = 2;
  dirty = false;
  flyoutRevision = 0;
  renderedFlyoutRevision = -1;
  dragStart = null;
  dragX = 0;
  dragY = 0;
  outlines.clear();
  flyoutRows.clear();
  findingNodes.clear();
  locatingCanvases.clear();
  fadingFlashes.clear();
  expiredFlashes.clear();
  pendingFlashes.length = 0;
  stats.clear();
  canvases.clear();
  sourceStates.clear();
  sourceErrors.clear();
}
