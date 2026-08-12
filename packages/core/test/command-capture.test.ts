import { describe, expect, it } from 'vitest';
import {
  captureBoundary,
  captureCommand,
  compareCommandWindows,
  createCommandCapture,
  disableCommandCapture,
  finishCommandCapture,
  getCommandEntryAllocationCount,
  getLiveComparisonStepCount,
  getLiveCommandRelationship,
  MAX_ACTIVE_WINDOWS,
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_ENTRIES,
  MAX_VALUE_TOKENS,
  resetCommandCaptureForTests,
} from '../src/command-capture';
import type { ExplanationCommandWindow, NormalizedCanvasCommand } from '../src/types';
import { trackBuild } from '../src/build-registry';
import { newWindowSignature } from '../src/signature';

function capture() {
  const value = createCommandCapture();
  if (!value) throw new Error('crypto unavailable');
  return value;
}

function command(overrides: Partial<NormalizedCanvasCommand> = {}): NormalizedCanvasCommand {
  return {
    ordinal: 0,
    operationKind: 'call',
    name: 'fillRect',
    argumentCount: 1,
    arguments: [{ position: 0, kind: 'number', token: 'token-a' }],
    unknownReason: null,
    ...overrides,
  };
}

function window(windowIndex: number, commands: NormalizedCanvasCommand[], complete = true): ExplanationCommandWindow {
  return { windowIndex, timestampMs: windowIndex, commands, complete, unknownReason: complete ? null : 'sampling-gap' };
}

function completeWindow(captureValue: ReturnType<typeof capture>, windowIndex: number, args: unknown[] = [1]): void {
  captureCommand(captureValue, 'call', 'fillRect', args, true);
  captureBoundary(captureValue, windowIndex, windowIndex, true, true);
}

