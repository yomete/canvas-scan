import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkArtifactEvidence as checkCommandArtifact,
  checkEvidence as checkCommandEvidence,
  counterexampleNames as commandCounterexamples,
  rowNames as commandRows,
} from './command-capture-truth.mjs';
import {
  checkArtifact as checkCallsiteArtifact,
  checkEvidenceObject as checkCallsiteEvidenceObject,
  evidenceFiles as callsiteFiles,
  readRepositoryTruth as readCallsiteRepositoryTruth,
} from './draw-callsite-truth.mjs';
import { checkEvidence as checkFixedLimitEvidence, recomputeLimitResult } from './fixed-limit-truth.mjs';
import { checkOverlayComparisonEvidence } from './overlay-comparison-truth.mjs';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { recompute } from './session-comparison-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundlePath = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const packagePath = path.join(root, 'packages/core/package.json');
const truthPath = path.join(root, 'packages/dogfood/fixtures/v05-lab/expected.json');
const topFiles = ['expected.json', 'matrix.json', 'run-metadata.json', 'collector-runs.json', 'run-links.json', 'diagnostics.json', 'checker-output.txt', 'mutation-test-output.txt', 'verification-output.txt', 'evidence-sha256.txt'];
const commandFiles = ['manifest.json', 'expected-results.json', 'actual-results.json', 'privacy-results.json', 'allocation-counter.json', ...[...commandRows, ...commandCounterexamples].map(name => `artifacts/${name}.json`)];
const comparisonFiles = ['expected-results.json', 'actual-results.json', 'browser-execution.json', ...expectedMatrix.rows.flatMap(row => [`inputs/${row.id}-baseline.json`, `inputs/${row.id}-candidate.json`, `artifacts/${row.id}.json`])];
const fixedFiles = ['expected.json', 'matrix.json', 'requests.json', 'mismatch.json', 'overlay-filter.json', 'privacy.json', 'diagnostics.json', 'run-metadata.json', 'mutation-test-output.txt', 'verification-output.txt', 'checker-output.txt', 'evidence-sha256.txt'];
const overlayFiles = ['chrome-flow.json', 'raw-baseline-session.json', 'raw-comparable-candidate-session.json', 'raw-incomparable-candidate-session.json', 'copied-comparable-comparison.json', 'copied-incomparable-comparison.json', 'comparable.png', 'incomparable.png', 'evidence-sha256.txt'];
const integratedFiles = ['baseline-session.json', 'explanation.json', 'candidate-session.json', 'comparison.json', 'exported-comparison.json', 'action-log.json', 'focus-log.json', 'interaction-state.json', 'panel-text.txt', 'comparison.png'];
const browserCollectorCommand = 'internal real-Chrome comparison and integrated flow';
const producerByGroup = {
  command: 'pnpm --filter dogfood run probe:command-capture',
  callsite: 'pnpm --filter dogfood run probe:draw-callsite',
  comparison: browserCollectorCommand,
  limits: 'pnpm --filter dogfood run probe:fixed-limits',
  overlay: 'pnpm --filter dogfood run probe:overlay-comparison',
  integrated: browserCollectorCommand,
};
const provenanceFiles = Object.keys(producerByGroup).map(group => `provenance/${group}.json`);
export const diskMutationNames = [
  'missing-row', 'extra-row', 'reordered-row', 'false-known-command', 'command-first-difference', 'callsite-limit-command-truth', 'command-gap-known',
  'wrong-callsite', 'wrong-comparison', 'wrong-limit', 'missing-artifact', 'unsafe-artifact-path',
  'extra-file', 'symlink', 'nested-manifest', 'forged-metadata', 'stale-final-file', 'stale-child-time', 'stale-provenance', 'stale-overlay-session',
  'private-raw', 'private-digest', 'raw-stack', 'source-map-body', 'outcome-claim',
  'direct-outcome-claim', 'compact-outcome-claim', 'forward-timing-claim', 'reverse-timing-claim', 'split-timing-claim',
  'diagnostic', 'unexpected-drop', 'missing-step', 'wrong-order', 'wrong-selected-index',
  'forged-integrated-comparison', 'changed-export', 'improvement-established', 'child-run-id',
  'copied-actual-result', 'collector-run', 'run-link', 'stripped-verification-record', 'missing-mutation-result',
];
const verificationCommands = [
  'pnpm --filter canvas-scan run build',
  'pnpm --filter dogfood run probe:command-capture:test',
  'pnpm --filter dogfood run probe:draw-callsite:test',
  'pnpm --filter dogfood run probe:session-comparison:test',
  'pnpm --filter dogfood run probe:overlay-comparison:test',
  'pnpm --filter dogfood run probe:fixed-limits:test',
  'pnpm --filter dogfood run lab:v0.4',
  'pnpm --filter dogfood run lab:v0.4:check',
  'pnpm --filter dogfood run probe:command-capture',
  'pnpm --filter dogfood run probe:draw-callsite',
  'pnpm --filter dogfood run probe:fixed-limits',
  'pnpm --filter dogfood run probe:overlay-comparison',
  'pnpm -r run typecheck',
  'git diff --exit-code f05f2fe2a7b5c005e1ca2d3e4ea8b04d454e5617 -- apps/workbench/public/v04-lab.html apps/workbench/src/V04Lab.tsx apps/workbench/src/v04-lab-main.tsx packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.test.mjs',
  'git diff --check',
  'git status --short --branch',
];
export const verificationCommandsFor = releaseMode => releaseMode
  ? verificationCommands.filter(command => command !== 'pnpm --filter dogfood run lab:v0.4')
  : verificationCommands;
