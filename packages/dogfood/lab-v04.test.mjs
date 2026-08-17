import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  buildMatrixArtifact,
  buildNearestNegativeArtifact,
  checkArtifactSet,
  checkCombinedRows,
  checkIdleEvidence,
  checkLegacyProjections,
  checkNonReactOwnership,
  checkReleaseEvidence,
  collectDiagnostics,
  closedArtifactPaths,
  compatibilityRow,
  evaluateCapture,
  managedArtifactPaths,
  orderedRuns,
  parseArgs,
  parseExactJson,
  parseHashManifest,
  projectPrimitiveProof,
  projectProductResult,
  releaseRunFromDirectory,
  selectProductLifecycleEvents,
  signatureUnknownReasons,
  stopOwnedServer,
  validPng,
} from './lab-v04.mjs';
import { applyMutation, checkMatrixCoverage, checkNearestNegatives, checkScenarioResult, checkVariantInvariance, scenarioOrder } from './lab-v04-truth.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const claims = {
  'heavy-canvas-work': ['The canvas spent the measured Canvas2D API self-time in the named draw episode.', 'The episode contains concentrated synchronous Canvas2D API work and is a review candidate.', 'The evidence does not establish GPU time, presentation or render time, or avoidable work.', 'Check the top measured methods and the application code that calls them.'],
  'repeated-draw-work': ['The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.', 'The repeated commands are a review candidate.', 'The evidence does not establish that the output stayed unchanged or that the work can be removed.', 'Check whether the application needs to send these repeated commands for the same scene and interaction.'],
  'resize-churn': ['canvas-scan observed the stated resets in windows with raster work.', 'Repeated resets overlapped active canvas work and are a review candidate.', 'The evidence does not show that resets made the application slow or that the application can remove them.', 'Check whether sizing or reset calls can run only when dimensions or state need to change.'],
  'backing-store-mismatch': ['The recorded backing area is larger than the DPR-adjusted expected area in the named active windows.', 'The recorded dimensions are a review candidate.', 'The evidence does not establish GPU cost, render cost, or the required image quality.', 'Check the canvas sizing policy and the required image quality.'],
};
const claim = type => digest(JSON.stringify(claims[type]));
const limits = { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 };
const drops = () => ({ canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 });
const diagnostics = () => ({ warnings: [], consoleErrors: [], pageErrors: [], requestFailures: [], instrumentationKills: [], unsupportedEvidence: [] });
const actions = ['Load', 'Zoom', 'Pan', 'Hover', 'Search', 'Filter', 'Resize'];
const expectedImageHash = manifest => manifest.scenario === 'integrated-continuous' ? 'e6d09891' : manifest.scenario === 'backing-store-mismatch' && manifest.variant === 'variant-c' ? '90241abe' : manifest.scenario === 'resize-churn' && manifest.mode === 'negative' ? '19e53d85' : manifest.variant === 'variant-b' ? '6beb92ce' : 'c46f0c01';
const eventType = manifest => manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';

test('idle and release checkers use only the exact ordered failure labels', () => {
  assert.deepEqual(checkIdleEvidence({}, {}), ['artifact identity', 'artifact schema', 'artifact truth', 'diagnostics', 'port']);
  assert.deepEqual(checkReleaseEvidence({}, {}), ['artifact schema', 'diagnostics', 'port']);
});
const rowId = manifest => `${manifest.scenario}:${manifest.variant}:${manifest.mode}`;
const windowValue = (canvasKey, windowIndex, values = {}) => ({ canvasKey, windowIndex, startedAtTimestampMs: windowIndex * 10, endedAtTimestampMs: windowIndex * 10 + 10, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, signatureStatus: 'unknown', unknownReason: 'first-window', sampled: false, comparisonGap: null, actualToExpectedAreaRatio: null, ...values });

function combinedRow(manifest) {
  const canvasKey = digest(`${rowId(manifest)}:canvas`);
  const replacementKey = digest(`${rowId(manifest)}:replacement`);
  const episodeKey = digest(`${rowId(manifest)}:episode`);
  const loafKey = digest(`${rowId(manifest)}:loaf`);
  const documentKey = digest(`${rowId(manifest)}:document`);
  const expected = type => manifest.expectations.some(item => item.kind === 'finding' && item.findingType === type && item.expected);
  const lifecycleExpected = manifest.expectations.some(item => item.kind === 'lifecycle' && item.expected);
  const replacementExpected = manifest.expectations.some(item => item.kind === 'replacement' && item.expected);
  const associationDeclared = manifest.expectations.some(item => item.kind === 'association');
  const associationExpected = manifest.expectations.some(item => item.kind === 'association' && item.expected);
  const windows = [windowValue(canvasKey, 0)];
  if (expected('heavy-canvas-work')) Object.assign(windows[0], { canvasApiSelfTimeMs: 8, rasterOperationCount: 2 });
  if (expected('repeated-draw-work')) windows.push(windowValue(canvasKey, 1, { signatureStatus: 'same', unknownReason: null, comparisonGap: 1, rasterOperationCount: 2 }));
  if ((expected('resize-churn') || expected('backing-store-mismatch')) && windows.length < 2) windows.push(windowValue(canvasKey, 1));
  if (lifecycleExpected) windows.push(windowValue(canvasKey, 120));
  if (expected('backing-store-mismatch')) for (const window of windows.slice(0, 2)) window.actualToExpectedAreaRatio = 2;
  if (replacementExpected) windows.push(windowValue(replacementKey, 2));
  if (manifest.mode === 'negative' && manifest.scenario === 'heavy-burst') Object.assign(windows[0], { canvasApiSelfTimeMs: 7, rasterOperationCount: 1 });
  if (manifest.mode === 'negative' && manifest.scenario === 'non-react-burst') Object.assign(windows[0], { canvasApiSelfTimeMs: 1, rasterOperationCount: 1 });
  if (manifest.mode === 'negative' && manifest.scenario === 'repeated-continuous') windows.push(windowValue(canvasKey, 1, { signatureStatus: 'same', unknownReason: null, comparisonGap: 1, rasterOperationCount: 1 }));
  if (manifest.mode === 'negative' && manifest.scenario === 'backing-store-mismatch') {
    windows[0].actualToExpectedAreaRatio = 2;
    windows.push(windowValue(canvasKey, 1, { actualToExpectedAreaRatio: 1.5 }));
  }
  if (associationDeclared) {
    windows.splice(0, windows.length, windowValue(canvasKey, 0, { startedAtTimestampMs: 10, endedAtTimestampMs: 20 }));
  }
  const resetEvents = [];
  if (expected('resize-churn')) resetEvents.push(
    { canvasKey, windowIndex: 0, source: 'width-setter', rasterOperationCount: windows[0].rasterOperationCount, activeRasterOverlap: true },
    { canvasKey, windowIndex: 1, source: 'height-setter', rasterOperationCount: windows[1].rasterOperationCount, activeRasterOverlap: true },
  );
  if (manifest.mode === 'negative' && manifest.scenario === 'resize-churn') resetEvents.push(
    { canvasKey, windowIndex: 0, source: 'width-setter', rasterOperationCount: 1, activeRasterOverlap: true },
    { canvasKey, windowIndex: 0, source: 'height-setter', rasterOperationCount: 1, activeRasterOverlap: true },
  );
  const episodeCanvases = [{ canvasKey, canvasApiSelfTimeMs: windows.filter(item => item.canvasKey === canvasKey).reduce((total, item) => total + item.canvasApiSelfTimeMs, 0), rasterOperationCount: windows.filter(item => item.canvasKey === canvasKey).reduce((total, item) => total + item.rasterOperationCount, 0), methodCount: 1 }];
  if (replacementExpected) episodeCanvases.push({ canvasKey: replacementKey, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, methodCount: 1 });
  episodeCanvases.sort((left, right) => left.canvasKey.localeCompare(right.canvasKey));
  const episodes = windows.at(-1).windowIndex - windows[0].windowIndex >= 3 ? windows.map((window, index) => ({ episodeKey: index ? digest(`${rowId(manifest)}:episode:${index}`) : episodeKey, firstWindowIndex: window.windowIndex, lastWindowIndex: window.windowIndex, startedAtTimestampMs: window.startedAtTimestampMs, endedAtTimestampMs: window.endedAtTimestampMs, canvases: [{ canvasKey: window.canvasKey, canvasApiSelfTimeMs: window.canvasApiSelfTimeMs, rasterOperationCount: window.rasterOperationCount, methodCount: 1 }] })) : [{ episodeKey, firstWindowIndex: 0, lastWindowIndex: windows.at(-1).windowIndex, startedAtTimestampMs: associationDeclared ? 10 : 0, endedAtTimestampMs: associationDeclared ? 20 : windows.at(-1).endedAtTimestampMs, canvases: episodeCanvases }];
  const lifecycleEvents = [];
  if (lifecycleExpected) lifecycleEvents.push(
    { type: 'retired', canvasKey, windowIndex: 119, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' },
    { type: 'reactivated', canvasKey, windowIndex: 120, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' },
  );
  if (replacementExpected) lifecycleEvents.push({ type: 'detached', canvasKey, windowIndex: 1, connected: false, activeRegistrySize: 1, evidenceLevel: 'measured' });
  if (manifest.mode === 'negative' && manifest.scenario === 'resize-churn') lifecycleEvents.push({ type: 'retired', canvasKey, windowIndex: 0, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' });
  lifecycleEvents.sort((left, right) => left.windowIndex - right.windowIndex || left.type.localeCompare(right.type) || left.canvasKey.localeCompare(right.canvasKey));
  const browserEntries = associationDeclared ? [
    { entryKey: documentKey, kind: 'document-event', eventType: eventType(manifest), startedAtTimestampMs: 0, endedAtTimestampMs: 1 },
    ...(associationExpected ? [{ entryKey: loafKey, kind: 'long-animation-frame', eventType: null, startedAtTimestampMs: 10, endedAtTimestampMs: 20 }] : []),
  ] : [];
  const episodeAssociations = associationExpected ? [{ entryKey: loafKey, entryKind: 'long-animation-frame', episodeKey, startedAtTimestampMs: 0, endedAtTimestampMs: 10, evidenceLevel: 'associated' }] : [];
  const metrics = type => {
    if (type === 'heavy-canvas-work') { const canvas = episodeCanvases.find(item => item.canvasKey === canvasKey); return { canvasApiSelfTimeMs: canvas.canvasApiSelfTimeMs, rasterOperationCount: canvas.rasterOperationCount, maximumWindowSelfTimeMs: 8, topMethodCount: 1 }; }
    if (type === 'repeated-draw-work') return { repeatedWindowCount: 1, rasterOperationCount: 2, repeatedWindowIndexes: [1], repeatedWindowRasterOperationCounts: [2] };
    if (type === 'resize-churn') return { activeResetCount: 2, resetEventWindowIndexes: [0, 1] };
    return { affectedWindowCount: 2, affectedWindowIndexes: [0, 1], areaRatios: [2, 2] };
  };
  const findings = Object.keys(claims).filter(expected).map(type => ({ type, evidenceLevel: 'candidate', claimSha256: claim(type), canvasKey, relatedEpisodeKeys: [episodeKey], metrics: metrics(type) })).sort((left, right) => `${left.type}:${left.canvasKey}:${left.relatedEpisodeKeys[0]}`.localeCompare(`${right.type}:${right.canvasKey}:${right.relatedEpisodeKeys[0]}`));
  return {
    scenario: manifest.scenario,
    variant: manifest.variant,
    mode: manifest.mode,
    productResult: { findings, lifecycleEvents, episodeAssociations },
    primitiveProof: {
      windows,
      episodes,
      resetEvents,
      browser: { longAnimationFrames: true, entries: browserEntries },
      fixture: { interactionStartedAtTimestampMs: 0, boundaryCount: lifecycleExpected ? 120 : manifest.mode === 'negative' && manifest.scenario === 'lifecycle-reactivation' ? 119 : null, acceptedRunCount: manifest.scenario === 'integrated-burst' ? 0 : 1, drawCount: 1, actions: manifest.scenario === 'integrated-burst' ? [...actions] : [], visibleChecksum: `${manifest.scenario}|${manifest.variant}|18,24,82,44,132,56`, visibleImageHash: expectedImageHash(manifest) },
      idle: { idleDrawCount: 0, preInteractionWindowCount: 0, preInteractionEpisodeCount: 0, drainWindowCount: 1, drainRasterOperationCount: 17 },
      collectionLimits: { ...limits },
      droppedEntryCounts: drops(),
      diagnostics: diagnostics(),
    },
  };
}

const rows = () => orderedRuns().map(combinedRow);
const findIndex = (scenario, variant, mode) => orderedRuns().findIndex(item => item.scenario === scenario && item.variant === variant && item.mode === mode);
const mutateRows = operation => {
  const value = rows();
  operation(value);
  return value;
};
const rejectedCombined = (operation, expected) => () => assert.deepEqual(checkCombinedRows(mutateRows(operation)), expected);

const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data, corrupt = false) => {
  const name = Buffer.from(type);
  const value = Buffer.alloc(data.length + 12);
  value.writeUInt32BE(data.length, 0); name.copy(value, 4); data.copy(value, 8);
  value.writeUInt32BE((crc32(Buffer.concat([name, data])) + (corrupt ? 1 : 0)) >>> 0, data.length + 8);
  return value;
};
const ihdr = () => {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(1440, 0); data.writeUInt32BE(1000, 4); Buffer.from([8, 2, 0, 0, 0]).copy(data, 8);
  return data;
};
const rawImage = filter => {
  const bytes = Buffer.alloc((1440 * 3 + 1) * 1000);
  if (filter !== undefined) bytes[0] = filter;
  return bytes;
};
const png = (chunks = [chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage())), chunk('IEND', Buffer.alloc(0))]) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);