describe('command capture window truth', () => {
  it('marks the first command-active window partial', () => {
    const value = capture();
    captureCommand(value, 'call', 'fillRect', [1], true);
    captureBoundary(value, 10, 10, true, true);
    const result = finishCommandCapture(value, 11, 11);
    expect(result.windows[0]).toMatchObject({ windowIndex: 10, complete: false, unknownReason: 'sampling-gap' });
    expect(result.firstGap).toEqual({ windowIndex: 10, commandOrdinal: 0, reason: 'sampling-gap' });
  });

  it('marks the first reset-only active window partial after idle boundaries', () => {
    const value = capture();
    captureBoundary(value, 1, 1, false, true);
    captureBoundary(value, 2, 2, false, true);
    captureBoundary(value, 3, 3, true, true);
    captureBoundary(value, 4, 4, true, true);
    const result = finishCommandCapture(value, 5, 5);
    expect(result.windows[0]).toMatchObject({ windowIndex: 3, commands: [], complete: false, unknownReason: 'sampling-gap' });
    expect(result.comparisons[0]).toMatchObject({ status: 'unknown', difference: null, unknownReason: 'sampling-gap' });
    expect(result.firstDifference).toBeNull();
  });

  it('does not bridge an incomplete selected window', () => {
    const value = capture();
    completeWindow(value, 1, [1]);
    completeWindow(value, 2, [1]);
    captureCommand(value, 'call', 'save', [() => {}], true);
    captureBoundary(value, 3, 3, true, true);
    completeWindow(value, 4, [2]);
    const result = finishCommandCapture(value, 5, 5);
    expect(result.comparisons.map(entry => entry.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(result.firstDifference).toBeNull();
  });

  it('uses real frame indexes for command gaps', () => {
    for (const [reason, add] of [
      ['sampling-gap', (value: ReturnType<typeof capture>) => captureCommand(value, 'call', 'save', [], false)],
      ['argument-limit', (value: ReturnType<typeof capture>) => captureCommand(value, 'call', 'save', Array.from({ length: 21 }), true)],
      ['unsupported-value', (value: ReturnType<typeof capture>) => captureCommand(value, 'call', 'save', [Symbol('private')], true)],
    ] as const) {
      const value = capture();
      captureBoundary(value, 40, 40, true, true);
      add(value);
      captureBoundary(value, 44, 44, true, true);
      const result = finishCommandCapture(value, 45, 45);
      expect(result.firstGap).toEqual({ windowIndex: 40, commandOrdinal: 0, reason: 'sampling-gap' });
      expect(result.windows[1]).toMatchObject({ windowIndex: 44, complete: false, unknownReason: reason });
      if (result.windows[1].commands[0]) expect(result.windows[1].commands[0]).toMatchObject({ ordinal: 0, unknownReason: reason });
    }
  });

  it('keeps the earlier start gap when the first command is unsupported', () => {
    const value = capture();
    captureCommand(value, 'call', 'fillRect', [1, 2, 3, 4, () => {}], true);
    captureBoundary(value, 20, 20, true, true);
    const result = finishCommandCapture(value, 21, 21);
    expect(result.windows[0]).toMatchObject({ complete: false, unknownReason: 'sampling-gap' });
    expect(result.firstGap).toEqual({ windowIndex: 20, commandOrdinal: 0, reason: 'sampling-gap' });
  });
});

describe('command capture limits', () => {
  it('stores 20 arguments and drops the first omitted argument', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    captureCommand(value, 'call', 'save', Array.from({ length: MAX_COMMAND_ARGUMENTS + 1 }, (_, index) => index), true);
    captureBoundary(value, 2, 2, true, true);
    const result = finishCommandCapture(value, 3, 3);
    expect(result.windows[1].commands[0].arguments).toHaveLength(MAX_COMMAND_ARGUMENTS);
    expect(result.droppedEntryCounts.commandArguments).toBe(1);
    expect(result.firstAffected.commandArguments).toEqual({ windowIndex: 2, commandOrdinal: 0 });
    expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'argument-limit' });
    expect(result.firstGap).toEqual({ windowIndex: 1, commandOrdinal: 0, reason: 'sampling-gap' });
  });

  it('stores 1,024 tokens and drops the first new token occurrence', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    for (let index = 0; index <= MAX_VALUE_TOKENS; index++) captureCommand(value, 'call', 'save', [`value-${index}`], true);
    captureBoundary(value, 2, 2, true, true);
    const result = finishCommandCapture(value, 3, 3);
    expect(result.windows[1].commands[MAX_VALUE_TOKENS - 1].arguments[0].token).not.toBeNull();
    expect(result.windows[1].commands[MAX_VALUE_TOKENS].arguments[0].token).toBeNull();
    expect(result.droppedEntryCounts.valueTokens).toBe(1);
    expect(result.firstAffected.valueTokens).toEqual({ windowIndex: 2, commandOrdinal: MAX_VALUE_TOKENS });
    expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'value-token-limit' });
    expect(result.firstGap).toEqual({ windowIndex: 1, commandOrdinal: 0, reason: 'sampling-gap' });
  });

  it('records both coordinates when argument and value-token limits fail on one command', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    for (let start = 0; start < MAX_VALUE_TOKENS; start += MAX_COMMAND_ARGUMENTS) {
      captureCommand(value, 'call', 'save', Array.from({ length: Math.min(MAX_COMMAND_ARGUMENTS, MAX_VALUE_TOKENS - start) }, (_, index) => `value-${start + index}`), true);
    }
    captureCommand(value, 'call', 'save', Array.from({ length: MAX_COMMAND_ARGUMENTS + 1 }, (_, index) => `overflow-${index}`), true);
    captureBoundary(value, 2, 2, true, true);
    const result = finishCommandCapture(value, 3, 3);
    expect(result.droppedEntryCounts.commandArguments).toBe(1);
    expect(result.droppedEntryCounts.valueTokens).toBe(MAX_COMMAND_ARGUMENTS);
    expect(result.firstAffected.commandArguments).toEqual({ windowIndex: 2, commandOrdinal: 52 });
    expect(result.firstAffected.valueTokens).toEqual({ windowIndex: 2, commandOrdinal: 52 });
    expect(result.windows[1].commands[52]).toMatchObject({ unknownReason: 'argument-limit' });
  });

  it('stores 5,000 commands and drops the first omitted command', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    for (let index = 0; index <= MAX_COMMAND_ENTRIES; index++) captureCommand(value, 'call', 'save', [], true);
    captureBoundary(value, 2, 2, true, true);
    const result = finishCommandCapture(value, 3, 3);
    expect(result.windows[1].commands).toHaveLength(MAX_COMMAND_ENTRIES);
    expect(result.windows[1].commands.at(-1)?.ordinal).toBe(MAX_COMMAND_ENTRIES - 1);
    expect(result.droppedEntryCounts.commandEntries).toBe(1);
    expect(result.firstAffected.commandEntries).toEqual({ windowIndex: 2, commandOrdinal: MAX_COMMAND_ENTRIES });
    expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'command-limit' });
    expect(result.firstGap).toEqual({ windowIndex: 1, commandOrdinal: 0, reason: 'sampling-gap' });
  });

  it('stores 120 active windows and records the omitted window comparison', () => {
    const value = capture();
    for (let index = 1; index <= MAX_ACTIVE_WINDOWS + 1; index++) captureBoundary(value, index, index, true, true);
    const result = finishCommandCapture(value, MAX_ACTIVE_WINDOWS + 2, MAX_ACTIVE_WINDOWS + 2);
    expect(result.windows).toHaveLength(MAX_ACTIVE_WINDOWS);
    expect(result.droppedEntryCounts.activeWindows).toBe(1);
    expect(result.firstAffected.activeWindows).toEqual({ windowIndex: MAX_ACTIVE_WINDOWS + 1, commandOrdinal: null });
    expect(result.firstGap).toEqual({ windowIndex: 1, commandOrdinal: 0, reason: 'sampling-gap' });
    expect(result.comparisons.at(-1)).toEqual({ referenceWindowIndex: MAX_ACTIVE_WINDOWS, targetWindowIndex: MAX_ACTIVE_WINDOWS + 1, status: 'unknown', difference: null, unknownReason: 'window-limit' });
  });

  it('allocates no command entry for an unsampled command', () => {
    resetCommandCaptureForTests();
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    captureCommand(value, 'call', 'fillRect', ['private'], false);
    captureBoundary(value, 2, 2, true, true);
    const result = finishCommandCapture(value, 3, 3);
    expect(getCommandEntryAllocationCount()).toBe(0);
    expect(result.droppedEntryCounts.commandEntries).toBe(0);
    expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'sampling-gap' });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('records no limit coordinate at every exact command boundary', () => {
    const argumentsCapture = capture();
    captureBoundary(argumentsCapture, 1, 1, true, true);
    captureCommand(argumentsCapture, 'call', 'save', Array.from({ length: MAX_COMMAND_ARGUMENTS }), true);
    captureBoundary(argumentsCapture, 2, 2, true, true);
    expect(finishCommandCapture(argumentsCapture, 3, 3)).toMatchObject({ droppedEntryCounts: { commandArguments: 0 }, firstAffected: {} });

    const tokenCapture = capture();
    captureBoundary(tokenCapture, 1, 1, true, true);
    for (let index = 0; index < MAX_VALUE_TOKENS; index++) captureCommand(tokenCapture, 'call', 'save', [`value-${index}`], true);
    captureBoundary(tokenCapture, 2, 2, true, true);
    expect(finishCommandCapture(tokenCapture, 3, 3)).toMatchObject({ droppedEntryCounts: { valueTokens: 0 }, firstAffected: {} });

    const commandCapture = capture();
    captureBoundary(commandCapture, 1, 1, true, true);
    for (let index = 0; index < MAX_COMMAND_ENTRIES; index++) captureCommand(commandCapture, 'call', 'save', [], true);
    captureBoundary(commandCapture, 2, 2, true, true);
    expect(finishCommandCapture(commandCapture, 3, 3)).toMatchObject({ droppedEntryCounts: { commandEntries: 0 }, firstAffected: {} });

    const windowCapture = capture();
    for (let index = 1; index <= MAX_ACTIVE_WINDOWS; index++) captureBoundary(windowCapture, index, index, true, true);
    expect(finishCommandCapture(windowCapture, MAX_ACTIVE_WINDOWS, MAX_ACTIVE_WINDOWS)).toMatchObject({ droppedEntryCounts: { activeWindows: 0 }, firstAffected: {} });
  });
});