const commonRowKeys = ['scenario', 'variant', 'mode', 'expectedResult', 'actualResult', 'artifactPath', 'commitHash', 'packageHash', 'browserRevision', 'pass', 'facts'];
const stable = value => JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error(`v0.5 lab evidence failed: ${reason}`); };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const exactKeys = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) && stable(Object.keys(value).sort()) === stable([...keys].sort());

export function safeArtifactPath(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split('/').some(part => part === '' || part === '.' || part === '..');
}

async function walk(directory, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await walk(directory, next));
    else result.push(next);
  }
  return result.sort();
}

function expectedFiles(truth) {
  const limitArtifacts = truth.rows.filter(row => row.scenario.startsWith('fixed-limit:')).map(row => `artifacts/${row.scenario.slice('fixed-limit:'.length)}/${row.variant === 'negative' ? 'nearest-negative' : row.variant}.json`);
  return [
    ...topFiles,
    ...commandFiles.map(name => `raw/command/${name}`),
    ...[...callsiteFiles, 'evidence-sha256.txt'].map(name => `raw/callsite/${name}`),
    ...comparisonFiles.map(name => `raw/comparison/${name}`),
    ...[...fixedFiles, ...limitArtifacts].map(name => `raw/limits/${name}`),
    ...overlayFiles.map(name => `raw/overlay/${name}`),
    ...integratedFiles.map(name => `raw/integrated/${name}`),
    ...provenanceFiles,
  ].sort();
}

export function rowArtifactPath(row) {
  if (row.scenario === 'command-difference') return `raw/command/artifacts/${row.variant}.json`;
  if (row.scenario === 'draw-callsite') return `raw/callsite/${row.variant}-artifact.json`;
  if (row.scenario === 'session-comparison') return `raw/comparison/artifacts/${row.variant}.json`;
  if (row.scenario.startsWith('fixed-limit:')) return `raw/limits/artifacts/${row.scenario.slice('fixed-limit:'.length)}/${row.variant === 'negative' ? 'nearest-negative' : row.variant}.json`;
  if (row.scenario === 'overlay-comparison-filter') return 'raw/limits/overlay-filter.json';
  if (row.scenario === 'integrated-user-flow') return 'raw/integrated/comparison.json';
  fail(`unknown scenario:${row.scenario}`);
}

function commandResult(artifact) {
  const checked = checkCommandArtifact(artifact);
  if (!checked.pass) fail(`command artifact:${checked.failures.join(',')}`);
  const result = artifact.comparisons?.at(-1);
  if (!result) fail('command comparison is absent');
  return {
    actualResult: result.status,
    facts: {
      ordinal: result.difference?.ordinal ?? null,
      reason: result.difference?.reason ?? null,
      unknownReason: result.unknownReason,
      firstGap: artifact.firstGap,
    },
  };
}

function callsiteResult(name, artifact, trusted) {
  checkCallsiteArtifact(name, artifact, trusted.expected);
  const frames = artifact.stacks.flatMap(sample => sample.frames);
  const generated = frames.find(frame => frame.generated?.file.includes(`/v05-05-generated/${name}.js`));
  if (!generated) fail(`callsite generated frame:${name}`);
  const mapped = frames.find(frame => frame.mappingStatus === 'mapped' && frame.mapped);
  return {
    actualResult: name === 'no-map' ? 'unresolved' : 'mapped',
    facts: {
      generated: generated.generated,
      mapped: mapped?.mapped ?? null,
      unresolvedReason: name === 'no-map' ? generated.unresolvedReason : null,
      stackSampleCount: artifact.stacks.length,
    },
  };
}

function comparisonResult(row, baseline, candidate, artifact) {
  const actual = recompute(row, baseline, candidate);
  if (stable(actual) !== stable(artifact)) fail(`comparison artifact:${row.id}`);
  return {
    actualResult: actual.status,
    facts: {
      measureIds: actual.measures.map(item => item.id),
      deltas: actual.measures.map(item => item.delta),
      incomparableReasons: actual.incomparableReasons,
      pairingMethod: actual.pairingMethod,
      improvementEstablished: actual.improvementEstablished,
    },
  };
}

