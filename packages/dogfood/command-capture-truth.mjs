import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const rowNames = ['wrapper-depth', 'canvas-order', 'background-work', 'identical-stream', 'unsupported-value'];
export const counterexampleNames = ['unsupported-gap', 'proxy-zero-traps', 'revoked-proxy', 'reset-only-start', 'non-selected-decoy'];

export const limits = {
  maxDurationMs: 10000,
  maxSelectedCanvases: 1,
  maxActiveWindows: 120,
  maxCommandEntries: 5000,
  maxArgumentsPerCommand: 20,
  maxValueTokens: 1024,
  maxStackSamples: 8,
  maxFramesPerStack: 20,
  maxSourceMapLookups: 8,
  maxSourceMapResponseBytes: 2097152,
};

const expectedRows = {
  'wrapper-depth': { changedFactor: 'wrapper-depth', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'canvas-order': { changedFactor: 'canvas-order', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'background-work': { changedFactor: 'background-work', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'identical-stream': { changedFactor: 'none', status: 'same', ordinal: null, reason: null, unknownReason: null },
  'unsupported-value': { changedFactor: 'unsupported-value', status: 'unknown', ordinal: null, reason: null, unknownReason: 'unsupported-value' },
};
const expectedCounterexamples = {
  'unsupported-gap': { status: 'unknown', unknownReason: 'unsupported-value' },
  'proxy-zero-traps': { status: 'same', unknownReason: null },
  'revoked-proxy': { status: 'unknown', unknownReason: 'unsupported-value' },
  'reset-only-start': { status: 'unknown', unknownReason: 'sampling-gap' },
  'non-selected-decoy': { status: 'same', unknownReason: null },
};
const argumentKinds = new Set(['number', 'string', 'boolean', 'null', 'undefined', 'array', 'typed-array', 'image', 'canvas', 'path', 'gradient', 'pattern', 'object']);
const differenceReasons = new Set(['command-added', 'command-removed', 'operation-kind', 'operation-name', 'argument-count', 'argument-kind', 'argument-token']);
const gapReasons = new Set(['unsupported-value', 'argument-limit', 'value-token-limit', 'command-limit', 'window-limit', 'sampling-gap', 'instrumentation-disabled']);
const dropKeys = ['activeWindows', 'commandEntries', 'commandArguments', 'valueTokens', 'stackSamples', 'stackFrames', 'sourceMapLookups'];
const privacyCategories = ['strings', 'numbers', 'keys', 'urls', 'sha256', 'fnv', 'function-source', 'live-object-shapes', 'claim-language'];
const privateStrings = ['opaque-private-string', 'privateKey', 'privateValue', 'private-function', 'privateFunction', 'liveOnlyPrivateShape'];
const privateNumbers = [918273.645, 771928.125];
const privateUrls = ['https://secret.example.invalid/private-path?private-query=1#private-fragment'];
const privateUrlParts = ['secret.example.invalid', 'private-path', 'private-query', 'private-fragment'];
const liveKeys = ['privateKey', 'liveOnlyPrivateShape', 'ownerDocument', 'nodeType'];
const forbiddenClaims = ['same pixels', 'unchanged pixels', 'wasted work', 'avoidable work', 'caused by'];
const tokenPattern = /^[a-f0-9]{32}-[1-9]\d*$/;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
const privacySeeds = [...privateStrings, ...privateNumbers.map(String), ...privateUrls, ...privateUrlParts];
const combinedSeeds = [
  privacySeeds.join(''),
  privacySeeds.join(':'),
  privacySeeds.join('|'),
  JSON.stringify(privacySeeds),
];
for (let left = 0; left < privacySeeds.length; left++) for (let right = left + 1; right < privacySeeds.length; right++) {
  combinedSeeds.push(`${privacySeeds[left]}${privacySeeds[right]}`, `${privacySeeds[left]}:${privacySeeds[right]}`, `${privacySeeds[left]}|${privacySeeds[right]}`);
}
const digestInputs = [...new Set([...privacySeeds, ...combinedSeeds])];
const sha256Secrets = digestInputs.map(value => createHash('sha256').update(value).digest('hex'));
const fnvHexSecrets = digestInputs.map(fnv1a);
const fnvDecimalSecrets = fnvHexSecrets.map(value => String(Number.parseInt(value, 16)));

function addFailure(failures, failure) {
  if (!failures.includes(failure)) failures.push(failure);
}

function comparison(reference, target) {
  if (!reference.complete || !target.complete) {
    return {
      referenceWindowIndex: reference.windowIndex,
      targetWindowIndex: target.windowIndex,
      status: 'unknown',
      difference: null,
      unknownReason: reference.unknownReason ?? target.unknownReason,
    };
  }
  const count = Math.max(reference.commands.length, target.commands.length);
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const left = reference.commands[ordinal] ?? null;
    const right = target.commands[ordinal] ?? null;
    let reason = null;
    if (!left) reason = 'command-added';
    else if (!right) reason = 'command-removed';
    else if (left.operationKind !== right.operationKind) reason = 'operation-kind';
    else if (left.name !== right.name) reason = 'operation-name';
    else if (left.argumentCount !== right.argumentCount) reason = 'argument-count';
    else {
      const argumentCount = Math.max(left.arguments.length, right.arguments.length);
      for (let position = 0; position < argumentCount; position++) {
        const leftArgument = left.arguments[position];
        const rightArgument = right.arguments[position];
        if (!leftArgument || !rightArgument || leftArgument.kind !== rightArgument.kind) { reason = 'argument-kind'; break; }
        if (leftArgument.token !== rightArgument.token) { reason = 'argument-token'; break; }
      }
    }
    if (reason) {
      return {
        referenceWindowIndex: reference.windowIndex,
        targetWindowIndex: target.windowIndex,
        status: 'changed',
        difference: { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, ordinal, reason, reference: left ? clone(left) : null, target: right ? clone(right) : null },
        unknownReason: null,
      };
    }
  }
  return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, status: 'same', difference: null, unknownReason: null };
}

function privacyMatch(trail, category, value) { return { trail, category, value: String(value) }; }
export function scanArtifactPrivacy(value) {
  const matches = [];
  function visit(entry, trail) {
    if (typeof entry === 'number') {
      if (privateNumbers.some(value => Object.is(value, entry))) matches.push(privacyMatch(trail, 'numbers', entry));
      if (fnvDecimalSecrets.includes(String(entry))) matches.push(privacyMatch(trail, 'fnv', entry));
      return;
    }
    if (typeof entry === 'string') {
      const lower = entry.toLowerCase();
      for (const seed of privateStrings) if (lower.includes(seed.toLowerCase())) matches.push(privacyMatch(trail, 'strings', seed));
      for (const seed of privateNumbers) if (entry.includes(String(seed))) matches.push(privacyMatch(trail, 'numbers', seed));
      for (const part of [...privateUrls, ...privateUrlParts]) if (entry.includes(part)) matches.push(privacyMatch(trail, 'urls', part));
      for (const digest of sha256Secrets) if (entry.includes(digest)) matches.push(privacyMatch(trail, 'sha256', digest));
      for (const digest of [...fnvHexSecrets, ...fnvDecimalSecrets]) if (entry.includes(digest)) matches.push(privacyMatch(trail, 'fnv', digest));
      if (entry.includes('function privateFunction') || entry.includes("() => 'private-function'") || entry.includes('privateFunction')) matches.push(privacyMatch(trail, 'function-source', entry));
      for (const claim of forbiddenClaims) if (lower.includes(claim)) matches.push(privacyMatch(trail, 'claim-language', claim));
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${trail}[${index}]`));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, item] of Object.entries(entry)) {
      if (privateStrings.some(seed => key.toLowerCase().includes(seed.toLowerCase()))) matches.push(privacyMatch(`${trail}.${key}`, 'keys', key));
      if (liveKeys.includes(key)) matches.push(privacyMatch(`${trail}.${key}`, 'live-object-shapes', key));
      visit(item, `${trail}.${key}`);
    }
  }
  visit(value, '$');
  return matches;
}

function checkCommand(name, command, ordinal, failures, tokens, counters) {
  if (!command || command.ordinal !== ordinal || !['call', 'set'].includes(command.operationKind) || typeof command.name !== 'string' || command.name.length === 0) addFailure(failures, `${name}:command-shape`);
  if (!Number.isInteger(command?.argumentCount) || command.argumentCount < 0 || !Array.isArray(command?.arguments) || command.arguments.length > limits.maxArgumentsPerCommand || command.arguments.length > command.argumentCount) addFailure(failures, `${name}:argument-count`);
  if (!(command?.unknownReason === null || gapReasons.has(command?.unknownReason))) addFailure(failures, `${name}:command-unknown-reason`);
  for (let position = 0; position < (command?.arguments?.length ?? 0); position++) {
    const argument = command.arguments[position];
    if (!argument || argument.position !== position || !argumentKinds.has(argument.kind) || !(argument.token === null || tokenPattern.test(argument.token))) addFailure(failures, `${name}:argument-shape`);
    if (typeof argument?.token === 'string') {
      const owner = tokens.get(argument.token);
      if (owner && owner !== name) addFailure(failures, `${name}:token-cross-artifact`);
      tokens.set(argument.token, name);
      counters.tokens.add(argument.token);
    }
  }
}

function checkGap(name, artifact, failures) {
  const incomplete = artifact.windows.find(window => !window.complete);
  const dropped = dropKeys.some(key => artifact.droppedEntryCounts[key] > 0);
  if ((incomplete || dropped) && !artifact.firstGap) addFailure(failures, `${name}:missing-first-gap`);
  if (!artifact.firstGap) return;
  const gap = artifact.firstGap;
  if (!Number.isInteger(gap.windowIndex) || gap.windowIndex < 0 || !(gap.commandOrdinal === null || Number.isInteger(gap.commandOrdinal) && gap.commandOrdinal >= 0) || !gapReasons.has(gap.reason)) addFailure(failures, `${name}:first-gap-shape`);
  const window = artifact.windows.find(entry => entry.windowIndex === gap.windowIndex);
  if (gap.reason === 'window-limit') {
    if (gap.commandOrdinal !== null || artifact.droppedEntryCounts.activeWindows === 0) addFailure(failures, `${name}:first-gap-window-limit`);
  } else if (!window || window.complete || window.unknownReason !== gap.reason || gap.commandOrdinal === null) addFailure(failures, `${name}:first-gap-reference`);
}

function checkArtifact(name, artifact, failures, tokens) {
  const startedMs = Date.parse(artifact?.startedAt);
  const endedMs = Date.parse(artifact?.endedAt);
  if (!artifact || artifact.schemaVersion !== 1 || typeof artifact.explanationId !== 'string' || artifact.explanationId.length === 0 || !Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs || !Number.isFinite(artifact.durationMs) || artifact.durationMs < 0 || artifact.durationMs > limits.maxDurationMs || Math.abs(endedMs - startedMs - artifact.durationMs) > 100 || !['manual', 'max-duration'].includes(artifact.stopReason) || typeof artifact.canvasScanVersion !== 'string' || artifact.canvasScanVersion.length === 0) {
    addFailure(failures, `${name}:metadata`);
    return;
  }
  if (!artifact.source?.sessionId || !Number.isInteger(artifact.source.findingIndex) || !artifact.source.findingType || !artifact.source.canvasId || !artifact.followUp?.sessionId || artifact.source.canvasId !== artifact.followUp.canvasId) addFailure(failures, `${name}:identity`);
  if (!sameJson(artifact.collectionLimits, limits)) addFailure(failures, `${name}:limits`);
  if (!Array.isArray(artifact.stacks) || artifact.stacks.length > limits.maxStackSamples) addFailure(failures, `${name}:stacks`);
  if (!Array.isArray(artifact.windows) || artifact.windows.length === 0 || artifact.windows.length > limits.maxActiveWindows) {
    addFailure(failures, `${name}:windows`);
    return;
  }
  let commandCount = 0;
  let previousWindowIndex = -1;
  let previousTimestamp = -Infinity;
  const counters = { tokens: new Set() };
  for (const window of artifact.windows) {
    if (!Number.isInteger(window?.windowIndex) || window.windowIndex <= previousWindowIndex || !Number.isFinite(window.timestampMs) || window.timestampMs < previousTimestamp || !Array.isArray(window.commands) || typeof window.complete !== 'boolean' || !(window.unknownReason === null || gapReasons.has(window.unknownReason)) || window.complete !== (window.unknownReason === null)) addFailure(failures, `${name}:window-shape`);
    previousWindowIndex = window.windowIndex;
    previousTimestamp = window.timestampMs;
    for (let ordinal = 0; ordinal < (window.commands?.length ?? 0); ordinal++) checkCommand(name, window.commands[ordinal], ordinal, failures, tokens, counters);
    const commandReasons = window.commands.map(command => command.unknownReason).filter(Boolean);
    if (!window.complete && ['unsupported-value', 'argument-limit', 'value-token-limit'].includes(window.unknownReason) && !commandReasons.includes(window.unknownReason)) addFailure(failures, `${name}:missing-command-gap`);
    for (const command of window.commands) {
      if (command.unknownReason === 'unsupported-value' && !command.arguments.some(argument => argument.token === null)) addFailure(failures, `${name}:unsupported-command-gap`);
      if (command.unknownReason === 'value-token-limit' && !command.arguments.some(argument => argument.token === null)) addFailure(failures, `${name}:value-token-gap`);
      if (command.unknownReason === 'argument-limit' && command.argumentCount <= command.arguments.length) addFailure(failures, `${name}:argument-gap`);
      if (command.unknownReason && window.complete) addFailure(failures, `${name}:complete-command-gap`);
    }
    commandCount += window.commands?.length ?? 0;
  }
  if (commandCount > limits.maxCommandEntries || counters.tokens.size > limits.maxValueTokens) addFailure(failures, `${name}:stored-limits`);
  if (!artifact.windows[0] || artifact.windows[0].complete || artifact.windows[0].unknownReason !== 'sampling-gap') addFailure(failures, `${name}:first-window-partial`);
  if (!artifact.droppedEntryCounts || Object.keys(artifact.droppedEntryCounts).sort().join(',') !== [...dropKeys].sort().join(',')) addFailure(failures, `${name}:drop-keys`);
  for (const key of dropKeys) if (!Number.isInteger(artifact.droppedEntryCounts?.[key]) || artifact.droppedEntryCounts[key] < 0) addFailure(failures, `${name}:drop-${key}`);
  const omittedArguments = artifact.windows.flatMap(window => window.commands).reduce((sum, command) => sum + Math.max(0, command.argumentCount - command.arguments.length), 0);
  const omittedTokens = artifact.windows.flatMap(window => window.commands).flatMap(command => command.arguments).filter(argument => argument.token === null && argumentKinds.has(argument.kind)).length;
  const droppedValueTokens = artifact.windows.flatMap(window => window.commands).reduce((sum, command) => sum + (command.unknownReason === 'value-token-limit' ? command.arguments.filter(argument => argument.token === null).length : 0), 0);
  if (artifact.droppedEntryCounts.commandArguments !== omittedArguments) addFailure(failures, `${name}:drop-commandArguments-exact`);
  if (artifact.droppedEntryCounts.valueTokens !== droppedValueTokens) addFailure(failures, `${name}:drop-valueTokens-exact`);
  if (artifact.droppedEntryCounts.commandEntries !== 0 || artifact.droppedEntryCounts.stackSamples !== 0 || artifact.droppedEntryCounts.stackFrames !== 0 || artifact.droppedEntryCounts.sourceMapLookups !== 0) addFailure(failures, `${name}:unsupported-drop-count`);
  if (artifact.droppedEntryCounts.activeWindows > 0 && artifact.windows.length !== limits.maxActiveWindows) addFailure(failures, `${name}:drop-activeWindows-exact`);
  if (omittedTokens > 0 && !artifact.windows.some(window => window.commands.some(command => command.unknownReason === 'unsupported-value' || command.unknownReason === 'value-token-limit'))) addFailure(failures, `${name}:null-token-without-gap`);

  const expectedComparisons = [];
  for (let index = 1; index < artifact.windows.length; index++) expectedComparisons.push(comparison(artifact.windows[index - 1], artifact.windows[index]));
  for (let index = 0; index < (artifact.droppedEntryCounts?.activeWindows ?? 0); index++) {
    const reference = artifact.windows.at(-1);
    expectedComparisons.push({ referenceWindowIndex: reference.windowIndex, targetWindowIndex: reference.windowIndex + index + 1, status: 'unknown', difference: null, unknownReason: 'window-limit' });
  }
  if (!Array.isArray(artifact.comparisons) || artifact.comparisons.length !== expectedComparisons.length) addFailure(failures, `${name}:comparison-count`);
  else for (let index = 0; index < expectedComparisons.length; index++) if (!sameJson(artifact.comparisons[index], expectedComparisons[index])) addFailure(failures, `${name}:comparison-${index}`);
  const firstDifference = expectedComparisons.find(entry => entry.status === 'changed')?.difference ?? null;
  if (!sameJson(artifact.firstDifference, firstDifference)) addFailure(failures, `${name}:first-difference`);
  if (artifact.firstDifference && !differenceReasons.has(artifact.firstDifference.reason)) addFailure(failures, `${name}:difference-reason`);
  checkGap(name, artifact, failures);
  if (!artifact.firstGap || artifact.firstGap.windowIndex !== artifact.windows[0].windowIndex || artifact.firstGap.reason !== 'sampling-gap') addFailure(failures, `${name}:start-gap`);
  if (scanArtifactPrivacy(artifact).length > 0) addFailure(failures, `${name}:privacy`);
}

export function checkArtifactEvidence(artifact) {
  const failures = [];
  checkArtifact('artifact', artifact, failures, new Map());
  return { pass: failures.length === 0, failures };
}

function lastComparison(artifact) { return artifact?.comparisons?.at(-1) ?? null; }
function checkRows(expectedResults, actualResults, artifacts, failures) {
  if (!sameJson(expectedResults?.rows, rowNames.map(name => ({ name, ...expectedRows[name] })))) addFailure(failures, 'expected-rows');
  if (!Array.isArray(actualResults?.rows) || !sameJson(actualResults.rows.map(row => row.name), rowNames)) { addFailure(failures, 'actual-rows'); return; }
  for (const row of actualResults.rows) {
    const expected = expectedRows[row.name];
    const artifact = artifacts[row.name];
    if (!artifact) { addFailure(failures, `${row.name}:missing-artifact`); continue; }
    const result = lastComparison(artifact);
    if (row.canvasId !== artifact?.source?.canvasId || !Number.isInteger(row.wrapperDepth) || !Array.isArray(row.registrationOrder) || !Number.isInteger(row.nonSelectedOperationCount) || row.nonSelectedProbeOperationCount !== 1 || !Number.isInteger(row.selectedOperationCount) || !sameJson(row.gap, artifact.firstGap)) addFailure(failures, `${row.name}:actual-shape`);
    const expectedDepth = row.name === 'wrapper-depth' ? 3 : 1;
    const expectedOrder = row.name === 'canvas-order' ? ['decoy', 'selected'] : ['selected', 'decoy'];
    const expectedBackground = row.name === 'background-work' ? 4 : 1;
    if (row.wrapperDepth !== expectedDepth || !sameJson(row.registrationOrder, expectedOrder) || row.nonSelectedOperationCount !== expectedBackground || row.selectedOperationCount !== 12) addFailure(failures, `${row.name}:factor-isolation`);
    if (!result || result.status !== expected.status || result.unknownReason !== expected.unknownReason || (result.difference?.ordinal ?? null) !== expected.ordinal || (result.difference?.reason ?? null) !== expected.reason) addFailure(failures, `${row.name}:result`);
    if (row.status !== result?.status || row.unknownReason !== result?.unknownReason || row.ordinal !== (result?.difference?.ordinal ?? null) || row.reason !== (result?.difference?.reason ?? null)) addFailure(failures, `${row.name}:reported-result`);
    if (artifact.windows.reduce((sum, window) => sum + window.commands.length, 0) !== row.selectedOperationCount) addFailure(failures, `${row.name}:selected-operation-count`);
    if (row.name === 'unsupported-value' && !artifact.windows.some(window => window.unknownReason === 'unsupported-value' && window.commands.some(command => command.unknownReason === 'unsupported-value'))) addFailure(failures, `${row.name}:unsupported-gap`);
  }
}

function checkCounterexamples(actualResults, artifacts, failures) {
  if (!Array.isArray(actualResults?.counterexamples) || !sameJson(actualResults.counterexamples.map(row => row.name), counterexampleNames)) { addFailure(failures, 'counterexamples'); return; }
  for (const row of actualResults.counterexamples) {
    const expected = expectedCounterexamples[row.name];
    const artifact = artifacts[row.name];
    if (!artifact) { addFailure(failures, `${row.name}:missing-artifact`); continue; }
    const result = lastComparison(artifact);
    if (row.canvasId !== artifact?.source?.canvasId || row.status !== result?.status || row.unknownReason !== result?.unknownReason || result?.status !== expected.status || result?.unknownReason !== expected.unknownReason || !sameJson(row.gap, artifact.firstGap) || !['same', 'changed', 'unknown'].includes(row.passiveReportStatus)) addFailure(failures, `${row.name}:result`);
    if (row.name === 'unsupported-gap' && !(row.nativeSucceeded === true && row.passiveAlive === true && row.selectedOperationCount === 12 && artifact.windows.some(window => window.unknownReason === 'unsupported-value' && window.commands.some(command => command.unknownReason === 'unsupported-value')))) addFailure(failures, `${row.name}:facts`);
    if (row.name === 'proxy-zero-traps' && !(row.nativeSucceeded === true && row.passiveAlive === true && row.trapCount === 0)) addFailure(failures, `${row.name}:facts`);
    if (row.name === 'revoked-proxy' && !(row.nativeSucceeded === true && row.passiveAlive === true && row.trapCount === 0 && artifact.windows.some(window => window.unknownReason === 'unsupported-value'))) addFailure(failures, `${row.name}:facts`);
    if (row.name === 'reset-only-start' && !(row.nativeSucceeded === true && row.passiveAlive === true && artifact.windows[0]?.commands.length === 0 && artifact.windows[0]?.unknownReason === 'sampling-gap')) addFailure(failures, `${row.name}:facts`);
    if (row.name === 'non-selected-decoy' && !(row.nativeSucceeded === true && row.passiveAlive === true && row.nonSelectedOperationCount === 3 && row.selectedOperationCount === 12)) addFailure(failures, `${row.name}:facts`);
  }
}

function checkAllocation(allocationCounter, failures) {
  if (!Array.isArray(allocationCounter?.rows) || !sameJson(allocationCounter.rows.map(row => row.name), rowNames)) { addFailure(failures, 'allocation-rows'); return; }
  let noExplanationTotal = 0;
  let nonSelectedTotal = 0;
  let selectedTotal = 0;
  for (const row of allocationCounter.rows) {
    for (const key of ['noExplanationDelta', 'nonSelectedDelta', 'selectedDelta']) if (!Number.isInteger(row[key]) || row[key] < 0) addFailure(failures, `${row.name}:allocation-shape`);
    if (row.noExplanationDelta !== 0 || row.nonSelectedDelta !== 0 || row.selectedDelta <= 0) addFailure(failures, `${row.name}:allocation-value`);
    noExplanationTotal += row.noExplanationDelta;
    nonSelectedTotal += row.nonSelectedDelta;
    selectedTotal += row.selectedDelta;
  }
  if (!sameJson(allocationCounter.totals, { noExplanation: noExplanationTotal, nonSelected: nonSelectedTotal, selected: selectedTotal })) addFailure(failures, 'allocation-totals');
}

export function checkEvidence({ manifest, expectedResults, actualResults, artifacts, privacyScan, allocationCounter }) {
  const failures = [];
  for (const key of ['schemaVersion', 'probeVersion', 'chromeVersion', 'platform', 'gitSha', 'productionBundleSha256', 'diagnosticBundleSha256']) if (typeof manifest?.[key] !== 'string' || manifest[key].length === 0) addFailure(failures, `manifest:${key}`);
  if (!/^[a-f0-9]{40}$/.test(manifest?.gitSha ?? '') || !/^[a-f0-9]{64}$/.test(manifest?.productionBundleSha256 ?? '') || !/^[a-f0-9]{64}$/.test(manifest?.diagnosticBundleSha256 ?? '')) addFailure(failures, 'manifest:hashes');
  if (typeof manifest?.dirty !== 'boolean' || !sameJson(manifest?.limits, limits) || !sameJson(manifest?.rows, rowNames) || !sameJson(manifest?.counterexamples, counterexampleNames)) addFailure(failures, 'manifest:state');
  const tokens = new Map();
  if (!sameJson(Object.keys(artifacts ?? {}).sort(), [...rowNames, ...counterexampleNames].sort())) addFailure(failures, 'artifact-set');
  for (const name of [...rowNames, ...counterexampleNames]) checkArtifact(name, artifacts?.[name], failures, tokens);
  checkRows(expectedResults, actualResults, artifacts, failures);
  checkCounterexamples(actualResults, artifacts, failures);
  const recomputedPrivacy = scanArtifactPrivacy(artifacts);
  if (!sameJson(privacyScan?.checkedCategories, privacyCategories) || privacyScan?.pass !== (recomputedPrivacy.length === 0) || !sameJson(privacyScan?.matches, recomputedPrivacy) || recomputedPrivacy.length > 0) addFailure(failures, 'privacy');
  checkAllocation(allocationCounter, failures);
  return { pass: failures.length === 0, failures };
}

if (process.argv[2] === '--check-evidence') {
  const directory = process.argv[3];
  const read = name => readFile(path.join(directory, name), 'utf8').then(JSON.parse);
  const [manifest, expectedResults, actualResults, privacyScan, allocationCounter] = await Promise.all(['manifest.json', 'expected-results.json', 'actual-results.json', 'privacy-results.json', 'allocation-counter.json'].map(read));
  const artifacts = Object.fromEntries(await Promise.all([...rowNames, ...counterexampleNames].map(async name => [name, await read(`artifacts/${name}.json`)])));
  const result = checkEvidence({ manifest, expectedResults, actualResults, artifacts, privacyScan, allocationCounter });
  if (result.pass) console.log('SIDPROJ_72_COMMAND_EVIDENCE: PASS');
  else { console.error(`SIDPROJ_72_COMMAND_EVIDENCE: FAIL ${result.failures.join(', ')}`); process.exitCode = 1; }
}
