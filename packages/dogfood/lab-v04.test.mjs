import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyMutation, checkMatrixCoverage, checkNearestNegatives, checkScenarioResult, checkVariantInvariance, expectedMatrixRows, scenarioOrder } from './lab-v04-truth.mjs';
import { buildLabResult, buildMatrixArtifact, buildNearestNegativeArtifact, collectDiagnostics, evaluateCapture, hashEntries, orderedRuns, parseArgs, safeArtifactPath, stopOwnedServer, validateEvidencePayload, validateManifestEntries, validateMutationPayload, validateRegularFile } from './lab-v04.mjs';

const rows = orderedRuns();
const normalPaths = ['/private/tmp/sidproj-55-canvas-lab-v0.4.json', '/private/tmp/sidproj-55-variant-matrix.json', '/private/tmp/sidproj-55-nearest-negatives.json', '/private/tmp/sidproj-55-console-summary.txt', '/private/tmp/sidproj-55-integrated-continuous.png', '/private/tmp/sidproj-55-integrated-burst.png'];
const row = (scenario, mode = 'bad') => rows.find(item => item.scenario === scenario && item.mode === mode && item.variant === (mode === 'negative' ? 'nearest-negative' : 'variant-a'));
const claims = {
  'heavy-canvas-work': { observation: 'The canvas spent the measured Canvas2D API self-time.', explanation: 'This is a review candidate.', nonEstablishedFacts: 'This does not establish GPU time.', nextCheck: 'Check the top measured methods.' },
  'repeated-draw-work': { observation: 'The canvas sent repeated commands.', explanation: 'This is a review candidate.', nonEstablishedFacts: 'This does not establish that the output stayed unchanged.', nextCheck: 'Check whether the application needs to send these repeated commands.' },
  'resize-churn': { observation: 'Canvas-scan observed resets in windows with raster work.', explanation: 'This is a review candidate.', nonEstablishedFacts: 'This does not show that resets made the application slow.', nextCheck: 'Check whether sizing or reset calls can change.' },
  'backing-store-mismatch': { observation: 'The backing area is larger than expected.', explanation: 'This is a review candidate.', nonEstablishedFacts: 'This does not establish GPU cost.', nextCheck: 'Check the canvas sizing policy.' },
};
const summary = (canvasId = 'canvas-1', extra = {}) => ({ canvasId, nearestReactOwner: 'V04Lab', attributionKind: 'jsx-owner', canvasApiSelfTimeMs: 9, maxWindowSelfTimeMs: 9, rasterOperationCount: 10, ...extra });
const finding = (type, canvasId = 'canvas-1', overrides = {}) => {
  const approved = claims[type];
  const common = { type, canvasId, evidenceLevel: 'candidate', canvasApiSelfTimeMs: 9, rasterOperationCount: 10, claimBoundary: { observation: approved.observation, explanation: approved.explanation, nonEstablishedFacts: approved.nonEstablishedFacts }, nextCheck: approved.nextCheck };
  if (type === 'heavy-canvas-work') return { ...common, episodeId: 'episode-1', topMethods: [{ method: 'fillRect', count: 10, canvasApiSelfTimeMs: 9 }], maximumWindow: { canvasApiSelfTimeMs: 9, rasterOperationCount: 10, methodEvidence: { fillRect: { count: 10, canvasApiSelfTimeMs: 9 } } }, ...overrides };
  if (type === 'repeated-draw-work') return { ...common, episodeId: 'episode-1', repeatedWindowCount: 1, repeatedWindows: [{ rasterOperationCount: 2 }], rasterOperationCount: 2, ...overrides };
  if (type === 'resize-churn') return { ...common, observedResetCount: 2, activeResetCount: 2, resetEvents: [{ windowIndex: 1 }, { windowIndex: 2 }], affectedEpisodeIds: ['episode-1'], ...overrides };
  return { ...common, affectedWindowCount: 2, affectedWindows: [{ actualToExpectedAreaRatio: 2 }, { actualToExpectedAreaRatio: 2 }], affectedEpisodeIds: ['episode-1'], ...overrides };
};
const session = ({ canvases = [summary()], findings = [], windows = [], resetEvents = [], lifecycleEvents = [], browserEntries = [], episodeAssociations = [], episodes = [], browserFeatures = { longAnimationFrames: true }, droppedEntryCounts } = {}) => ({
  canvases, findings, windows, resetEvents, lifecycleEvents, browserEntries, episodeAssociations, episodes, browserFeatures,
  droppedEntryCounts: droppedEntryCounts ?? { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 },
});

