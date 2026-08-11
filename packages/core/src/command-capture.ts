import { getBuildKind, getBuildSignature } from './build-registry';
import { isTrackedCanvas } from './wrap-context';
import type { CommandDifference, ExplanationCommandWindow, ExplanationUnknownReason, ExplanationWindowComparison, NormalizedCanvasCommand } from './types';

export const MAX_ACTIVE_WINDOWS = 120;
export const MAX_COMMAND_ENTRIES = 5000;
export const MAX_COMMAND_ARGUMENTS = 20;
export const MAX_VALUE_TOKENS = 1024;

type DropCounts = { activeWindows: number; commandEntries: number; commandArguments: number; valueTokens: number };
type Capture = {
  namespace: string;
  primitiveTokens: Map<string, string>;
  objectTokens: WeakMap<object, Map<string, string>>;
  nextToken: number;
  commandCount: number;
  pending: { windowIndex: number; timestampMs: number; commands: NormalizedCanvasCommand[]; complete: boolean; reason: ExplanationUnknownReason | null; active: boolean; nextOrdinal: number } | null;
  windows: ExplanationCommandWindow[];
  comparisons: ExplanationWindowComparison[];
  firstDifference: CommandDifference | null;
  dropped: DropCounts;
  firstGap: { windowIndex: number; commandOrdinal: number | null; reason: ExplanationUnknownReason } | null;
  pendingGap: { commandOrdinal: number; reason: ExplanationUnknownReason } | null;
  instrumentationDisabled: boolean;
  finished: boolean;
  firstActiveBoundarySeen: boolean;
};

let allocations = 0;

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function setGap(capture: Capture, windowIndex: number, commandOrdinal: number | null, reason: ExplanationUnknownReason): void {
  if (!capture.firstGap) capture.firstGap = { windowIndex, commandOrdinal, reason };
}
function primitiveKey(value: unknown): string {
  if (typeof value === 'number') {
    const normalized = Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
    if (Number.isNaN(normalized)) return 'number:nan';
    if (Object.is(normalized, -0)) return 'number:-0';
    if (normalized === Infinity) return 'number:+infinity';
    if (normalized === -Infinity) return 'number:-infinity';
    return `number:${normalized}`;
  }
  return `${typeof value}:${value === null ? 'null' : String(value)}`;
}
function token(capture: Capture, value: unknown, objectState = 'identity'): string | null {
  const object = typeof value === 'object' && value !== null;
  const objectTable = object ? capture.objectTokens.get(value as object) : undefined;
  const table = object ? objectTable : capture.primitiveTokens;
  const key = object ? objectState : primitiveKey(value);
  const prior = table?.get(key);
  if (prior) return prior;
  if (capture.nextToken >= MAX_VALUE_TOKENS) {
    capture.dropped.valueTokens++;
    return null;
  }
  const next = `${capture.namespace}-${++capture.nextToken}`;
  if (object) {
    const states = objectTable ?? new Map();
    states.set(key, next);
    if (!objectTable) capture.objectTokens.set(value as object, states);
  } else capture.primitiveTokens.set(key, next);
  return next;
}
function kind(value: unknown, name: string, index: number): NormalizedCanvasCommand['arguments'][number]['kind'] {
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value !== 'object') return 'object';
  const tagged = getBuildKind(value);
  if (tagged) return tagged;
  try { if (Array.isArray(value)) return 'array'; } catch { return 'object'; }
  try { if (ArrayBuffer.isView(value)) return 'typed-array'; } catch { return 'object'; }
  if (isTrackedCanvas(value)) return 'canvas';
  if ((name === 'drawImage' || name === 'putImageData') && index === 0) return 'image';
  return 'object';
}

// This check deliberately uses only operations that do not read application
// object properties. A revoked proxy can throw from the built-in brand checks.
function isSafeObject(value: object): boolean {
  try {
    getBuildKind(value);
    isTrackedCanvas(value);
    Array.isArray(value);
    ArrayBuffer.isView(value);
    return true;
  } catch {
    return false;
  }
}
function markPending(capture: Capture, ordinal: number, reason: ExplanationUnknownReason): void {
  const pending = capture.pending!;
  pending.complete = false;
  if (!pending.reason) pending.reason = reason;
  if (!capture.firstGap && !capture.pendingGap) capture.pendingGap = { commandOrdinal: ordinal, reason };
}

