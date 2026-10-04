import { getSourceFromSourceMap, getSourceMap, parseStack } from 'bippy/source';
import type { CommandWindowIdentity } from './command-capture.js';
import type { ExplanationStackFrame, ExplanationStackSample } from './types.js';

export const MAX_STACK_SAMPLES = 8;
export const MAX_FRAMES_PER_STACK = 20;
export const MAX_SOURCE_MAP_LOOKUPS = 8;
export const MAX_SOURCE_MAP_RESPONSE_BYTES = 2097152;
export const MAX_CREATION_SITE_STACKS = 256;

type Reason = ExplanationStackSample['reason'];
type UnresolvedReason = ExplanationStackFrame['unresolvedReason'];
type SourceMapResult = Awaited<ReturnType<typeof getSourceMap>>;
type PendingFrame = { frame: ExplanationStackFrame; line: number; column: number };
type Lookup = {
  frames: PendingFrame[];
  work: Promise<void>;
  failure: UnresolvedReason | null;
  declaredMap: boolean;
  mapRequested: boolean;
  done: boolean;
  result: SourceMapResult;
  target: CommandWindowIdentity;
  commandOrdinal: number;
};
type Capture = {
  stacks: ExplanationStackSample[];
  dropped: { stackSamples: number; stackFrames: number; sourceMapLookups: number; sourceMapResponses: number };
  firstAffected: Partial<Record<'stackSamples' | 'stackFrames' | 'sourceMapLookups' | 'sourceMapResponses', { identity: CommandWindowIdentity; commandOrdinal: number; windowIndex: number }>>;
  resolvedWindows: WeakMap<CommandWindowIdentity, number>;
  firstRaster: boolean;
  firstDifferences: Set<CommandWindowIdentity>;
  heaviestMethods: Set<CommandWindowIdentity>;
  targets: Map<ExplanationStackSample, CommandWindowIdentity>;
  lookups: Map<string, Lookup>;
  locationHref: string;
  fetch: typeof fetch;
  active: boolean;
};
type CaptureOptions = { locationHref?: string; fetch?: typeof fetch };

const SOURCE_MAP_DIRECTIVE = /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^*]+?)[ \t]*(?:\*\/)[ \t]*$)/m;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const apply = Reflect.apply;
const createObject = Object.create;
const globalErrorDescriptor = getOwnPropertyDescriptor(globalThis, 'Error');
const globalError = globalErrorDescriptor && 'value' in globalErrorDescriptor && typeof globalErrorDescriptor.value === 'function' ? globalErrorDescriptor.value : null;
const nativeErrorSource = globalError ? apply(Function.prototype.toString, globalError, []) === 'function Error() { [native code] }' : false;
const StackError = nativeErrorSource ? globalError as ErrorConstructor : null;
const captureStackTraceDescriptor = StackError ? getOwnPropertyDescriptor(StackError, 'captureStackTrace') : undefined;
const nativeCaptureStackTrace = captureStackTraceDescriptor && 'value' in captureStackTraceDescriptor && typeof captureStackTraceDescriptor.value === 'function'
  ? captureStackTraceDescriptor.value as (target: object, boundary?: (...args: unknown[]) => unknown) => void
  : null;
let stackAllocations = 0;
let sourceMapLookups = 0;
// Counted apart from stackAllocations on purpose. That counter guards a
// promise — canvas-scan allocates no stack unless you ask for an explanation —
// and creation sites are a standing cost paid once per canvas whether you ask
// or not. Folding the two together would let this cost hide behind that
// promise.
let creationSiteStacks = 0;