const paths = closedArtifactPaths();
const evidenceFiles = paths.filter(file => !file.endsWith('sha256.txt'));
const hashLine = file => `${'a'.repeat(64)}  ${file}`;
const hashLines = () => evidenceFiles.map(hashLine);
const rejectedFiles = value => () => assert.throws(() => checkArtifactSet(value), error => error.message === 'combined artifact set is incomplete');
const rejectedHash = operation => () => {
  const lines = hashLines(); operation(lines);
  assert.throws(() => checkArtifactSet(paths, lines), error => error.message === 'artifact hash line count changed');
};
const rejectedPng = value => () => assert.equal(validPng(value), false);

const attacks = [
  ['remove-positive-product-finding', rejectedCombined(value => value[findIndex('heavy-burst', 'variant-a', 'bad')].productResult.findings = [], ['0:dual result', '0:product findings'])],
  ['insert-fixed-product-finding', rejectedCombined(value => { const target = value[findIndex('heavy-burst', 'variant-a', 'fixed')]; const source = value[findIndex('heavy-burst', 'variant-a', 'bad')].productResult.findings[0]; target.productResult.findings = [{ ...structuredClone(source), canvasKey: target.primitiveProof.windows[0].canvasKey, relatedEpisodeKeys: [target.primitiveProof.episodes[0].episodeKey] }]; }, ['1:dual result', '1:product findings', '1:key binding'])],
  ['insert-negative-product-finding', rejectedCombined(value => { const target = value[findIndex('heavy-burst', 'nearest-negative', 'negative')]; const source = value[findIndex('heavy-burst', 'variant-a', 'bad')].productResult.findings[0]; target.productResult.findings = [{ ...structuredClone(source), canvasKey: target.primitiveProof.windows[0].canvasKey, relatedEpisodeKeys: [target.primitiveProof.episodes[0].episodeKey] }]; }, ['6:dual result', '6:product findings', '6:key binding', '6:negative boundary'])],
  ['remove-product-loaf-association', rejectedCombined(value => value[findIndex('interaction-association', 'variant-a', 'bad')].productResult.episodeAssociations = [], ['35:dual result', '35:key binding'])],
  ['insert-product-loaf-without-overlap', rejectedCombined(value => { const target = value[findIndex('interaction-association', 'variant-a', 'bad')]; const entryKey = digest('non-overlapping-loaf'); target.primitiveProof.browser.entries.splice(1, 0, { entryKey, kind: 'long-animation-frame', eventType: null, startedAtTimestampMs: 2, endedAtTimestampMs: 3 }); target.productResult.episodeAssociations[0] = { ...target.productResult.episodeAssociations[0], entryKey, startedAtTimestampMs: 0, endedAtTimestampMs: 1 }; }, ['35:key binding'])],
  ['remove-product-retired-event', rejectedCombined(value => { const result = value[findIndex('lifecycle-reactivation', 'variant-a', 'bad')].productResult; result.lifecycleEvents = result.lifecycleEvents.filter(item => item.type !== 'retired'); }, ['28:dual result', '28:lifecycle binding'])],
  ['remove-product-reactivated-event', rejectedCombined(value => { const result = value[findIndex('lifecycle-reactivation', 'variant-a', 'bad')].productResult; result.lifecycleEvents = result.lifecycleEvents.filter(item => item.type !== 'reactivated'); }, ['28:dual result', '28:lifecycle binding'])],
  ['insert-fixed-product-lifecycle', rejectedCombined(value => { const target = value[findIndex('lifecycle-reactivation', 'variant-a', 'fixed')]; const key = target.primitiveProof.windows[0].canvasKey; target.productResult.lifecycleEvents = [{ type: 'retired', canvasKey: key, windowIndex: 0, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }, { type: 'reactivated', canvasKey: key, windowIndex: 1, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }]; }, ['29:dual result'])],
  ['remove-product-detached-event', rejectedCombined(value => { const result = value[findIndex('integrated-burst', 'integrated', 'bad')].productResult; result.lifecycleEvents = result.lifecycleEvents.filter(item => item.type !== 'detached'); }, ['51:dual result', '51:replacement binding'])],
  ['insert-fixed-product-detached-event', rejectedCombined(value => { const target = value[findIndex('integrated-burst', 'integrated', 'fixed')]; target.productResult.lifecycleEvents = [{ type: 'detached', canvasKey: target.primitiveProof.windows[0].canvasKey, windowIndex: 0, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }]; }, ['52:dual result'])],
  ['remove-primitive-heavy-episode', rejectedCombined(value => value[findIndex('heavy-burst', 'variant-a', 'bad')].primitiveProof.episodes = [], ['0:dual result', '0:key binding'])],
  ['remove-primitive-repeated-window', rejectedCombined(value => value[findIndex('repeated-continuous', 'variant-a', 'bad')].primitiveProof.windows = [], ['7:combined schema'])],
  ['remove-primitive-resize-reset', rejectedCombined(value => value[findIndex('resize-churn', 'variant-a', 'bad')].primitiveProof.resetEvents.pop(), ['14:dual result', '14:key binding'])],
  ['remove-primitive-backing-window', rejectedCombined(value => value[findIndex('backing-store-mismatch', 'variant-a', 'bad')].primitiveProof.windows.pop(), ['21:combined schema'])],
  ['remove-primitive-lifecycle-gap', rejectedCombined(value => value[findIndex('lifecycle-reactivation', 'variant-a', 'bad')].primitiveProof.fixture.boundaryCount = 119, ['28:dual result'])],
  ['remove-primitive-loaf-overlap', rejectedCombined(value => { const entry = value[findIndex('interaction-association', 'variant-a', 'bad')].primitiveProof.browser.entries.find(item => item.kind === 'long-animation-frame'); entry.startedAtTimestampMs = 21; entry.endedAtTimestampMs = 22; }, ['35:dual result', '35:key binding'])],
  ['change-supporting-canvas-key', rejectedCombined(value => value[findIndex('heavy-burst', 'variant-a', 'bad')].productResult.findings[0].canvasKey = digest('other-canvas'), ['0:key binding'])],
  ['change-related-episode-key', rejectedCombined(value => value[findIndex('heavy-burst', 'variant-a', 'bad')].productResult.findings[0].relatedEpisodeKeys = [digest('other-episode')], ['0:key binding'])],
  ['add-product-field', rejectedCombined(value => value[0].productResult.extra = true, ['0:combined schema'])],
  ['add-primitive-field', rejectedCombined(value => value[0].primitiveProof.extra = true, ['0:combined schema'])],
  ['add-legacy-field', () => { const combined = rows(); const primary = combined.map(compatibilityRow); primary[0].extra = true; assert.throws(() => checkLegacyProjections(combined, primary, buildMatrixArtifact('run', combined.map(compatibilityRow)).rows, buildNearestNegativeArtifact('run', combined.map(compatibilityRow)).rows), error => error.message === 'primary projection changed'); }],
  ['add-combined-row', rejectedCombined(value => value.push(structuredClone(value[0])), ['combined row count'])],
  ['remove-combined-row', rejectedCombined(value => value.pop(), ['combined row count'])],
  ['reorder-combined-rows', rejectedCombined(value => [value[0], value[1]] = [value[1], value[0]], ['0:combined schema', '1:combined schema'])],
  ['legacy-only-file-set', rejectedFiles(paths.slice(0, 7))],
  ['mutation-only-file-set', rejectedFiles(paths.filter(file => file.includes('mutation') || file.includes('sha256')))],
  ['missing-release-file', rejectedFiles(paths.filter(file => file !== 'release-evidence.json'))],
  ['missing-idle-file', rejectedFiles(paths.filter(file => file !== 'idle-boundary.json'))],
  ['extra-hash-line', rejectedHash(lines => lines.push(hashLine('/private/tmp/sidproj-extra.json')))],
  ['duplicate-hash-line', rejectedHash(lines => lines.push(lines[0]))],
  ['blank-hash-line', () => assert.throws(() => parseHashManifest(`${hashLines().join('\n')}\n\n`), error => error.message === 'invalid hash manifest')],
  ['leading-hash-line', () => assert.throws(() => parseHashManifest(` ${hashLines().join('\n')}\n`), error => error.message === 'invalid hash manifest')],
  ['trailing-hash-line', () => { const lines = hashLines(); lines[0] += ' '; assert.throws(() => parseHashManifest(`${lines.join('\n')}\n`), error => error.message === 'invalid hash manifest'); }],
  ['duplicate-json-key', () => assert.throws(() => parseExactJson('{"a":1,"a":2}'), error => error.message === 'duplicate JSON key: a')],
  ['escaped-duplicate-json-key', () => assert.throws(() => parseExactJson('{"a":1,"\\u0061":2}'), error => error.message === 'duplicate JSON key: a')],
  ['negative-backing-ratio', rejectedCombined(value => value[findIndex('backing-store-mismatch', 'variant-a', 'bad')].primitiveProof.windows[0].actualToExpectedAreaRatio = -1, ['21:combined schema'])],
  ['huge-backing-ratio', rejectedCombined(value => value[findIndex('backing-store-mismatch', 'variant-a', 'bad')].primitiveProof.windows[0].actualToExpectedAreaRatio = 1e300, ['21:combined schema'])],
  ['max-value-backing-ratio', rejectedCombined(value => value[findIndex('backing-store-mismatch', 'variant-a', 'bad')].primitiveProof.windows[0].actualToExpectedAreaRatio = Number.MAX_VALUE, ['21:combined schema'])],
  ['huge-reset-index', rejectedCombined(value => value[findIndex('resize-churn', 'variant-a', 'bad')].primitiveProof.resetEvents[0].windowIndex = Number.MAX_SAFE_INTEGER, ['14:combined schema'])],
  ['max-safe-lifecycle-index', rejectedCombined(value => value[findIndex('lifecycle-reactivation', 'variant-a', 'bad')].productResult.lifecycleEvents[0].windowIndex = Number.MAX_SAFE_INTEGER, ['28:combined schema'])],
  ['huge-event-time', rejectedCombined(value => value[findIndex('interaction-association', 'variant-a', 'bad')].primitiveProof.browser.entries[0].endedAtTimestampMs = 1e300, ['35:combined schema'])],
  ['huge-episode-time', rejectedCombined(value => value[findIndex('interaction-association', 'variant-a', 'bad')].primitiveProof.episodes[0].endedAtTimestampMs = 1e300, ['35:combined schema'])],
  ['huge-gap-value', rejectedCombined(value => value[findIndex('interaction-association', 'nearest-negative', 'negative')].primitiveProof.episodes[0].startedAtTimestampMs = 1e300, ['41:combined schema'])],
  ['max-safe-idle-drain-count', rejectedCombined(value => value[0].primitiveProof.idle.drainWindowCount = Number.MAX_SAFE_INTEGER, ['0:combined schema'])],
  ['negative-count', rejectedCombined(value => value[0].primitiveProof.windows[0].rasterOperationCount = -1, ['0:combined schema'])],
  ['self-time-exceeds-run-duration', rejectedCombined(value => value[0].primitiveProof.windows[0].canvasApiSelfTimeMs = 11, ['0:combined schema'])],
  ['maximum-window-exceeds-total', rejectedCombined(value => value[0].productResult.findings[0].metrics.maximumWindowSelfTimeMs = 9, ['0:combined schema'])],
  ['contradictory-repeated-total', rejectedCombined(value => value[findIndex('repeated-continuous', 'variant-a', 'bad')].productResult.findings[0].metrics.rasterOperationCount = 3, ['7:combined schema'])],
  ['png-ihdr-iend-only', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IEND', Buffer.alloc(0))]))],
  ['png-invalid-ihdr-crc', rejectedPng(png([chunk('IHDR', ihdr(), true), chunk('IDAT', deflateSync(rawImage())), chunk('IEND', Buffer.alloc(0))]))],
  ['png-invalid-idat-crc', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage()), true), chunk('IEND', Buffer.alloc(0))]))],
  ['png-invalid-iend-crc', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage())), chunk('IEND', Buffer.alloc(0), true)]))],
  ['png-empty-idat', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', Buffer.alloc(0)), chunk('IEND', Buffer.alloc(0))]))],
  ['png-invalid-deflate-stream', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', Buffer.from('invalid')), chunk('IEND', Buffer.alloc(0))]))],
  ['png-wrong-inflated-size', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(Buffer.alloc(1))), chunk('IEND', Buffer.alloc(0))]))],
  ['png-invalid-filter-byte', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage(5))), chunk('IEND', Buffer.alloc(0))]))],
  ['png-trailing-bytes', rejectedPng(Buffer.concat([png(), Buffer.from([0])]))],
  ['png-second-ihdr', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage())), chunk('IEND', Buffer.alloc(0))]))],
  ['png-nonconsecutive-idat', rejectedPng(png([chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage())), chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(rawImage())), chunk('IEND', Buffer.alloc(0))]))],
  ['coordinated-legacy-and-combined-product-lie', () => { const combined = rows(); const primary = combined.map(compatibilityRow); const index = findIndex('heavy-burst', 'variant-a', 'bad'); combined[index].productResult.findings = []; primary[index].productResult.findings = []; assert.throws(() => checkLegacyProjections(combined, primary, buildMatrixArtifact('run', primary).rows, buildNearestNegativeArtifact('run', primary).rows), error => error.message === 'combined evidence failed'); }],
];