async function cacheFor(truth) {
  return {
    comparisons: new Map(expectedMatrix.rows.map(row => [row.id, row])),
    limits: await readJson(path.join(root, 'packages/dogfood/fixtures/v05-08a-fixed-limits/expected.json')),
    integrated: truth.integratedFlow,
  };
}

async function resultForRow(directory, row, cache) {
  const artifact = await readJson(path.join(directory, row.artifactPath));
  if (row.scenario === 'command-difference') return commandResult(artifact);
  if (row.scenario === 'draw-callsite') {
    const expected = await readJson(path.join(directory, 'raw/callsite/expected.json'));
    return callsiteResult(row.variant, artifact, { expected });
  }
  if (row.scenario === 'session-comparison') {
    const expected = cache.comparisons.get(row.variant);
    if (!expected) fail(`comparison truth:${row.variant}`);
    const baseline = await readJson(path.join(directory, `raw/comparison/inputs/${row.variant}-baseline.json`));
    const candidate = await readJson(path.join(directory, `raw/comparison/inputs/${row.variant}-candidate.json`));
    if (stable(baseline) !== stable(sessionFor(expected, 0)) || stable(candidate) !== stable(sessionFor(expected, 1))) fail(`comparison controlled input:${row.variant}`);
    const actual = recompute(expected, baseline, candidate);
    if (actual.status !== expected.status || (actual.incomparableReasons[0] ?? null) !== expected.reason || stable(actual.measures.map(item => item.id)) !== stable(expected.measureIds) || stable(actual.measures.map(item => item.delta)) !== stable(expected.deltas)) fail(`comparison repository result:${row.variant}`);
    return comparisonResult(expected, baseline, candidate, artifact);
  }
  if (row.scenario.startsWith('fixed-limit:')) {
    const limit = row.scenario.slice('fixed-limit:'.length);
    const variant = row.variant === 'negative' ? 'nearest-negative' : row.variant;
    const source = cache.limits.rows.find(item => item.limit === limit && item.variant === variant);
    if (!source) fail(`fixed limit truth:${limit}:${variant}`);
    const actual = recomputeLimitResult(artifact, source, cache.limits);
    return { actualResult: actual.rejectedCount > 0 ? 'rejected' : 'accepted', facts: { rejectedCount: actual.rejectedCount, reason: actual.reason, firstAffected: actual.firstAffected } };
  }
  if (row.scenario === 'overlay-comparison-filter') {
    const same = artifact.same;
    const mismatch = artifact.mismatch;
    const visible = same?.actions?.filter(action => !action.hidden).map(action => action.findingIndex) ?? [];
    const hidden = mismatch?.actions?.filter(action => action.hidden).map(action => action.findingIndex) ?? [];
    if (!visible.length || !hidden.length || same.actions.some(action => action.hidden) || mismatch.actions.some(action => !action.hidden)) fail('overlay filter evidence');
    return { actualResult: 'filtered', facts: { baselineType: artifact.baselineType, visibleCandidateIndexes: visible, hiddenCandidateIndexes: hidden } };
  }
  if (row.scenario === 'integrated-user-flow') {
    const [baseline, explanation, candidate, exported, actions, focus] = await Promise.all([
      readJson(path.join(directory, 'raw/integrated/baseline-session.json')),
      readJson(path.join(directory, 'raw/integrated/explanation.json')),
      readJson(path.join(directory, 'raw/integrated/candidate-session.json')),
      readJson(path.join(directory, 'raw/integrated/exported-comparison.json')),
      readJson(path.join(directory, 'raw/integrated/action-log.json')),
      readJson(path.join(directory, 'raw/integrated/focus-log.json')),
    ]);
    const pairing = { baselineFindingIndex: artifact.baseline?.findingIndex, candidateFindingIndex: artifact.candidate?.findingIndex };
    const actual = recompute(pairing, baseline, candidate);
    if (stable(actual) !== stable(artifact) || stable(exported) !== stable(actual)) fail('integrated exported comparison');
    if (stable(actions) !== stable(cache.integrated.actionSequence)) fail('integrated action sequence');
    if (!Array.isArray(focus)) fail('integrated input and focus evidence');
    const pointerActions = focus.filter(item => item.inputMethod === 'pointer').map(item => item.action);
    const keyboardActions = focus.filter(item => item.inputMethod === 'keyboard').map(item => item.action);
    if (stable(pointerActions) !== stable(['select-baseline']) || stable(keyboardActions) !== stable(['apply-structural-change', 'record-candidate', 'select-candidate', 'compare', 'export']) || focus.filter(item => item.inputMethod === 'keyboard').some(item => item.focusBefore !== true || item.focusAfter !== true)) fail('integrated input and focus evidence');
    const baselineFinding = baseline.findings?.[pairing.baselineFindingIndex];
    const candidateFinding = candidate.findings?.[pairing.candidateFindingIndex];
    if (baselineFinding?.type !== cache.integrated.findingType || candidateFinding?.type !== cache.integrated.findingType) fail('integrated selected finding type');
    const fillRect = actual.measures.find(measure => measure.id === 'method:fillRect:operation-count');
    if (!(baselineFinding.rasterOperationCount > candidateFinding.rasterOperationCount) || !(fillRect?.baseline > fillRect?.candidate)) fail('integrated structural change');
    const baselineCanvas = baseline.canvases?.find(canvas => canvas.canvasId === baselineFinding.canvasId);
    const candidateCanvas = candidate.canvases?.find(canvas => canvas.canvasId === candidateFinding.canvasId);
    if (baselineCanvas?.rasterOperationCount !== cache.integrated.baselineDrawsPerFrame * 8 || candidateCanvas?.rasterOperationCount !== cache.integrated.candidateDrawsPerFrame * 8) fail('integrated controlled draw counts');
    for (const session of [baseline, candidate]) if (Object.values(session.droppedEntryCounts ?? {}).some(value => value !== 0)) fail('integrated session drops');
    if (Object.values(explanation.droppedEntryCounts ?? {}).some(value => value !== 0)) fail('integrated explanation drops');
    if (explanation.source?.sessionId !== baseline.sessionId || explanation.source?.findingIndex !== pairing.baselineFindingIndex) fail('integrated explanation selection');
    if (actual.status !== cache.integrated.status || actual.pairingMethod !== cache.integrated.pairingMethod || actual.improvementEstablished !== cache.integrated.improvementEstablished) fail('integrated comparison boundary');
    return {
      actualResult: actual.status,
      facts: {
        baselineFindingIndex: pairing.baselineFindingIndex,
        candidateFindingIndex: pairing.candidateFindingIndex,
        findingType: baselineFinding.type,
        measures: actual.measures,
        actionSequence: actions,
        improvementEstablished: actual.improvementEstablished,
      },
    };
  }
  fail(`unknown scenario:${row.scenario}`);
}