export function createCommandCapture(): Capture | null {
  try {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return { namespace: [...values].map(value => value.toString(16).padStart(8, '0')).join(''), primitiveTokens: new Map(), objectTokens: new WeakMap(), nextToken: 0, commandCount: 0, pending: null, windows: [], comparisons: [], firstDifference: null, pendingGap: null, instrumentationDisabled: false, dropped: { activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0 }, firstGap: null, finished: false, firstActiveBoundarySeen: false };
  } catch { return null; }
}

export function captureCommand(capture: Capture, operationKind: 'call' | 'set', name: string, args: unknown[], sampled: boolean): NormalizedCanvasCommand | null {
  if (capture.finished) return null;
  const pending = capture.pending ?? (capture.pending = { windowIndex: -1, timestampMs: 0, commands: [], complete: true, reason: null, active: false, nextOrdinal: 0 });
  pending.active = true;
  const ordinal = pending.nextOrdinal++;
  if (!sampled) { capture.dropped.commandEntries++; markPending(capture, ordinal, 'sampling-gap'); return null; }
  if (capture.windows.length >= MAX_ACTIVE_WINDOWS) { capture.dropped.commandEntries++; return null; }
  if (capture.commandCount >= MAX_COMMAND_ENTRIES) { capture.dropped.commandEntries++; markPending(capture, ordinal, 'command-limit'); return null; }
  const command: NormalizedCanvasCommand = { ordinal, operationKind, name, argumentCount: args.length, arguments: [], unknownReason: null };
  allocations++;
  capture.commandCount++;
  pending.commands.push(command);
  if (args.length > MAX_COMMAND_ARGUMENTS) {
    capture.dropped.commandArguments += args.length - MAX_COMMAND_ARGUMENTS;
    command.unknownReason = 'argument-limit';
    markPending(capture, ordinal, 'argument-limit');
  }
  for (let index = 0; index < Math.min(args.length, MAX_COMMAND_ARGUMENTS); index++) {
    const value = args[index];
    const valueKind = kind(value, name, index);
    let valueToken: string | null = null;
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || (typeof value === 'object' && value !== null && !isSafeObject(value))) {
      if (!command.unknownReason) command.unknownReason = 'unsupported-value';
      markPending(capture, ordinal, 'unsupported-value');
    } else {
      const build = typeof value === 'object' && value !== null ? getBuildSignature(value) : undefined;
      if (build?.unknown) {
        if (!command.unknownReason) command.unknownReason = 'unsupported-value';
        markPending(capture, ordinal, 'unsupported-value');
      } else valueToken = token(capture, value, build ? `build:${build.hash}` : 'identity');
      if (!valueToken && !command.unknownReason) {
        command.unknownReason = 'value-token-limit';
        markPending(capture, ordinal, 'value-token-limit');
      }
    }
    command.arguments.push({ position: index, kind: valueKind, token: valueToken });
  }
  return command;
}