test('the 53 combined rows pass both independent observations', () => {
  assert.equal(rows().length, 53);
  assert.deepEqual(checkCombinedRows(rows()), []);
});

test('the product projector does not read primitive source fields', () => {
  const source = { findings: [], lifecycleEvents: [], episodeAssociations: [] };
  Object.defineProperty(source, 'windows', { get: () => { throw new Error('primitive read'); } });
  assert.deepEqual(projectProductResult(source), { findings: [], lifecycleEvents: [], episodeAssociations: [] });
});

test('the primitive projector does not read product source fields', () => {
  const source = { windows: [{ canvasId: 'c', windowIndex: 0, startedAtTimestampMs: 0, endedAtTimestampMs: 1, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, signatureStatus: 'changed', unknownReason: null, sampled: false, comparisonGap: 1, geometry: {} }], episodes: [{ episodeId: 'e', firstWindowIndex: 0, lastWindowIndex: 0, startedAtTimestampMs: 0, endedAtTimestampMs: 1, canvases: [{ canvasId: 'c', canvasApiSelfTimeMs: 1, rasterOperationCount: 1, methodEvidence: { fillRect: 1 } }] }], resetEvents: [], browserEntries: [], browserFeatures: { longAnimationFrames: true }, collectionLimits: limits, droppedEntryCounts: drops() };
  Object.defineProperty(source, 'findings', { get: () => { throw new Error('product read'); } });
  const proof = projectPrimitiveProof(source, { interactionStartedAt: 0, boundaryCount: null, acceptedRunCount: 1, drawCount: 1, actions: [], visibleChecksum: 'x', visibleImageHash: 'deadbeef' }, { drawCount: 0, drainWindowCount: 1, drainRasterOperationCount: 17 }, diagnostics());
  assert.deepEqual(proof.windows.map(item => item.windowIndex), [0]);
});

test('primitive status keeps its measured support fields', () => {
  const source = { windows: [{ canvasId: 'c', windowIndex: 0, startedAtTimestampMs: 0, endedAtTimestampMs: 1, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, signatureStatus: 'unknown', unknownReason: 'first-window', sampled: false, comparisonGap: null, geometry: {} }], episodes: [{ episodeId: 'e', firstWindowIndex: 0, lastWindowIndex: 0, startedAtTimestampMs: 0, endedAtTimestampMs: 1, canvases: [{ canvasId: 'c', canvasApiSelfTimeMs: 1, rasterOperationCount: 1, methodEvidence: { fillRect: 1 } }] }], resetEvents: [], browserEntries: [], browserFeatures: { longAnimationFrames: true }, collectionLimits: limits, droppedEntryCounts: drops() };
  const proof = projectPrimitiveProof(source, { interactionStartedAt: 0, boundaryCount: null, acceptedRunCount: 1, drawCount: 1, actions: [], visibleChecksum: 'x', visibleImageHash: 'deadbeef' }, { drawCount: 0, drainWindowCount: 1, drainRasterOperationCount: 17 }, diagnostics());
  assert.deepEqual(proof.windows[0], { canvasKey: digest('c'), windowIndex: 0, startedAtTimestampMs: 0, endedAtTimestampMs: 1, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, signatureStatus: 'unknown', unknownReason: 'first-window', sampled: false, comparisonGap: null, actualToExpectedAreaRatio: null });
});

for (const status of ['same', 'changed']) test(`rejects unknown to ${status} without measured support`, () => {
  const values = rows(); const target = values[findIndex('heavy-burst', 'variant-a', 'bad')].primitiveProof.windows[0];
  Object.assign(target, { signatureStatus: status, unknownReason: 'first-window', sampled: false, comparisonGap: null });
  assert.deepEqual(checkCombinedRows(values), [`${findIndex('heavy-burst', 'variant-a', 'bad')}:unknown support`]);
});

for (const reason of signatureUnknownReasons) test(`accepts honest unknown support reason ${reason}`, () => {
  const values = rows();
  Object.assign(values[0].primitiveProof.windows[0], { signatureStatus: 'unknown', unknownReason: reason, comparisonGap: null });
  assert.deepEqual(checkCombinedRows(values), []);
});