export async function deriveRows(directory, truth, metadata) {
  const cache = await cacheFor(truth);
  const rows = [];
  for (const declared of truth.rows) {
    const artifactPath = rowArtifactPath(declared);
    const actual = await resultForRow(directory, { ...declared, artifactPath }, cache);
    rows.push({
      ...declared,
      actualResult: actual.actualResult,
      artifactPath,
      commitHash: metadata.commitHash,
      packageHash: metadata.packageHash,
      browserRevision: metadata.browserRevision,
      pass: actual.actualResult === declared.expectedResult,
      facts: actual.facts,
    });
  }
  return rows;
}

function claim(value, forbidden, source) {
  const text = (typeof value === 'string' ? value : stable(value)).replace(/\\n/g, '\n');
  const declared = forbidden.find(item => text.toLowerCase().includes(item.toLowerCase()));
  if (declared) return declared;
  if (/\b(?:gpu|render(?:ing)?)\b[\s\S]{0,40}\btime\b|\btime\b[\s\S]{0,40}\b(?:gpu|render(?:ing)?)\b/i.test(text)) return 'timing conclusion';
  if (/\b(?:faster|improved|regressed)\b/i.test(text)) return 'outcome conclusion';
  let withoutMachineLabels = text.replace(/\bfixed-limits?\b/gi, '');
  if (source === 'verification-output.txt' || source === 'raw/limits/verification-output.txt') {
    withoutMachineLabels = withoutMachineLabels.replace(/^(?:(?:heavy-burst|repeated-continuous|resize-churn|backing-store-mismatch|lifecycle-reactivation|interaction-association|non-react-burst):variant-[abc]|integrated-(?:continuous|burst):integrated):fixed: PASS$/gim, '');
  }
  return /\bfixed\b/i.test(withoutMachineLabels) ? 'outcome conclusion' : null;
}

export async function checkEvidenceObject(evidence, truth, directory, options = {}) {
  if (!truth || truth.schemaVersion !== 1 || !Array.isArray(truth.rows) || truth.rows.length !== 59) fail('repository matrix');
  if (!Array.isArray(evidence.matrix) || evidence.matrix.length !== truth.rows.length) fail('matrix count');
  if (!exactKeys(evidence.diagnostics, truth.requiredDiagnostics)) fail('diagnostic keys');
  for (const key of truth.requiredDiagnostics) if (!Array.isArray(evidence.diagnostics[key]) || evidence.diagnostics[key].length) fail(`diagnostics:${key}`);
  const cache = options.actualRows ? null : await cacheFor(truth);
  const paths = new Set();
  for (const [index, row] of evidence.matrix.entries()) {
    const declared = truth.rows[index];
    if (!exactKeys(row, commonRowKeys)) fail(`row keys:${index + 1}`);
    if (['scenario', 'variant', 'mode', 'expectedResult'].some(key => row[key] !== declared[key])) fail(`matrix declaration:${index + 1}`);
    if (!safeArtifactPath(row.artifactPath) || row.artifactPath !== rowArtifactPath(declared) || paths.has(row.artifactPath)) fail(`artifact path:${index + 1}`);
    paths.add(row.artifactPath);
    if (!row.facts || typeof row.facts !== 'object' || Array.isArray(row.facts)) fail(`row facts:${index + 1}`);
    if (row.commitHash !== evidence.metadata.commitHash || row.packageHash !== evidence.metadata.packageHash || row.browserRevision !== evidence.metadata.browserRevision) fail(`row metadata:${index + 1}`);
    const actual = options.actualRows ? options.actualRows[index] : await resultForRow(directory, row, cache);
    if (!actual || row.actualResult !== actual.actualResult || stable(row.facts) !== stable(actual.facts) || row.actualResult !== declared.expectedResult || row.pass !== true) fail(`recomputed result:${index + 1}`);
  }
  if (claim(evidence.matrix, truth.forbiddenClaims)) fail('matrix claim');
  return true;
}

