import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recompute } from './session-comparison-truth.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const files = ['chrome-flow.json', 'raw-baseline-session.json', 'raw-comparable-candidate-session.json', 'raw-incomparable-candidate-session.json', 'copied-comparable-comparison.json', 'copied-incomparable-comparison.json', 'comparable.png', 'incomparable.png', 'evidence-sha256.txt'];
const flowKeys = ['chromeVersion', 'gitCommit', 'initialStatus', 'finalStatus', 'bundleSha256', 'command', 'selectedIndexes', 'panelText', 'actions', 'activations', 'screenshots', 'checks', 'diagnostics', 'failures'];
const actionKeys = ['baseline', 'hydration', 'tabOrder', 'sameTypeFilter', 'comparable', 'comparableCopy', 'incomparable', 'incomparableCopy', 'replacement'];
const checkKeys = ['record-comparable:focus-after', 'record-comparable:focus-before', 'stop-comparable:focus-after', 'stop-comparable:focus-before', 'copy-comparable:focus-after', 'copy-comparable:focus-before', 'record-incomparable:focus-after', 'record-incomparable:focus-before', 'stop-incomparable:focus-after', 'stop-incomparable:focus-before', 'compare-incomparable:focus-after', 'compare-incomparable:focus-before', 'copy-incomparable:focus-after', 'copy-incomparable:focus-before', 'replace-baseline:focus-after', 'replace-baseline:focus-before', 'baselineAfterReattach', 'baselineSelected', 'browserDiagnostics', 'claimWords', 'hostReattached', 'incompleteDrop', 'keyboardComparableCopy', 'keyboardIncomparable', 'keyboardReplacement', 'pointerBaseline', 'pointerComparable', 'sameTypeFilter', 'tabOrderAfterReattach'];
const hash = value => createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const stable = value => JSON.stringify(value);
const fail = message => { throw new Error(`overlay comparison evidence failed: ${message}`); };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const forbidden = /\b(fixed|faster|improved|regressed)\b|same pixels|pixel identity|gpu time|render time|caused by|wasted work|auto.?match/i;
const privateText = /privateFixture|secret\.example\.invalid|private-(?:path|query|fragment)|raw.?argument.?token|https?:\/\//i;