for (const [name, mutate, expected] of [
  ['missing reason', window => { delete window.unknownReason; }, ['7:unknown support']],
  ['wrong canvas', (window, proof) => { proof.windows[0].canvasKey = digest('wrong-canvas'); }, ['7:unknown support']],
  ['wrong gap', window => { window.comparisonGap = 2; }, ['7:unknown support']],
  ['future support', (window, proof) => { proof.windows[0].windowIndex = 2; }, ['7:unknown support']],
  ['duplicate support', (window, proof) => { proof.windows.splice(1, 0, structuredClone(proof.windows[0])); }, ['7:combined schema']],
  ['copied known status', (window, proof) => { Object.assign(proof.windows[0], { signatureStatus: window.signatureStatus, unknownReason: window.unknownReason, comparisonGap: window.comparisonGap }); }, ['7:unknown support']],
]) test(`rejects ${name}`, () => {
  const values = rows(); const proof = values[7].primitiveProof; const window = proof.windows[1]; mutate(window, proof);
  assert.deepEqual(checkCombinedRows(values), expected);
});

test('separates product, fixture, and browser inputs during capture evaluation', () => {
  const manifest = liveManifest('heavy-burst'); const session = liveFindingSession(manifest);
  Object.defineProperty(session, 'acceptedRunCount', { get: () => { throw new Error('fixture read'); } });
  const fixture = { acceptedRunCount: 1 };
  Object.defineProperty(fixture, 'diagnostics', { get: () => { throw new Error('browser read'); } });
  assert.equal(evaluateCapture(manifest, session, fixture, { diagnostics: diagnostics() }).pass, true);
});

test('server cleanup rejects lost ownership before signaling', async () => {
  await assert.rejects(stopOwnedServer({ pid: 123, exitCode: null, signalCode: null }, () => false), error => error.message === 'Vite ownership changed before cleanup');
});