function fnv1a(value) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 0x01000193); }
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function scanPrivateEvidence(text, privacy) {
  const values = [...privacy.strings, ...privacy.numbers.map(String), ...privacy.urlParts, ...privacy.objectKeys, ...privacy.rawStackParts, ...privacy.mapBodyParts];
  const combinations = [values.join(''), values.join(':'), values.join('|'), JSON.stringify(values)];
  for (let left = 0; left < values.length; left++) for (let right = left + 1; right < values.length; right++) combinations.push(`${values[left]}${values[right]}`, `${values[left]}:${values[right]}`, `${values[left]}|${values[right]}`);
  const encoded = [...new Set([...values, ...combinations])];
  const forbidden = [...values, ...encoded.map(value => sha256(value)), ...encoded.flatMap(value => [fnv1a(value), String(Number.parseInt(fnv1a(value), 16))])];
  const lower = String(text).toLowerCase();
  const direct = forbidden.find(value => lower.includes(String(value).toLowerCase()));
  if (direct) return direct;
  if (/"mappings"\s*:|sourceMappingURL=|(?:^|\n)\s*at\s+\S/i.test(String(text))) return 'raw stack or map';
  return null;
}

function installedChromeRevision() {
  const executable = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome';
  const output = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
  const revision = output.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (!revision) fail('installed Chrome revision');
  return revision;
}

function insideRun(startedAt, endedAt, run) {
  const start = Date.parse(startedAt); const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= Date.parse(run.startedAt) && end <= Date.parse(run.endedAt);
}

async function checkCommandDirectory(directory, metadata, collectorRun) {
  const read = name => readJson(path.join(directory, name));
  const [manifest, expectedResults, actualResults, privacyScan, allocationCounter] = await Promise.all(['manifest.json', 'expected-results.json', 'actual-results.json', 'privacy-results.json', 'allocation-counter.json'].map(read));
  const artifacts = Object.fromEntries(await Promise.all([...commandRows, ...commandCounterexamples].map(async name => [name, await read(`artifacts/${name}.json`)])));
  const checked = checkCommandEvidence({ manifest, expectedResults, actualResults, artifacts, privacyScan, allocationCounter });
  if (!checked.pass) fail(`command evidence:${checked.failures.join(',')}`);
  if (manifest.runId !== metadata.runId || manifest.gitSha !== metadata.commitHash || manifest.productionBundleSha256 !== metadata.bundleHash || manifest.chromeVersion !== metadata.browserRevision) fail('command metadata');
  for (const [name, artifact] of Object.entries(artifacts)) {
    if (!insideRun(artifact.startedAt, artifact.endedAt, collectorRun)) fail(`command artifact time:${name}`);
  }
}

async function checkCallsiteDirectory(directory, collectorRun) {
  const trusted = await readCallsiteRepositoryTruth();
  const expected = await readJson(path.join(directory, 'expected.json'));
  const artifacts = Object.fromEntries(await Promise.all(['direct', 'nested', 'bundled', 'no-map'].map(async name => [name, await readJson(path.join(directory, `${name}-artifact.json`))])));
  const requests = await readJson(path.join(directory, 'request-log.json'));
  const overlay = await readJson(path.join(directory, 'overlay-evidence.json'));
  const metadata = await readJson(path.join(directory, 'run-metadata.json'));
  checkCallsiteEvidenceObject({ expected, artifacts, requests, overlay, metadata }, trusted);
  for (const [name, artifact] of Object.entries(artifacts)) if (!insideRun(artifact.startedAt, artifact.endedAt, collectorRun)) fail(`callsite artifact time:${name}`);
  const names = callsiteFiles.slice().sort();
  const lines = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim().split('\n').filter(Boolean);
  const bytes = new Map(await Promise.all(names.map(async name => [name, await readFile(path.join(directory, name))])));
  validateManifest(lines, names, bytes);
}