function compareCommands(reference: NormalizedCanvasCommand[], target: NormalizedCanvasCommand[], referenceWindowIndex: number, targetWindowIndex: number): CommandDifference | null {
  const count = Math.max(reference.length, target.length);
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const left = reference[ordinal] ?? null; const right = target[ordinal] ?? null;
    let reason: CommandDifference['reason'] | null = null;
    if (!left) reason = 'command-added'; else if (!right) reason = 'command-removed';
    else if (left.operationKind !== right.operationKind) reason = 'operation-kind';
    else if (left.name !== right.name) reason = 'operation-name';
    else if (left.argumentCount !== right.argumentCount) reason = 'argument-count';
    else for (let index = 0; index < Math.max(left.arguments.length, right.arguments.length); index++) {
      const leftArg = left.arguments[index]; const rightArg = right.arguments[index];
      if (!leftArg || !rightArg || leftArg.kind !== rightArg.kind) { reason = 'argument-kind'; break; }
      if (leftArg.token !== rightArg.token) { reason = 'argument-token'; break; }
    }
    if (reason) return { referenceWindowIndex, targetWindowIndex, ordinal, reason, reference: left ? copy(left) : null, target: right ? copy(right) : null };
  }
  return null;
}
export function compareCommandWindows(reference: ExplanationCommandWindow, target: ExplanationCommandWindow): ExplanationWindowComparison {
  if (!reference.complete || !target.complete) return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: 'unknown', difference: null, unknownReason: reference.unknownReason ?? target.unknownReason };
  const difference = compareCommands(reference.commands, target.commands, reference.windowIndex, target.windowIndex);
  return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: difference ? 'changed' : 'same', difference, unknownReason: null };
}
function finishWindow(capture: Capture, windowIndex: number, timestampMs: number, partial: boolean): void {
  const pending = capture.pending;
  if (!pending || !pending.active) return;
  pending.windowIndex = windowIndex; pending.timestampMs = timestampMs;
  if (partial) {
    pending.complete = false;
    pending.reason = 'sampling-gap';
    if (!capture.firstGap) {
      capture.pendingGap = { commandOrdinal: pending.commands[0]?.ordinal ?? 0, reason: 'sampling-gap' };
    }
  }
  if (!capture.firstGap && capture.pendingGap) {
    setGap(capture, windowIndex, capture.pendingGap.commandOrdinal, capture.pendingGap.reason);
    capture.pendingGap = null;
  }
  if (capture.windows.length >= MAX_ACTIVE_WINDOWS) {
    capture.dropped.activeWindows++;
    setGap(capture, windowIndex, null, 'window-limit');
    const reference = capture.windows.at(-1);
    if (reference) capture.comparisons.push({ referenceWindowIndex: reference.windowIndex, targetWindowIndex: windowIndex, status: 'unknown', difference: null, unknownReason: 'window-limit' });
    capture.pending = null;
    return;
  }
  const window: ExplanationCommandWindow = { windowIndex, timestampMs, commands: pending.commands.map(copy), complete: pending.complete && !pending.reason, unknownReason: pending.reason };
  const reference = capture.windows.at(-1);
  capture.windows.push(window);
  if (reference) { const comparison = compareCommandWindows(reference, window); capture.comparisons.push(comparison); if (!capture.firstDifference && comparison.difference) capture.firstDifference = copy(comparison.difference); }
  capture.pending = null;
}
export function captureBoundary(capture: Capture, windowIndex: number, timestampMs: number, active: boolean, sampled: boolean): void {
  if (!active) return;
  const pending = capture.pending;
  if (!pending) {
    capture.pending = { windowIndex, timestampMs, commands: [], complete: sampled && !capture.instrumentationDisabled, reason: !sampled ? 'sampling-gap' : capture.instrumentationDisabled ? 'instrumentation-disabled' : null, active: true, nextOrdinal: 0 };
    if (capture.instrumentationDisabled && !capture.firstGap && !capture.pendingGap) capture.pendingGap = { commandOrdinal: 0, reason: 'instrumentation-disabled' };
    // A reset-only boundary is still the first observed explanation window.
    finishWindow(capture, windowIndex, timestampMs, !sampled || !capture.firstActiveBoundarySeen);
    capture.firstActiveBoundarySeen = true;
    return;
  }
  finishWindow(capture, windowIndex, timestampMs, !sampled || !capture.firstActiveBoundarySeen);
  capture.firstActiveBoundarySeen = true;
}
export function disableCommandCapture(capture: Capture): void {
  capture.instrumentationDisabled = true;
  const pending = capture.pending;
  if (pending) markPending(capture, pending.commands.at(-1)?.ordinal ?? 0, 'instrumentation-disabled');
}
export function finishCommandCapture(capture: Capture, windowIndex: number, timestampMs: number): { windows: ExplanationCommandWindow[]; comparisons: ExplanationWindowComparison[]; firstDifference: CommandDifference | null; droppedEntryCounts: DropCounts; firstGap: Capture['firstGap'] } {
  if (!capture.finished) { finishWindow(capture, windowIndex, timestampMs, true); capture.finished = true; capture.primitiveTokens.clear(); }
  return { windows: copy(capture.windows), comparisons: copy(capture.comparisons), firstDifference: capture.firstDifference ? copy(capture.firstDifference) : null, droppedEntryCounts: { ...capture.dropped }, firstGap: capture.firstGap ? { ...capture.firstGap } : null };
}
export function getCommandEntryAllocationCount(): number { return allocations; }
export function resetCommandCaptureForTests(): void { allocations = 0; }
