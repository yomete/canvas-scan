import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { recompute } from './session-comparison-truth.mjs';
import { checkOverlayComparisonEvidence } from './overlay-comparison-truth.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const row = id => expectedMatrix.rows.find(value => value.id === id);
const checkKeys = ['record-comparable:focus-after', 'record-comparable:focus-before', 'stop-comparable:focus-after', 'stop-comparable:focus-before', 'copy-comparable:focus-after', 'copy-comparable:focus-before', 'record-incomparable:focus-after', 'record-incomparable:focus-before', 'stop-incomparable:focus-after', 'stop-incomparable:focus-before', 'compare-incomparable:focus-after', 'compare-incomparable:focus-before', 'copy-incomparable:focus-after', 'copy-incomparable:focus-before', 'replace-baseline:focus-after', 'replace-baseline:focus-before', 'baselineAfterReattach', 'baselineSelected', 'browserDiagnostics', 'claimWords', 'hostReattached', 'incompleteDrop', 'keyboardComparableCopy', 'keyboardIncomparable', 'keyboardReplacement', 'pointerBaseline', 'pointerComparable', 'sameTypeFilter', 'tabOrderAfterReattach'];
execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });

function findingLabel(type) { return { 'heavy-canvas-work': 'Concentrated canvas work', 'repeated-draw-work': 'Repeated draw commands', 'resize-churn': 'Resets during active work', 'backing-store-mismatch': 'Large canvas backing store' }[type]; }
function installedChromeVersion() {
  const command = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome';
  const version = execFileSync(command, ['--version'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error('installed Chrome version is unavailable');
  return `Chrome ${version}`;
}
function measureLabel(id) {
  const labels = { 'active-window-count': 'Active window count', 'raster-operation-count': 'Raster operation count', 'canvas-api-self-time-ms': 'Canvas2D API self-time', 'maximum-window-self-time-ms': 'Maximum window Canvas2D API self-time', 'unknown-command-window-count': 'Unknown command window count', 'heavy-episode-operation-count': 'Heavy episode operation count', 'heavy-episode-self-time-ms': 'Heavy episode Canvas2D API self-time', 'repeated-window-count': 'Repeated window count', 'repeated-raster-operation-count': 'Repeated raster operation count', 'comparison-gap-count': 'Comparison gap count', 'active-reset-count': 'Active reset count', 'observed-reset-count': 'Observed reset count', 'affected-episode-count': 'Affected episode count', 'same-command-window-count': 'Same command window count', 'changed-command-window-count': 'Changed command window count', 'affected-backing-window-count': 'Affected backing window count', 'maximum-backing-area-ratio': 'Maximum backing area ratio' };
  if (id.startsWith('method:')) { const [, method, kind] = id.split(':'); return `${method} ${kind === 'operation-count' ? 'operation count' : 'Canvas2D API self-time'}`; }
  return labels[id];
}
function direction(measure) { return measure.interpretation === 'structural' ? measure.direction : { increased: 'higher in this pair', decreased: 'lower in this pair', unchanged: 'equal in this pair', unknown: 'unknown in this pair' }[measure.direction]; }
function panel(baseline, artifact) {
  const lines = ['BASELINE KEPT', `Session: ${baseline.sessionId}`, `Finding ${artifact.baseline.findingIndex + 1}: ${findingLabel(artifact.baseline.findingType)}`, 'COMPARISON COMPLETE', `Baseline: Session ${artifact.baseline.sessionId} · Finding ${artifact.baseline.findingIndex + 1}: ${findingLabel(artifact.baseline.findingType)}`, `Candidate: Session ${artifact.candidate.sessionId} · Finding ${artifact.candidate.findingIndex + 1}: ${findingLabel(artifact.candidate.findingType)}`, 'Pairing: user-selected', 'Canvas IDs and owner names are session-local labels and were not used to pair the findings.', `Comparison status: ${artifact.status}`, 'One selected pair does not establish a performance improvement.', 'improvementEstablished: false'];
  if (artifact.status === 'comparable') for (const measure of artifact.measures) lines.push(`${measureLabel(measure.id)}: baseline ${measure.baseline} · candidate ${measure.candidate} · delta ${measure.delta} · ${measure.unit} · ${direction(measure)} · ${measure.interpretation}`);
  else for (const reason of artifact.incomparableReasons) lines.push(`Incomparable reason: ${reason}`);
  lines.push('Copy comparison JSON');
  return lines.join('\n');
}
function refresh(directory) {
  const names = readdirSync(directory).filter(name => name !== 'evidence-sha256.txt').sort();
  writeFileSync(join(directory, 'evidence-sha256.txt'), `${names.map(name => `${hash(readFileSync(join(directory, name)))}  ${name}`).join('\n')}\n`);
}
function writeJson(directory, name, value) { writeFileSync(join(directory, name), stable(value)); }
function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sidproj-66-check-'));
  const repeated = row('repeated-work'); const heavy = row('heavy-work');
  const baseline = sessionFor(repeated, 0); const comparable = sessionFor(repeated, 1);
  const heavySession = sessionFor(heavy, 1); const unrelatedCanvas = structuredClone(heavySession.canvases[0]); const unrelatedFinding = structuredClone(heavySession.findings[0]);
  unrelatedCanvas.canvasId = 'candidate-unrelated-canvas'; unrelatedFinding.canvasId = unrelatedCanvas.canvasId; unrelatedFinding.episodeId = 'candidate-unrelated-episode';
  comparable.canvases.push(unrelatedCanvas); comparable.findings.push(unrelatedFinding);
  const incomparable = structuredClone(comparable); incomparable.sessionId = 'incomplete-candidate-session'; incomparable.endedAt = '2026-08-11T10:02:00.000Z'; incomparable.droppedEntryCounts.canvasLifetimes = 1;
  const selectedIndexes = { comparable: { baselineFindingIndex: 0, candidateFindingIndex: 0 }, incomparable: { baselineFindingIndex: 0, candidateFindingIndex: 0 } };
  const comparableArtifact = recompute(selectedIndexes.comparable, baseline, comparable); const incomparableArtifact = recompute(selectedIndexes.incomparable, baseline, incomparable);
  const comparablePanel = panel(baseline, comparableArtifact); const incomparablePanel = panel(baseline, incomparableArtifact);
  const screenshot = readFileSync(join(root, 'docs/overlay.png'));
  copyFileSync(join(root, 'docs/overlay.png'), join(directory, 'comparable.png')); copyFileSync(join(root, 'docs/overlay.png'), join(directory, 'incomparable.png'));
  const currentStatus = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
  const flow = {
    chromeVersion: installedChromeVersion(), gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), initialStatus: currentStatus, finalStatus: currentStatus,
    bundleSha256: hash(readFileSync(join(root, 'packages/core/dist/canvas-scan.iife.js'))), command: 'pnpm --filter dogfood run probe:overlay-comparison', selectedIndexes,
    panelText: { comparable: comparablePanel, incomparable: incomparablePanel, beforeReplacement: comparablePanel, afterReplacement: `BASELINE KEPT\nSession: ${incomparable.sessionId}\nFinding 1: Repeated draw commands` },
    actions: {
      baseline: { inputMethod: 'pointer', sessionId: baseline.sessionId, findingIndex: 0, labelBefore: 'Keep as baseline', labelAfter: 'Baseline kept', ariaPressedAfter: 'true' },
      hydration: { hostRemoved: true, reattachedHostCount: 1, baselineActionCount: 1 },
      tabOrder: { inputMethod: 'keyboard', key: 'Tab', from: 'Explain next interaction', to: 'Baseline kept', focusAfter: true },
      sameTypeFilter: { findingCount: 2, visibleCandidateIndexes: [0], hiddenCandidateIndexes: [1] },
      comparable: { inputMethod: 'pointer', status: 'comparable', baselineFindingIndex: 0, candidateFindingIndex: 0 },
      comparableCopy: { inputMethod: 'keyboard', key: 'Enter', clipboardMatched: true },
      incomparable: { inputMethod: 'keyboard', key: 'Enter', status: 'incomparable', reason: 'incomplete-evidence', baselineFindingIndex: 0, candidateFindingIndex: 0 },
      incomparableCopy: { inputMethod: 'keyboard', key: 'Space', clipboardMatched: true },
      replacement: { inputMethod: 'keyboard', key: 'Enter', sessionIdBefore: baseline.sessionId, sessionIdAfter: incomparable.sessionId, findingIndexAfter: 0, comparisonCleared: true },
    },
    activations: [['record-comparable', 'Enter'], ['stop-comparable', 'Space'], ['copy-comparable', 'Enter'], ['record-incomparable', 'Space'], ['stop-incomparable', 'Enter'], ['compare-incomparable', 'Enter'], ['copy-incomparable', 'Space'], ['replace-baseline', 'Enter']].map(([action, key]) => ({ action, inputMethod: 'keyboard', key, focusBefore: true, focusAfter: true })),
    screenshots: { comparableSha256: hash(screenshot), incomparableSha256: hash(screenshot) }, checks: Object.fromEntries(checkKeys.map(key => [key, true])), diagnostics: { warnings: [], errors: [], pageErrors: [] }, failures: [],
  };
  writeJson(directory, 'chrome-flow.json', flow); writeJson(directory, 'raw-baseline-session.json', baseline); writeJson(directory, 'raw-comparable-candidate-session.json', comparable); writeJson(directory, 'raw-incomparable-candidate-session.json', incomparable); writeJson(directory, 'copied-comparable-comparison.json', comparableArtifact); writeJson(directory, 'copied-incomparable-comparison.json', incomparableArtifact); refresh(directory);
  return directory;
}
function mutate(directory, file, change) { const path = join(directory, file); const value = JSON.parse(readFileSync(path, 'utf8')); change(value); writeJson(directory, file, value); refresh(directory); }