async function validateMetadata(metadata, truth, currentStatus) {
  const keys = ['schemaVersion', 'runId', 'command', 'releaseMode', 'commitHash', 'packageHash', 'bundleHash', 'expectedHash', 'expectedHashes', 'fixtureHashes', 'browserRevision', 'platform', 'nodeVersion', 'startedAt', 'endedAt', 'initialStatus', 'finalStatus'];
  if (!exactKeys(metadata, keys) || metadata.schemaVersion !== 1 || metadata.command !== 'pnpm --filter dogfood run lab:v0.5' || typeof metadata.releaseMode !== 'boolean' || typeof metadata.runId !== 'string' || !metadata.runId) fail('run metadata shape');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const bundle = await readFile(bundlePath);
  if (metadata.commitHash !== head || !/^[a-f0-9]{40}$/.test(metadata.commitHash) || metadata.bundleHash !== sha256(bundle) || metadata.packageHash !== sha256(Buffer.concat([await readFile(packagePath), bundle]))) fail('run build metadata');
  if (metadata.expectedHash !== sha256(await readFile(truthPath))) fail('run expected hash');
  if (!exactKeys(metadata.expectedHashes, truth.expectedSources) || !exactKeys(metadata.fixtureHashes, truth.fixtureSources)) fail('run source hash keys');
  for (const name of truth.expectedSources) if (metadata.expectedHashes[name] !== sha256(await readFile(path.join(root, name)))) fail(`expected source hash:${name}`);
  for (const name of truth.fixtureSources) if (metadata.fixtureHashes[name] !== sha256(await readFile(path.join(root, name)))) fail(`fixture source hash:${name}`);
  if (metadata.browserRevision !== installedChromeRevision() || typeof metadata.nodeVersion !== 'string' || metadata.platform !== process.platform) fail('run environment');
  const start = Date.parse(metadata.startedAt); const end = Date.parse(metadata.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 2 * 60 * 60 * 1000) fail('run timestamps');
  if (end > Date.now() + 5 * 60 * 1000 || Date.now() - end > 2 * 60 * 60 * 1000) fail('run freshness');
  if (metadata.initialStatus !== metadata.finalStatus || metadata.finalStatus !== currentStatus) fail('run worktree state');
}

async function validateEvidenceTimes(directory, names, metadata) {
  const start = Date.parse(metadata.startedAt) - 2000;
  const end = Date.parse(metadata.endedAt) + 2000;
  for (const name of names) {
    const modified = (await stat(path.join(directory, name))).mtimeMs;
    if (modified < start || modified > end) fail(`evidence file time:${name}`);
  }
}

function validateRunLinks(links, runId, present) {
  if (!exactKeys(links, ['schemaVersion', 'runId', 'files', 'groups']) || links.schemaVersion !== 1 || links.runId !== runId || !Array.isArray(links.files) || !exactKeys(links.groups, Object.keys(producerByGroup))) fail('run links shape');
  const expected = present.filter(name => !['run-links.json', 'evidence-sha256.txt'].includes(name)).sort();
  if (stable(links.files) !== stable(expected)) fail('run links coverage');
  for (const group of Object.keys(producerByGroup)) if (links.groups[group] !== `provenance/${group}.json`) fail(`run link group:${group}`);
}

function validateVerificationOutput(text, releaseMode) {
  const expectedCommands = verificationCommandsFor(releaseMode);
  const records = text.trimEnd().split(/(?=^COMMAND: )/m).filter(Boolean);
  if (records.length !== expectedCommands.length) fail('verification record count');
  for (const [index, record] of records.entries()) {
    const lines = record.split('\n');
    if (lines[0] !== `COMMAND: ${expectedCommands[index]}` || lines[1] !== 'EXIT: 0') fail(`verification record:${expectedCommands[index]}`);
    const attempts = Number(/^ATTEMPTS: ([1-9]\d*)$/.exec(lines[2])?.[1]);
    const prior = [...record.matchAll(/^ATTEMPT (\d+) EXIT: (-?\d+)$/gm)];
    const stdout = [...record.matchAll(/^STDOUT:$/gm)];
    const stderr = [...record.matchAll(/^STDERR:$/gm)];
    if (!Number.isInteger(attempts) || prior.length !== attempts - 1 || stdout.length !== attempts || stderr.length !== attempts) fail(`verification attempt shape:${verificationCommands[index]}`);
    for (const [attemptIndex, match] of prior.entries()) if (Number(match[1]) !== attemptIndex + 1 || Number(match[2]) === 0) fail(`verification attempt history:${verificationCommands[index]}`);
    if (record.lastIndexOf('\nSTDOUT:') > record.lastIndexOf('\nSTDERR:')) fail(`verification output order:${verificationCommands[index]}`);
  }
}