function installedChromeVersion() {
  const command = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome';
  const output = execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
  const version = output.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (!version) fail('installed Chrome version is unavailable');
  return `Chrome ${version}`;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(`${label} keys are wrong`);
}
function exactArray(value, expected, label) { if (!Array.isArray(value) || stable(value) !== stable(expected)) fail(`${label} is wrong`); }
function findingLabel(type) {
  return { 'heavy-canvas-work': 'Concentrated canvas work', 'repeated-draw-work': 'Repeated draw commands', 'resize-churn': 'Resets during active work', 'backing-store-mismatch': 'Large canvas backing store' }[type];
}
function measureLabel(id) {
  const labels = {
    'active-window-count': 'Active window count', 'raster-operation-count': 'Raster operation count',
    'canvas-api-self-time-ms': 'Canvas2D API self-time', 'maximum-window-self-time-ms': 'Maximum window Canvas2D API self-time',
    'unknown-command-window-count': 'Unknown command window count', 'heavy-episode-operation-count': 'Heavy episode operation count',
    'heavy-episode-self-time-ms': 'Heavy episode Canvas2D API self-time', 'repeated-window-count': 'Repeated window count',
    'repeated-raster-operation-count': 'Repeated raster operation count', 'comparison-gap-count': 'Comparison gap count',
    'active-reset-count': 'Active reset count', 'observed-reset-count': 'Observed reset count', 'affected-episode-count': 'Affected episode count',
    'same-command-window-count': 'Same command window count', 'changed-command-window-count': 'Changed command window count',
    'affected-backing-window-count': 'Affected backing window count', 'maximum-backing-area-ratio': 'Maximum backing area ratio',
  };
  if (id.startsWith('method:')) { const [, method, kind] = id.split(':'); return `${method} ${kind === 'operation-count' ? 'operation count' : 'Canvas2D API self-time'}`; }
  return labels[id];
}
function directionText(measure) {
  if (measure.interpretation === 'structural') return measure.direction;
  return { increased: 'higher in this pair', decreased: 'lower in this pair', unchanged: 'equal in this pair', unknown: 'unknown in this pair' }[measure.direction];
}
function measureLine(measure) { return `${measureLabel(measure.id)}: baseline ${measure.baseline} · candidate ${measure.candidate} · delta ${measure.delta} · ${measure.unit} · ${directionText(measure)} · ${measure.interpretation}`; }
function validatePng(value, name) {
  if (!value.subarray(0, 8).equals(png) || value.length < 1000 || value.length < 24) fail(`${name} is not a nontrivial PNG`);
  const width = value.readUInt32BE(16); const height = value.readUInt32BE(20);
  if (width < 100 || height < 60) fail(`${name} dimensions are too small`);
}
function validateActivations(value) {
  const expected = [
    ['record-comparable', 'Enter'], ['stop-comparable', 'Space'], ['copy-comparable', 'Enter'],
    ['record-incomparable', 'Space'], ['stop-incomparable', 'Enter'], ['compare-incomparable', 'Enter'],
    ['copy-incomparable', 'Space'], ['replace-baseline', 'Enter'],
  ];
  if (!Array.isArray(value) || value.length !== expected.length) fail('activation records are incomplete');
  value.forEach((item, index) => {
    exactKeys(item, ['action', 'inputMethod', 'key', 'focusBefore', 'focusAfter'], `activation ${index}`);
    if (item.action !== expected[index][0] || item.inputMethod !== 'keyboard' || item.key !== expected[index][1] || item.focusBefore !== true || item.focusAfter !== true) fail(`activation ${index} differs`);
  });
}
function validateActions(actions, baseline, comparable, incomparable, comparableArtifact, incomparableArtifact, indexes) {
  exactKeys(actions, actionKeys, 'actions');
  exactKeys(actions.baseline, ['inputMethod', 'sessionId', 'findingIndex', 'labelBefore', 'labelAfter', 'ariaPressedAfter'], 'baseline action');
  if (actions.baseline.inputMethod !== 'pointer' || actions.baseline.sessionId !== baseline.sessionId || actions.baseline.findingIndex !== indexes.comparable.baselineFindingIndex || actions.baseline.labelBefore !== 'Keep as baseline' || actions.baseline.labelAfter !== 'Baseline kept' || actions.baseline.ariaPressedAfter !== 'true') fail('baseline action differs');
  exactKeys(actions.hydration, ['hostRemoved', 'reattachedHostCount', 'baselineActionCount'], 'hydration action');
  if (actions.hydration.hostRemoved !== true || actions.hydration.reattachedHostCount !== 1 || actions.hydration.baselineActionCount < 1) fail('hydration action differs');
  exactKeys(actions.tabOrder, ['inputMethod', 'key', 'from', 'to', 'focusAfter'], 'tab order action');
  if (actions.tabOrder.inputMethod !== 'keyboard' || actions.tabOrder.key !== 'Tab' || actions.tabOrder.from !== 'Explain next interaction' || actions.tabOrder.to !== 'Baseline kept' || actions.tabOrder.focusAfter !== true) fail('tab order action differs');
  exactKeys(actions.sameTypeFilter, ['findingCount', 'visibleCandidateIndexes', 'hiddenCandidateIndexes'], 'same-type filter');
  const baselineType = baseline.findings[indexes.comparable.baselineFindingIndex]?.type;
  const expectedVisible = comparable.findings.flatMap((finding, index) => finding.type === baselineType ? [index] : []);
  const expectedHidden = comparable.findings.flatMap((finding, index) => finding.type === baselineType ? [] : [index]);
  if (actions.sameTypeFilter.findingCount !== comparable.findings.length) fail('same-type finding count differs');
  exactArray(actions.sameTypeFilter.visibleCandidateIndexes, expectedVisible, 'visible candidate indexes');
  exactArray(actions.sameTypeFilter.hiddenCandidateIndexes, expectedHidden, 'hidden candidate indexes');
  if (!expectedVisible.length || !expectedHidden.length) fail('same-type filter is vacuous');
  exactKeys(actions.comparable, ['inputMethod', 'status', 'baselineFindingIndex', 'candidateFindingIndex'], 'comparable action');
  if (actions.comparable.inputMethod !== 'pointer' || actions.comparable.status !== comparableArtifact.status || actions.comparable.baselineFindingIndex !== indexes.comparable.baselineFindingIndex || actions.comparable.candidateFindingIndex !== indexes.comparable.candidateFindingIndex) fail('comparable action differs');
  exactKeys(actions.comparableCopy, ['inputMethod', 'key', 'clipboardMatched'], 'comparable copy');
  if (actions.comparableCopy.inputMethod !== 'keyboard' || actions.comparableCopy.key !== 'Enter' || actions.comparableCopy.clipboardMatched !== true) fail('comparable copy differs');
  exactKeys(actions.incomparable, ['inputMethod', 'key', 'status', 'reason', 'baselineFindingIndex', 'candidateFindingIndex'], 'incomparable action');
  if (actions.incomparable.inputMethod !== 'keyboard' || actions.incomparable.key !== 'Enter' || actions.incomparable.status !== incomparableArtifact.status || actions.incomparable.reason !== incomparableArtifact.incomparableReasons[0] || actions.incomparable.baselineFindingIndex !== indexes.incomparable.baselineFindingIndex || actions.incomparable.candidateFindingIndex !== indexes.incomparable.candidateFindingIndex) fail('incomparable action differs');
  exactKeys(actions.incomparableCopy, ['inputMethod', 'key', 'clipboardMatched'], 'incomparable copy');
  if (actions.incomparableCopy.inputMethod !== 'keyboard' || actions.incomparableCopy.key !== 'Space' || actions.incomparableCopy.clipboardMatched !== true) fail('incomparable copy differs');
  exactKeys(actions.replacement, ['inputMethod', 'key', 'sessionIdBefore', 'sessionIdAfter', 'findingIndexAfter', 'comparisonCleared'], 'replacement action');
  if (actions.replacement.inputMethod !== 'keyboard' || actions.replacement.key !== 'Enter' || actions.replacement.sessionIdBefore !== baseline.sessionId || actions.replacement.sessionIdAfter !== incomparable.sessionId || !Number.isInteger(actions.replacement.findingIndexAfter) || !incomparable.findings[actions.replacement.findingIndexAfter] || actions.replacement.comparisonCleared !== true) fail('replacement action differs');
}

