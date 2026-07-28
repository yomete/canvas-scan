import {
  getHistory,
  getLatestReport,
  getTrackedCanvasIds,
  setSourceLocation,
  subscribeToReports,
} from './frame-loop';
import { resolveSourceOutcome } from './symbolicate';
import type {
  AttributionKind,
  CanvasScanOptions,
  DrawBatchReport,
  SourceLocation,
} from './types';

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
let canvasCount: HTMLSpanElement | null = null;
let candidateCount: HTMLSpanElement | null = null;
let flyout: HTMLDivElement | null = null;
let popover: HTMLDivElement | null = null;
let collapsed = false;
let flyoutOpen = false;
let showAllRows = false;
let inspectMode = false;
let selectedCanvasId: string | null = null;
let minFlashRasterOps = 2;
let refreshInterval: number | null = null;
let survivalInterval: number | null = null;
let commitAnimationFrame: number | null = null;
let dirty = false;
let flyoutRevision = 0;
let renderedFlyoutRevision = -1;
let unsubscribe: (() => void) | null = null;
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
  width: 310px;
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
  'gets the same instructions twice, that redraw may be avoidable.';

const UNKNOWN_PHRASES = new Map([
  ['first-window', 'first frame seen — nothing to compare yet'],
  ['previous-window', 'the last frame it was compared with was unclear'],
  ['canvas-resize', 'the canvas was resized'],
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

function placeOutline(outline: HTMLDivElement, canvas: Element): boolean {
  if (!canvas.isConnected) {
    outline.hidden = true;
    outline.style.pointerEvents = 'none';
    return false;
  }
  if (!isVisiblyHitTestable(canvas)) {
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

function isVisiblyHitTestable(canvas: Element): boolean {
  if (typeof getComputedStyle !== 'function') return true;
  // Computed pointer-events already resolves inheritance, so the canvas's own
  // value is the answer: if the page lets clicks pass through it, our outline
  // must not catch them instead.
  if (getComputedStyle(canvas).pointerEvents === 'none') return false;
  for (let el: Element | null = canvas; el;) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    if (style.display === 'none') return false;
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

function ensureOutline(canvasId: string, canvas: Element): HTMLDivElement | null {
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
  return placeOutline(outline, canvas) ? outline : null;
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

function locateCanvas(canvasId: string): void {
  const canvas = canvases.get(canvasId);
  if (!(canvas instanceof Element) || !canvas.isConnected) return;
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
}

function updateInspectOutlines(): void {
  // Placement reads layout and computed style, so each outline is placed at
  // most once per commit and the result is reused below.
  const placements = new Map<string, boolean>();
  for (const [canvasId, canvas] of canvases) {
    if (!(canvas instanceof Element)) continue;
    if (!inspectMode && !locatingCanvases.has(canvasId)) continue;
    placements.set(canvasId, ensureOutline(canvasId, canvas) !== null);
  }

  for (const [canvasId, outline] of outlines) {
    const canvas = canvases.get(canvasId);
    const active = placements.get(canvasId) === true;
    const placed =
      placements.get(canvasId) ??
      (canvas instanceof Element && placeOutline(outline, canvas));
    const interactive = inspectMode && placed;
    if (interactive) {
      const label = outline.querySelector('.label');
      if (label && !outline.classList.contains('flash')) {
        label.textContent = stats.get(canvasId)?.owner ?? canvasId;
      }
    }
    outline.classList.toggle('inspect', interactive);
    outline.classList.toggle('selected', canvasId === selectedCanvasId);
    outline.classList.toggle('locate', locatingCanvases.has(canvasId) && placed);
    outline.style.pointerEvents = interactive ? 'auto' : 'none';
    if (!placed || !active) clearOutline(canvasId);
  }
}

function closePopover(): void {
  selectedCanvasId = null;
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
}

function openPopover(canvasId: string): void {
  const canvasStats = stats.get(canvasId);
  if (!canvasStats) return;
  selectedCanvasId = canvasId;
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
  flyout.append(note);
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
    const owner = canvasStats.owner ?? canvasId;
    let content =
      `${owner} · same in ${aggregate.same} of ${frames(aggregate.windows)}`;
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
  let more = flyout.querySelector<HTMLButtonElement>('.more');
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
  // Per-canvas overlay state must not outlive the core's retention. An empty
  // set means the frame loop is not the thing feeding this overlay (before the
  // first report, or when reports are pushed directly), so there is nothing to
  // prune against.
  const tracked = getTrackedCanvasIds();
  if (tracked.size > 0) {
    for (const canvasId of [...stats.keys()]) {
      if (tracked.has(canvasId)) continue;
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
  let totalCandidates = 0;
  for (const canvasStats of stats.values()) {
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
  if (event.key === 'Escape' && inspectMode) exitInspectMode();
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
  openPopover(canvasId);
}

function handleFlyoutClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.more')) {
    showAllRows = true;
    flyoutRevision++;
    markDirty();
    return;
  }
  const canvasId = findCanvasId(event.target);
  if (canvasId) openPopover(canvasId);
}

function handleFlyoutMouseover(event: MouseEvent): void {
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
    `${EXPLAINER} Review candidates are canvases that received the same ` +
    'draw commands again — often a sign of avoidable redrawing.';
  countsButton.setAttribute('aria-expanded', 'false');
  canvasCount = document.createElement('span');
  canvasCount.className = 'canvas-count';
  candidateCount = document.createElement('span');
  candidateCount.className = 'candidate-count';
  countsButton.append(canvasCount, candidateCount);
  countsButton.addEventListener('click', () => {
    flyoutOpen = !flyoutOpen;
    selectedCanvasId = null;
    showAllRows = false;
    flyoutRevision++;
    markDirty();
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
  canvasCount = null;
  candidateCount = null;
  flyout = null;
  popover = null;
  collapsed = false;
  flyoutOpen = false;
  showAllRows = false;
  inspectMode = false;
  selectedCanvasId = null;
  minFlashRasterOps = 2;
  dirty = false;
  flyoutRevision = 0;
  renderedFlyoutRevision = -1;
  dragStart = null;
  dragX = 0;
  dragY = 0;
  outlines.clear();
  flyoutRows.clear();
  locatingCanvases.clear();
  fadingFlashes.clear();
  expiredFlashes.clear();
  pendingFlashes.length = 0;
  stats.clear();
  canvases.clear();
  sourceStates.clear();
  sourceErrors.clear();
}