test('the product projector selects one current lifecycle chain from product summaries', () => {
  const events = [
    { canvasId: 'old', type: 'retired', windowIndex: 200, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' },
    { canvasId: 'old', type: 'reactivated', windowIndex: 201, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' },
    { canvasId: 'current', type: 'retired', windowIndex: 120, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' },
    { canvasId: 'current', type: 'reactivated', windowIndex: 121, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' },
  ];
  assert.deepEqual(selectProductLifecycleEvents([{ canvasId: 'current' }], events).map(item => `${item.canvasId}:${item.type}:${item.windowIndex}`), ['current:retired:120', 'current:reactivated:121']);
  assert.deepEqual(selectProductLifecycleEvents([{ canvasId: 'old' }], events).map(item => `${item.canvasId}:${item.type}:${item.windowIndex}`), ['old:retired:200', 'old:reactivated:201']);
});

test('product lifecycle projection ignores primitive-only decoys and omitted association kinds', () => {
  const source = { canvases: [{ canvasId: 'current' }], findings: [], lifecycleEvents: [{ canvasId: 'current', type: 'retired', windowIndex: 1, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }], episodeAssociations: [{ entryId: 'event', entryKind: 'event-timing', episodeId: 'episode', startedAtTimestampMs: 1, endedAtTimestampMs: 2 }, { entryId: 'mark', entryKind: 'user-mark', episodeId: 'episode', startedAtTimestampMs: 3, endedAtTimestampMs: 4 }] };
  Object.defineProperty(source, 'windows', { get: () => { throw new Error('primitive read'); } });
  assert.deepEqual(projectProductResult(source).episodeAssociations, []);
  assert.equal(projectProductResult(source).lifecycleEvents.length, 1);
});

test('product schemas reject extra fields', () => attacks.find(([name]) => name === 'add-product-field')[1]());
test('primitive schemas reject extra fields', () => attacks.find(([name]) => name === 'add-primitive-field')[1]());
test('heavy findings enforce the threshold and maximum relation', () => attacks.find(([name]) => name === 'maximum-window-exceeds-total')[1]());
test('repeated findings enforce the operation total', () => attacks.find(([name]) => name === 'contradictory-repeated-total')[1]());
test('resize findings bind to distinct reset windows', () => attacks.find(([name]) => name === 'remove-primitive-resize-reset')[1]());
test('backing findings bind exact ratios and windows', () => attacks.find(([name]) => name === 'remove-primitive-backing-window')[1]());
test('lifecycle results require retirement then reactivation', () => attacks.find(([name]) => name === 'remove-product-reactivated-event')[1]());
test('association results require a real LoAF overlap', () => attacks.find(([name]) => name === 'remove-primitive-loaf-overlap')[1]());
test('nearest-negative rows reject seeded product conclusions', () => attacks.find(([name]) => name === 'insert-negative-product-finding')[1]());
test('product associations bind to the exact overlapping entry and episode', () => attacks.find(([name]) => name === 'insert-product-loaf-without-overlap')[1]());
test('product association times start at zero and match the referenced overlap', () => rejectedCombined(value => { const association = value[findIndex('interaction-association', 'variant-a', 'bad')].productResult.episodeAssociations[0]; association.startedAtTimestampMs = 5; association.endedAtTimestampMs = 15; }, ['35:combined schema'])());
test('lifecycle events bind the same canvas across the 120-boundary gap', () => rejectedCombined(value => { const events = value[findIndex('lifecycle-reactivation', 'variant-a', 'bad')].productResult.lifecycleEvents; events[0].windowIndex = 9998; events[1].windowIndex = 9999; }, ['28:lifecycle binding'])());
test('replacement binds the detached event to the earlier working canvas', () => rejectedCombined(value => { const target = value[findIndex('integrated-burst', 'integrated', 'bad')]; target.productResult.lifecycleEvents[0].canvasKey = target.primitiveProof.windows.at(-1).canvasKey; }, ['51:replacement binding'])());
test('episode totals equal their member windows', () => rejectedCombined(value => value[0].primitiveProof.episodes[0].canvases[0].rasterOperationCount = 10000000, ['0:combined schema'])());
test('reset totals equal their referenced window', () => rejectedCombined(value => value[findIndex('resize-churn', 'variant-a', 'bad')].primitiveProof.resetEvents[0].rasterOperationCount = 10000000, ['14:combined schema'])());

test('legacy files are exact projections of combined rows', () => {
  const combined = rows(); const primary = combined.map(compatibilityRow);
  assert.equal(checkLegacyProjections(combined, primary, buildMatrixArtifact('run', primary).rows, buildNearestNegativeArtifact('run', primary).rows), true);
});

test('the closed artifact set has exactly ten files', () => {
  assert.equal(paths.length, 10);
  assert.equal(checkArtifactSet(paths, hashLines()), true);
});
test('the managed disk namespace exposes extra release files to the set checker', () => {
  const names = [...paths];
  const candidates = managedArtifactPaths([...names, 'sidproj-55-extra.json']);
  assert.equal(checkArtifactSet(candidates), true);
  assert.throws(() => checkArtifactSet([...candidates, 'extra.json']), error => error.message === 'combined artifact set is incomplete');
});

test('hash text accepts only exact normalized lines', () => assert.deepEqual(parseHashManifest(`${hashLines().join('\n')}\n`), hashLines()));
test('exact JSON rejects plain and escaped duplicate keys', () => { attacks[33][1](); attacks[34][1](); });
test('exact JSON rejects malformed Unicode escapes', () => { assert.throws(() => parseExactJson('{"a":"\\uZZZZ"}'), error => error.message === 'invalid JSON string'); assert.throws(() => parseExactJson('{"a":"\\uD800"}'), error => error.message === 'invalid JSON Unicode escape'); });
test('the strict PNG parser accepts a complete RGB image', () => assert.equal(validPng(png()), true));
test('the strict PNG parser rejects a missing image stream', () => attacks.find(([name]) => name === 'png-ihdr-iend-only')[1]());

test('product association support cannot come from a different LoAF and episode pair', () => {
  const combined = rows();
  assert.deepEqual(checkCombinedRows(combined), []);
  const row = combined[findIndex('interaction-association', 'variant-a', 'bad')];
  const proof = row.primitiveProof;
  const firstEpisode = proof.episodes[0];
  const firstWindow = proof.windows[0];
  const firstCanvas = firstEpisode.canvases[0];
  const secondCanvasKey = digest('split-pair-canvas');
  const secondEpisodeKey = digest('split-pair-episode');
  const secondEntryKey = digest('split-pair-loaf');
  Object.assign(firstWindow, { canvasApiSelfTimeMs: 0, rasterOperationCount: 0 });
  Object.assign(firstCanvas, { canvasApiSelfTimeMs: 0, rasterOperationCount: 0, methodCount: 0 });
  proof.windows.push(windowValue(secondCanvasKey, 1, { startedAtTimestampMs: 21, endedAtTimestampMs: 30, canvasApiSelfTimeMs: 1, rasterOperationCount: 1 }));
  proof.episodes.push({ episodeKey: secondEpisodeKey, firstWindowIndex: 1, lastWindowIndex: 1, startedAtTimestampMs: 21, endedAtTimestampMs: 30, canvases: [{ canvasKey: secondCanvasKey, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, methodCount: 1 }] });
  proof.browser.entries.push({ entryKey: secondEntryKey, kind: 'long-animation-frame', eventType: null, startedAtTimestampMs: 21, endedAtTimestampMs: 30 });
  assert.deepEqual(checkCombinedRows(combined), ['35:key binding']);
});

test('the strict PNG parser rejects unused compressed input inside IDAT', () => {
  const compressed = Buffer.concat([deflateSync(rawImage()), Buffer.from([0])]);
  const base = png();
  const changed = png([chunk('IHDR', ihdr()), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(validPng(base), true);
  assert.equal(validPng(changed), false);
});

test('the reconstructed live combined rows return no former failures', () => {
  const cases = [[20, 'resize-churn:nearest-negative:negative', 'key binding'], [28, 'lifecycle-reactivation:variant-a:bad', 'key binding'], [29, 'lifecycle-reactivation:variant-a:fixed', 'key binding'], [30, 'lifecycle-reactivation:variant-b:bad', 'key binding'], [31, 'lifecycle-reactivation:variant-b:fixed', 'key binding'], [32, 'lifecycle-reactivation:variant-c:bad', 'key binding'], [33, 'lifecycle-reactivation:variant-c:fixed', 'key binding'], [34, 'lifecycle-reactivation:nearest-negative:negative', 'key binding'], [34, 'lifecycle-reactivation:nearest-negative:negative', 'negative boundary'], [35, 'interaction-association:variant-a:bad', 'dual result'], [35, 'interaction-association:variant-a:bad', 'key binding'], [39, 'interaction-association:variant-c:bad', 'dual result'], [39, 'interaction-association:variant-c:bad', 'key binding']];
  const combined = rows();
  for (const coordinate of [20, 28, 29, 30, 31, 32, 33, 34]) {
    const manifest = orderedRuns()[coordinate]; const id = rowId(manifest);
    const primary = `${id}:canvas`;
    const historical = [{ canvasId: 'historical', type: 'retired', windowIndex: 120, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }, { canvasId: 'historical', type: 'reactivated', windowIndex: 121, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }];
    const events = manifest.scenario === 'resize-churn' ? [{ canvasId: primary, type: 'retired', windowIndex: 0, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }] : [28, 30, 32].includes(coordinate) ? [...historical, { canvasId: primary, type: 'retired', windowIndex: 119, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }, { canvasId: primary, type: 'reactivated', windowIndex: 120, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }] : historical;
    combined[coordinate].productResult = projectProductResult({ canvases: [{ canvasId: primary }], lifecycleEvents: events });
  }
  for (const coordinate of [35, 39]) {
    const manifest = orderedRuns()[coordinate]; const id = rowId(manifest);
    combined[coordinate].productResult = projectProductResult({ canvases: [{ canvasId: `${id}:canvas` }], episodeAssociations: [{ entryId: `${id}:loaf`, entryKind: 'long-animation-frame', episodeId: `${id}:episode`, startedAtTimestampMs: 10, endedAtTimestampMs: 20 }] });
  }
  assert.equal(cases.length, 13);
  assert.deepEqual(checkCombinedRows(combined), []);
});

test('product lifecycle selection keeps fallback retirement and excludes historical chains', () => {
  const events = [
    { canvasId: 'old', type: 'retired', windowIndex: 120, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' },
    { canvasId: 'old', type: 'reactivated', windowIndex: 121, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' },
    { canvasId: 'primary', type: 'retired', windowIndex: 119, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' },
  ];
  assert.deepEqual(selectProductLifecycleEvents([{ canvasId: 'primary' }], events).map(item => item.type), ['retired']);
  assert.deepEqual(selectProductLifecycleEvents([{ canvasId: 'missing' }], events), []);
  assert.equal(projectProductResult({ canvases: [{ canvasId: 'primary' }], lifecycleEvents: events }).lifecycleEvents.length, 1);
});

test('a direct combined association with an omitted kind fails the exact product schema', () => {
  const combined = rows();
  combined[findIndex('interaction-association', 'variant-a', 'bad')].productResult.episodeAssociations[0].entryKind = 'event-timing';
  assert.deepEqual(checkCombinedRows(combined), ['35:combined schema']);
});

test('a valid LoAF pair needs the declared document event and its own positive member window', () => {
  const wrongEvent = rows();
  wrongEvent[findIndex('interaction-association', 'variant-a', 'bad')].primitiveProof.browser.entries[0].eventType = 'wheel';
  assert.deepEqual(checkCombinedRows(wrongEvent), ['35:dual result']);
  const noMemberWork = rows();
  const proof = noMemberWork[findIndex('interaction-association', 'variant-a', 'bad')].primitiveProof;
  proof.windows[0].rasterOperationCount = 0; proof.episodes[0].canvases[0].rasterOperationCount = 0;
  assert.deepEqual(checkCombinedRows(noMemberWork), ['35:dual result', '35:key binding']);
});

test('a product LoAF association cannot move to a second working episode', () => {
  const combined = rows(); const row = combined[35]; const proof = row.primitiveProof;
  const canvasKey = digest('second-working-canvas'); const episodeKey = digest('second-working-episode');
  proof.windows.push(windowValue(canvasKey, 1, { startedAtTimestampMs: 10, endedAtTimestampMs: 20, canvasApiSelfTimeMs: 1, rasterOperationCount: 1 }));
  proof.episodes.push({ episodeKey, firstWindowIndex: 1, lastWindowIndex: 1, startedAtTimestampMs: 10, endedAtTimestampMs: 20, canvases: [{ canvasKey, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, methodCount: 1 }] });
  row.productResult.episodeAssociations[0].episodeKey = episodeKey;
  assert.deepEqual(checkCombinedRows(combined), ['35:key binding']);
});

function twoPairAssociationRows() {
  const combined = rows(); const row = combined[35]; const proof = row.primitiveProof;
  const canvasKey = digest('two-pair-canvas'); const episodeKey = digest('two-pair-episode'); const loaf = proof.browser.entries.find(item => item.kind === 'long-animation-frame');
  proof.windows.push(windowValue(canvasKey, 1, { startedAtTimestampMs: 10, endedAtTimestampMs: 20, canvasApiSelfTimeMs: 1, rasterOperationCount: 1 }));
  proof.episodes.push({ episodeKey, firstWindowIndex: 1, lastWindowIndex: 1, startedAtTimestampMs: 10, endedAtTimestampMs: 20, canvases: [{ canvasKey, canvasApiSelfTimeMs: 1, rasterOperationCount: 1, methodCount: 1 }] });
  const raw = [{ entryId: 'interaction-association:variant-a:bad:loaf', entryKind: 'long-animation-frame', episodeId: 'interaction-association:variant-a:bad:episode', startedAtTimestampMs: 10, endedAtTimestampMs: 20 }, { entryId: 'interaction-association:variant-a:bad:loaf', entryKind: 'long-animation-frame', episodeId: 'two-pair-episode', startedAtTimestampMs: 10, endedAtTimestampMs: 20 }];
  row.productResult = projectProductResult({ canvases: [{ canvasId: 'interaction-association:variant-a:bad:canvas' }], episodeAssociations: raw });
  assert.equal(loaf.entryKey, digest('interaction-association:variant-a:bad:loaf'));
  return { combined, row };
}

test('complete LoAF pair sets bind exact semantic pairs and times', () => {
  assert.deepEqual(checkCombinedRows(rows()), []);
  const { combined, row } = twoPairAssociationRows();
  assert.deepEqual(checkCombinedRows(combined), []);
  const onlyFirst = structuredClone(combined); onlyFirst[35].productResult.episodeAssociations.pop(); assert.deepEqual(checkCombinedRows(onlyFirst), ['35:key binding']);
  const onlySecond = structuredClone(combined); onlySecond[35].productResult.episodeAssociations.shift(); assert.deepEqual(checkCombinedRows(onlySecond), ['35:key binding']);
  const retarget = structuredClone(combined); retarget[35].productResult.episodeAssociations = [retarget[35].productResult.episodeAssociations[1]]; assert.deepEqual(checkCombinedRows(retarget), ['35:key binding']);
  const extra = structuredClone(combined); extra[35].productResult.episodeAssociations.push({ ...extra[35].productResult.episodeAssociations[0], entryKey: digest('extra-entry') }); assert.deepEqual(checkCombinedRows(extra), ['35:key binding']);
  const duplicate = structuredClone(combined); duplicate[35].productResult.episodeAssociations.push(structuredClone(duplicate[35].productResult.episodeAssociations[0])); assert.deepEqual(checkCombinedRows(duplicate), ['35:combined schema']);
  const orderPairs = value => value.sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs || left.endedAtTimestampMs - right.endedAtTimestampMs || left.entryKey.localeCompare(right.entryKey) || left.episodeKey.localeCompare(right.episodeKey));
  const wrongStart = structuredClone(combined); wrongStart[35].productResult.episodeAssociations[0].startedAtTimestampMs = 1; orderPairs(wrongStart[35].productResult.episodeAssociations); assert.deepEqual(checkCombinedRows(wrongStart), ['35:key binding']);
  const wrongEnd = structuredClone(combined); wrongEnd[35].productResult.episodeAssociations[0].endedAtTimestampMs = 9; orderPairs(wrongEnd[35].productResult.episodeAssociations); assert.deepEqual(checkCombinedRows(wrongEnd), ['35:key binding']);
  assert.ok(row);
});

test('complete LoAF pairs keep document event and member-work truth independent', () => {
  const noWork = rows(); const proof = noWork[35].primitiveProof; proof.windows[0].rasterOperationCount = 0; proof.episodes[0].canvases[0].rasterOperationCount = 0; assert.deepEqual(checkCombinedRows(noWork), ['35:dual result', '35:key binding']);
  const wrongEvent = rows(); wrongEvent[35].primitiveProof.browser.entries[0].eventType = 'wheel'; assert.deepEqual(checkCombinedRows(wrongEvent), ['35:dual result']);
  const noDocument = rows(); noDocument[35].primitiveProof.browser.entries = noDocument[35].primitiveProof.browser.entries.filter(item => item.kind !== 'document-event'); assert.deepEqual(checkCombinedRows(noDocument), ['35:dual result']);
  for (const kind of ['event-timing', 'user-mark']) { const direct = rows(); direct[35].productResult.episodeAssociations[0].entryKind = kind; assert.deepEqual(checkCombinedRows(direct), ['35:combined schema']); }
});

test('document association times use the earliest primitive intersection, not saved product time', () => {
  const product = rows(); const row = product[35]; const proof = row.primitiveProof;
  const episodeKey = proof.episodes[0].episodeKey; const loafKey = proof.browser.entries.find(item => item.kind === 'long-animation-frame').entryKey;
  const documentKey = digest('document-overlap');
  proof.browser.entries = [{ entryKey: documentKey, kind: 'document-event', eventType: 'keydown', startedAtTimestampMs: 12, endedAtTimestampMs: 18 }, ...proof.browser.entries.filter(item => item.kind !== 'document-event')].sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs || left.endedAtTimestampMs - right.endedAtTimestampMs || left.entryKey.localeCompare(right.entryKey));
  row.productResult = projectProductResult({ episodeAssociations: [{ entryId: 'interaction-association:variant-a:bad:loaf', entryKind: 'long-animation-frame', episodeId: 'interaction-association:variant-a:bad:episode', startedAtTimestampMs: 10, endedAtTimestampMs: 20 }, { entryId: 'document-overlap', entryKind: 'document-event', episodeId: 'interaction-association:variant-a:bad:episode', startedAtTimestampMs: 12, endedAtTimestampMs: 18 }] });
  assert.equal(row.productResult.episodeAssociations.find(item => item.entryKey === documentKey).startedAtTimestampMs, 0);
  assert.equal(row.productResult.episodeAssociations.find(item => item.entryKey === documentKey).endedAtTimestampMs, 6);
  assert.deepEqual(checkCombinedRows(product), []);
  const order = value => value.sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs || left.endedAtTimestampMs - right.endedAtTimestampMs || left.entryKey.localeCompare(right.entryKey) || left.episodeKey.localeCompare(right.episodeKey));
  const shiftedFive = structuredClone(product); Object.assign(shiftedFive[35].productResult.episodeAssociations.find(item => item.entryKey === documentKey), { startedAtTimestampMs: 5, endedAtTimestampMs: 6 }); order(shiftedFive[35].productResult.episodeAssociations); assert.deepEqual(checkCombinedRows(shiftedFive), ['35:key binding']);
  const shiftedSix = structuredClone(product); Object.assign(shiftedSix[35].productResult.episodeAssociations.find(item => item.entryKey === documentKey), { startedAtTimestampMs: 6, endedAtTimestampMs: 6 }); order(shiftedSix[35].productResult.episodeAssociations); assert.deepEqual(checkCombinedRows(shiftedSix), ['35:key binding']);
  assert.equal(loafKey, digest('interaction-association:variant-a:bad:loaf')); assert.equal(episodeKey, digest('interaction-association:variant-a:bad:episode'));
});

test('selected lifecycle rows bind only their current primary canvas', () => {
  const fixed = rows(); const fixedManifest = orderedRuns()[29]; const fixedId = rowId(fixedManifest);
  fixed[29].productResult = projectProductResult({ canvases: [{ canvasId: `${fixedId}:canvas` }], lifecycleEvents: [{ canvasId: 'historical', type: 'retired', windowIndex: 120, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }, { canvasId: 'historical', type: 'reactivated', windowIndex: 121, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }] });
  assert.deepEqual(checkCombinedRows(fixed), []);
  const negative = rows(); const negativeManifest = orderedRuns()[34]; const negativeId = rowId(negativeManifest);
  negative[34].productResult = projectProductResult({ canvases: [{ canvasId: `${negativeId}:canvas` }], lifecycleEvents: [{ canvasId: 'historical', type: 'retired', windowIndex: 120, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }, { canvasId: 'historical', type: 'reactivated', windowIndex: 121, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }] });
  assert.deepEqual(checkCombinedRows(negative), []);
  const noWork = rows(); const lifecycle = noWork[28]; const primary = `${rowId(orderedRuns()[28])}:canvas`;
  lifecycle.productResult = projectProductResult({ canvases: [{ canvasId: primary }], lifecycleEvents: [{ canvasId: primary, type: 'retired', windowIndex: 119, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }, { canvasId: primary, type: 'reactivated', windowIndex: 120, connected: true, activeRegistrySize: 1, evidenceLevel: 'measured' }] });
  lifecycle.primitiveProof.windows.forEach(item => { item.rasterOperationCount = 0; item.canvasApiSelfTimeMs = 0; }); lifecycle.primitiveProof.episodes.forEach(item => item.canvases.forEach(canvas => { canvas.rasterOperationCount = 0; canvas.canvasApiSelfTimeMs = 0; }));
  assert.deepEqual(checkCombinedRows(noWork), ['28:dual result', '28:lifecycle binding']);
  const resize = rows(); const resizeManifest = orderedRuns()[20]; const resizeId = rowId(resizeManifest);
  resize[20].productResult = projectProductResult({ canvases: [{ canvasId: `${resizeId}:canvas` }], lifecycleEvents: [{ canvasId: `${resizeId}:canvas`, type: 'retired', windowIndex: 0, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' }] });
  assert.deepEqual(checkCombinedRows(resize), []);
});

test('both projectors exclude event-timing and user-mark entries', () => {
  const product = projectProductResult({ episodeAssociations: [{ entryId: 'timing', entryKind: 'event-timing', episodeId: 'e', startedAtTimestampMs: 0, endedAtTimestampMs: 1 }, { entryId: 'mark', entryKind: 'user-mark', episodeId: 'e', startedAtTimestampMs: 0, endedAtTimestampMs: 1 }] });
  const primitive = projectPrimitiveProof({ browserEntries: [{ entryId: 'timing', kind: 'event-timing', startedAtTimestampMs: 0, endedAtTimestampMs: 1 }, { entryId: 'mark', kind: 'user-mark', startedAtTimestampMs: 0, endedAtTimestampMs: 1 }], browserFeatures: { longAnimationFrames: true }, collectionLimits: limits, droppedEntryCounts: drops() }, { interactionStartedAt: 0, boundaryCount: null, acceptedRunCount: 1, drawCount: 1, actions: [], visibleChecksum: 'x', visibleImageHash: 'deadbeef' }, { drawCount: 0, drainWindowCount: 1, drainRasterOperationCount: 17 }, diagnostics());
  assert.deepEqual(product.episodeAssociations, []); assert.deepEqual(primitive.browser.entries, []);
});

test('the mutation corpus has 60 stable executable attacks', () => {
  assert.equal(attacks.length, 60);
  assert.equal(new Set(attacks.map(([name]) => name)).size, 60);
  assert.ok(attacks.every(([, run]) => typeof run === 'function'));
});

test('all 60 attacks fail the intended closed checker', () => {
  for (const [, run] of attacks) run();
});

const liveManifest = (scenario, mode = 'bad') => orderedRuns().find(item => item.scenario === scenario && item.mode === mode && item.variant === (mode === 'negative' ? 'nearest-negative' : 'variant-a'));
const liveSummary = (canvasId = 'canvas-1', values = {}) => ({ canvasId, nearestReactOwner: 'V04Lab', attributionKind: 'jsx-owner', canvasApiSelfTimeMs: 9, maxWindowSelfTimeMs: 9, rasterOperationCount: 10, ...values });
const liveFinding = (type, canvasId = 'canvas-1', values = {}) => {
  const common = { type, canvasId, evidenceLevel: 'candidate', canvasApiSelfTimeMs: 9, rasterOperationCount: 10, claimBoundary: { observation: claims[type][0], explanation: claims[type][1], nonEstablishedFacts: claims[type][2] }, nextCheck: claims[type][3] };
  if (type === 'heavy-canvas-work') return { ...common, episodeId: 'episode-1', topMethods: [{ method: 'fillRect', count: 10, canvasApiSelfTimeMs: 9 }], maximumWindow: { canvasApiSelfTimeMs: 9, rasterOperationCount: 10, methodEvidence: { fillRect: { count: 10, canvasApiSelfTimeMs: 9 } } }, ...values };
  if (type === 'repeated-draw-work') return { ...common, episodeId: 'episode-1', repeatedWindowCount: 1, repeatedWindows: [{ rasterOperationCount: 2 }], rasterOperationCount: 2, ...values };
  if (type === 'resize-churn') return { ...common, observedResetCount: 2, activeResetCount: 2, resetEvents: [{ windowIndex: 1 }, { windowIndex: 2 }], affectedEpisodeIds: ['episode-1'], ...values };
  return { ...common, affectedWindowCount: 2, affectedWindows: [{ actualToExpectedAreaRatio: 2 }, { actualToExpectedAreaRatio: 2 }], affectedEpisodeIds: ['episode-1'], ...values };
};
const liveSession = ({ canvases = [liveSummary()], findings = [], windows = [], resetEvents = [], lifecycleEvents = [], browserEntries = [], episodeAssociations = [], episodes = [], browserFeatures = { longAnimationFrames: true }, droppedEntryCounts = drops() } = {}) => ({ canvases, findings, windows, resetEvents, lifecycleEvents, browserEntries, episodeAssociations, episodes, browserFeatures, droppedEntryCounts });
const liveFindingSession = manifest => liveSession({ canvases: [liveSummary('support')], findings: [liveFinding(manifest.expectations[0].findingType, 'support')], episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: 'support', canvasApiSelfTimeMs: 9 }] }] });

test('existing runner argument contract remains active', () => {
  assert.deepEqual(parseArgs([]), { mode: 'idle-release' });
  assert.deepEqual(parseArgs(['--idle-release']), { mode: 'idle-release' });
  assert.deepEqual(parseArgs(['--', '--idle-release']), { mode: 'idle-release' });
  assert.deepEqual(parseArgs(['--check-evidence', '/private/tmp/sidproj-102-idle-release-12345678-1234-4123-8123-123456789abc']), { mode: 'check', directory: '/private/tmp/sidproj-102-idle-release-12345678-1234-4123-8123-123456789abc' });
  assert.deepEqual(parseArgs(['--', '--check-evidence', '/private/tmp/sidproj-102-idle-release-12345678-1234-4123-8123-123456789abc']), { mode: 'check', directory: '/private/tmp/sidproj-102-idle-release-12345678-1234-4123-8123-123456789abc' });
  for (const args of [['--'], ['--bad'], ['--check-evidence'], ['--check-evidence', 'one', 'two'], ['--idle-release', 'extra']]) assert.throws(() => parseArgs(args), error => error.message === 'unsupported lab arguments');
});

test('release check accepts only one exact private idle-release directory', async () => {
  for (const directory of ['relative', '/tmp/sidproj-102-idle-release-12345678-1234-4123-8123-123456789abc', '/private/tmp/sidproj-999-idle-release-12345678-1234-4123-8123-123456789abc', '/private/tmp/sidproj-102-targeted-12345678-1234-4123-8123-123456789abc', '/private/tmp/sidproj-102-idle-release-bad', '/private/tmp/sidproj-102-idle-release-12345678-1234-1123-8123-123456789abc']) await assert.rejects(releaseRunFromDirectory(directory), error => error.message === 'run directory');
  const runId = randomUUID(); const directory = `/private/tmp/sidproj-102-idle-release-${runId}`;
  try {
    await mkdir(directory, { mode: 0o700 });
    const stat = await lstat(directory);
    assert.deepEqual(await releaseRunFromDirectory(directory), { kind: 'idle-release', runId, directory, directoryIdentity: { device: String(stat.dev), inode: String(stat.ino) } });
  } finally { await rm(directory, { recursive: true }); }
});

test('release check rejects regular, symlink, and wrong-mode paths', async () => {
  const cases = [];
  try {
    const regular = `/private/tmp/sidproj-102-idle-release-${randomUUID()}`; await writeFile(regular, 'x', { mode: 0o600 }); cases.push(regular);
    const target = `/private/tmp/sidproj-102-idle-release-${randomUUID()}`; await mkdir(target, { mode: 0o700 }); cases.push(target);
    const symbolic = `/private/tmp/sidproj-102-idle-release-${randomUUID()}`; await symlink(target, symbolic); cases.push(symbolic);
    const wrongMode = `/private/tmp/sidproj-102-idle-release-${randomUUID()}`; await mkdir(wrongMode, { mode: 0o700 }); await chmod(wrongMode, 0o755); cases.push(wrongMode);
    for (const directory of [regular, symbolic, wrongMode]) await assert.rejects(releaseRunFromDirectory(directory), error => error.message === 'run directory');
  } finally { for (const target of cases.reverse()) await rm(target, { recursive: true }); }
});

test('existing truth keeps the exact 53-row order and factor coverage', () => {
  const manifests = orderedRuns();
  assert.equal(manifests.length, 53);
  assert.deepEqual([...new Set(manifests.map(item => item.scenario))], scenarioOrder);
  assert.deepEqual(checkMatrixCoverage(manifests), { pass: true, missing: [] });
  assert.deepEqual(checkVariantInvariance(manifests), { pass: true, failures: [] });
  assert.deepEqual(checkNearestNegatives(manifests), { pass: true, failures: [] });
});

test('existing product truth requires measured finding fields and relationships', () => {
  const manifest = liveManifest('heavy-burst'); const valid = liveFindingSession(manifest);
  assert.deepEqual(checkScenarioResult(manifest, { session: valid }).failures, []);
  assert.deepEqual(checkScenarioResult(manifest, { session: { ...valid, canvases: [liveSummary('unrelated'), ...valid.canvases] } }).failures, ['heavy-burst:heavy-canvas-work: missing finding']);
  assert.deepEqual(checkScenarioResult(manifest, { session: { ...valid, findings: [{ ...valid.findings[0], claimBoundary: null }] } }).failures, ['heavy-burst:heavy-canvas-work: missing finding']);
  assert.deepEqual(checkScenarioResult(liveManifest('heavy-burst', 'fixed'), { session: valid }).failures, ['heavy-burst:heavy-canvas-work: seeded finding remains', 'unexpected finding:heavy-canvas-work']);
});

test('existing lifecycle truth requires the same identity after 120 boundaries', () => {
  const manifest = liveManifest('lifecycle-reactivation');
  const events = [{ canvasId: 'canvas-1', type: 'retired', windowIndex: 121, evidenceLevel: 'measured' }, { canvasId: 'canvas-1', type: 'reactivated', windowIndex: 122, evidenceLevel: 'measured' }];
  assert.deepEqual(checkScenarioResult(manifest, { session: liveSession({ lifecycleEvents: events }) }).failures, []);
  assert.deepEqual(checkScenarioResult(manifest, { session: liveSession({ lifecycleEvents: [events[0], { ...events[1], canvasId: 'other' }] }) }).failures, ['lifecycle-reactivation:retire-reactivate: missing lifecycle']);
});

test('existing association truth requires a document event and LoAF association', () => {
  const manifest = liveManifest('interaction-association'); const declaredEvent = eventType(manifest);
  const valid = liveSession({ canvases: [liveSummary('support')], browserEntries: [{ entryId: 'document-1', kind: 'document-event', eventType: declaredEvent, startedAtTimestampMs: 1, endedAtTimestampMs: 1 }, { entryId: 'loaf-1', kind: 'long-animation-frame', startedAtTimestampMs: 2, endedAtTimestampMs: 20 }], episodes: [{ episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 20, canvases: [{ canvasId: 'support', canvasApiSelfTimeMs: 1 }] }], episodeAssociations: [{ entryId: 'loaf-1', entryKind: 'long-animation-frame', episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 20, evidenceLevel: 'associated' }] });
  assert.deepEqual(checkScenarioResult(manifest, { session: valid }).failures, []);
  assert.deepEqual(checkScenarioResult(manifest, { session: { ...valid, episodeAssociations: [] } }).failures, ['interaction-association:long-frame-overlap: missing association']);
  assert.deepEqual(checkScenarioResult(manifest, { session: { ...valid, browserEntries: valid.browserEntries.filter(item => item.kind !== 'document-event') } }).failures, [`missing document event:${declaredEvent}`]);
});

test('existing non-React truth still checks live ownership before projection', () => {
  const manifest = liveManifest('non-react-burst'); const value = liveFindingSession(manifest);
  value.canvases[0] = liveSummary('support', { nearestReactOwner: null, attributionKind: 'unattributed' });
  assert.deepEqual(checkScenarioResult(manifest, { session: value }).failures, []);
  value.canvases[0].nearestReactOwner = 'Owner';
  assert.deepEqual(checkScenarioResult(manifest, { session: value }).failures, ['missing unattributed non-React supporting canvas']);
});

test('live non-React ownership binds the checked finding to its primitive canvas key', () => {
  const manifest = liveManifest('non-react-burst'); const combined = combinedRow(manifest); const rawCanvasId = rowId(manifest) + ':canvas';
  assert.equal(checkNonReactOwnership(combined.productResult, combined.primitiveProof, { canvasId: rawCanvasId, nearestReactOwner: null, attributionKind: 'unattributed' }), true);
  assert.equal(checkNonReactOwnership(combined.productResult, combined.primitiveProof, { canvasId: rawCanvasId, nearestReactOwner: 'Owner', attributionKind: 'jsx-owner' }), false);
});

test('existing idle, diagnostic, drop, and fixture gates remain active', () => {
  const manifest = liveManifest('heavy-burst'); const session = liveFindingSession(manifest);
  assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1 }).failures, []);
  assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 0 }).failures, ['fixture accepted run count must equal 1 (received 0)']);
  assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1, idleDrawCount: 1 }).failures, ['idle capture contains draw activity']);
  assert.deepEqual(evaluateCapture(manifest, { ...session, droppedEntryCounts: { ...drops(), resetEvents: 1 } }, { acceptedRunCount: 1 }).failures, ['dropped evidence:resetEvents:1']);
  assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1 }, { diagnostics: { consoleErrors: ['bad'] } }).failures, ['consoleErrors']);
  assert.deepEqual(collectDiagnostics(), diagnostics());
});

