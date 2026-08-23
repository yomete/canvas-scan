import type { RecordedBrowserEvidenceEntry, RecordedLongAnimationFrameScript } from './types.js';

const MAX_ENTRIES = 2000;
const MAX_SCRIPTS = 20;
const documentEventTypes = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'keydown', 'keyup', 'wheel', 'input', 'change'];
const standardTerminalTags = new Set('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture portal pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg animate animateMotion animateTransform circle clipPath defs desc ellipse feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter foreignObject g image line linearGradient marker mask metadata mpath path pattern polygon polyline radialGradient rect set stop switch symbol text textPath tspan use view'.split(' ').map(tag => tag.toLowerCase()));
type FeatureFlags = { eventTiming: boolean; longAnimationFrames: boolean };
type DropCounts = { documentEvents: number; eventTiming: number; userMarks: number; longAnimationFrames: number };
type EntryLike = Record<string, unknown>;
type ObserverLike = { observe(options: unknown): void; disconnect(): void; takeRecords?(): EntryLike[] };

let active = false;
let startedAt = 0;
let entries: RecordedBrowserEvidenceEntry[] = [];
let sequence = 0;
let eventObserver: ObserverLike | undefined;
let longFrameObserver: ObserverLike | undefined;
let generation = 0;
let features: FeatureFlags = { eventTiming: false, longAnimationFrames: false };
let dropped: DropCounts = { documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 };