function parsedHttpUrl(value: string, base: string): URL | null {
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch { return null; }
}
function safeResourceUrl(value: string, base: string): URL | null {
  const url = parsedHttpUrl(value, base);
  const origin = parsedHttpUrl(base, base)?.origin;
  return url && origin && url.origin === origin ? url : null;
}
function exportedUrl(url: URL): string {
  const value = new URL(url.href);
  value.search = '';
  value.hash = '';
  return value.href;
}
function generatedLocation(file: string, line: unknown, column: unknown, base: string) {
  if (typeof line !== 'number' || typeof column !== 'number' || !Number.isFinite(line) || !Number.isFinite(column)) return null;
  const url = parsedHttpUrl(file, base);
  return url ? { file: exportedUrl(url), line, column } : null;
}
function mappedLocation(file: unknown, line: unknown, column: unknown) {
  if (typeof file !== 'string' || typeof line !== 'number' || typeof column !== 'number' || !Number.isFinite(line) || !Number.isFinite(column)) return null;
  let clean = file.replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/^(?:webpack|file):\/*/i, '');
  if (/^https?:/i.test(clean)) {
    try { clean = new URL(clean).pathname; } catch { return null; }
  }
  const parts: string[] = [];
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const marker = parts.findIndex(part => part === 'apps' || part === 'fixtures' || part === 'packages' || part === 'src');
  const project = marker > 0 ? parts.slice(marker) : parts;
  return project.length ? { file: project.join('/'), line, column } : null;
}
function unresolved(functionName: unknown, generated: ReturnType<typeof generatedLocation>, reason: UnresolvedReason): ExplanationStackFrame {
  return { functionName: typeof functionName === 'string' ? functionName : null, generated, mapped: null, mappingStatus: 'unresolved', unresolvedReason: reason };
}
function sourceMapReference(content: string): string | null {
  let end = content.length;
  while (end > 0) {
    const start = content.lastIndexOf('\n', end - 1) + 1;
    const match = content.slice(start, end).match(SOURCE_MAP_DIRECTIVE);
    if (match) return match[1] || match[2] || null;
    end = start - 1;
  }
  return null;
}
function markFailure(lookup: Lookup, reason: UnresolvedReason): void {
  if (!lookup.failure) lookup.failure = reason;
}
function firstAffected(capture: Capture, name: keyof Capture['firstAffected'], target: CommandWindowIdentity, commandOrdinal: number): void {
  if (!capture.firstAffected[name]) capture.firstAffected[name] = { identity: target, commandOrdinal, windowIndex: capture.resolvedWindows.get(target) ?? -1 };
}
async function guardedFetch(capture: Capture, lookup: Lookup, value: string): Promise<Response> {
  const request = safeResourceUrl(value, capture.locationHref);
  if (!request) { markFailure(lookup, 'cross-origin-source-map'); throw new Error('unsafe source map resource'); }
  request.hash = '';
  const mapResponse = lookup.declaredMap;
  if (mapResponse) lookup.mapRequested = true;
  let response: Response;
  try { const fetchResource = capture.fetch; response = await fetchResource(request.href, { redirect: 'manual' }); }
  catch (error) { markFailure(lookup, 'source-map-load-failed'); throw error; }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    markFailure(lookup, 'cross-origin-source-map');
    throw new Error('source map redirect rejected');
  }
  const responseUrl = response.url ? safeResourceUrl(response.url, capture.locationHref) : request;
  if (!responseUrl) { markFailure(lookup, 'cross-origin-source-map'); throw new Error('cross-origin source map redirect'); }
  if (!response.ok) markFailure(lookup, 'source-map-load-failed');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_SOURCE_MAP_RESPONSE_BYTES) {
    capture.dropped.sourceMapResponses++;
    firstAffected(capture, 'sourceMapResponses', lookup.target, lookup.commandOrdinal);
    markFailure(lookup, 'source-map-too-large');
    throw new RangeError('source map response too large');
  }
  let bytes: ArrayBuffer;
  try { bytes = await response.arrayBuffer(); }
  catch (error) { markFailure(lookup, 'source-map-load-failed'); throw error; }
  if (bytes.byteLength > MAX_SOURCE_MAP_RESPONSE_BYTES) {
    if (lookup.failure !== 'source-map-too-large') { capture.dropped.sourceMapResponses++; firstAffected(capture, 'sourceMapResponses', lookup.target, lookup.commandOrdinal); }
    markFailure(lookup, 'source-map-too-large');
    throw new RangeError('source map response too large');
  }
  const text = new TextDecoder().decode(bytes);
  if (!mapResponse) {
    const reference = sourceMapReference(text);
    lookup.declaredMap = reference !== null;
    if (reference !== null && !safeResourceUrl(reference, request.href)) markFailure(lookup, 'cross-origin-source-map');
  } else {
    try {
      const value = JSON.parse(text) as { version?: unknown; mappings?: unknown; sections?: unknown };
      if (value.version !== 3 || (typeof value.mappings !== 'string' && !Array.isArray(value.sections))) markFailure(lookup, 'source-map-parse-failed');
    } catch { markFailure(lookup, 'source-map-parse-failed'); }
  }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}
async function resolveLookup(capture: Capture, url: string, lookup: Lookup): Promise<void> {
  const sourceMap = await getSourceMap(url, false, value => guardedFetch(capture, lookup, value));
  lookup.done = true;
  lookup.result = sourceMap;
  if (!capture.active) return;
  for (const pending of lookup.frames) applyLookup(pending, lookup);
}
function applyLookup(pending: PendingFrame, lookup: Lookup): void {
  const sourceMap = lookup.result;
  if (!sourceMap) {
    const reason = lookup.failure ?? (lookup.declaredMap ? 'source-map-parse-failed' : 'no-source-map');
    pending.frame.unresolvedReason = reason;
    return;
  }
  try {
    const source = getSourceFromSourceMap(sourceMap, pending.line, pending.column);
    const mapped = mappedLocation(source?.fileName, source?.lineNumber, source?.columnNumber);
    if (!mapped) { pending.frame.unresolvedReason = 'mapping-missing'; return; }
    pending.frame.mapped = mapped;
    pending.frame.mappingStatus = 'mapped';
    pending.frame.unresolvedReason = null;
  } catch { pending.frame.unresolvedReason = 'source-map-parse-failed'; }
}
function addFrame(capture: Capture, frame: ExplanationStackFrame, file: string, line: number, column: number, target: CommandWindowIdentity, commandOrdinal: number): void {
  const url = safeResourceUrl(file, capture.locationHref);
  if (!url) { frame.unresolvedReason = parsedHttpUrl(file, capture.locationHref) ? 'cross-origin-source-map' : 'mapping-missing'; return; }
  url.hash = '';
  const key = url.href;
  let lookup = capture.lookups.get(key);
  if (!lookup) {
    if (capture.lookups.size >= MAX_SOURCE_MAP_LOOKUPS) { capture.dropped.sourceMapLookups++; firstAffected(capture, 'sourceMapLookups', target, commandOrdinal); frame.unresolvedReason = 'source-map-lookup-limit'; return; }
    sourceMapLookups++;
    lookup = { frames: [], work: Promise.resolve(), failure: null, declaredMap: false, mapRequested: false, done: false, result: null, target, commandOrdinal };
    capture.lookups.set(key, lookup);
    lookup.frames.push({ frame, line, column });
    lookup.work = resolveLookup(capture, key, lookup);
    return;
  }
  const pending = { frame, line, column };
  lookup.frames.push(pending);
  if (lookup.done) applyLookup(pending, lookup);
}
function internalFrame(item: { fileName?: string | null }): boolean {
  const file = item.fileName?.toLowerCase() ?? '';
  return file.includes('draw-callsite') || file.includes('wrap-context');
}
function automaticStack(stackBoundary?: (...args: unknown[]) => unknown): { rawStack: string; bounded: boolean } {
  if (!StackError || !nativeCaptureStackTrace) return { rawStack: '', bounded: false };
  const currentError = getOwnPropertyDescriptor(globalThis, 'Error');
  if (!currentError || !('value' in currentError) || currentError.value !== StackError) return { rawStack: '', bounded: false };
  const prepareStackTrace = getOwnPropertyDescriptor(StackError, 'prepareStackTrace');
  const canMask = !prepareStackTrace || prepareStackTrace.configurable || ('value' in prepareStackTrace && prepareStackTrace.writable);
  if (!canMask) return { rawStack: '', bounded: false };
  try {
    defineProperty(StackError, 'prepareStackTrace', {
      configurable: prepareStackTrace?.configurable ?? true,
      enumerable: prepareStackTrace?.enumerable ?? false,
      value: undefined,
      writable: true,
    });
  } catch { return { rawStack: '', bounded: false }; }
  let rawStack = '';
  let bounded = false;
  let restored = true;
  try {
    const error = createObject(null) as { stack?: unknown };
    defineProperty(error, 'name', { configurable: true, value: 'Error' });
    defineProperty(error, 'message', { configurable: true, value: '' });
    apply(nativeCaptureStackTrace, StackError, stackBoundary ? [error, stackBoundary] : [error]);
    bounded = Boolean(stackBoundary);
    const stack = getOwnPropertyDescriptor(error, 'stack');
    const value = stack && ('value' in stack ? stack.value : typeof stack.get === 'function' ? apply(stack.get, error, []) : undefined);
    if (typeof value === 'string') rawStack = value;
  } catch { rawStack = ''; bounded = false; }
  finally {
    try {
      if (prepareStackTrace) defineProperty(StackError, 'prepareStackTrace', prepareStackTrace);
      else restored = deleteProperty(StackError, 'prepareStackTrace');
    } catch { restored = false; }
  }
  return restored ? { rawStack, bounded } : { rawStack: '', bounded: false };
}

export function createDrawCallsiteCapture(options: CaptureOptions = {}): Capture {
  const locationHref = options.locationHref ?? (typeof location === 'undefined' ? 'http://localhost/' : location.href);
  const captureFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return { stacks: [], dropped: { stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 }, firstAffected: {}, resolvedWindows: new WeakMap(), firstRaster: false, firstDifferences: new Set(), heaviestMethods: new Set(), targets: new Map(), lookups: new Map(), locationHref, fetch: captureFetch, active: true };
}
export function captureDrawCallsite(capture: Capture, target: CommandWindowIdentity, commandOrdinal: number, reasons: Reason[], rawStack?: string, stackBoundary?: (...args: unknown[]) => unknown): void {
  if (!capture.active) return;
  const unique = reasons.filter((reason, index) => reasons.indexOf(reason) === index);
  const allowed = unique.slice(0, Math.max(0, MAX_STACK_SAMPLES - capture.stacks.length));
  capture.dropped.stackSamples += unique.length - allowed.length;
  if (unique.length > allowed.length) firstAffected(capture, 'stackSamples', target, commandOrdinal);
  if (!allowed.length) return;
  stackAllocations++;
  const automatic = rawStack === undefined ? automaticStack(stackBoundary) : null;
  const parsed = parseStack(rawStack ?? automatic?.rawStack ?? '', { includeInElement: false });
  const bounded = automatic?.bounded ?? false;
  const kept = bounded ? parsed : parsed.filter(item => !internalFrame(item));
  for (const reason of allowed) {
    const sample: ExplanationStackSample = { windowIndex: -1, commandOrdinal, reason, frames: [], droppedFrameCount: Math.max(0, kept.length - MAX_FRAMES_PER_STACK) };
    capture.dropped.stackFrames += sample.droppedFrameCount;
    if (sample.droppedFrameCount) firstAffected(capture, 'stackFrames', target, commandOrdinal);
    for (const item of kept.slice(0, MAX_FRAMES_PER_STACK)) {
      const generated = generatedLocation(item.fileName ?? '', item.lineNumber, item.columnNumber, capture.locationHref);
      const frame = unresolved(item.functionName, generated, generated ? 'source-map-load-failed' : 'mapping-missing');
      sample.frames.push(frame);
      if (generated && typeof item.fileName === 'string') addFrame(capture, frame, item.fileName, generated.line, generated.column, target, commandOrdinal);
    }
    capture.targets.set(sample, target);
    capture.stacks.push(sample);
  }
}
// One bounded stack, taken where canvas-scan first sees a canvas.
//
// A canvas made imperatively carries no React fiber, so the owner lookup has
// nothing to answer with — 124 of the 128 canvases on excalidraw.com were in
// that state. The place the application created it is still a real place, and
// it is the thing a reader actually wants: not who owns this canvas, but where
// do I go to change it.
//
// The boundary is what makes this usable in a bundle. Without it, the top
// frames are canvas-scan's own wrapper, and in a minified build the file-name
// filter cannot see that — every frame is canvas-scan.iife.js.
export function captureCreationSite(boundary?: (...args: unknown[]) => unknown): { file: string; line: number; column: number } | null {
  // Twice the canvas lifetime cap, so every canvas that can reach a session
  // gets one and a page that makes thousands still stops paying.
  if (creationSiteStacks >= MAX_CREATION_SITE_STACKS) return null;
  creationSiteStacks++;
  const automatic = automaticStack(boundary);
  if (!automatic.rawStack) return null;
  const parsed = parseStack(automatic.rawStack, { includeInElement: false });
  const kept = automatic.bounded ? parsed : parsed.filter(item => !internalFrame(item));
  const frame = kept.find(item => typeof item.fileName === 'string' && item.fileName.length > 0 && typeof item.lineNumber === 'number');
  if (!frame?.fileName || frame.lineNumber === undefined) return null;
  return { file: frame.fileName, line: frame.lineNumber, column: frame.columnNumber ?? 0 };
}

// Maps a creation site through the application's own source map.
//
// `app.min.js:1:48213` is a real place and no help. This turns it into the line
// the developer wrote, which is the difference between a finding that is
// findable and one that is useful.
//
// One capture is shared by every creation site, on purpose. Its lookups are
// keyed by URL, so the 124 canvases a page makes from one bundle cost one
// fetch, and MAX_SOURCE_MAP_LOOKUPS still caps the distinct bundles at eight.
// Every guard the explanation path uses comes with it: same-origin only, a
// refused redirect, and the response size cap.
let creationSiteCapture: Capture | null = null;
export function resetCreationSiteMapsForTests(): void { creationSiteCapture = null; }

export async function mapCreationSite(
  site: { file: string; line: number; column: number },
  options: CaptureOptions = {},
): Promise<{ file: string; line: number; column: number } | null> {
  creationSiteCapture ??= createDrawCallsiteCapture(options);
  const capture = creationSiteCapture;
  const generated = generatedLocation(site.file, site.line, site.column, capture.locationHref);
  if (!generated) return null;
  const frame = unresolved(null, generated, 'source-map-load-failed');
  addFrame(capture, frame, site.file, site.line, site.column, {}, 0);
  // Mirrors the key addFrame builds, hash stripped, so this finds the lookup it
  // just created rather than starting a second one.
  const url = safeResourceUrl(site.file, capture.locationHref);
  if (url) url.hash = '';
  const lookup = url ? capture.lookups.get(url.href) : undefined;
  if (lookup) await lookup.work;
  return frame.mapped;
}

export function resolveDrawCallsiteBoundary(capture: Capture, identity: CommandWindowIdentity, windowIndex: number): void {
  capture.resolvedWindows.set(identity, windowIndex);
  for (const [sample, target] of capture.targets) if (target === identity) { sample.windowIndex = windowIndex; capture.targets.delete(sample); }
  for (const value of Object.values(capture.firstAffected)) if (value?.identity === identity) value.windowIndex = windowIndex;
}
export function shouldCaptureFirstRaster(capture: Capture): boolean {
  if (capture.firstRaster) return false;
  capture.firstRaster = true;
  return true;
}
export function shouldCaptureFirstDifference(capture: Capture, identity: CommandWindowIdentity): boolean {
  if (capture.firstDifferences.has(identity)) return false;
  capture.firstDifferences.add(identity);
  return true;
}
export function shouldCaptureHeaviestMethod(capture: Capture, identity: CommandWindowIdentity): boolean {
  if (capture.heaviestMethods.has(identity)) return false;
  capture.heaviestMethods.add(identity);
  return true;
}
function dropPendingSamples(capture: Capture): void {
  if (!capture.targets.size) return;
  const pending = new Set(capture.targets.keys());
  capture.stacks = capture.stacks.filter(sample => !pending.has(sample));
  capture.targets.clear();
}
export function finishDrawCallsiteCapture(capture: Capture) {
  capture.active = false;
  capture.lookups.clear();
  dropPendingSamples(capture);
  const first = Object.fromEntries(Object.entries(capture.firstAffected).map(([name, value]) => [name, value && value.windowIndex >= 0 ? { windowIndex: value.windowIndex, commandOrdinal: value.commandOrdinal } : null]));
  return { stacks: JSON.parse(JSON.stringify(capture.stacks)) as ExplanationStackSample[], droppedEntryCounts: { ...capture.dropped }, firstAffected: first };
}
export function disableDrawCallsiteCapture(capture: Capture): void {
  capture.active = false;
  capture.lookups.clear();
  dropPendingSamples(capture);
}
export async function settleDrawCallsiteCaptureForTests(capture: Capture): Promise<void> { await Promise.all([...capture.lookups.values()].map(lookup => lookup.work)); }
export function getDrawCallsiteTestCounts() { return { stackAllocations, sourceMapLookups, creationSiteStacks }; }
export function resetDrawCallsiteForTests(): void { stackAllocations = 0; sourceMapLookups = 0; creationSiteStacks = 0; }