test('existing heavy mutation remains narrow', () => {
  const mutated = applyMutation(orderedRuns(), 'heavy-burst-seed-off').find(item => item.mutation);
  const result = evaluateCapture(mutated, liveSession(), { acceptedRunCount: 1 });
  assert.deepEqual(result.failures, ['heavy-burst:heavy-canvas-work: missing finding']);
});

const baselineRow = (scenario, mode = 'bad') => liveManifest(scenario, mode);
const baselineNegative = scenario => {
  if (scenario === 'heavy-burst') return { session: liveSession({ canvases: [liveSummary('canvas-1', { canvasApiSelfTimeMs: 7 })] }) };
  if (scenario === 'non-react-burst') return { session: liveSession({ canvases: [liveSummary('canvas-1', { canvasApiSelfTimeMs: 7, nearestReactOwner: null, attributionKind: 'unattributed' })] }) };
  if (scenario === 'repeated-continuous') return { session: liveSession({ windows: [{ signatureStatus: 'same', rasterOperationCount: 1 }] }) };
  if (scenario === 'resize-churn') return { session: liveSession({ canvases: [liveSummary('setup')], windows: [{ canvasId: 'setup', rasterOperationCount: 1 }], resetEvents: [{ canvasId: 'setup', windowIndex: 1, activeRasterOverlap: true }, { canvasId: 'setup', windowIndex: 1, activeRasterOverlap: true }], lifecycleEvents: [{ canvasId: 'setup', type: 'retired' }] }) };
  if (scenario === 'backing-store-mismatch') return { session: liveSession({ windows: [{ rasterOperationCount: 1, geometry: { actualToExpectedAreaRatio: 2 } }, { rasterOperationCount: 1, geometry: { actualToExpectedAreaRatio: 1.999 } }] }) };
  if (scenario === 'lifecycle-reactivation') return { session: liveSession(), fixtureBoundaryCount: 119 };
  return { session: associationLiveSession(baselineRow('interaction-association', 'negative'), false, false) };
};
function associationLiveSession(manifest, associations = true, supported = true) {
  const entries = [{ entryId: 'document-1', kind: 'document-event', eventType: eventType(manifest), startedAtTimestampMs: 1, endedAtTimestampMs: 1 }];
  if (supported) entries.push({ entryId: 'loaf-1', kind: 'long-animation-frame', startedAtTimestampMs: 2, endedAtTimestampMs: 20 });
  return liveSession({ canvases: [liveSummary('support')], browserFeatures: { longAnimationFrames: supported }, browserEntries: entries, episodes: [{ episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 20, canvases: [{ canvasId: 'support', canvasApiSelfTimeMs: 1 }] }], episodeAssociations: associations && supported ? [{ entryId: 'loaf-1', entryKind: 'long-animation-frame', episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 20, evidenceLevel: 'associated' }] : [] });
}