test('lab arguments accept the package-manager separator', () => {
  assert.deepEqual(parseArgs(['--', '--mutation=heavy-burst-seed-off']), { mode: 'mutation', mutation: 'heavy-burst-seed-off' });
});

const findingSession = manifest => session({
  canvases: [summary('support')],
  findings: [finding(manifest.expectations[0].findingType, 'support')],
  episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: 'support', canvasApiSelfTimeMs: 9 }] }],
});
const sessionWithFinding = item => session({ findings: [item], episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: item.canvasId, canvasApiSelfTimeMs: item.canvasApiSelfTimeMs }] }] });
function associationSession(manifest, associations = true, supported = true) {
  const eventType = manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
  const entries = [{ entryId: 'document-1', kind: 'document-event', eventType, startedAtTimestampMs: 1, endedAtTimestampMs: 1 }];
  if (supported) entries.push({ entryId: 'loaf-1', kind: 'long-animation-frame', startedAtTimestampMs: 2, endedAtTimestampMs: 20 });
  return session({
    canvases: [summary('support')], browserFeatures: { longAnimationFrames: supported }, browserEntries: entries,
    episodes: [{ episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 20, canvases: [{ canvasId: 'support', canvasApiSelfTimeMs: 1 }] }],
    episodeAssociations: associations && supported ? [{ entryId: 'loaf-1', entryKind: 'long-animation-frame', episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 20, evidenceLevel: 'associated' }] : [],
  });
}
function negativeCapture(scenario) {
  if (scenario === 'heavy-burst') return { session: session({ canvases: [summary('canvas-1', { canvasApiSelfTimeMs: 7 })] }) };
  if (scenario === 'non-react-burst') return { session: session({ canvases: [summary('canvas-1', { canvasApiSelfTimeMs: 7, nearestReactOwner: null, attributionKind: 'unattributed' })] }) };
  if (scenario === 'repeated-continuous') return { session: { ...session(), windows: [{ signatureStatus: 'changed', rasterOperationCount: 1 }, { signatureStatus: 'same', rasterOperationCount: 1 }] } };
  if (scenario === 'resize-churn') return { session: session({
    canvases: [summary('setup')],
    resetEvents: [{ canvasId: 'setup', windowIndex: 1, activeRasterOverlap: true }, { canvasId: 'setup', windowIndex: 1, activeRasterOverlap: true }],
    windows: [{ canvasId: 'setup', rasterOperationCount: 1 }],
    lifecycleEvents: [{ canvasId: 'setup', type: 'retired' }],
  }) };
  if (scenario === 'backing-store-mismatch') return { session: { ...session(), windows: [{ rasterOperationCount: 1, geometry: { actualToExpectedAreaRatio: 2 } }, { rasterOperationCount: 1, geometry: { actualToExpectedAreaRatio: 1.999 } }] } };
  if (scenario === 'lifecycle-reactivation') return { session: session(), fixtureBoundaryCount: 119 };
  return { session: associationSession(row('interaction-association', 'negative'), false, false) };
}

test('ordered matrix has the exact 53-row scenario, variant, and mode order', () => {
  assert.equal(rows.length, 53);
  assert.deepEqual([...new Set(rows.map(item => item.scenario))], scenarioOrder);
  for (const scenario of scenarioOrder.slice(0, 7)) assert.deepEqual(rows.filter(item => item.scenario === scenario).map(item => `${item.variant}:${item.mode}`), ['variant-a:bad', 'variant-a:fixed', 'variant-b:bad', 'variant-b:fixed', 'variant-c:bad', 'variant-c:fixed', 'nearest-negative:negative']);
  assert.deepEqual(rows.slice(-4).map(item => `${item.scenario}:${item.mode}`), ['integrated-continuous:bad', 'integrated-continuous:fixed', 'integrated-burst:bad', 'integrated-burst:fixed']);
});