function validateCollectorRuns(value, metadata) {
  if (!exactKeys(value, ['schemaVersion', 'runId', 'runs']) || value.schemaVersion !== 1 || value.runId !== metadata.runId || !Array.isArray(value.runs)) fail('collector runs shape');
  const expected = ['pnpm --filter dogfood run lab:v0.5:test', ...verificationCommandsFor(metadata.releaseMode), browserCollectorCommand];
  if (stable(value.runs.map(run => run.command)) !== stable(expected)) fail('collector command order');
  for (const run of value.runs) {
    if (!exactKeys(run, ['runId', 'command', 'startedAt', 'endedAt', 'exitCode']) || run.runId !== metadata.runId || run.exitCode !== 0) fail('collector run');
    const start = Date.parse(run.startedAt); const end = Date.parse(run.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < Date.parse(metadata.startedAt) || end < start || end > Date.parse(metadata.endedAt)) fail('collector run time');
  }
}

async function validateProvenance(directory, metadata, collectorRuns, present) {
  const result = new Map();
  for (const [group, producer] of Object.entries(producerByGroup)) {
    const value = await readJson(path.join(directory, `provenance/${group}.json`));
    if (!exactKeys(value, ['schemaVersion', 'runId', 'group', 'producer', 'startedAt', 'endedAt']) || value.schemaVersion !== 1 || value.runId !== metadata.runId || value.group !== group || value.producer !== producer) fail(`provenance shape:${group}`);
    const run = collectorRuns.runs.find(item => item.command === producer);
    if (!run || value.startedAt !== run.startedAt || value.endedAt !== run.endedAt || !insideRun(value.startedAt, value.endedAt, metadata)) fail(`provenance run:${group}`);
    result.set(group, value);
  }
  for (const name of present.filter(item => item.startsWith('raw/'))) if (!result.has(name.split('/')[1])) fail(`raw provenance:${name}`);
  return result;
}

export function validateManifest(lines, names, bytesByName) {
  if (!Array.isArray(lines) || lines.length !== names.length) fail('manifest count');
  const expected = new Set(names);
  const seen = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || !safeArtifactPath(match[2]) || !expected.has(match[2]) || seen.has(match[2])) fail('manifest shape');
    if (bytesByName && match[1] !== sha256(bytesByName.get(match[2]))) fail(`manifest hash:${match[2]}`);
    seen.add(match[2]);
  }
  if (seen.size !== expected.size) fail('manifest coverage');
  return true;
}