test('ordered matrix has the exact 53-row scenario, variant, and mode order', () => {
  const manifests = orderedRuns();
  assert.equal(manifests.length, 53);
  assert.deepEqual([...new Set(manifests.map(item => item.scenario))], scenarioOrder);
  for (const scenario of scenarioOrder.slice(0, 7)) assert.deepEqual(manifests.filter(item => item.scenario === scenario).map(item => `${item.variant}:${item.mode}`), ['variant-a:bad', 'variant-a:fixed', 'variant-b:bad', 'variant-b:fixed', 'variant-c:bad', 'variant-c:fixed', 'nearest-negative:negative']);
  assert.deepEqual(manifests.slice(-4).map(item => `${item.scenario}:${item.mode}`), ['integrated-continuous:bad', 'integrated-continuous:fixed', 'integrated-burst:bad', 'integrated-burst:fixed']);
});

test('preserving variants cover every factor axis and keep the declared invariant', () => {
  const manifests = orderedRuns();
  assert.deepEqual(checkMatrixCoverage(manifests), { pass: true, missing: [] }); assert.deepEqual(checkVariantInvariance(manifests), { pass: true, failures: [] }); assert.deepEqual(checkNearestNegatives(manifests), { pass: true, failures: [] });
  assert.ok(manifests.filter(item => item.variant.startsWith('variant-')).every(item => item.changedFactors.length >= 2));
  const changed = structuredClone(manifests); changed.find(item => item.variant === 'variant-b').invariant.supportedClaim = 'changed';
  assert.deepEqual(checkVariantInvariance(changed).failures, ['heavy-burst:variant-b:bad']);
});