function now(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
function read(object: unknown, key: string): unknown { try { return object && (typeof object === 'object' || typeof object === 'function') ? (object as Record<string, unknown>)[key] : undefined; } catch { return undefined; } }
function finite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function clean(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const result = [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().replace(/\s+/g, ' ')].slice(0, limit).join('');
  return result || null;
}
function cleanURL(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  return clean(withoutQuery, 200);
}
function cleanInvoker(value: unknown): string | null {
  const text = clean(value, 200);
  if (!text) return null;
  const handler = text.match(/\.(on[a-z0-9_-]+)$/i)?.[1];
  const terminal = text.split(/[\s>+~|]+/).at(-1) ?? '';
  const tag = terminal.match(/^(?:[a-z][a-z0-9-]*:)?([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase();
  const hasSelectorMarker = /[#[\]:>+~|*]|\s/.test(text) || terminal.startsWith('.');
  const dotPrefix = terminal.match(/^([a-z][a-z0-9-]*)\./i)?.[1]?.toLowerCase();
  const isDotOnlyDom = !hasSelectorMarker && !!dotPrefix && (standardTerminalTags.has(dotPrefix) || dotPrefix.includes('-'));
  if (!hasSelectorMarker && !isDotOnlyDom) return text;
  if (!tag) return handler?.toLowerCase() ?? null;
  return handler ? `${tag}.${handler.toLowerCase()}` : tag;
}
function entryRange(entry: EntryLike): { start: number; end: number } | null {
  const start = finite(read(entry, 'startTime')); const duration = finite(read(entry, 'duration'));
  return start === null || duration === null ? null : { start, end: start + Math.max(0, duration) };
}
function overlaps(start: number, end: number, rangeEnd: number): boolean { return start <= rangeEnd && startedAt <= end; }
function add(entry: RecordedBrowserEvidenceEntry): void {
  if (entries.length === MAX_ENTRIES) {
    const removed = entries.shift()!;
    if (removed.kind === 'document-event') dropped.documentEvents++;
    else if (removed.kind === 'event-timing') dropped.eventTiming++;
    else if (removed.kind === 'user-mark') dropped.userMarks++;
    else dropped.longAnimationFrames++;
  }
  entries.push(entry);
}
function nextId(): string { return `browser-evidence-${++sequence}`; }
function targetTag(target: unknown): string { return clean(read(target, 'tagName'), 80)?.toLowerCase() ?? ''; }
function approvedEventType(value: unknown): string | null { const type = clean(value, 80); return type && documentEventTypes.includes(type) ? type : null; }
function onDocumentEvent(event: Event): void {
  if (!active) return;
  const type = approvedEventType(read(event, 'type')); if (!type) return;
  const current = now(); const eventTimestamp = finite(read(event, 'timeStamp'));
  if (eventTimestamp !== null && (eventTimestamp < startedAt || eventTimestamp > current)) return;
  const timestamp = eventTimestamp ?? current;
  add({ entryId: nextId(), kind: 'document-event', eventType: type, startedAtTimestampMs: timestamp, endedAtTimestampMs: timestamp, targetTagName: targetTag(read(event, 'target')) });
}
function copyScript(value: unknown): RecordedLongAnimationFrameScript {
  return { invoker: cleanInvoker(read(value, 'invoker')), invokerType: clean(read(value, 'invokerType'), 200), sourceURL: cleanURL(read(value, 'sourceURL')), sourceFunctionName: clean(read(value, 'sourceFunctionName'), 200), executionStartTimestampMs: finite(read(value, 'executionStart')), durationMs: finite(read(value, 'duration')), forcedStyleAndLayoutDurationMs: finite(read(value, 'forcedStyleAndLayoutDuration')), pauseDurationMs: finite(read(value, 'pauseDuration')) };
}
function processEventTiming(entry: EntryLike, rangeEnd: number): void {
  try {
    const type = approvedEventType(read(entry, 'name')); const range = entryRange(entry); const duration = finite(read(entry, 'duration'));
    if (!type || !range || duration === null || !overlaps(range.start, range.end, rangeEnd)) return;
    add({ entryId: nextId(), kind: 'event-timing', eventType: type, startedAtTimestampMs: range.start, endedAtTimestampMs: range.end, targetTagName: targetTag(read(entry, 'target')), durationMs: duration, interactionId: finite(read(entry, 'interactionId')) ?? null });
  } catch {}
}
function processLongFrame(entry: EntryLike, rangeEnd: number): void {
  try {
    const range = entryRange(entry); const duration = finite(read(entry, 'duration'));
    if (!range || duration === null || !overlaps(range.start, range.end, rangeEnd)) return;
    const scriptValues = read(entry, 'scripts'); const source = Array.isArray(scriptValues) ? scriptValues : [];
    add({ entryId: nextId(), kind: 'long-animation-frame', startedAtTimestampMs: range.start, endedAtTimestampMs: range.end, durationMs: duration, blockingDurationMs: finite(read(entry, 'blockingDuration')) ?? 0, scripts: source.slice(0, MAX_SCRIPTS).map(copyScript), droppedScriptAttributionCount: Math.max(0, source.length - MAX_SCRIPTS) });
  } catch {}
}
function disconnect(observer: ObserverLike | undefined): void { try { observer?.disconnect(); } catch {} }
function makeObserver(type: 'event' | 'long-animation-frame', process: (entry: EntryLike, rangeEnd: number) => void, owner: number): ObserverLike | undefined {
  const Observer = read(globalThis, 'PerformanceObserver') as (new (callback: (list: { getEntries(): EntryLike[] }) => void) => ObserverLike) | undefined;
  if (typeof Observer !== 'function') return undefined;
  let observer: ObserverLike | undefined;
  try {
    observer = new Observer(list => { if (!active || generation !== owner) return; try { for (const entry of list.getEntries()) process(entry, now()); } catch {} });
    observer.observe(type === 'event' ? { type, buffered: true, durationThreshold: 16 } : { type, buffered: true });
    return observer;
  } catch { disconnect(observer); return undefined; }
}
function supportedTypes(): unknown[] { try { const observer = read(globalThis, 'PerformanceObserver'); const types = read(observer, 'supportedEntryTypes'); return Array.isArray(types) ? types : []; } catch { return []; } }
function removeListeners(): void { if (typeof document !== 'undefined') for (const type of documentEventTypes) document.removeEventListener(type, onDocumentEvent, true); }
export function startBrowserEvidence(start: number): FeatureFlags {
  resetBrowserEvidence(); active = true; startedAt = start;
  const owner = generation;
  const supported = supportedTypes();
  if (supported.includes('event')) eventObserver = makeObserver('event', processEventTiming, owner);
  if (supported.includes('long-animation-frame')) longFrameObserver = makeObserver('long-animation-frame', processLongFrame, owner);
  features = { eventTiming: eventObserver !== undefined, longAnimationFrames: longFrameObserver !== undefined };
  if (typeof document !== 'undefined') for (const type of documentEventTypes) document.addEventListener(type, onDocumentEvent, true);
  return { ...features };
}
export function stopBrowserEvidence(end: number): { entries: RecordedBrowserEvidenceEntry[]; features: FeatureFlags; dropped: DropCounts } {
  for (const [observer, process] of [[eventObserver, processEventTiming], [longFrameObserver, processLongFrame]] as const) {
    try { for (const entry of observer?.takeRecords?.() ?? []) process(entry, end); } catch {}
  }
  active = false; generation++;
  disconnect(eventObserver); disconnect(longFrameObserver); removeListeners(); eventObserver = undefined; longFrameObserver = undefined;
  return { entries: entries.map(entry => JSON.parse(JSON.stringify(entry))), features: { ...features }, dropped: { ...dropped } };
}
export function markBrowserEvidence(label: string): void {
  if (!active) return;
  const cleaned = clean(label, 80); if (!cleaned) return;
  const timestamp = now(); add({ entryId: nextId(), kind: 'user-mark', startedAtTimestampMs: timestamp, endedAtTimestampMs: timestamp, label: cleaned });
}
export function resetBrowserEvidence(): void {
  active = false; generation++;
  disconnect(eventObserver); disconnect(longFrameObserver); removeListeners();
  startedAt = 0; entries = []; sequence = 0; eventObserver = undefined; longFrameObserver = undefined; features = { eventTiming: false, longAnimationFrames: false }; dropped = { documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 };
}