test('accepts one complete deterministic checker fixture', () => {
  const directory = createFixture(); try { assert.equal(checkOverlayComparisonEvidence(directory), true); } finally { rmSync(directory, { recursive: true, force: true }); }
});

const mutations = [
  ['baseline raw session', 'raw-baseline-session.json', value => { value.canvases[0].activeWindowCount++; }],
  ['comparable raw session', 'raw-comparable-candidate-session.json', value => { value.canvases[0].rasterOperationCount++; }],
  ['incomparable drop count', 'raw-incomparable-candidate-session.json', value => { value.droppedEntryCounts.canvasLifetimes = 0; }],
  ['baseline index', 'chrome-flow.json', value => { value.selectedIndexes.comparable.baselineFindingIndex = 1; }],
  ['candidate index', 'chrome-flow.json', value => { value.selectedIndexes.comparable.candidateFindingIndex = 1; }],
  ['measure baseline', 'copied-comparable-comparison.json', value => { value.measures[0].baseline++; }],
  ['measure candidate', 'copied-comparable-comparison.json', value => { value.measures[0].candidate++; }],
  ['measure delta', 'copied-comparable-comparison.json', value => { value.measures[0].delta++; }],
  ['measure unit', 'copied-comparable-comparison.json', value => { value.measures[0].unit = 'ms'; }],
  ['measure direction', 'copied-comparable-comparison.json', value => { value.measures[0].direction = 'increased'; }],
  ['measure interpretation', 'copied-comparable-comparison.json', value => { value.measures[0].interpretation = 'observed-timing-pair'; }],
  ['pairing method', 'copied-comparable-comparison.json', value => { value.pairingMethod = 'automatic'; }],
  ['improvement claim', 'copied-comparable-comparison.json', value => { value.improvementEstablished = true; }],
  ['comparable status', 'copied-comparable-comparison.json', value => { value.status = 'incomparable'; }],
  ['incomparable reason', 'copied-incomparable-comparison.json', value => { value.incomparableReasons = ['finding-type-mismatch']; }],
  ['incomparable measure', 'copied-incomparable-comparison.json', value => { value.measures.push({ id: 'active-window-count', unit: 'count', baseline: 1, candidate: 2, delta: 1, direction: 'increased', interpretation: 'structural' }); }],
  ['missing shown measure', 'chrome-flow.json', value => { value.panelText.comparable = value.panelText.comparable.split('\n').filter(line => !line.startsWith('Active window count:')).join('\n'); }],
  ['baseline label', 'chrome-flow.json', value => { value.actions.baseline.labelAfter = 'Not baseline'; }],
  ['replacement label', 'chrome-flow.json', value => { value.panelText.afterReplacement = 'BASELINE KEPT'; }],
  ['replacement index', 'chrome-flow.json', value => { value.actions.replacement.findingIndexAfter = 1; }],
  ['same-type filter', 'chrome-flow.json', value => { value.actions.sameTypeFilter.visibleCandidateIndexes = [0, 1]; }],
  ['pointer action', 'chrome-flow.json', value => { value.actions.baseline.inputMethod = 'keyboard'; }],
  ['keyboard focus', 'chrome-flow.json', value => { value.activations[0].focusAfter = false; }],
  ['hydration action', 'chrome-flow.json', value => { value.actions.hydration.reattachedHostCount = 0; }],
  ['tab order', 'chrome-flow.json', value => { value.actions.tabOrder.focusAfter = false; }],
  ['extra aggregate check', 'chrome-flow.json', value => { value.checks.passed = true; }],
  ['forbidden claim', 'chrome-flow.json', value => { value.panelText.comparable += '\nfaster'; }],
  ['private sentinel', 'chrome-flow.json', value => { value.panelText.comparable += '\nprivateFixtureKey'; }],
  ['Git commit', 'chrome-flow.json', value => { value.gitCommit = '0'.repeat(40); }],
  ['bundle hash', 'chrome-flow.json', value => { value.bundleSha256 = '0'.repeat(64); }],
  ['Chrome version', 'chrome-flow.json', value => { value.chromeVersion = 'Chrome 999.1.2.3'; }],
  ['command', 'chrome-flow.json', value => { value.command = 'another command'; }],
  ['worktree status', 'chrome-flow.json', value => { value.initialStatus = 'forged\n'; value.finalStatus = 'forged\n'; }],
  ['screenshot hash', 'chrome-flow.json', value => { value.screenshots.comparableSha256 = '0'.repeat(64); }],
];

for (const [name, file, change] of mutations) test(`rejects refreshed-hash tampering with ${name}`, () => {
  const directory = createFixture(); try { mutate(directory, file, change); assert.throws(() => checkOverlayComparisonEvidence(directory), /overlay comparison evidence failed/); } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rejects changed screenshot bytes after the manifest is refreshed', () => {
  const directory = createFixture(); try { const path = join(directory, 'comparable.png'); const value = readFileSync(path); value[value.length - 1] ^= 1; writeFileSync(path, value); refresh(directory); assert.throws(() => checkOverlayComparisonEvidence(directory), /screenshot hash/); } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('rejects a stale manifest, a missing file, and an extra file', () => {
  for (const kind of ['manifest', 'missing', 'extra']) {
    const directory = createFixture();
    try {
      if (kind === 'manifest') writeFileSync(join(directory, 'evidence-sha256.txt'), 'forged\n');
      if (kind === 'missing') rmSync(join(directory, 'comparable.png'));
      if (kind === 'extra') writeFileSync(join(directory, 'extra.txt'), 'extra');
      assert.throws(() => checkOverlayComparisonEvidence(directory), /overlay comparison evidence failed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