test('finding checks require measured fields, product relationships, and rank', () => {
  const manifest = baselineRow('heavy-burst'); const valid = liveFindingSession(manifest);
  assert.deepEqual(checkScenarioResult(manifest, { session: valid }).failures, []);
  for (const session of [
    { ...valid, canvases: [liveSummary('unrelated'), ...valid.canvases] },
    { ...valid, findings: [{ ...valid.findings[0], canvasId: 'missing' }] },
    { ...valid, findings: [{ ...valid.findings[0], claimBoundary: null }] },
    { ...valid, findings: [{ ...valid.findings[0], claimBoundary: { observation: 'changed', explanation: 'changed', nonEstablishedFacts: 'changed' } }] },
    { ...valid, findings: [{ ...valid.findings[0], maximumWindow: null }] },
  ]) assert.deepEqual(checkScenarioResult(manifest, { session }).failures, ['heavy-burst:heavy-canvas-work: missing finding']);
});

test('numeric truth boundaries accept the threshold and reject the nearest value below it', () => {
  const cases = [['heavy-burst', liveFinding('heavy-canvas-work', 'canvas-1', { canvasApiSelfTimeMs: 8 }), liveFinding('heavy-canvas-work', 'canvas-1', { canvasApiSelfTimeMs: 7.999 })], ['repeated-continuous', liveFinding('repeated-draw-work'), liveFinding('repeated-draw-work', 'canvas-1', { rasterOperationCount: 1, repeatedWindows: [{ rasterOperationCount: 1 }] })], ['resize-churn', liveFinding('resize-churn'), liveFinding('resize-churn', 'canvas-1', { resetEvents: [{ windowIndex: 1 }, { windowIndex: 1 }] })], ['backing-store-mismatch', liveFinding('backing-store-mismatch'), liveFinding('backing-store-mismatch', 'canvas-1', { affectedWindows: [{ actualToExpectedAreaRatio: 2 }, { actualToExpectedAreaRatio: 1.999 }] })]];
  for (const [scenario, at, below] of cases) {
    assert.deepEqual(checkScenarioResult(baselineRow(scenario), { session: liveSession({ findings: [at], episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: at.canvasId, canvasApiSelfTimeMs: 9 }] }] }) }).failures, []);
    assert.deepEqual(checkScenarioResult(baselineRow(scenario), { session: liveSession({ findings: [below], episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: below.canvasId, canvasApiSelfTimeMs: 9 }] }] }) }).failures, [`${scenario}:${at.type}: missing finding`]);
    assert.deepEqual(checkScenarioResult(baselineRow(scenario, 'negative'), baselineNegative(scenario)).failures, []);
  }
});

test('resize nearest negative keeps paired setup evidence and retirement', () => { const capture = baselineNegative('resize-churn'); assert.deepEqual(checkScenarioResult(baselineRow('resize-churn', 'negative'), capture).failures, []); assert.deepEqual(checkScenarioResult(baselineRow('resize-churn', 'negative'), { session: { ...capture.session, resetEvents: [] } }).failures, ['nearest-negative setup evidence is invalid']); assert.deepEqual(checkScenarioResult(baselineRow('resize-churn', 'negative'), { session: { ...capture.session, lifecycleEvents: [] } }).failures, ['nearest-negative setup evidence is invalid']); });
test('fixed and negative rows reject seeded and unexpected findings', () => { const seeded = liveFindingSession(baselineRow('heavy-burst')); assert.deepEqual(checkScenarioResult(baselineRow('heavy-burst', 'fixed'), { session: seeded }).failures, ['heavy-burst:heavy-canvas-work: seeded finding remains', 'unexpected finding:heavy-canvas-work']); assert.deepEqual(checkScenarioResult(baselineRow('heavy-burst', 'negative'), { session: seeded }).failures, ['heavy-burst:heavy-canvas-work: seeded finding remains', 'unexpected finding:heavy-canvas-work', 'nearest-negative heavy self-time observed=9 ms; required=[7, 8) ms']); assert.deepEqual(checkScenarioResult(baselineRow('heavy-burst', 'fixed'), { session: liveSession({ findings: [liveFinding('resize-churn')] }) }).failures, ['unexpected finding:resize-churn']); assert.deepEqual(checkScenarioResult(baselineRow('heavy-burst', 'fixed'), { session: liveSession() }).failures, []); assert.deepEqual(checkScenarioResult(baselineRow('heavy-burst', 'negative'), { session: liveSession({ canvases: [liveSummary('canvas-1', { canvasApiSelfTimeMs: 6.999 })] }) }).failures, ['nearest-negative heavy self-time observed=6.999 ms; required=[7, 8) ms']); });
test('lifecycle uses 120-boundary retirement and same-identity reactivation evidence', () => {
  const events = [{ canvasId: 'canvas-1', type: 'retired', windowIndex: 121, evidenceLevel: 'measured' }, { canvasId: 'canvas-1', type: 'reactivated', windowIndex: 122, evidenceLevel: 'measured' }];
  assert.deepEqual(checkScenarioResult(baselineRow('lifecycle-reactivation'), { session: liveSession({ lifecycleEvents: events }) }).failures, []);
  assert.deepEqual(checkScenarioResult(baselineRow('lifecycle-reactivation'), { session: liveSession({ lifecycleEvents: [events[0], { ...events[1], canvasId: 'other' }] }) }).failures, ['lifecycle-reactivation:retire-reactivate: missing lifecycle']);
  assert.deepEqual(checkScenarioResult(baselineRow('lifecycle-reactivation', 'negative'), baselineNegative('lifecycle-reactivation')).failures, []);
  assert.deepEqual(checkScenarioResult(baselineRow('lifecycle-reactivation', 'negative'), { session: liveSession({ lifecycleEvents: [events[0]] }) }).failures, ['nearest-negative canvas retired', 'nearest-negative lifecycle boundary count is not 119']);
});
test('association checks require document capture, overlap relationships, and approved skips only', () => {
  const manifest = baselineRow('interaction-association');
  assert.deepEqual(checkScenarioResult(manifest, { session: associationLiveSession(manifest) }).failures, []);
  assert.deepEqual(checkScenarioResult(manifest, { session: associationLiveSession(manifest, false) }).failures, ['interaction-association:long-frame-overlap: missing association']);
  assert.deepEqual(checkScenarioResult(manifest, { session: associationLiveSession(manifest, false, false) }).failures, []);
  const noDocument = associationLiveSession(manifest); noDocument.browserEntries = noDocument.browserEntries.filter(item => item.kind !== 'document-event');
  assert.deepEqual(checkScenarioResult(manifest, { session: noDocument }).failures, ['missing document event:keydown']);
  const near = associationLiveSession(baselineRow('interaction-association', 'negative'), false, false);
  assert.deepEqual(checkScenarioResult(baselineRow('interaction-association', 'negative'), { session: near }).failures, []);
  near.episodeAssociations.push({ entryId: 'document-1', entryKind: 'document-event', episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 2, evidenceLevel: 'associated' });
  assert.deepEqual(checkScenarioResult(baselineRow('interaction-association', 'negative'), { session: near }).failures, ['nearest-negative document event associated']);
});
test('non-React and integrated scenarios verify their complete evidence sets', () => {
  const nonReact = liveFindingSession(baselineRow('non-react-burst')); nonReact.canvases[0] = liveSummary('support', { nearestReactOwner: null, attributionKind: 'unattributed' });
  assert.deepEqual(checkScenarioResult(baselineRow('non-react-burst'), { session: nonReact }).failures, []); nonReact.canvases[0].nearestReactOwner = 'Owner';
  assert.deepEqual(checkScenarioResult(baselineRow('non-react-burst'), { session: nonReact }).failures, ['missing unattributed non-React supporting canvas']);
  const nonReactNegative = baselineNegative('non-react-burst'); assert.deepEqual(checkScenarioResult(baselineRow('non-react-burst', 'negative'), nonReactNegative).failures, []); nonReactNegative.session.canvases[0].nearestReactOwner = 'Owner';
  assert.deepEqual(checkScenarioResult(baselineRow('non-react-burst', 'negative'), nonReactNegative).failures, ['nearest-negative non-React owner evidence is invalid']);
  const manifest = orderedRuns().find(item => item.scenario === 'integrated-continuous' && item.mode === 'bad'); const value = liveSession({ findings: [liveFinding('repeated-draw-work'), liveFinding('resize-churn'), liveFinding('backing-store-mismatch')], episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: 'canvas-1', canvasApiSelfTimeMs: 9 }] }] });
  assert.deepEqual(checkScenarioResult(manifest, { session: value }).failures, []); value.findings.pop();
  assert.deepEqual(checkScenarioResult(manifest, { session: value }).failures, ['integrated-continuous:backing-store-mismatch: missing finding']);
});
test('diagnostics, idle draws, dropped evidence, and unapproved skips fail', () => { const manifest = baselineRow('heavy-burst'); const session = liveFindingSession(manifest); for (const key of ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills']) assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1 }, { diagnostics: { [key]: ['bad'] } }).failures, [key]); assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1, idleDrawCount: 1 }).failures, ['idle capture contains draw activity']); assert.deepEqual(evaluateCapture(manifest, { ...session, droppedEntryCounts: { ...drops(), resetEvents: 1 } }, { acceptedRunCount: 1 }).failures, ['dropped evidence:resetEvents:1']); assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1 }, { diagnostics: { unsupportedEvidence: [{ feature: 'gpu-time' }] } }).failures, ['unsupportedEvidence']); assert.deepEqual(collectDiagnostics(), diagnostics()); });
test('non-integrated captures accept exactly one fixture run', () => { const manifest = baselineRow('heavy-burst'); const session = liveFindingSession(manifest); assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: 1 }).failures, []); for (const count of [0, 2]) assert.deepEqual(evaluateCapture(manifest, session, { acceptedRunCount: count }).failures, [`fixture accepted run count must equal 1 (received ${count})`]); });
test('mutation is narrow and fails only because the heavy finding is missing', () => { const mutated = applyMutation(orderedRuns(), 'heavy-burst-seed-off').find(item => item.mutation); const result = evaluateCapture(mutated, liveSession(), { acceptedRunCount: 1 }); assert.deepEqual(result.failures, ['heavy-burst:heavy-canvas-work: missing finding']); assert.throws(() => applyMutation(orderedRuns(), 'unknown'), error => error.message === 'unknown mutation: unknown'); });