export async function checkEvidence(directory, options = {}) {
  const truth = await readJson(truthPath);
  const present = await walk(directory);
  const declared = expectedFiles(truth);
  if (stable(present) !== stable(declared)) fail('file set');
  for (const name of present) {
    const stat = await lstat(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`unsafe file:${name}`);
  }
  const copiedTruth = await readJson(path.join(directory, 'expected.json'));
  if (stable(copiedTruth) !== stable(truth)) fail('expected copy');
  const [matrix, metadata, diagnostics, collectorRuns, runLinks] = await Promise.all(['matrix.json', 'run-metadata.json', 'diagnostics.json', 'collector-runs.json', 'run-links.json'].map(name => readJson(path.join(directory, name))));
  const currentStatus = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  await validateMetadata(metadata, truth, currentStatus);
  await validateEvidenceTimes(directory, present, metadata);
  validateCollectorRuns(collectorRuns, metadata);
  validateRunLinks(runLinks, metadata.runId, present);
  const provenance = await validateProvenance(directory, metadata, collectorRuns, present);

  await checkCommandDirectory(path.join(directory, 'raw/command'), metadata, provenance.get('command'));
  await checkCallsiteDirectory(path.join(directory, 'raw/callsite'), provenance.get('callsite'));
  await checkFixedLimitEvidence(path.join(directory, 'raw/limits'));
  if ((await readJson(path.join(directory, 'raw/limits/run-metadata.json'))).runId !== metadata.runId) fail('fixed-limit run id');
  checkOverlayComparisonEvidence(path.join(directory, 'raw/overlay'));
  for (const name of ['raw-baseline-session.json', 'raw-comparable-candidate-session.json', 'raw-incomparable-candidate-session.json']) {
    const artifact = await readJson(path.join(directory, 'raw/overlay', name));
    if (!insideRun(artifact.startedAt, artifact.endedAt, provenance.get('overlay'))) fail(`overlay artifact time:${name}`);
  }
  for (const name of ['copied-comparable-comparison.json', 'copied-incomparable-comparison.json']) {
    const artifact = await readJson(path.join(directory, 'raw/overlay', name));
    const created = Date.parse(artifact.createdAt);
    if (!Number.isFinite(created) || created < Date.parse(provenance.get('overlay').startedAt) || created > Date.parse(provenance.get('overlay').endedAt)) fail(`overlay comparison time:${name}`);
  }
  const browserExecution = await readJson(path.join(directory, 'raw/comparison/browser-execution.json'));
  if (!exactKeys(browserExecution, ['schemaVersion', 'runId', 'startedAt', 'endedAt', 'browserRevision', 'rowIds', 'publicApi']) || browserExecution.schemaVersion !== 1 || browserExecution.runId !== metadata.runId || browserExecution.startedAt !== provenance.get('comparison').startedAt || browserExecution.endedAt !== provenance.get('comparison').endedAt || browserExecution.browserRevision !== metadata.browserRevision || stable(browserExecution.rowIds) !== stable(expectedMatrix.rows.map(row => row.id)) || browserExecution.publicApi !== 'window.__CANVAS_SCAN__.compareSessions') fail('comparison browser execution');
  const copiedComparisonTruth = await readJson(path.join(directory, 'raw/comparison/expected-results.json'));
  const comparisonResults = await readJson(path.join(directory, 'raw/comparison/actual-results.json'));
  if (stable(copiedComparisonTruth) !== stable(expectedMatrix) || !Array.isArray(comparisonResults) || comparisonResults.length !== expectedMatrix.rows.length) fail('comparison copied results');
  for (const [index, row] of expectedMatrix.rows.entries()) if (stable(comparisonResults[index]) !== stable(await readJson(path.join(directory, `raw/comparison/artifacts/${row.id}.json`)))) fail(`comparison actual result:${row.id}`);

  await checkEvidenceObject({ matrix, metadata, diagnostics }, truth, directory);
  for (const required of truth.requiredEvidenceFiles) if (!present.includes(required)) fail(`required evidence:${required}`);
  const screenshot = await readFile(path.join(directory, 'raw/integrated/comparison.png'));
  if (screenshot.length < 1000 || !screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('integrated screenshot');
  const interaction = await readJson(path.join(directory, 'raw/integrated/interaction-state.json'));
  if (!exactKeys(interaction, ['schemaVersion', 'runId', 'startedAt', 'endedAt', 'baselineSelected', 'structuralChangeApplied', 'candidateSelected', 'baselineFindingIndex', 'candidateFindingIndex', 'comparisonCount', 'exported']) || interaction.schemaVersion !== 1 || interaction.runId !== metadata.runId || interaction.startedAt !== provenance.get('integrated').startedAt || interaction.endedAt !== provenance.get('integrated').endedAt || interaction.baselineSelected !== true || interaction.structuralChangeApplied !== true || interaction.candidateSelected !== true || interaction.comparisonCount !== 1 || interaction.exported !== true) fail('integrated interaction state');
  if (interaction.baselineFindingIndex !== matrix.at(-1)?.facts?.baselineFindingIndex || interaction.candidateFindingIndex !== matrix.at(-1)?.facts?.candidateFindingIndex) fail('integrated selected state');
  for (const name of ['baseline-session.json', 'explanation.json', 'candidate-session.json']) {
    const artifact = await readJson(path.join(directory, 'raw/integrated', name));
    if (!insideRun(artifact.startedAt, artifact.endedAt, provenance.get('integrated'))) fail(`integrated artifact time:${name}`);
  }

  const expectedCopies = new Set(['expected.json', 'raw/callsite/expected.json', 'raw/limits/expected.json']);
  for (const name of present.filter(name => /\.(?:json|txt)$/.test(name) && !expectedCopies.has(name))) {
    const text = await readFile(path.join(directory, name), 'utf8');
    const leak = scanPrivateEvidence(text, truth.privacySeeds);
    if (leak) fail(`private evidence:${name}`);
    if (claim(text, truth.forbiddenClaims, name)) fail(`unsupported claim:${name}`);
  }
  const checkerOutput = await readFile(path.join(directory, 'checker-output.txt'), 'utf8');
  if (options.allowPendingCheckerOutput ? checkerOutput !== 'PENDING\n' : checkerOutput !== 'CANVAS_LAB_V05: PASS\n') fail('checker output');
  const mutationOutput = await readFile(path.join(directory, 'mutation-test-output.txt'), 'utf8');
  if (!mutationOutput.startsWith('COMMAND: pnpm --filter dogfood run lab:v0.5:test\nEXIT: 0\n') || !/[#ℹ] fail 0/.test(mutationOutput)) fail('mutation output');
  const diskMutationLine = `CANVAS_LAB_V05_DISK_MUTATIONS: PASS ${diskMutationNames.join(',')}`;
  if (!options.allowPendingMutations && !mutationOutput.includes(diskMutationLine)) fail('disk mutation output');
  const verificationOutput = await readFile(path.join(directory, 'verification-output.txt'), 'utf8');
  validateVerificationOutput(verificationOutput, metadata.releaseMode);

  const manifestNames = present.filter(name => name !== 'evidence-sha256.txt').sort();
  const manifest = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim().split('\n').filter(Boolean);
  const bytes = new Map(await Promise.all(manifestNames.map(async name => [name, await readFile(path.join(directory, name))])));
  validateManifest(manifest, manifestNames, bytes);
  return true;
}