describe('command normalization and privacy', () => {
  it('reuses tokens inside one capture and isolates separate captures', () => {
    const first = capture();
    captureBoundary(first, 1, 1, true, true);
    captureCommand(first, 'call', 'save', ['secret', 'secret'], true);
    captureBoundary(first, 2, 2, true, true);
    const firstTokens = finishCommandCapture(first, 3, 3).windows[1].commands[0].arguments.map(argument => argument.token);
    const second = capture();
    captureBoundary(second, 1, 1, true, true);
    captureCommand(second, 'call', 'save', ['secret'], true);
    captureBoundary(second, 2, 2, true, true);
    const secondToken = finishCommandCapture(second, 3, 3).windows[1].commands[0].arguments[0].token;
    expect(firstTokens[0]).toBe(firstTokens[1]);
    expect(secondToken).not.toBe(firstTokens[0]);
  });

  it('quantizes numbers and keeps signed zero distinct', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    captureCommand(value, 'call', 'save', [1.001, 1.004, 1.006, -1.004, -0.004, 0], true);
    captureBoundary(value, 2, 2, true, true);
    const tokens = finishCommandCapture(value, 3, 3).windows[1].commands[0].arguments.map(argument => argument.token);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[2]).not.toBe(tokens[1]);
    expect(tokens[3]).not.toBe(tokens[0]);
    expect(tokens[4]).not.toBe(tokens[5]);
  });

  it('does not invoke hostile proxy traps and marks a revoked proxy unknown', () => {
    let traps = 0;
    const handler = Object.fromEntries(['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'deleteProperty', 'isExtensible', 'preventExtensions'].map(name => [name, () => { traps++; throw new Error(name); }]));
    const hostile = new Proxy({}, handler);
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    captureCommand(value, 'call', 'save', [hostile], true);
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    captureCommand(value, 'call', 'save', [revoked.proxy], true);
    captureBoundary(value, 2, 2, true, true);
    const result = finishCommandCapture(value, 3, 3);
    expect(traps).toBe(0);
    expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'unsupported-value' });
  });

  it('exports no raw application values', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    captureCommand(value, 'call', 'save', ['opaque-private-string', 918273.645, { privateKey: 'privateValue' }, () => 'private-function'], true);
    captureBoundary(value, 2, 2, true, true);
    const json = JSON.stringify(finishCommandCapture(value, 3, 3));
    for (const raw of ['opaque-private-string', '918273', 'privateKey', 'privateValue', 'private-function']) expect(json).not.toContain(raw);
  });

  it('uses safe array, typed-array, path, and gradient brands', () => {
    const path = {};
    const gradient = {};
    trackBuild(path, newWindowSignature(), 'path');
    trackBuild(gradient, newWindowSignature(), 'gradient');
    const value = capture();
    captureCommand(value, 'call', 'save', [[], new Uint8Array(2), path, gradient], true);
    captureBoundary(value, 1, 1, true, true);
    expect(finishCommandCapture(value, 2, 2).windows[0].commands[0].arguments.map(argument => argument.kind)).toEqual(['array', 'typed-array', 'path', 'gradient']);
  });

  it('changes opaque tokens when a tracked path or gradient build changes', () => {
    for (const kind of ['path', 'gradient'] as const) {
      const tracked = {};
      const build = newWindowSignature();
      trackBuild(tracked, build, kind);
      const value = capture();
      captureCommand(value, 'call', 'fill', [tracked], true);
      captureBoundary(value, 1, 1, true, true);
      captureCommand(value, 'call', 'fill', [tracked], true);
      captureBoundary(value, 2, 2, true, true);
      build.hash++;
      captureCommand(value, 'call', 'fill', [tracked], true);
      captureBoundary(value, 3, 3, true, true);
      const result = finishCommandCapture(value, 4, 4);
      expect(result.comparisons.at(-1)).toMatchObject({ status: 'changed', difference: { ordinal: 0, reason: 'argument-token' } });
    }
  });

  it('keeps a disabled capture unknown without a pending command', () => {
    const value = capture();
    captureBoundary(value, 1, 1, true, true);
    disableCommandCapture(value);
    captureBoundary(value, 2, 2, true, true);
    captureBoundary(value, 3, 3, true, true);
    const result = finishCommandCapture(value, 4, 4);
    expect(result.windows[0]).toMatchObject({ complete: false, unknownReason: 'sampling-gap' });
    expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'instrumentation-disabled' });
    expect(result.comparisons.at(-1)).toMatchObject({ status: 'unknown', difference: null, unknownReason: 'instrumentation-disabled' });
    expect(result.firstDifference).toBeNull();
  });
});

