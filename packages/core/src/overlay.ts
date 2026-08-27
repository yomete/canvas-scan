import {
  getHistory,
  droppedCanvasIds,
  getLatestReport,
  latestReports,
  MAX_TRACKED_CANVASES,
  retiredCanvasIds,
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
  // Consecutive `same` windows ending at the latest one. The flash label reads
  // as a run, so it counts a run rather than the lifetime total.
  sameStreak: number;
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
let copySessionRequest = 0;
let copyPopoverStatus = '';
let copyPopoverRequest = 0;
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
let renderedLiveSignature = '';
let unsubscribe: (() => void) | null = null;
let unsubscribeRecording: (() => void) | null = null;
let dragStart: { pointerX: number; pointerY: number; pointerId: number; x: number; y: number } | null =
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
/* A run keeps going while the overlay is collapsed and Stop is out of reach,
   so the dot pulses to say a recording is open. */
.collapsed-dot.recording { background: #ef4444; animation: canvas-scan-recording 1.2s ease-in-out infinite; }
@keyframes canvas-scan-recording { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.control.inert { opacity: 0.4; cursor: default; }
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
.popover[hidden],
.row[hidden],
.more[hidden] { display: none; }
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
.row.stale { opacity: 0.55; }
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
.finding-boundary { margin: 4px 0 2px; }
.finding-boundary > summary { cursor: pointer; color: rgba(255, 255, 255, 0.62); font-size: 11px; }
.finding-boundary > summary:hover { color: #fff; }
.finding-boundary[open] > summary { color: rgba(255, 255, 255, 0.86); }
.finding-quiet { margin-top: 6px; }
.finding-quiet > summary { cursor: pointer; color: rgba(255, 255, 255, 0.62); font: 11px/16px ui-monospace, monospace; }
.finding-quiet > summary:hover { color: #fff; }
.finding-quiet[open] > summary { color: rgba(255, 255, 255, 0.86); margin-bottom: 4px; }
.finding-truncated { color: #fbbf24; }
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
  [
    'sampling-gap',
    'frames in between were skipped by sampling',
  ],
  [
    'instrumentation-disabled',
    'command capture was off for this frame',
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

// One phrase for a canvas with no owning React component. The overlay used to
// say "Not attributed" in one place, "Unattributed" in another, and show the
// bare canvas ID in three more, which read as three different states.
const NO_OWNER = 'No owner found';
// A minified symbol is evidence, not a name. It is shown as what it is, so a
// reader can search the bundle for it and never mistakes it for something to
// look up in their own source.
const MINIFIED_OWNER = 'Minified owner';
function ownerName(owner: string | null, kind: AttributionKind): string {
  if (kind === 'minified-owner') return owner ? `${MINIFIED_OWNER} · ${owner}` : MINIFIED_OWNER;
  return owner ?? NO_OWNER;
}
function ownerWithId(owner: string | null, kind: AttributionKind, canvasId: string): string {
  if (kind === 'minified-owner') return `${ownerName(owner, kind)} · ${canvasId}`;
  return owner ?? `${NO_OWNER} · ${canvasId}`;
}

function badgeText(kind: AttributionKind): string {
  if (kind === 'jsx-owner') return 'jsx';
  if (kind === 'react-host-no-owner') return 'no';
  if (kind === 'container-only') return 'co';
  if (kind === 'minified-owner') return 'min';
  return 'un';
}

const BADGE_TITLES: Record<AttributionKind, string> = {
  'jsx-owner': 'this canvas is written in the component’s JSX',
  'react-host-no-owner': 'React made this canvas, but no component above it owns it',
  'container-only':
    'a library made this canvas inside the component’s markup, so the owner is the nearest one above it',
  'minified-owner':
    'a component owns this canvas, and the build renamed it — the symbol is here to search the bundle for, not a name in your source',
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
      `${ownerWithId(report.nearestReactOwner, report.attributionKind, report.canvasId)} · ` +
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
  const request = ++copyPopoverRequest;
  const report = (status: string) => {
    if (request !== copyPopoverRequest || selectedCanvasId !== canvasId) return;
    copyPopoverStatus = status;
    markDirty();
  };
  try {
    const copied = navigator.clipboard?.writeText(payload);
    if (!copied) { report('Clipboard unavailable'); return; }
    void copied.then(() => report('Canvas JSON copied'), () => report('Copy failed'));
  } catch {
    report('Copy failed');
  }
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
  if (owner) owner.textContent = ownerWithId(canvasStats.owner, canvasStats.kind, canvasId);
  const status = popover.querySelector<HTMLElement>('.status');
  if (status) {
    status.textContent =
      (retiredCanvasIds.has(canvasId) ? 'This canvas has stopped drawing.\n' : '') +
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
  const copyStatus = popover.querySelector<HTMLElement>('.popover-copy-status');
  if (copyStatus) {
    copyStatus.hidden = copyPopoverStatus === '';
    copyStatus.textContent = copyPopoverStatus;
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
  copyPopoverStatus = '';
  copyPopoverRequest++;
  flyoutOpen = false;
  flyoutRevision++;
  // Opening from a flyout row hides the flyout while that row still holds
  // focus, which drops focus to the document. Move it into the popover so the
  // keyboard stays where the user is now working; Escape hands it back.
  requestAnimationFrame(() => {
    if (selectedCanvasId !== canvasId) return;
    popover?.querySelector<HTMLButtonElement>('.close')?.focus();
  });

  requestSource(canvasId);
  markDirty();
}

// Asks for one canvas's source location, once. Retries only when the last
// answer was "unavailable": that is usually a sourcemap that was not ready yet.
// A resolved location is kept.
//
// This is the only thing that fetches a source map outside an explanation, and
// it never runs on its own — a person opened a popover, or a recording they
// started produced a finding.
function requestSource(canvasId: string): void {
  const known = sourceStates.get(canvasId);
  if (known && !(known.status === 'resolved' && known.location === null)) return;
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
    // The card that names where this canvas was drawn from is already on
    // screen, and rebuilding the panel would take the reader's focus with it.
    // updateFinding refreshes the line in place instead.
    flyoutRevision++;
    markDirty();
  });
}

function findingLabel(type: InvestigationFinding['type']): string {
  return { 'heavy-canvas-work': 'Heavy frame', 'repeated-draw-work': 'Repeated drawing', 'resize-churn': 'Canvas resets while drawing', 'backing-store-mismatch': 'Oversized canvas' }[type];
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

function sessionCanvas(session: InvestigationSessionV1, canvasId: string) {
  return session.canvases.find(canvas => canvas.canvasId === canvasId);
}

function findingSummary(finding: InvestigationFinding): string {
  // Both numbers are labelled with the span they cover. Read as one clause the
  // old line said a single frame made the whole episode's draw calls.
  if (finding.type === 'heavy-canvas-work') return `Slowest frame ${finding.maximumWindow.canvasApiSelfTimeMs} ms, ${finding.maximumWindow.rasterOperationCount} draw calls · this episode ${finding.canvasApiSelfTimeMs} ms, ${finding.rasterOperationCount} draw calls`;
  if (finding.type === 'repeated-draw-work') return `${finding.repeatedWindowCount} near-identical frames · ${finding.rasterOperationCount} draw calls · ${finding.canvasApiSelfTimeMs} ms`;
  // The unavailable tally is named rather than left out, so a reader
  // subtracting the unchanged count does not read the rest as size changes.
  if (finding.type === 'resize-churn') {
    const { unchanged, unavailable } = finding.dimensionChanges;
    const sizes = unavailable ? `${unchanged} didn't change the size · ${unavailable} size unknown` : `${unchanged} didn't change the size`;
    return `${finding.activeResetCount} canvas resets · ${sizes}`;
  }
  const worst = finding.affectedWindows.reduce((worst, window) => (window.actualToExpectedAreaRatio ?? 0) > (worst.actualToExpectedAreaRatio ?? 0) ? window : worst, finding.affectedWindows[0]);
  const ratio = worst?.actualToExpectedAreaRatio == null ? null : Math.round(worst.actualToExpectedAreaRatio * 10) / 10;
  return `${finding.affectedWindowCount} frames · backing store${ratio && ratio !== 1 ? ` up to ${ratio}× larger` : ' larger'} than displayed`;
}

function setDrawnFrom(line: HTMLElement, session: InvestigationSessionV1, finding: InvestigationFinding): void {
  const text = findingDrawnFrom(session, finding);
  line.textContent = text ?? '';
  line.hidden = text === null;
}

function findingDrawnFrom(session: InvestigationSessionV1, finding: InvestigationFinding): string | null {
  // The artifact carries the raw creation site, taken with no network at all.
  // A mapped location, once one exists, is the same place said in the reader's
  // own source, so it wins here. The artifact is left as it was recorded.
  const resolved = sourceStates.get(finding.canvasId);
  const location = (resolved?.status === 'resolved' ? resolved.location : null)
    ?? sessionCanvas(session, finding.canvasId)?.sourceLocation;
  if (!location) return null;
  const basename = location.file.split(/[\\/]/).pop() || location.file;
  return `Drawn from ${basename}:${location.line}`;
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

function droppedEntries(session: InvestigationSessionV1): Array<[string, number]> {
  return Object.entries(session.droppedEntryCounts).filter(([, count]) => count > 0);
}

const explanationStartCopy: Record<Exclude<ExplanationStartResult, { status: 'started' } | { status: 'already-active' }>['reason'], string> = {
  'no-session': 'Recording changed — select the finding again.',
  'session-mismatch': 'Recording changed — select the finding again.',
  'finding-not-found': 'Finding changed — select it again.',
  'canvas-unavailable': 'Canvas is no longer on the page.',
  'recording-active': 'Stop the recording first.',
  'instrumentation-disabled': 'Instrumentation unavailable — reload the page.',
};

function differenceVerdict(difference: CommandDifference): string {
  const name = (difference.target ?? difference.reference)?.name;
  switch (difference.reason) {
    case 'argument-token': return difference.reference?.operationKind === 'set' ? `${name} changed` : `${name} was called with different arguments`;
    case 'argument-kind': return `${name} got a different kind of argument`;
    case 'argument-count': return `${name} got a different number of arguments`;
    case 'operation-name': return `${difference.reference?.name ?? 'the command'} became ${name}`;
    case 'operation-kind': return `${name} is now a different kind of call`;
    case 'command-added': return 'A draw command was added';
    case 'command-removed': return 'A draw command was removed';
  }
}

const explanationUnknownCopy: Record<ExplanationUnknownReason, string> = {
  'unsupported-value': 'a value could not be compared',
  'argument-limit': 'too many arguments to record',
  'value-token-limit': 'too many values to record',
  'command-limit': 'too many commands to record',
  'window-limit': 'too many frames to record',
  'sampling-gap': 'some commands were not sampled',
  'missing-reference': 'no two frames were available to compare',
  'instrumentation-disabled': 'instrumentation stopped',
};

function appendExplanationLine(root: HTMLElement, text: string, title?: string): void {
  const line = document.createElement('div');
  line.className = 'finding-line';
  line.textContent = text;
  if (title) line.title = title;
  root.append(line);
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

const sessionLabel = (id: string) => id.replace(/^canvas-scan-/, '');

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
    if (finding) appendExplanationLine(panel, `Finding ${baseline.findingIndex + 1} · ${findingLabel(finding.type)}`);
  }
  const artifact = completedComparison;
  if (!artifact) return;
  appendExplanationLine(panel, 'COMPARISON COMPLETE');
  appendExplanationLine(panel, `Baseline: Finding ${artifact.baseline.findingIndex + 1} · ${artifact.baseline.findingType ? findingLabel(artifact.baseline.findingType) : 'Selected finding'} · session ${sessionLabel(artifact.baseline.sessionId)}`);
  appendExplanationLine(panel, `Candidate: Finding ${artifact.candidate.findingIndex + 1} · ${artifact.candidate.findingType ? findingLabel(artifact.candidate.findingType) : 'Selected finding'} · session ${sessionLabel(artifact.candidate.sessionId)}`);
  if (artifact.status === 'comparable') {
    // Counts and times do not carry the same weight and are no longer shown
    // alike. A count is a structural fact about the two recordings; a time is
    // two measurements taken on separate occasions, so a small move in it can
    // be noise while a count of the same size is real.
    const structural = artifact.measures.filter(measure => measure.interpretation === 'structural');
    const timings = artifact.measures.filter(measure => measure.interpretation === 'observed-timing-pair');
    const line = (measure: ComparisonMeasure) => {
      const delta = measure.delta === null ? '' : ` (${measure.delta > 0 ? '+' : ''}${measure.delta}${measure.unit === 'ms' ? ' ms' : ''})`;
      const scope = measure.scope === 'episode' ? 'Measured over the finding\'s draw episode.' : 'Measured over the whole recording.';
      appendExplanationLine(panel, `${comparisonMeasureLabel(measure.id)}: ${measure.baseline} → ${measure.candidate}${delta}`, scope);
    };
    if (structural.length) {
      appendExplanationLine(panel, 'WHAT CHANGED IN THE DRAWING');
      for (const measure of structural) line(measure);
    }
    if (timings.length) {
      appendExplanationLine(panel, 'TIMES MEASURED ON TWO SEPARATE OCCASIONS', 'Each side was measured in a different recording, so a small difference here can be ordinary variation rather than a change.');
      for (const measure of timings) line(measure);
    }
  } else for (const reason of artifact.incomparableReasons) appendExplanationLine(panel, `Couldn't compare: ${reason.replaceAll('-', ' ')}`);
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
  if ((selection && getRecordingState() === 'recording') || completedExplanation || explanationStartFailure) panel.scrollIntoView?.({ block: 'nearest' });
  if (selection && getRecordingState() === 'recording') {
    panel.classList.add('active');
    const finding = shownSession?.findings[selection.findingIndex];
    appendExplanationLine(panel, 'EXPLANATION ACTIVE');
    if (finding) appendExplanationLine(panel, `Finding ${selection.findingIndex + 1} · ${findingLabel(finding.type)}`);
    appendExplanationLine(panel, 'Repeat the interaction now — stops after 10 s, or press Stop.');
    return;
  }
  if (completedExplanation) {
    panel.classList.add('complete');
    const artifact = completedExplanation;
    const comparison = selectedComparison(artifact);
    appendExplanationLine(panel, 'EXPLANATION COMPLETE');
    appendExplanationLine(panel, `Finding ${artifact.source.findingIndex + 1} · ${findingLabel(artifact.source.findingType)}`);
    // An explanation capture runs a recording of its own, so it leaves a second
    // session behind. The panel keeps showing the session being investigated
    // while getLastSession() has moved on to the new one, and Keep as baseline
    // acts on the new one. Say so rather than letting the two disagree in
    // silence.
    if (artifact.followUp.sessionId !== artifact.source.sessionId) {
      appendExplanationLine(
        panel,
        `Explaining also made a new recording (${sessionLabel(artifact.followUp.sessionId)}). The findings above stay from ${sessionLabel(artifact.source.sessionId)}; getLastSession() now returns the new one.`,
        `source ${artifact.source.sessionId} · follow-up ${artifact.followUp.sessionId}`,
      );
    }
    const status = comparison?.status ?? 'unknown';
    if (status === 'changed' && artifact.firstDifference) {
      appendExplanationLine(panel, differenceVerdict(artifact.firstDifference), artifact.firstDifference.reason);
    } else if (status === 'same') {
      appendExplanationLine(panel, 'The same commands ran again — nothing changed between the frames.');
    } else {
      const reason = comparison?.unknownReason ?? artifact.firstGap?.reason ?? 'missing-reference';
      appendExplanationLine(panel, `Couldn't compare the frames — ${explanationUnknownCopy[reason]}.`, reason);
    }
    // The verdict above names the first difference, so the callsite shown with
    // it must be the sample taken for that same command. Any sample with
    // frames used to do, which could pair a first-difference verdict with a
    // first-raster callsite and present the two as one answer.
    const withFrames = artifact.stacks.filter(candidate => candidate.frames.length > 0);
    const difference = artifact.firstDifference;
    const matching = difference
      ? withFrames.find(candidate => candidate.reason === 'first-difference' && candidate.commandOrdinal === difference.ordinal)
      : undefined;
    const sample = matching ?? withFrames[0];
    if (!sample) {
      appendExplanationLine(panel, 'No draw callsite captured.');
    } else {
      if (difference && !matching) {
        appendExplanationLine(
          panel,
          'No callsite was captured for the command that differed. The one below is from a different command in the same recording.',
          `captured for ${sample.reason}, command ${sample.commandOrdinal}`,
        );
      }
      let appFrames = 0;
      let frameworkFrames = 0;
      for (const frame of sample.frames) {
        const mapped = frame.mapped;
        const file = mapped?.file;
        if (!mapped || !file || /node_modules/.test(file) || appFrames >= 3) { frameworkFrames++; continue; }
        const basename = file.split(/[\\/]/).pop() || file;
        const name = frame.functionName || 'anonymous';
        appendExplanationLine(panel, appFrames === 0 ? `Drawn by ${name} — ${basename}:${mapped.line}` : `via ${name} — ${basename}:${mapped.line}`, `${file}:${mapped.line}:${mapped.column}`);
        appFrames++;
      }
      if (!appFrames) appendExplanationLine(panel, 'Callsite captured but not mapped to app source');
      if (frameworkFrames) appendExplanationLine(panel, `+${frameworkFrames} framework frames`);
    }
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
  const key = findingKey(finding);
  const id = `canvas-scan-finding-${key.replaceAll(':', '-')}`;
  const findingCanvas = sessionCanvas(session, finding.canvasId);
  const owner = ownerWithId(findingCanvas?.nearestReactOwner ?? null, findingCanvas?.attributionKind ?? 'unattributed', finding.canvasId);
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
  control.textContent = `${index + 1}  ${findingLabel(finding.type)} · ${owner}`;
  card.append(control);

  const evidence = document.createElement('div');
  evidence.className = 'finding-evidence';
  evidence.id = `${id}-evidence`;
  appendLine(evidence, '', findingSummary(finding));
  // Always created, because the location can arrive after the card does: the
  // creation site is known with no network, and its mapping through the
  // application's source map is not.
  const drawnFrom = document.createElement('div');
  drawnFrom.className = 'finding-line finding-drawn-from';
  setDrawnFrom(drawnFrom, session, finding);
  evidence.append(drawnFrom);

  if (lifecycleEndsRetired(session, finding.canvasId)) {
    const retired = document.createElement('div');
    retired.className = 'finding-line finding-retired';
    retired.textContent = 'This canvas closed during the recording.';
    evidence.append(retired);
  }
  const unavailable = document.createElement('div');
  unavailable.className = 'finding-line finding-unavailable';
  unavailable.textContent = 'Canvas not on the page.';
  evidence.append(unavailable);

  // A recording that overflowed a cap describes the end of what the user did,
  // not the start, and its findings are derived from what survived. That was
  // only visible in the coverage line at the top of the panel, far from the
  // card a reader acts on.
  if (droppedEntries(session).length) {
    const truncated = document.createElement('div');
    truncated.className = 'finding-line finding-truncated';
    truncated.textContent = 'This recording hit a collection limit. The oldest entries were dropped, so this finding is derived from the later part of the recording only.';
    evidence.append(truncated);
  }

  // The card speaks plainly and the artifact carries the contract. The
  // contract now has a way into the interface too: collapsed by default, so it
  // costs a reader nothing, and one press away when they want to know what the
  // evidence does and does not establish.
  const boundary = document.createElement('details');
  boundary.className = 'finding-boundary';
  const boundarySummary = document.createElement('summary');
  boundarySummary.textContent = 'What this shows, and what it does not';
  boundary.append(boundarySummary);
  appendLine(boundary, 'Evidence level', finding.evidenceLevel);
  appendLine(boundary, 'Observed', finding.claimBoundary.observation);
  appendLine(boundary, 'Reading', finding.claimBoundary.explanation);
  appendLine(boundary, 'Not established', finding.claimBoundary.nonEstablishedFacts);
  appendLine(boundary, 'Next check', finding.nextCheck);
  if (finding.type === 'heavy-canvas-work' && finding.topMethods.length) {
    // The next check names the top measured methods, so they are reachable
    // from the same disclosure rather than only in the exported JSON.
    appendLine(boundary, 'Top measured methods', finding.topMethods.slice(0, 5).map(method =>
      `${method.method} ×${method.count}${method.canvasApiSelfTimeMs === null ? '' : ` (${method.canvasApiSelfTimeMs} ms)`}`).join(' · '));
  }
  evidence.append(boundary);

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
  const drawnFrom = card.querySelector<HTMLElement>('.finding-drawn-from');
  if (drawnFrom) setDrawnFrom(drawnFrom, session, finding);
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

function coverageLabel(name: string, count: number): string {
  const [one, many] = ({
    canvasWindowReports: ['canvas frame report', 'canvas frame reports'],
    canvasLifetimes: ['canvas lifetime', 'canvas lifetimes'],
    resetEvents: ['reset event', 'reset events'],
    lifecycleEvents: ['lifecycle event', 'lifecycle events'],
    documentEvents: ['document event', 'document events'],
    eventTiming: ['Event Timing entry', 'Event Timing entries'],
    userMarks: ['user mark', 'user marks'],
    longAnimationFrames: ['Long Animation Frame entry', 'Long Animation Frame entries'],
  } as Record<string, [string, string]>)[name] ?? [name, name];
  return count === 1 ? one : many;
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
  if (!session.browserFeatures.eventTiming) appendLine(coverage, '', 'Event Timing is unavailable in this browser.');
  if (!session.browserFeatures.longAnimationFrames) appendLine(coverage, '', 'Long Animation Frames are unavailable in this browser.');
  for (const [name, count] of droppedEntries(session)) {
    appendLine(coverage, 'Coverage', `${count} ${coverageLabel(name, count)} dropped`);
  }
  // A canvas the lifetime cap evicted is a state of its own: its totals are
  // real and it still appears in the summaries, but nothing derived per window
  // — episodes, findings, the comparison — can mention it. Say so rather than
  // let a reader assume the summary list and the findings cover the same set.
  const summaryOnly = session.canvases.filter(canvas => canvas.windowDetailDropped).length;
  if (summaryOnly > 0) {
    appendLine(coverage, 'Coverage', `${summaryOnly} ${summaryOnly === 1 ? 'canvas is' : 'canvases are'} kept as a summary only. The recording reached its canvas limit, so their frame detail was dropped and no finding covers them.`);
  }
  coverage.hidden = coverage.childElementCount === 0;
  root.append(coverage);

  if (session.windows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-section session-empty';
    empty.textContent = 'No canvas activity in this recording. Record again and interact with the canvas.';
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
      // No tab stop. These rows are a record of what the recording measured,
      // deliberately separate from live inspection — hovering one must not
      // locate a canvas and clicking one must not open the popover. A tab stop
      // on a row that does nothing when pressed is worse than no tab stop, and
      // the live list below offers the same canvases as real controls.
      line.className = 'session-line canvas-summary';
      line.dataset.summaryIndex = String(index);
      line.dataset.sessionCanvasId = canvas.canvasId;
      const owner = document.createElement('div');
      owner.className = 'session-owner';
      owner.textContent = `${ownerName(canvas.nearestReactOwner, canvas.attributionKind)} · ${canvas.canvasApiSelfTimeMs} ms in Canvas2D · ${canvas.rasterOperationCount} draw calls · slowest frame ${canvas.maxWindowSelfTimeMs} ms`;
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
    more.hidden = true;
    summaries.append(more);
    root.append(summaries);
  }

  const findings = document.createElement('div');
  findings.className = 'session-section findings-list';
  const findingsHeading = document.createElement('div');
  findingsHeading.className = 'session-heading';
  findingsHeading.textContent = 'FINDINGS';
  findings.append(findingsHeading);
  if (session.findings.length === 0) appendLine(findings, '', 'No findings in this recording.');
  // A finding with no measured Canvas2D time is still true, so it is kept and
  // still numbered where the ranking put it. It is just not allowed to pad the
  // list a reader scrolls to be sure they have seen everything. On a fast
  // application these are most of the list; on a slow one they are the tail.
  const ranked: Array<{ finding: InvestigationFinding; index: number }> = [];
  const quiet: Array<{ finding: InvestigationFinding; index: number }> = [];
  for (const [index, finding] of session.findings.entries()) {
    // The reader is about to be told a canvas is slow. Ask where it came from
    // now, so the card can say it in their source rather than in the bundle.
    // Once per canvas, and the source-map lookup cap still bounds the fetches.
    requestSource(finding.canvasId);
    (finding.canvasApiSelfTimeMs > 0 ? ranked : quiet).push({ finding, index });
  }
  for (const { finding, index } of ranked) findings.append(createFinding(session, finding, index));
  if (quiet.length) {
    const group = document.createElement('details');
    group.className = 'finding-quiet';
    const summary = document.createElement('summary');
    // "more" only reads correctly when there is something above to be more
    // than. When every finding is empty, say that instead of implying a list
    // that is not there.
    summary.textContent = ranked.length === 0
      ? `${quiet.length} finding${quiet.length === 1 ? '' : 's'}, none with measured time`
      : `${quiet.length} more finding${quiet.length === 1 ? '' : 's'} with no measured time`;
    group.append(summary);
    // Clicking an inspect outline expands the matching card and focuses its
    // control. That control is not reachable inside a closed disclosure, so
    // the group opens whenever it holds the expanded card.
    group.open = quiet.some(({ finding }) => findingKey(finding) === expandedFindingId);
    for (const { finding, index } of quiet) group.append(createFinding(session, finding, index));
    findings.append(group);
  }
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
  for (const [index, summary] of summaries.entries()) {
    summary.hidden = !showAllSessionCanvases && index >= 8;
  }
  const more = root.querySelector<HTMLButtonElement>('.summary-more');
  const hiddenSummaries = Math.max(0, summaries.length - 8);
  if (more) {
    if (showAllSessionCanvases || hiddenSummaries === 0) {
      // Removed rather than hidden, and focus goes to the rows it revealed —
      // the same behaviour the live list's control already had.
      const wasActive = root.getRootNode() instanceof ShadowRoot &&
        (root.getRootNode() as ShadowRoot).activeElement === more;
      more.remove();
      if (wasActive) summaries[8]?.focus();
    } else {
      more.hidden = false;
      more.textContent = `+${hiddenSummaries} more`;
    }
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
    const owner = ownerName(canvasStats.owner, canvasStats.kind);
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
    // A retired canvas keeps its row and its last figures, but says it stopped
    // drawing. Without this the list mixes canvases that are drawing now with
    // canvases canvas-scan is no longer following, and they look the same.
    const retired = retiredCanvasIds.has(canvasId);
    row.classList.toggle('stale', retired);
    if (retired) {
      content += ' · stopped drawing';
      title += ' It has stopped drawing and canvas-scan is no longer following it. Drawing again brings it back.';
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
    // Optional: a commit can land before the document element exists when
    // canvas-scan is injected at document-start. attachHost owns the retry.
    (document.body ?? document.documentElement)?.append(host);
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
  // Two different counts, so two different labels. With a completed recording
  // this is the number of findings; without one it is the number of canvases
  // seen redrawing the same commands live. Calling both "review candidates"
  // made a live count of 0 read as "nothing to look at" while canvases flashed.
  let totalCandidates = shownSession?.findings.length ?? 0;
  if (!shownSession) for (const canvasStats of stats.values()) {
    if (canvasStats.candidate) totalCandidates++;
  }
  canvasCount.textContent = `${stats.size} ${stats.size === 1 ? 'canvas' : 'canvases'}${droppedCanvasIds.size ? ` (+${droppedCanvasIds.size} not tracked)` : ''} · `;
  canvasCount.title = droppedCanvasIds.size
    ? `canvas-scan follows at most ${MAX_TRACKED_CANVASES} canvases at once. ${droppedCanvasIds.size} left the list and return as soon as they draw again.`
    : '';
  candidateCount.textContent = shownSession
    ? `${totalCandidates} review ${totalCandidates === 1 ? 'candidate' : 'candidates'}`
    : `${totalCandidates} ${totalCandidates === 1 ? 'canvas' : 'canvases'} repeating`;
  candidateCount.classList.toggle('accent', totalCandidates > 0);
  toolbar.classList.toggle('collapsed', collapsed);
  const collapsedDot = toolbar.querySelector<HTMLElement>('.collapsed-dot');
  const runOpen = getRecordingState() === 'recording';
  collapsedDot?.classList.toggle('accent', totalCandidates > 0);
  // Collapsing hides Stop. The dot says a run is still open and expanding
  // brings Stop back, so the run is never invisible and unstoppable.
  collapsedDot?.classList.toggle('recording', runOpen);
  if (collapsedDot) {
    collapsedDot.title = runOpen ? 'Recording — expand to stop' : 'Expand canvas-scan';
    collapsedDot.setAttribute('aria-label', runOpen ? 'Recording in progress. Expand canvas-scan to stop.' : 'Expand canvas-scan');
  }
  countsButton.setAttribute('aria-expanded', String(flyoutOpen));
  inspectButton?.classList.toggle('active', inspectMode);
  inspectButton?.setAttribute('aria-pressed', String(inspectMode));
  updateDockTransform();

  for (const { canvasId, report, same } of pendingFlashes.splice(0)) {
    const canvas = canvases.get(canvasId);
    if (canvas instanceof Element) flashOutline(report, canvas, same);
  }
  // A canvas leaving the page, or retiring, changes what the flyout should
  // show, and neither goes through a code path that bumps the revision. The
  // flyout is only re-rendered on a revision change, so a finding card would
  // keep offering actions against a canvas that is no longer there until some
  // unrelated interaction forced a re-render. Watch the state itself instead.
  const liveSignature = [
    ...(shownSession?.findings ?? []).map(finding => {
      const live = canvases.get(finding.canvasId);
      return `${finding.canvasId}:${live instanceof Element && live.isConnected ? 1 : 0}`;
    }),
    ...[...stats.keys()].map(canvasId => `${canvasId}:${retiredCanvasIds.has(canvasId) ? 'r' : 'a'}`),
  ].join('|');
  if (liveSignature !== renderedLiveSignature) {
    renderedLiveSignature = liveSignature;
    flyoutRevision++;
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
  // Kept focusable so the focus is not dropped, but it looks the way it is
  // announced: inert, not pressable.
  stopRecordingButton.classList.toggle('inert', !recording && stopFocused);
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

// True while the focused element is the overlay host or lives inside its
// shadow root. The document's activeElement is the host itself for anything
// inside the shadow tree.
function overlayHasFocus(): boolean {
  if (!host) return false;
  if (host.shadowRoot?.activeElement) return true;
  return typeof document !== 'undefined' && document.activeElement === host;
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
    // Escape belongs to whatever the user is working in. The overlay takes it
    // only while focus is inside the overlay, so a dialog or menu in the host
    // application keeps its own dismissal. Inspect mode is the exception: it
    // paints over the page and takes focus nowhere, so its own exit stays
    // reachable from anywhere.
    if (!overlayHasFocus() && !inspectMode) return;
    if (!overlayHasFocus()) { exitInspectMode(); return; }
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

// Enough of the dock has to stay on screen to grab it again. Without this a
// drag past the edge leaves the overlay unreachable until a reload.
const MINIMUM_VISIBLE_DOCK_PX = 48;

function clampDrag(x: number, y: number): { x: number; y: number } {
  if (!dock || typeof window === 'undefined') return { x, y };
  const box = dock.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (!box.width || !box.height || !viewportWidth || !viewportHeight) return { x, y };
  // The box already includes the current translate, so work out where the
  // untranslated dock sits and clamp the offset against that.
  const restLeft = box.left - dragX;
  const restTop = box.top - dragY;
  // Each axis is clamped against its own dimension. Taking the smaller of the
  // two would let a short dock give away horizontal margin it does not need.
  const visibleX = Math.min(MINIMUM_VISIBLE_DOCK_PX, box.width);
  const visibleY = Math.min(MINIMUM_VISIBLE_DOCK_PX, box.height);
  return {
    x: Math.min(Math.max(x, visibleX - box.width - restLeft), viewportWidth - visibleX - restLeft),
    y: Math.min(Math.max(y, visibleY - box.height - restTop), viewportHeight - visibleY - restTop),
  };
}

function handlePointerMove(event: PointerEvent): void {
  if (!dragStart) return;
  const clamped = clampDrag(
    dragStart.x + event.clientX - dragStart.pointerX,
    dragStart.y + event.clientY - dragStart.pointerY,
  );
  dragX = clamped.x;
  dragY = clamped.y;
  markDirty();
}

function handlePointerUp(): void {
  if (dragStart && toolbar) {
    // A release outside the window is still delivered to the captured element,
    // so the dock stops following the pointer.
    try { toolbar?.releasePointerCapture(dragStart.pointerId); } catch { /* already released */ }
  }
  dragStart = null;
  document.removeEventListener('pointermove', handlePointerMove);
  document.removeEventListener('pointerup', handlePointerUp);
}

function handleToolbarPointerDown(event: PointerEvent): void {
  if (event.target !== toolbar) return;
  dragStart = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    pointerId: event.pointerId,
    x: dragX,
    y: dragY,
  };
  try { toolbar?.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
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
    if (!source || !finding || action.dataset.sessionId !== source.sessionId) {
      const status = action.closest<HTMLElement>('.finding-card')?.querySelector<HTMLElement>('.finding-status');
      if (status) status.textContent = 'Recording changed — select the finding again.';
      return;
    }
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
      const status = action.closest<HTMLElement>('.finding-card')?.querySelector<HTMLElement>('.finding-status');
      if (status) {
        status.textContent = result.status === 'already-active'
          ? 'Already explaining — repeat the interaction.'
          : 'Explaining now — repeat the interaction (stops after 10 s).';
      }
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
    // Guarded the way the explanation and comparison copies are. A slow
    // clipboard resolving after a new recording started would otherwise write
    // its result into the panel showing that new recording.
    const sessionId = shownSession.sessionId;
    const request = ++copySessionRequest;
    const copied = (status: string) => {
      if (request !== copySessionRequest || shownSession?.sessionId !== sessionId) return;
      copySessionStatus = status; flyoutRevision++; markDirty();
    };
    try {
      if (!navigator.clipboard?.writeText) copied('Copy failed');
      else void navigator.clipboard.writeText(JSON.stringify(shownSession)).then(() => copied('Session JSON copied')).catch(() => copied('Copy failed'));
    } catch { copied('Copy failed'); }
    return;
  }
  if (action?.dataset.action === 'download-session' && shownSession) {
    // A blocked or failed download used to report success anyway. Only the
    // steps that actually ran are reported.
    copySessionRequest++;
    let url: string | undefined;
    try {
      const blob = new Blob([JSON.stringify(shownSession)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${shownSession.sessionId}.json`;
      anchor.click();
      copySessionStatus = 'Session JSON download started';
    } catch {
      copySessionStatus = 'Download failed';
    } finally {
      if (url !== undefined) URL.revokeObjectURL(url);
    }
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
    sameStreak: 0,
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
  canvasStats.sameStreak = report.signatureStatus === 'same' ? canvasStats.sameStreak + 1 : 0;
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
      same: canvasStats.sameStreak,
    });
  }
  markDirty();
}

// Injected at document-start — by a browser extension, or by an automation
// harness through addInitScript or Page.addScriptToEvaluateOnNewDocument —
// canvas-scan runs before the document element exists, so there is nothing to
// append to yet. Appending anyway threw, and because start() sets its global
// only after mounting, the throw left the Canvas2D prototypes patched with no
// API and no overlay: all of the overhead and none of the tool.
//
// The script-tag position the README documents is not affected, because the
// document element exists by the time a script in <head> runs. Waiting for the
// document covers the earlier position too.
function attachHost(element: HTMLElement): void {
  const parent = document.body ?? document.documentElement;
  if (parent) {
    parent.append(element);
    return;
  }
  const attachWhenReady = () => {
    document.removeEventListener('DOMContentLoaded', attachWhenReady);
    // mountOverlay may have been torn down before the document arrived.
    if (host !== element) return;
    (document.body ?? document.documentElement)?.append(element);
    markDirty();
  };
  document.addEventListener('DOMContentLoaded', attachWhenReady);
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
  countsButton.title = 'Show canvas activity and findings.';
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
  // A named dialog rather than an anonymous div, so a screen reader announces
  // what opened and which canvas it is about. Not modal: the page underneath
  // stays usable while the popover is open.
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-labelledby', 'canvas-scan-popover-title');
  popover.addEventListener('click', handlePopoverClick);

  const popoverHeader = document.createElement('div');
  popoverHeader.className = 'popover-header';
  const popoverBadge = document.createElement('span');
  popoverBadge.className = 'badge popover-badge';
  const popoverOwner = document.createElement('span');
  popoverOwner.className = 'popover-owner';
  popoverOwner.id = 'canvas-scan-popover-title';
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
  // The other three copy actions each report their result. This one now does
  // too, so a failed copy stops looking like a successful one.
  const copyStatus = document.createElement('div');
  copyStatus.className = 'popover-line popover-copy-status';
  copyStatus.setAttribute('aria-live', 'polite');
  popoverBody.append(copy, copyStatus);
  popover.append(popoverHeader, popoverBody);

  dock.append(flyout, popover, toolbar);
  shadowRoot.append(outlineLayer, dock);

  attachHost(host);
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
      for (const node of flyout?.querySelectorAll<HTMLElement>('.finding-status') ?? []) node.textContent = '';
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
    // While a panel is open its contents depend on page state nothing reports:
    // a canvas can leave the document or retire with no event to hang a
    // re-render on. Commit on the tick so those views correct themselves.
    if (inspectMode || outlines.size > 0 || flyoutOpen || selectedCanvasId !== null) dirty = true;
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