export function checkOverlayComparisonEvidence(directory) {
  if (stable(readdirSync(directory).sort()) !== stable([...files].sort())) fail('file set is not exact');
  for (const name of files) if (readFileSync(join(directory, name)).length === 0) fail(`${name} is empty`);
  const comparablePng = readFileSync(join(directory, 'comparable.png')); const incomparablePng = readFileSync(join(directory, 'incomparable.png'));
  validatePng(comparablePng, 'comparable.png'); validatePng(incomparablePng, 'incomparable.png');

  const flow = readJson(join(directory, 'chrome-flow.json'));
  exactKeys(flow, flowKeys, 'flow');
  if (flow.chromeVersion !== installedChromeVersion() || !/^[0-9a-f]{40}$/.test(flow.gitCommit) || !/^[0-9a-f]{64}$/.test(flow.bundleSha256) || flow.command !== 'pnpm --filter dogfood run probe:overlay-comparison') fail('flow metadata is wrong');
  exactKeys(flow.selectedIndexes, ['comparable', 'incomparable'], 'selected indexes');
  for (const name of ['comparable', 'incomparable']) {
    exactKeys(flow.selectedIndexes[name], ['baselineFindingIndex', 'candidateFindingIndex'], `${name} indexes`);
    if (!Number.isInteger(flow.selectedIndexes[name].baselineFindingIndex) || !Number.isInteger(flow.selectedIndexes[name].candidateFindingIndex)) fail(`${name} indexes are invalid`);
  }
  exactKeys(flow.panelText, ['comparable', 'incomparable', 'beforeReplacement', 'afterReplacement'], 'panel text');
  exactKeys(flow.screenshots, ['comparableSha256', 'incomparableSha256'], 'screenshot hashes');
  if (flow.screenshots.comparableSha256 !== hash(comparablePng) || flow.screenshots.incomparableSha256 !== hash(incomparablePng)) fail('screenshot hash differs');
  const currentStatus = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
  if (flow.gitCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() || flow.initialStatus !== flow.finalStatus || flow.finalStatus !== currentStatus) fail('checkout state differs');
  if (flow.bundleSha256 !== hash(readFileSync(join(root, 'packages/core/dist/canvas-scan.iife.js')))) fail('bundle hash differs');
  exactKeys(flow.diagnostics, ['warnings', 'errors', 'pageErrors'], 'diagnostics');
  if (Object.values(flow.diagnostics).some(value => !Array.isArray(value) || value.length)) fail('browser diagnostics exist');
  if (!Array.isArray(flow.failures) || flow.failures.length) fail('browser failures exist');
  exactKeys(flow.checks, checkKeys, 'action checks');
  if (Object.values(flow.checks).some(value => value !== true)) fail('action checks are incomplete');
  validateActivations(flow.activations);

  const baseline = readJson(join(directory, 'raw-baseline-session.json'));
  const comparable = readJson(join(directory, 'raw-comparable-candidate-session.json'));
  const incomparable = readJson(join(directory, 'raw-incomparable-candidate-session.json'));
  const expectedComparable = recompute(flow.selectedIndexes.comparable, baseline, comparable);
  const expectedIncomparable = recompute(flow.selectedIndexes.incomparable, baseline, incomparable);
  const copiedComparable = readJson(join(directory, 'copied-comparable-comparison.json'));
  const copiedIncomparable = readJson(join(directory, 'copied-incomparable-comparison.json'));
  if (stable(copiedComparable) !== stable(expectedComparable) || stable(copiedIncomparable) !== stable(expectedIncomparable)) fail('copied artifact differs from independent result');
  if (expectedComparable.status !== 'comparable' || expectedIncomparable.status !== 'incomparable' || stable(expectedIncomparable.incomparableReasons) !== stable(['incomplete-evidence']) || expectedIncomparable.measures.length) fail('comparison status is wrong');
  validateActions(flow.actions, baseline, comparable, incomparable, expectedComparable, expectedIncomparable, flow.selectedIndexes);

  const comparablePanel = flow.panelText.comparable; const incomparablePanel = flow.panelText.incomparable;
  for (const expected of [
    'BASELINE KEPT', `Session: ${baseline.sessionId}`, `Finding ${flow.selectedIndexes.comparable.baselineFindingIndex + 1}: ${findingLabel(baseline.findings[flow.selectedIndexes.comparable.baselineFindingIndex].type)}`,
    'COMPARISON COMPLETE', `Baseline: Session ${expectedComparable.baseline.sessionId} · Finding ${expectedComparable.baseline.findingIndex + 1}: ${findingLabel(expectedComparable.baseline.findingType)}`,
    `Candidate: Session ${expectedComparable.candidate.sessionId} · Finding ${expectedComparable.candidate.findingIndex + 1}: ${findingLabel(expectedComparable.candidate.findingType)}`,
    'Pairing: user-selected', 'Canvas IDs and owner names are session-local labels and were not used to pair the findings.', 'Comparison status: comparable',
    'One selected pair does not establish a performance improvement.', 'improvementEstablished: false', ...expectedComparable.measures.map(measureLine),
  ]) if (!comparablePanel.includes(expected)) fail(`comparable panel lacks: ${expected}`);
  for (const expected of ['Comparison status: incomparable', 'Incomparable reason: incomplete-evidence', 'One selected pair does not establish a performance improvement.', 'improvementEstablished: false']) if (!incomparablePanel.includes(expected)) fail(`incomparable panel lacks: ${expected}`);
  if (/\bdelta\b|higher in this pair|lower in this pair|equal in this pair|unknown in this pair/.test(incomparablePanel)) fail('incomparable panel has measure claims');
  const replacementFinding = incomparable.findings[flow.actions.replacement.findingIndexAfter];
  if (!flow.panelText.beforeReplacement.includes('COMPARISON COMPLETE') || !flow.panelText.afterReplacement.includes('BASELINE KEPT') || flow.panelText.afterReplacement.includes('COMPARISON COMPLETE') || !flow.panelText.afterReplacement.includes(`Session: ${incomparable.sessionId}`) || !flow.panelText.afterReplacement.includes(`Finding ${flow.actions.replacement.findingIndexAfter + 1}: ${findingLabel(replacementFinding.type)}`)) fail('replacement panel differs');
  const publicText = `${comparablePanel}\n${incomparablePanel}\n${stable(copiedComparable)}\n${stable(copiedIncomparable)}`;
  if (forbidden.test(publicText)) fail('forbidden claim text');
  if (privateText.test(publicText)) fail('private fixture text leaked');

  const manifest = readFileSync(join(directory, 'evidence-sha256.txt'), 'utf8').trim().split('\n');
  const expectedManifest = files.filter(name => name !== 'evidence-sha256.txt').sort().map(name => `${hash(readFileSync(join(directory, name)))}  ${name}`);
  if (stable(manifest) !== stable(expectedManifest)) fail('manifest differs');
  return true;
}