describe('command comparison', () => {
  it.each([
    ['command-added', [], [command()]],
    ['command-removed', [command()], []],
    ['operation-kind', [command()], [command({ operationKind: 'set' })]],
    ['operation-name', [command()], [command({ name: 'strokeRect' })]],
    ['argument-count', [command()], [command({ argumentCount: 2 })]],
    ['argument-kind', [command()], [command({ arguments: [{ position: 0, kind: 'string', token: 'token-a' }] })]],
    ['argument-token', [command()], [command({ arguments: [{ position: 0, kind: 'number', token: 'token-b' }] })]],
  ] as const)('returns %s for the first difference', (reason, reference, target) => {
    expect(compareCommandWindows(window(1, [...reference]), window(2, [...target]))).toMatchObject({ status: 'changed', difference: { ordinal: 0, reason } });
  });

  it('uses operation and count precedence before argument differences', () => {
    const target = command({ operationKind: 'set', name: 'strokeRect', argumentCount: 2, arguments: [{ position: 0, kind: 'string', token: 'token-b' }] });
    expect(compareCommandWindows(window(1, [command()]), window(2, [target])).difference?.reason).toBe('operation-kind');
    target.operationKind = 'call';
    expect(compareCommandWindows(window(1, [command()]), window(2, [target])).difference?.reason).toBe('operation-name');
    target.name = 'fillRect';
    expect(compareCommandWindows(window(1, [command()]), window(2, [target])).difference?.reason).toBe('argument-count');
  });

  it('returns same for equal complete windows and unknown for incomplete windows', () => {
    expect(compareCommandWindows(window(1, [command()]), window(2, [command()]))).toEqual({ referenceWindowIndex: 1, targetWindowIndex: 2, status: 'same', difference: null, unknownReason: null });
    expect(compareCommandWindows(window(1, [command()], false), window(2, [command()]))).toMatchObject({ status: 'unknown', difference: null, unknownReason: 'sampling-gap' });
  });
});

