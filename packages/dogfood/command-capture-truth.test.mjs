import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkArtifactEvidence, checkEvidence, counterexampleNames, limits, rowNames, scanArtifactPrivacy } from './command-capture-truth.mjs';

const expected = {
  'wrapper-depth': { changedFactor: 'wrapper-depth', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'canvas-order': { changedFactor: 'canvas-order', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'background-work': { changedFactor: 'background-work', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'identical-stream': { changedFactor: 'none', status: 'same', ordinal: null, reason: null, unknownReason: null },
  'unsupported-value': { changedFactor: 'unsupported-value', status: 'unknown', ordinal: null, reason: null, unknownReason: 'unsupported-value' },
};
const privacyCategories = ['strings', 'numbers', 'keys', 'urls', 'sha256', 'fnv', 'function-source', 'live-object-shapes', 'claim-language'];

function token(index, value) { return `${index.toString(16).padStart(32, '0')}-${value}`; }
function command(index, ordinal, valueToken, overrides = {}) {
  return {
    ordinal,
    operationKind: 'call',
    name: ordinal === 0 ? 'save' : ordinal === 1 ? 'fillStyle' : ordinal === 2 ? 'fillRect' : 'restore',
    argumentCount: 1,
    arguments: [{ position: 0, kind: ordinal === 0 ? 'object' : ordinal === 1 ? 'string' : 'number', token: token(index, valueToken) }],
    unknownReason: null,
    ...overrides,
  };
}
function commands(index, changed = false, unsupported = false) {
  const result = [command(index, 0, 1), command(index, 1, 2), command(index, 2, changed ? 4 : 3), command(index, 3, 5, { argumentCount: 0, arguments: [] })];
  if (unsupported) result[0] = command(index, 0, 1, { unknownReason: 'unsupported-value', arguments: [{ position: 0, kind: 'object', token: null }] });
  return result;
}
function changedDifference(reference, target) {
  return { referenceWindowIndex: reference.windowIndex, targetWindowIndex: target.windowIndex, ordinal: 2, reason: 'argument-token', reference: reference.commands[2], target: target.commands[2] };
}
function emptyLimitResults() {
  return [
    ['duration-ms', 10000], ['selected-canvases', 1], ['active-windows', 120], ['command-entries', 5000], ['arguments-per-command', 20],
    ['value-tokens', 1024], ['stack-samples', 8], ['frames-per-stack', 20], ['source-map-lookups', 8], ['source-map-response-bytes', 2097152],
  ].map(([name, maximum]) => ({ name, maximum, rejectedCount: 0, reason: null, firstAffected: null }));
}
function artifact(name, index) {
  const resetOnly = name === 'reset-only-start';
  const unknown = ['unsupported-value', 'unsupported-gap', 'revoked-proxy'].includes(name);
  const changed = ['wrapper-depth', 'canvas-order', 'background-work'].includes(name);
  const first = { windowIndex: 10, timestampMs: 10, commands: resetOnly ? [] : commands(index), complete: false, unknownReason: 'sampling-gap' };
  const second = { windowIndex: 11, timestampMs: 11, commands: resetOnly ? [] : commands(index), complete: true, unknownReason: null };
  const windows = [first, second];
  if (!resetOnly) windows.push({ windowIndex: 12, timestampMs: 12, commands: commands(index, changed, unknown), complete: !unknown, unknownReason: unknown ? 'unsupported-value' : null });
  const comparisons = [{ referenceWindowIndex: 10, targetWindowIndex: 11, status: 'unknown', difference: null, unknownReason: 'sampling-gap' }];
  if (!resetOnly) {
    const difference = changed ? changedDifference(second, windows[2]) : null;
    comparisons.push({ referenceWindowIndex: 11, targetWindowIndex: 12, status: unknown ? 'unknown' : changed ? 'changed' : 'same', difference, unknownReason: unknown ? 'unsupported-value' : null });
  }
  return {
    schemaVersion: 1,
    explanationId: `explanation-${index}`,
    startedAt: '2026-08-07T00:00:00.000Z',
    endedAt: '2026-08-07T00:00:01.000Z',
    durationMs: 1000,
    stopReason: 'manual',
    canvasScanVersion: '0.5.0',
    source: { sessionId: `source-${index}`, findingIndex: 0, findingType: 'repeated-draw-work', canvasId: `canvas-${index}` },
    followUp: { sessionId: `follow-${index}`, canvasId: `canvas-${index}` },
    windows,
    comparisons,
    firstDifference: changed ? comparisons[1].difference : null,
    stacks: [],
    collectionLimits: { ...limits },
    droppedEntryCounts: { durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 },
    limitResults: emptyLimitResults(),
    callsiteCoverage: { status: 'complete', incompleteReasons: [] },
    firstGap: { windowIndex: 10, commandOrdinal: 0, reason: 'sampling-gap' },
  };
}

function valid() {
  const names = [...rowNames, ...counterexampleNames];
  const artifacts = JSON.parse(JSON.stringify(Object.fromEntries(names.map((name, index) => [name, artifact(name, index + 1)]))));
  const actualRows = rowNames.map(name => {
    const result = artifacts[name].comparisons.at(-1);
    return {
      name,
      canvasId: artifacts[name].source.canvasId,
      wrapperDepth: name === 'wrapper-depth' ? 3 : 1,
      registrationOrder: name === 'canvas-order' ? ['decoy', 'selected'] : ['selected', 'decoy'],
      nonSelectedOperationCount: name === 'background-work' ? 4 : 1,
      nonSelectedProbeOperationCount: 1,
      selectedOperationCount: 12,
      gap: artifacts[name].firstGap,
      status: result.status,
      ordinal: result.difference?.ordinal ?? null,
      reason: result.difference?.reason ?? null,
      unknownReason: result.unknownReason,
    };
  });
  const actualCounterexamples = counterexampleNames.map(name => {
    const result = artifacts[name].comparisons.at(-1);
    return {
      name,
      canvasId: artifacts[name].source.canvasId,
      status: result.status,
      unknownReason: result.unknownReason,
      nativeSucceeded: true,
      passiveAlive: true,
      passiveReportStatus: 'unknown',
      trapCount: 0,
      selectedOperationCount: 12,
      nonSelectedOperationCount: name === 'non-selected-decoy' ? 3 : 0,
      gap: artifacts[name].firstGap,
    };
  });
  const allocationRows = rowNames.map(name => ({ name, noExplanationDelta: 0, nonSelectedDelta: 0, selectedDelta: 12 }));
  return {
    manifest: { schemaVersion: '1', probeVersion: '1', chromeVersion: 'Chrome test', platform: 'test', gitSha: 'a'.repeat(40), dirty: true, productionBundleSha256: 'a'.repeat(64), diagnosticBundleSha256: 'b'.repeat(64), limits: { ...limits }, rows: [...rowNames], counterexamples: [...counterexampleNames] },
    expectedResults: { rows: rowNames.map(name => ({ name, ...expected[name] })) },
    actualResults: { rows: actualRows, counterexamples: actualCounterexamples },
    artifacts,
    privacyScan: { pass: true, checkedCategories: [...privacyCategories], matches: [] },
    allocationCounter: { rows: allocationRows, totals: { noExplanation: 0, nonSelected: 0, selected: 60 } },
  };
}

test('checker accepts complete valid evidence', () => {
  const evidence = valid();
  assert.deepEqual(scanArtifactPrivacy(evidence.artifacts), []);
  assert.deepEqual(checkEvidence(evidence), { pass: true, failures: [] });
});

test('artifact checker accepts a valid omitted 121st active window', () => {
  const value = artifact('reset-only-start', 90);
  while (value.windows.length < limits.maxActiveWindows) {
    const prior = value.windows.at(-1);
    const next = { windowIndex: prior.windowIndex + 1, timestampMs: prior.timestampMs + 1, commands: [], complete: true, unknownReason: null };
    value.comparisons.push({ referenceWindowIndex: prior.windowIndex, targetWindowIndex: next.windowIndex, status: 'same', difference: null, unknownReason: null });
    value.windows.push(next);
  }
  value.droppedEntryCounts.activeWindows = 1;
  value.comparisons.push({ referenceWindowIndex: value.windows.at(-1).windowIndex, targetWindowIndex: value.windows.at(-1).windowIndex + 1, status: 'unknown', difference: null, unknownReason: 'window-limit' });
  assert.deepEqual(checkArtifactEvidence(value), { pass: true, failures: [] });
});

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

const mutations = {
  'missing artifact': value => { delete value.artifacts['wrapper-depth']; },
  'extra artifact': value => { value.artifacts.extra = structuredClone(value.artifacts['wrapper-depth']); },
  'manifest row order': value => { value.manifest.rows.reverse(); },
  'empty manifest metadata': value => { value.manifest.chromeVersion = ''; },
  'manifest limit': value => { value.manifest.limits.maxActiveWindows = 119; },
  'manifest hash format': value => { value.manifest.productionBundleSha256 = 'x'; },
  'expected result': value => { value.expectedResults.rows[0].ordinal = 1; },
  'actual row order': value => { value.actualResults.rows.reverse(); },
  'extra actual row': value => { value.actualResults.rows.push(structuredClone(value.actualResults.rows[0])); },
  'duplicate actual row': value => { value.actualResults.rows[1].name = value.actualResults.rows[0].name; },
  'factor isolation': value => { value.actualResults.rows[0].wrapperDepth = 2; },
  'reported result': value => { value.actualResults.rows[0].status = 'same'; },
  'counterexample facts': value => { value.actualResults.counterexamples[1].trapCount = 1; },
  'missing passive report': value => { value.actualResults.counterexamples[1].passiveReportStatus = null; },
  'source identity': value => { value.artifacts['wrapper-depth'].followUp.canvasId = 'other'; },
  'invalid start date': value => { value.artifacts['wrapper-depth'].startedAt = 'not-a-date'; },
  'end before start': value => { value.artifacts['wrapper-depth'].endedAt = '2020-01-01T00:00:00.000Z'; },
  'negative duration': value => { value.artifacts['wrapper-depth'].durationMs = -1; },
  'inconsistent duration': value => { value.artifacts['wrapper-depth'].durationMs = 9999; },
  'window order': value => { value.artifacts['wrapper-depth'].windows[1].windowIndex = 10; },
  'timestamp order': value => { value.artifacts['wrapper-depth'].windows[1].timestampMs = 9; },
  'first window completeness': value => { value.artifacts['wrapper-depth'].windows[0].complete = true; value.artifacts['wrapper-depth'].windows[0].unknownReason = null; },
  'command ordinal': value => { value.artifacts['wrapper-depth'].windows[1].commands[1].ordinal = 3; },
  'argument position': value => { value.artifacts['wrapper-depth'].windows[1].commands[0].arguments[0].position = 2; },
  'argument token shape': value => { value.artifacts['wrapper-depth'].windows[1].commands[0].arguments[0].token = 'plain'; },
  'token reused between artifacts': value => { value.artifacts['canvas-order'].windows[0].commands[0].arguments[0].token = value.artifacts['wrapper-depth'].windows[0].commands[0].arguments[0].token; },
  'comparison count': value => { value.artifacts['wrapper-depth'].comparisons.pop(); },
  'comparison status': value => { value.artifacts['wrapper-depth'].comparisons[1].status = 'same'; },
  'incomplete comparison changed': value => { value.artifacts['wrapper-depth'].comparisons[0].status = 'changed'; },
  'comparison across gap': value => { value.artifacts['wrapper-depth'].comparisons[0].targetWindowIndex = 12; },
  'comparison difference reason': value => { value.artifacts['wrapper-depth'].comparisons[1].difference.reason = 'operation-name'; },
  'difference snapshot': value => { value.artifacts['wrapper-depth'].comparisons[1].difference.reference.arguments[0].token = token(99, 1); },
  'first difference': value => { value.artifacts['wrapper-depth'].firstDifference = null; },
  'missing first gap': value => { value.artifacts['unsupported-value'].firstGap = null; },
  'negative gap window': value => { value.artifacts['unsupported-value'].firstGap.windowIndex = -1; },
  'wrong gap reason': value => { value.artifacts['unsupported-value'].firstGap.reason = 'argument-limit'; },
  'missing unsupported command gap': value => { value.artifacts['unsupported-value'].windows[2].commands[0].unknownReason = null; },
  'drop count': value => { value.artifacts['wrapper-depth'].droppedEntryCounts.valueTokens = -1; },
  'false positive drop count': value => { value.artifacts['wrapper-depth'].droppedEntryCounts.valueTokens = 1; },
  'missing drop key': value => { delete value.artifacts['wrapper-depth'].droppedEntryCounts.commandEntries; },
  'raw string privacy': value => { value.artifacts['wrapper-depth'].leak = 'opaque-private-string'; },
  'raw number privacy': value => { value.artifacts['wrapper-depth'].leak = 918273.645; },
  'URL privacy': value => { value.artifacts['wrapper-depth'].leak = 'secret.example.invalid/private-path'; },
  'URL substring privacy': value => { value.artifacts['wrapper-depth'].leak = 'private-query'; },
  'digest privacy': value => { value.artifacts['wrapper-depth'].leak = createHash('sha256').update('opaque-private-string').digest('hex'); },
  'combined digest privacy': value => { value.artifacts['wrapper-depth'].leak = createHash('sha256').update('opaque-private-string:privateValue').digest('hex'); },
  'FNV hex privacy': value => { value.artifacts['wrapper-depth'].leak = fnv1a('opaque-private-string').toString(16).padStart(8, '0'); },
  'FNV decimal privacy': value => { value.artifacts['wrapper-depth'].leak = fnv1a('opaque-private-string'); },
  'bare function privacy': value => { value.artifacts['wrapper-depth'].leak = 'privateFunction'; },
  'live key privacy': value => { value.artifacts['wrapper-depth'].ownerDocument = null; },
  'claim privacy': value => { value.artifacts['wrapper-depth'].claim = 'same pixels'; },
  'forged privacy pass': value => { value.artifacts['wrapper-depth'].leak = 'opaque-private-string'; value.privacyScan.pass = true; value.privacyScan.matches = []; },
  'privacy categories': value => { value.privacyScan.checkedCategories.pop(); },
  'no-explanation allocation': value => { value.allocationCounter.rows[0].noExplanationDelta = 1; },
  'non-selected allocation': value => { value.allocationCounter.rows[0].nonSelectedDelta = 1; },
  'selected allocation': value => { value.allocationCounter.rows[0].selectedDelta = 0; },
  'allocation total': value => { value.allocationCounter.totals.selected = 59; },
  'extra decoy command': value => { value.artifacts['wrapper-depth'].windows[2].commands.push(command(1, 4, 8)); },
};

for (const [name, mutate] of Object.entries(mutations)) test(`checker rejects ${name}`, () => {
  const evidence = valid();
  mutate(evidence);
  assert.equal(checkEvidence(evidence).pass, false);
});
