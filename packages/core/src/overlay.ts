import { subscribeToReports } from './frame-loop';
import type { CanvasScanOptions, DrawBatchReport } from './types';

const stats = new Map<
  string,
  {
    owner: string | null;
    windows: number;
    same: number;
    changed: number;
    unknown: number;
  }
>();
const outlines = new Map<string, HTMLDivElement>();

let host: HTMLDivElement | null = null;
let hud: HTMLDivElement | null = null;
let hudText: Text | null = null;
let hudList: HTMLUListElement | null = null;
let lastHudListUpdate = -Infinity;
let minFlashRasterOps = 2;
let survivalInterval: number | null = null;
let unsubscribe: (() => void) | null = null;

const styles = `
.outline {
  position: fixed;
  border: 2px solid #ef4444;
  border-radius: 3px;
  pointer-events: none;
  opacity: 0;
}
.outline.flash { opacity: 1; }
.outline.flash.fading { opacity: 0; transition: opacity 700ms ease-out 300ms; }
.outline .label {
  position: absolute;
  top: -18px;
  left: -2px;
  background: #ef4444;
  color: #fff;
  font: 11px/14px ui-monospace, monospace;
  padding: 1px 5px;
  border-radius: 2px;
  white-space: nowrap;
}
.hud {
  position: fixed;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  font: 11px/16px ui-monospace, monospace;
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}
.hud-list { display: none; margin: 4px 0 0; padding: 0; list-style: none; }
.hud.open .hud-list { display: block; }
`;

function updateHud(): void {
  if (!hudText || !hudList) return;

  let totalSame = 0;
  for (const canvasStats of stats.values()) {
    totalSame += canvasStats.same;
  }

  const text = `canvas-scan · ${stats.size} canvases · ${totalSame} review candidates`;
  if (hudText.nodeValue !== text) hudText.nodeValue = text;

  const now = Date.now();
  if (now - lastHudListUpdate < 500) return;
  lastHudListUpdate = now;
  hudList.replaceChildren();

  for (const [canvasId, canvasStats] of stats) {
    const item = document.createElement('li');
    item.textContent = `${canvasStats.owner ?? canvasId} · ${canvasStats.same}/${canvasStats.windows} same`;
    hudList.append(item);
  }
}

function flashOutline(
  report: DrawBatchReport,
  canvas: Element,
  same: number,
): void {
  if (!host?.shadowRoot || !canvas.isConnected) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  let outline = outlines.get(report.canvasId);
  if (!outline) {
    outline = document.createElement('div');
    outline.className = 'outline';
    const label = document.createElement('span');
    label.className = 'label';
    outline.append(label);
    host.shadowRoot.append(outline);
    outlines.set(report.canvasId, outline);
  }

  outline.style.top = `${rect.top - 2}px`;
  outline.style.left = `${rect.left - 2}px`;
  outline.style.width = `${rect.width + 4}px`;
  outline.style.height = `${rect.height + 4}px`;
  const label = outline.querySelector('.label');
  if (label) {
    label.textContent = `${report.nearestReactOwner ?? report.canvasId} · same signature ×${same}`;
  }

  outline.classList.remove('flash', 'fading');
  // Force reflow so consecutive same-signature windows restart the flash.
  void outline.offsetWidth;
  outline.classList.add('flash');
  requestAnimationFrame(() => outline.classList.add('fading'));
}

function handleReport(report: DrawBatchReport, canvas: unknown): void {
  const canvasStats = stats.get(report.canvasId) ?? {
    owner: report.nearestReactOwner,
    windows: 0,
    same: 0,
    changed: 0,
    unknown: 0,
  };
  canvasStats.owner = report.nearestReactOwner;
  canvasStats.windows++;
  canvasStats[report.signatureStatus]++;
  stats.set(report.canvasId, canvasStats);

  updateHud();

  if (
    report.signatureStatus === 'same' &&
    // 1-op `same` windows (mount double-draws, wake-up repaints) are noise next to multi-op redraw candidates — Excalidraw dogfood finding 4.
    report.rasterOperationCount >= minFlashRasterOps &&
    canvas instanceof Element
  ) {
    flashOutline(report, canvas, canvasStats.same);
  }
}

export function mountOverlay(options: CanvasScanOptions = {}): void {
  if (typeof document === 'undefined' || host) return;
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

  hud = document.createElement('div');
  hud.className = 'hud';
  hudText = document.createTextNode('canvas-scan · 0 canvases · 0 review candidates');
  hudList = document.createElement('ul');
  hudList.className = 'hud-list';
  hud.append(hudText, hudList);
  hud.addEventListener('click', () => hud?.classList.toggle('open'));
  shadowRoot.append(hud);

  (document.body ?? document.documentElement).append(host);
  unsubscribe = subscribeToReports(handleReport);
  survivalInterval = window.setInterval(() => {
    if (host && !host.isConnected) {
      (document.body ?? document.documentElement).append(host);
    }
  }, 1000);
}

export function unmountOverlay(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (survivalInterval !== null) window.clearInterval(survivalInterval);
  survivalInterval = null;
  host?.remove();
  host = null;
  hud = null;
  hudText = null;
  hudList = null;
  outlines.clear();
  stats.clear();
  lastHudListUpdate = -Infinity;
  minFlashRasterOps = 2;
}