describe('live command relationship', () => {
  it('does one live comparison step per selected command', () => {
    const value = capture();
    captureBoundary(value, 0, 0, true, true);
    for (let index = 0; index < 1000; index++) captureCommand(value, 'call', 'fillRect', [index], true);
    captureBoundary(value, 1, 1, true, true);
    resetCommandCaptureForTests();
    for (let index = 0; index < 1000; index++) {
      const current = captureCommand(value, 'call', 'fillRect', [index], true)!;
      getLiveCommandRelationship(value, current);
    }
    expect(getLiveComparisonStepCount()).toBe(1000);
  });

  it('uses the boundary identity that receives the final target window index', () => {
    const value = capture();
    completeWindow(value, 10, [1]);
    completeWindow(value, 11, [1]);
    const current = captureCommand(value, 'call', 'fillRect', [2], true)!;
    const relationship = getLiveCommandRelationship(value, current);
    expect(relationship?.firstDifference).toBe(true);
    const boundary = captureBoundary(value, 17, 17, true, true);
    expect(boundary).toEqual({ identity: relationship?.identity, windowIndex: 17 });
    const result = finishCommandCapture(value, 18, 18);
    expect(result.firstDifference).toMatchObject({ targetWindowIndex: 17, ordinal: current.ordinal, reason: 'argument-token' });
  });

  it('does not qualify equal, later, incomplete, or removed current commands', () => {
    const equal = capture();
    completeWindow(equal, 1, [1]); completeWindow(equal, 2, [1]);
    const equalCommand = captureCommand(equal, 'call', 'fillRect', [1], true)!;
    expect(getLiveCommandRelationship(equal, equalCommand)?.firstDifference).toBe(false);

    const later = capture();
    captureCommand(later, 'call', 'fillRect', [1], true); captureCommand(later, 'call', 'strokeRect', [1], true); captureBoundary(later, 1, 1, true, true);
    captureCommand(later, 'call', 'fillRect', [1], true); captureCommand(later, 'call', 'strokeRect', [1], true); captureBoundary(later, 2, 2, true, true);
    const first = captureCommand(later, 'call', 'fillRect', [2], true)!;
    const second = captureCommand(later, 'call', 'strokeRect', [2], true)!;
    expect(getLiveCommandRelationship(later, first)?.firstDifference).toBe(true);
    expect(getLiveCommandRelationship(later, second)?.firstDifference).toBe(false);

    const incomplete = capture();
    completeWindow(incomplete, 1, [1]); completeWindow(incomplete, 2, [1]);
    captureCommand(incomplete, 'call', 'save', [], false);
    const sampled = captureCommand(incomplete, 'call', 'fillRect', [2], true)!;
    expect(getLiveCommandRelationship(incomplete, sampled)?.firstDifference).toBe(false);

    const removed = compareCommandWindows(window(1, [command(), command({ ordinal: 1 })]), window(2, [command()]));
    expect(removed.difference).toMatchObject({ ordinal: 1, reason: 'command-removed', target: null });
  });
});