test('preserving variants cover every factor axis and keep the declared invariant', () => {
  assert.equal(checkMatrixCoverage(rows).pass, true);
  assert.equal(checkVariantInvariance(rows).pass, true);
  assert.equal(checkNearestNegatives(rows).pass, true);
  for (const item of rows.filter(value => value.variant.startsWith('variant-'))) assert.ok(item.changedFactors.length >= 2);
  const changed = structuredClone(rows); changed.find(item => item.variant === 'variant-b').invariant.supportedClaim = 'changed';
  assert.equal(checkVariantInvariance(changed).pass, false);
});

test('finding checks require measured fields, product relationships, and rank', () => {
  const manifest = row('heavy-burst'); const valid = findingSession(manifest);
  assert.equal(checkScenarioResult(manifest, { session: valid }).pass, true);
  assert.equal(checkScenarioResult(manifest, { session: { ...valid, canvases: [summary('unrelated'), ...valid.canvases] } }).pass, false);
  assert.equal(checkScenarioResult(manifest, { session: { ...valid, findings: [{ ...valid.findings[0], canvasId: 'missing' }] } }).pass, false);
  assert.equal(checkScenarioResult(manifest, { session: { ...valid, findings: [{ ...valid.findings[0], claimBoundary: null }] } }).pass, false);
  assert.equal(checkScenarioResult(manifest, { session: { ...valid, findings: [{ ...valid.findings[0], claimBoundary: { observation: 'measured', explanation: 'candidate', nonEstablishedFacts: 'unknown' } }] } }).pass, false);
  assert.equal(checkScenarioResult(manifest, { session: { ...valid, findings: [{ ...valid.findings[0], maximumWindow: null }] } }).pass, false);
});

test('numeric truth boundaries accept the threshold and reject the nearest value below it', () => {
  const cases = [
    ['heavy-burst', finding('heavy-canvas-work', 'canvas-1', { canvasApiSelfTimeMs: 8 }), finding('heavy-canvas-work', 'canvas-1', { canvasApiSelfTimeMs: 7.999 })],
    ['repeated-continuous', finding('repeated-draw-work'), finding('repeated-draw-work', 'canvas-1', { rasterOperationCount: 1, repeatedWindows: [{ rasterOperationCount: 1 }] })],
    ['resize-churn', finding('resize-churn'), finding('resize-churn', 'canvas-1', { resetEvents: [{ windowIndex: 1 }, { windowIndex: 1 }] })],
    ['backing-store-mismatch', finding('backing-store-mismatch'), finding('backing-store-mismatch', 'canvas-1', { affectedWindows: [{ actualToExpectedAreaRatio: 2 }, { actualToExpectedAreaRatio: 1.999 }] })],
  ];
  for (const [scenario, at, below] of cases) {
    assert.equal(checkScenarioResult(row(scenario), { session: sessionWithFinding(at) }).pass, true, `${scenario} threshold`);
    assert.equal(checkScenarioResult(row(scenario), { session: sessionWithFinding(below) }).pass, false, `${scenario} below threshold`);
    assert.equal(checkScenarioResult(row(scenario, 'negative'), negativeCapture(scenario)).pass, true, `${scenario} negative`);
  }
});

test('resize nearest negative keeps paired setup evidence and retirement', () => {
  const capture = negativeCapture('resize-churn');
  assert.equal(checkScenarioResult(row('resize-churn', 'negative'), capture).pass, true);
  assert.equal(checkScenarioResult(row('resize-churn', 'negative'), { session: { ...capture.session, resetEvents: [] } }).pass, false);
  assert.equal(checkScenarioResult(row('resize-churn', 'negative'), { session: { ...capture.session, lifecycleEvents: [] } }).pass, false);
});

test('fixed and negative rows reject seeded and unexpected findings', () => {
  const seeded = findingSession(row('heavy-burst'));
  assert.equal(checkScenarioResult(row('heavy-burst', 'fixed'), { session: seeded }).pass, false);
  assert.equal(checkScenarioResult(row('heavy-burst', 'negative'), { session: seeded }).pass, false);
  assert.equal(checkScenarioResult(row('heavy-burst', 'fixed'), { session: sessionWithFinding(finding('resize-churn')) }).pass, false);
  assert.equal(checkScenarioResult(row('heavy-burst', 'fixed'), { session: session({ canvases: [summary('unrelated')] }) }).pass, true);
  assert.equal(checkScenarioResult(row('heavy-burst', 'negative'), { session: session({ canvases: [summary('canvas-1', { canvasApiSelfTimeMs: 6.999 })] }) }).pass, false);
});

test('lifecycle uses 120-boundary retirement and same-identity reactivation evidence', () => {
  const manifest = row('lifecycle-reactivation');
  const events = [{ canvasId: 'canvas-1', type: 'retired', windowIndex: 121, evidenceLevel: 'measured' }, { canvasId: 'canvas-1', type: 'reactivated', windowIndex: 122, evidenceLevel: 'measured' }];
  assert.equal(checkScenarioResult(manifest, { session: session({ lifecycleEvents: events }) }).pass, true);
  assert.equal(checkScenarioResult(manifest, { session: session({ lifecycleEvents: [events[0], { ...events[1], canvasId: 'other' }] }) }).pass, false);
  assert.equal(checkScenarioResult(row('lifecycle-reactivation', 'negative'), negativeCapture('lifecycle-reactivation')).pass, true);
  assert.equal(checkScenarioResult(row('lifecycle-reactivation', 'negative'), { session: session({ lifecycleEvents: [events[0]] }) }).pass, false);
});

test('association checks require document capture, overlap relationships, and approved skips only', () => {
  const bad = row('interaction-association');
  assert.equal(checkScenarioResult(bad, { session: associationSession(bad) }).pass, true);
  assert.equal(checkScenarioResult(bad, { session: associationSession(bad, false) }).pass, false);
  assert.equal(checkScenarioResult(bad, { session: associationSession(bad, false, false) }).pass, true);
  const noDocument = associationSession(bad); noDocument.browserEntries = noDocument.browserEntries.filter(entry => entry.kind !== 'document-event');
  assert.equal(checkScenarioResult(bad, { session: noDocument }).pass, false);
  const negative = row('interaction-association', 'negative'); const near = associationSession(negative, false, false);
  assert.equal(checkScenarioResult(negative, { session: near }).pass, true);
  near.episodeAssociations.push({ entryId: 'document-1', entryKind: 'document-event', episodeId: 'episode-1', startedAtTimestampMs: 2, endedAtTimestampMs: 2, evidenceLevel: 'associated' });
  assert.equal(checkScenarioResult(negative, { session: near }).pass, false);
});

test('non-React and integrated scenarios verify their complete evidence sets', () => {
  const nonReact = row('non-react-burst'); const nonReactSession = findingSession(nonReact);
  nonReactSession.canvases[0] = summary('support', { nearestReactOwner: null, attributionKind: 'unattributed' });
  assert.equal(checkScenarioResult(nonReact, { session: nonReactSession }).pass, true);
  nonReactSession.canvases[0].nearestReactOwner = 'Owner';
  assert.equal(checkScenarioResult(nonReact, { session: nonReactSession }).pass, false);
  const integrated = rows.find(item => item.scenario === 'integrated-continuous' && item.mode === 'bad');
  const integratedSession = session({ findings: [finding('repeated-draw-work'), finding('resize-churn'), finding('backing-store-mismatch')], episodes: [{ episodeId: 'episode-1', canvases: [{ canvasId: 'canvas-1', canvasApiSelfTimeMs: 9 }] }] });
  assert.equal(checkScenarioResult(integrated, { session: integratedSession }).pass, true);
  integratedSession.findings.pop();
  assert.equal(checkScenarioResult(integrated, { session: integratedSession }).pass, false);
});

test('diagnostics, idle draws, dropped evidence, and unapproved skips fail', () => {
  const manifest = row('heavy-burst'); const capture = { session: findingSession(manifest), acceptedRunCount: 1 };
  for (const key of ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills']) assert.equal(evaluateCapture(manifest, { ...capture, diagnostics: { [key]: ['bad'] } }).pass, false);
  assert.equal(evaluateCapture(manifest, { ...capture, idleDrawCount: 1 }).pass, false);
  assert.equal(evaluateCapture(manifest, { session: { ...capture.session, droppedEntryCounts: { ...capture.session.droppedEntryCounts, resetEvents: 1 } } }).pass, false);
  assert.equal(evaluateCapture(manifest, { ...capture, diagnostics: { unsupportedEvidence: [{ feature: 'gpu-time' }] } }).pass, false);
  assert.deepEqual(collectDiagnostics(), { warnings: [], consoleErrors: [], pageErrors: [], requestFailures: [], instrumentationKills: [], unsupportedEvidence: [] });
});

test('non-integrated captures accept exactly one fixture run', () => {
  const manifest = row('heavy-burst'); const capture = { session: findingSession(manifest) };
  assert.equal(evaluateCapture(manifest, { ...capture, acceptedRunCount: 1 }).failures.some(failure => failure.includes('fixture accepted run count')), false);
  for (const acceptedRunCount of [0, 2]) {
    const result = evaluateCapture(manifest, { ...capture, acceptedRunCount });
    assert.equal(result.pass, false);
    assert(result.failures.includes(`fixture accepted run count must equal 1 (received ${acceptedRunCount})`));
  }
});

test('mutation is narrow and fails only because the heavy finding is missing', () => {
  const mutated = applyMutation(rows, 'heavy-burst-seed-off').find(item => item.mutation);
  const result = evaluateCapture(mutated, { session: session(), acceptedRunCount: 1 });
  assert.equal(result.pass, false); assert.deepEqual(result.failures, ['heavy-burst:heavy-canvas-work: missing finding']);
  assert.throws(() => applyMutation(rows, 'other'), /unknown mutation/);
});

function png() { const bytes = Buffer.alloc(25); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(1440, 16); bytes.writeUInt32BE(1000, 20); return bytes; }
function negativeArtifactData(scenario) {
  const supportingCanvas = summary('support', scenario === 'non-react-burst' ? { canvasApiSelfTimeMs: 7, nearestReactOwner: null, attributionKind: 'unattributed' } : { canvasApiSelfTimeMs: 7 });
  if (scenario === 'heavy-burst' || scenario === 'non-react-burst') return { boundary: { threshold: 8 }, observations: { maximumCanvasApiSelfTimeMs: 7 }, supportingCanvas };
  if (scenario === 'repeated-continuous') return { boundary: { threshold: 2 }, observations: { sameWindowRasterOperationCounts: [1] }, supportingCanvas };
  if (scenario === 'resize-churn') return { boundary: { threshold: 2 }, observations: { activeResetCount: 2, activeResetWindowCount: 1, measuredWorkCount: 1, retiredCount: 1 }, supportingCanvas };
  if (scenario === 'backing-store-mismatch') return { boundary: { threshold: 2 }, observations: { affectedWindowCount: 1, activeWindowAreaRatios: [2, 1.999] }, supportingCanvas };
  if (scenario === 'lifecycle-reactivation') return { boundary: { threshold: 120 }, observations: { inactiveBoundaries: 119, retiredCount: 0 }, supportingCanvas };
  return { boundary: { metric: 'overlap' }, observations: { gapMs: 1, associationCount: 0 }, supportingCanvas };
}
test('evidence payload validates run IDs, order, pass state, freshness, and screenshot dimensions', () => {
  const now = Date.now(); const timestamp = new Date(now).toISOString();
  const completeRows = expectedMatrixRows().map(item => ({ ...item, expectations: item.expectations.map(expectation => ({ ...expectation, actual: expectation.expected, pass: true, unsupported: false })), pass: true, ...(item.mode === 'negative' ? negativeArtifactData(item.scenario) : {}) }));
  const primary = buildLabResult({ runId: 'run-1', startedAt: timestamp, endedAt: timestamp, scenarios: completeRows, browser: { name: 'Chrome', version: 'Chrome 140', channel: 'chrome', headless: true }, product: { name: 'canvas-scan', version: '0.4.0', bundleSha256: 'a'.repeat(64) } });
  const matrix = buildMatrixArtifact('run-1', completeRows); const negatives = buildNearestNegativeArtifact('run-1', completeRows);
  const summaryText = [`runId=run-1`, ...completeRows.map(item => `${item.scenario}:${item.variant}:${item.mode}: PASS`), ...normalPaths].join('\n');
  const input = { primary, matrix, negatives, summary: summaryText, continuousPng: png(), burstPng: png(), now };
  assert.equal(validateEvidencePayload(input), true);
  assert.throws(() => validateEvidencePayload({ ...input, matrix: { ...matrix, runId: 'other' } }), /run ID/);
  assert.throws(() => validateEvidencePayload({ ...input, primary: { ...primary, pass: false } }), /primary evidence/);
  const incompleteNegatives = { ...negatives, rows: negatives.rows.map(item => item.scenario === 'resize-churn' ? { ...item, observations: undefined } : item) };
  assert.throws(() => validateEvidencePayload({ ...input, negatives: incompleteNegatives }), /nearest-negative observations/);
  const belowNeighborhood = item => item.scenario === 'heavy-burst' && item.mode === 'negative' ? { ...item, observations: { ...item.observations, maximumCanvasApiSelfTimeMs: 0.5 }, supportingCanvas: { ...item.supportingCanvas, canvasApiSelfTimeMs: 0.5 } } : item;
  assert.throws(() => validateEvidencePayload({ ...input, primary: { ...primary, scenarios: primary.scenarios.map(belowNeighborhood) }, matrix: { ...matrix, rows: matrix.rows.map(belowNeighborhood) }, negatives: { ...negatives, rows: negatives.rows.map(belowNeighborhood) } }), /nearest-negative observations/);
  const stale = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  assert.throws(() => validateEvidencePayload({ ...input, primary: { ...primary, startedAt: stale, endedAt: stale } }), /stale/);
  assert.throws(() => validateEvidencePayload({ ...input, continuousPng: Buffer.alloc(25) }), /screenshot/);
});

test('runner inputs, artifact paths, hashes, manifest checks, and filesystem types are constrained', async () => {
  assert.deepEqual(parseArgs([]), { mode: 'run' }); assert.deepEqual(parseArgs(['--check-evidence']), { mode: 'check' }); assert.throws(() => parseArgs(['--bad']));
  assert.throws(() => safeArtifactPath('/private/tmp/sidproj-55-nope.json'));
  assert.equal(safeArtifactPath('/private/tmp/sidproj-55-sha256.txt'), '/private/tmp/sidproj-55-sha256.txt');
  assert.deepEqual(await stopOwnedServer({ pid: 1 }, () => false), { stopped: false, forced: false });
  const directory = await mkdtemp(path.join(tmpdir(), 'sidproj-55-unit-'));
  try {
    const regular = path.join(directory, 'regular'); const link = path.join(directory, 'link'); const nested = path.join(directory, 'nested');
    await writeFile(regular, 'value'); await symlink(regular, link); await mkdir(nested);
    assert.ok(await validateRegularFile(regular, [regular]));
    await assert.rejects(validateRegularFile(link, [link]), /unsafe artifact type/);
    await assert.rejects(validateRegularFile(nested, [nested]), /unsafe artifact type/);
    const hashes = await hashEntries([regular]); assert.match(hashes[0], /^[0-9a-f]{64}  /);
    assert.equal(validateManifestEntries(hashes, [...hashes]), true);
    assert.throws(() => validateManifestEntries(hashes, []), /hash mismatch/);
  } finally { await rm(directory, { recursive: true }); }
});

test('mutation evidence must link to the parent run with ordered fresh timestamps', () => {
  const now = Date.now(); const primary = { runId: 'parent', endedAt: new Date(now - 2000).toISOString() };
  const mutation = { mutationRunId: 'mutation', parentRunId: 'parent', startedAt: new Date(now - 1000).toISOString(), endedAt: new Date(now).toISOString(), missing: 'heavy-canvas-work' };
  assert.equal(validateMutationPayload(mutation, primary, now), true);
  assert.throws(() => validateMutationPayload({ ...mutation, parentRunId: 'other' }, primary, now), /link mismatch/);
  assert.throws(() => validateMutationPayload({ ...mutation, startedAt: new Date(now + 1000).toISOString() }, primary, now), /timestamp order/);
  assert.throws(() => validateMutationPayload({ ...mutation, startedAt: new Date(now - 3000).toISOString() }, primary, now), /timestamp order/);
  const stale = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  assert.throws(() => validateMutationPayload({ ...mutation, startedAt: stale, endedAt: stale }, { ...primary, endedAt: stale }, now), /stale/);
});
