import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = '/private/tmp';
const gatePath = `${tmp}/sidproj-56-release-gate.json`;
const consolePath = `${tmp}/sidproj-56-release-console.txt`;
const shaPath = `${tmp}/sidproj-56-release-sha256.txt`;
const probeSummaryPath = `${tmp}/sidproj-56-probe-summary.json`;
const judgePath = `${tmp}/sidproj-56-judge.txt`;
const packPath = `${tmp}/sidproj-56-pack-summary.json`;
const manualReleasePath = `${tmp}/sidproj-56-manual-release-test.json`;
const labPath = `${tmp}/sidproj-55-canvas-lab-v0.4.json`;
const mutationPath = `${tmp}/sidproj-55-mutation-output.txt`;
const reportPath = path.join(root, 'docs/releases/v0.4-report.md');
const baselineCommit = '4d6d700c2982be7e06eb827f5bb9996a98995f6e';
const maxAgeMs = 24 * 60 * 60 * 1000;
const absoluteThresholds = {
  fullAddedMeanMs: 2,
  fullAddedP95Ms: 3,
  countOnlyAddedMeanMs: 0.75,
  countOnlyAddedP95Ms: 2,
};
const pairedThresholds = { fullAddedMeanMs: 0.25, fullAddedP95Ms: 0.5 };

export const PROBES = ['probe:reset', 'probe:recording', 'probe:burst-heavy', 'probe:continuous-repeated', 'probe:resize-churn', 'probe:backing-store', 'probe:lifecycle', 'probe:associations', 'probe:findings'];
export const PROBE_PATHS = {
  'probe:reset': `${tmp}/sidproj-56-reset-probe.json`,
  'probe:recording': `${tmp}/sidproj-47-recording-probe.json`,
  'probe:burst-heavy': `${tmp}/sidproj-51-burst-comparison.json`,
  'probe:continuous-repeated': `${tmp}/sidproj-49-continuous-comparison.json`,
  'probe:resize-churn': `${tmp}/sidproj-48-comparison.json`,
  'probe:backing-store': `${tmp}/sidproj-50-comparison.json`,
  'probe:lifecycle': `${tmp}/sidproj-52-browser-result.json`,
  'probe:associations': `${tmp}/sidproj-53-associations-probe.json`,
  'probe:findings': `${tmp}/sidproj-54-chrome-probe.json`,
};
export const REQUIRED_COMMANDS = [
  ['pnpm', ['-r', 'run', 'typecheck']],
  ['pnpm', ['--filter', 'canvas-scan', 'run', 'test']],
  ['pnpm', ['--filter', 'canvas-scan', 'run', 'build']],
  ['pnpm', ['--filter', 'demo', 'run', 'build']],
  ['pnpm', ['--filter', 'dogfood', 'run', 'lab:v0.4']],
  ['pnpm', ['--filter', 'dogfood', 'run', 'bench:chrome']],
  ['node', ['scripts/verify-pack.mjs']],
  ['git', ['diff', '--check']],
  ['pnpm', ['--filter', 'dogfood', 'run', 'probe:v0.4']],
];
const labCheckCommand = ['pnpm', ['--filter', 'dogfood', 'run', 'lab:v0.4:check']];
const mutationCommand = ['pnpm', ['--filter', 'dogfood', 'run', 'lab:v0.4', '--', '--mutation=heavy-burst-seed-off']];

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const commandText = ([bin, args]) => [bin, ...args].join(' ');
export const isAllowedEvidencePath = (file) => typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file && /^\/private\/tmp\/sidproj-(?:47|48|49|50|51|52|53|54|55|56)-[A-Za-z0-9_.-]+$/.test(file);

const text = (file) => readFileSync(file, 'utf8');
const json = (file) => JSON.parse(text(file));
const hashFile = (file) => sha256(readFileSync(file));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
const output = (result = {}) => `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const regularFile = (file) => {
  if (!isAllowedEvidencePath(file)) throw new Error(`unapproved evidence path: ${file}`);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`unsafe evidence file: ${file}`);
  return info;
};
const environmentText = (value) => /(?:Executable doesn't exist.*chrome|Chrome unavailable|browserType\.launch|listen EPERM|EADDRINUSE|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ERR_NETWORK|NetworkError|network (?:request )?failed|Could not resolve|npm[^\n]*(?:cache|EPERM|EACCES|exit 255)|server did not (?:start|answer))/i.test(value);

export function classifyCommand(result) {
  if (result.exitCode === 0) return 'PASS';
  return environmentText(output(result)) ? 'ENVIRONMENT_LIMIT' : 'FAIL';
}

const candidateFiles = () => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((file) => !file.startsWith('.codex/') && file !== 'docs/releases/v0.4-report.md')
  .sort();

export function candidateManifest(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function candidateIdentity() {
  const files = candidateFiles();
  const statusEntries = git(['status', '--porcelain']).split('\n').filter(Boolean);
  const read = (file) => existsSync(path.join(root, file)) ? hashFile(path.join(root, file)) : null;
  return {
    version: JSON.parse(text(path.join(root, 'packages/core/package.json'))).version,
    baseGitSha: git(['rev-parse', 'HEAD']),
    dirty: statusEntries.length > 0,
    statusEntries,
    iifeSha256: read('packages/core/dist/canvas-scan.iife.js'),
    esmSha256: read('packages/core/dist/index.js'),
    tarballSha256: null,
    publicReadmeSha256: { root: read('README.md'), package: read('packages/core/README.md') },
    releaseHarnessSha256: read('packages/dogfood/release-v04.mjs'),
    benchmarkHarnessSha256: read('packages/dogfood/bench-chrome.mjs'),
    pairedBenchmarkHarnessSha256: read('packages/dogfood/bench-chrome-interleaved.mjs'),
    candidateInputCount: files.length,
    candidateManifestSha256: candidateManifest(files),
  };
}

export function checkCandidate(candidate, expected) {
  const failures = [];
  if (candidate?.version !== '0.4.0') failures.push('candidate version is not 0.4.0');
  for (const key of ['baseGitSha', 'iifeSha256', 'esmSha256', 'candidateManifestSha256', 'releaseHarnessSha256', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`candidate ${key} mismatch`);
  }
  if (!same(candidate?.publicReadmeSha256, expected?.publicReadmeSha256)) failures.push('candidate README hashes mismatch');
  if (expected?.tarballSha256 && candidate?.tarballSha256 !== expected.tarballSha256) failures.push('candidate tarball hash mismatch');
  return failures;
}

const checkAbsoluteArtifact = (artifact, candidate, requirePass) => {
  const failures = [];
  if (artifact?.schemaVersion !== 1) failures.push('absolute benchmark schema mismatch');
  if (!['mixed', 'tracked-source'].includes(artifact?.stream)) failures.push('absolute benchmark stream mismatch');
  if (!same(artifact?.thresholds, absoluteThresholds)) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} thresholds changed`);
  if (artifact?.git?.sha !== candidate?.baseGitSha) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} Git SHA mismatch`);
  if (artifact?.bundleSha256 !== candidate?.iifeSha256) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} bundle hash mismatch`);
  if (artifact?.harnessSha256 !== candidate?.benchmarkHarnessSha256) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} harness hash mismatch`);
  if (!artifact?.browserVersion || !artifact?.hardware?.cpu || !Number.isInteger(artifact?.hardware?.cores)) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} environment is incomplete`);
  if (artifact?.raw?.length !== 5 || artifact?.perBlock?.length !== 5) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} needs five complete blocks`);
  for (const key of Object.keys(absoluteThresholds)) if (!Number.isFinite(artifact?.gates?.[key])) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} missing ${key}`);
  if (requirePass && (artifact?.gates?.pass !== true || artifact?.failures?.length)) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} failed`);
  if (requirePass) for (const [key, limit] of Object.entries(absoluteThresholds)) if (!(artifact?.gates?.[key] < limit)) failures.push(`absolute benchmark ${artifact?.stream ?? 'unknown'} ${key} exceeds its strict limit`);
  return failures;
};

export function checkAbsoluteBenchmarks(artifacts, candidate) {
  if (!Array.isArray(artifacts) || artifacts.length !== 2) return ['absolute mode needs exactly two benchmark artifacts'];
  const failures = artifacts.flatMap((artifact) => checkAbsoluteArtifact(artifact, candidate, true));
  const streams = new Set(artifacts.map((artifact) => artifact.stream));
  if (!streams.has('mixed') || !streams.has('tracked-source') || streams.size !== 2) failures.push('absolute benchmarks need one mixed and one tracked-source stream');
  return failures;
}

export function checkPairedBenchmark(artifact, reason, absoluteAttempts = [], candidate) {
  const failures = [];
  if (!reason || !reason.trim()) failures.push('paired mode needs a stable-host reproduction reason');
  if (absoluteAttempts.length !== 1) failures.push('paired mode needs exactly one recorded authoritative absolute attempt');
  const attempt = absoluteAttempts[0];
  if (attempt?.status !== 'FAIL' || attempt?.artifacts?.length !== 2) failures.push('paired mode needs a recorded failed absolute attempt with two artifacts');
  else {
    failures.push(...attempt.artifacts.flatMap((item) => checkAbsoluteArtifact(item, candidate, false)));
    if (attempt.artifacts.every((item) => item?.gates?.pass === true && !item?.failures?.length)) failures.push('recorded absolute attempt did not fail timing');
  }
  if (artifact?.baselineCommit !== baselineCommit) failures.push('paired benchmark baseline mismatch');
  if (artifact?.activeHead !== candidate?.baseGitSha) failures.push('paired benchmark Git SHA mismatch');
  if (artifact?.hashes?.candidateBundleSha256 !== candidate?.iifeSha256 || artifact?.inputs?.candidateExpectedBundleSha256 !== candidate?.iifeSha256) failures.push('paired benchmark candidate hash mismatch');
  if (artifact?.hashes?.harnessSha256 !== candidate?.pairedBenchmarkHarnessSha256) failures.push('paired benchmark harness hash mismatch');
  if (!same(artifact?.thresholds, { absolute: absoluteThresholds, pairedFullCapture: pairedThresholds })) failures.push('paired benchmark thresholds changed');
  if (artifact?.status !== 'COMPLETE' || artifact?.verdict?.pass !== true || artifact?.errors?.length) failures.push('paired benchmark did not pass');
  for (const stream of ['mixed', 'tracked-source']) {
    const value = artifact?.streams?.[stream];
    if (!value || value.pairs?.length !== 6 || value.status !== 'COMPLETE' || value.verdict?.pass !== true) failures.push(`paired ${stream} stream is incomplete or failed`);
    for (const [key, limit] of Object.entries(pairedThresholds)) if (!(value?.pairedGateValues?.[key] <= limit)) failures.push(`paired ${stream} ${key} exceeds the approved limit`);
    for (const key of ['countOnlyAddedMeanMs', 'countOnlyAddedP95Ms']) if (value?.absoluteGates?.candidate?.passes?.[key] !== true) failures.push(`paired ${stream} candidate ${key} absolute gate failed`);
  }
  return failures;
}

export function checkLab(lab, candidate, consoleText = '') {
  const failures = [];
  if (lab?.pass !== true || lab?.scenarios?.length !== 53 || !lab.scenarios.every((row) => row.pass === true)) failures.push('lab did not record 53 passing rows');
  if (lab?.product?.version !== '0.4.0' || lab?.product?.bundleSha256 !== candidate?.iifeSha256) failures.push('lab candidate identity mismatch');
  if (lab?.gitSha !== candidate?.baseGitSha) failures.push('lab Git SHA mismatch');
  if (Object.values(lab?.diagnostics ?? {}).some((value) => !Array.isArray(value) || value.length > 0)) failures.push('lab recorded browser diagnostics');
  if (!/^CANVAS_LAB_V04: PASS$/m.test(consoleText)) failures.push('lab PASS line is missing');
  return failures;
}

export function checkMutation(mutation, lab, command) {
  const failures = [];
  if (command?.status !== 'PASS') failures.push('lab mutation command did not produce the expected failure');
  if (mutation?.parentRunId !== lab?.runId || mutation?.missing !== 'heavy-canvas-work' || !mutation?.mutationRunId) failures.push('lab mutation evidence mismatch');
  const started = Date.parse(mutation?.startedAt); const ended = Date.parse(mutation?.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || started > ended || started < Date.parse(lab?.endedAt)) failures.push('lab mutation timestamps are invalid');
  return failures;
}

export function checkProbes(results, candidate) {
  const failures = [];
  for (const probe of PROBES) {
    const result = results?.[probe];
    if (result?.status !== 'PASS') failures.push(`${probe} did not pass`);
    if (result?.gitSha !== candidate?.baseGitSha) failures.push(`${probe} Git SHA mismatch`);
    const bundle = result?.bundleSha256 ?? result?.bundleHash;
    if (bundle && bundle !== candidate?.iifeSha256) failures.push(`${probe} bundle hash mismatch`);
  }
  return failures;
}

export function checkPack(pack, candidate, allowEnvironment = false) {
  const failures = [];
  if (!pack || pack.packageVersion !== '0.4.0') return ['package summary is missing or has the wrong version'];
  if (pack.finalStatus !== 'PASS' && !allowEnvironment) failures.push('package contract failed');
  if (pack.baseGitSha !== candidate?.baseGitSha) failures.push('package Git SHA mismatch');
  if (pack.iifeSha256 !== candidate?.iifeSha256) failures.push('package IIFE hash mismatch');
  if (pack.esmSha256 !== candidate?.esmSha256) failures.push('package ESM hash mismatch');
  if (!pack.tarballSha256 || pack.tarballSha256 !== candidate?.tarballSha256) failures.push('package tarball hash mismatch');
  if (pack.packageManifestVersion !== '0.4.0') failures.push('packed manifest version mismatch');
  if (!pack.manualReleaseTestSha256) failures.push('manual release test hash is missing from package evidence');
  if (pack.publicContract !== 'PASS' || pack.labBoundary !== 'PASS') failures.push('package public or lab-boundary contract failed');
  if (!allowEnvironment && pack.fixtureResults?.some((item) => item.status !== 'PASS')) failures.push('clean-consumer package fixture failed');
  return failures;
}

export function checkManualRelease(manual, candidate) {
  const failures = [];
  if (manual?.status !== 'PASS' || manual?.failures?.length) failures.push('manual release test did not pass');
  if (manual?.startedFromExactTarball !== true || manual?.tarballSha256 !== candidate?.tarballSha256) failures.push('manual release tarball identity mismatch');
  if (manual?.iifeSha256 !== candidate?.iifeSha256 || manual?.gitSha !== candidate?.baseGitSha || manual?.expectedGitSha !== candidate?.baseGitSha || manual?.packageVersion !== '0.4.0') failures.push('manual release candidate identity mismatch');
  if (!manual?.browserVersion || !manual?.checks || Object.values(manual.checks).some((value) => value !== true)) failures.push('manual release checks are incomplete');
  const continuous = manual?.sessions?.continuous;
  const burst = manual?.sessions?.burst;
  if (continuous?.stopReason !== 'manual' || !continuous?.windows?.length || !continuous?.findings?.some((finding) => finding.type === 'repeated-draw-work')) failures.push('manual continuous workflow is incomplete');
  if (burst?.stopReason !== 'manual' || !burst?.windows?.length || !burst?.findings?.some((finding) => finding.type === 'heavy-canvas-work')) failures.push('manual burst workflow is incomplete');
  return failures;
}

export function checkDocuments(documents) {
  return documents?.pass === true ? [] : [`public document contract failed${documents?.missing?.length ? `: ${documents.missing.join(', ')}` : ''}`];
}

export function evaluateRelease({ candidate, expectedCandidate = candidate, commands = [], lab, labConsole = '', labCheckConsole = '', mutation, mutationResult, probes, pack, manual, documents, benchmarkMode = 'absolute', benchmarks = [], pairedArtifact, stableHostReason, absoluteAttempts = [], judgeState = 'PENDING', now = Date.now(), evidence = [] }) {
  const productFailures = [...checkCandidate(candidate, expectedCandidate)];
  const environmentLimits = [];
  const status = (suffix) => commands.find((item) => item.command.endsWith(suffix))?.status;
  for (const command of commands) {
    if (benchmarkMode === 'paired-v0.3.1' && command.command.endsWith('bench:chrome')) continue;
    if (command.status === 'ENVIRONMENT_LIMIT') environmentLimits.push(`${command.command}: ${command.environmentError ?? 'environment limit'}`);
    else if (command.status !== 'PASS') productFailures.push(`${command.command}: failed`);
  }
  if (status('lab:v0.4') !== 'ENVIRONMENT_LIMIT') {
    productFailures.push(...checkLab(lab, candidate, labConsole));
    for (const line of ['CANVAS_LAB_V04_NEAREST_NEGATIVES: PASS', 'CANVAS_LAB_V04_VARIANTS: PASS', 'CANVAS_LAB_V04_MANIFEST: PASS']) if (!labCheckConsole.includes(line)) productFailures.push(`lab check line is missing: ${line}`);
    productFailures.push(...checkMutation(mutation, lab, mutationResult));
  }
  if (status('probe:v0.4') !== 'ENVIRONMENT_LIMIT') productFailures.push(...checkProbes(probes, candidate));
  const packEnvironment = status('scripts/verify-pack.mjs') === 'ENVIRONMENT_LIMIT';
  productFailures.push(...checkPack(pack, candidate, packEnvironment));
  productFailures.push(...checkManualRelease(manual, candidate));
  productFailures.push(...checkDocuments(documents));
  if (benchmarkMode === 'paired-v0.3.1') productFailures.push(...checkPairedBenchmark(pairedArtifact, stableHostReason, absoluteAttempts, candidate));
  else if (benchmarkMode === 'absolute' && status('bench:chrome') !== 'ENVIRONMENT_LIMIT') productFailures.push(...checkAbsoluteBenchmarks(benchmarks, candidate));
  else if (benchmarkMode !== 'absolute') productFailures.push('unknown benchmark mode');
  for (const item of evidence) {
    if (!isAllowedEvidencePath(item.path) || item.stale || item.hashMismatch) productFailures.push(`invalid evidence: ${item.path}`);
    if (item.endedAt && now - Date.parse(item.endedAt) > maxAgeMs) productFailures.push(`stale evidence: ${item.path}`);
  }
  if (!['PENDING', 'FAIL', 'PASS'].includes(judgeState)) productFailures.push('invalid judge state');
  const uniqueProductFailures = [...new Set(productFailures)];
  const uniqueEnvironmentLimits = [...new Set(environmentLimits)];
  const mechanicalPass = uniqueProductFailures.length === 0 && uniqueEnvironmentLimits.length === 0;
  return { productFailures: uniqueProductFailures, environmentLimits: uniqueEnvironmentLimits, mechanicalPass, pass: mechanicalPass && judgeState === 'PASS' };
}

const run = ([bin, args]) => {
  const startedAt = new Date().toISOString();
  const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const record = { command: commandText([bin, args]), startedAt, endedAt: new Date().toISOString(), exitCode: result.status, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}${result.error ? `${result.error.message}\n` : ''}` };
  record.status = classifyCommand(record);
  if (record.status === 'ENVIRONMENT_LIMIT') record.environmentError = output(record);
  return record;
};

const runMutation = () => {
  const result = run(mutationCommand);
  const lines = output(result).split('\n').filter((line) => line.includes('CANVAS_LAB_V04'));
  if (result.exitCode === 1 && same(lines, ['CANVAS_LAB_V04_MUTATION: EXPECTED FAIL missing heavy-canvas-work'])) result.status = 'PASS';
  else if (environmentText(output(result))) { result.status = 'ENVIRONMENT_LIMIT'; result.environmentError = output(result); }
  else result.status = 'FAIL';
  return result;
};

const probeResults = () => Object.fromEntries(PROBES.map((probe) => [probe, existsSync(PROBE_PATHS[probe]) ? json(PROBE_PATHS[probe]) : { status: 'MISSING' }]));
const parseMutation = () => existsSync(mutationPath) ? Object.fromEntries(text(mutationPath).trim().split('\n').map((line) => line.split('=', 2))) : null;
const normalizeDocumentText = (value) => value.replace(/\s+/g, ' ').toLowerCase();

export const checkPublicDocuments = (rootReadme, packageReadme) => {
  const normalizedPackage = packageReadme.replace(/^<!-- This README is packed with the canvas-scan package\. -->\n\n/, '');
  const required = ['canvas-scan@0.4.0', 'release candidate', 'not published on npm', 'main-thread Canvas2D', 'React owner data is optional attribution', "import 'canvas-scan/auto'", 'startRecording', 'stopRecording', 'getLastSession', 'mark', 'InvestigationSessionV1', 'schemaVersion', 'dropped-entry counts', 'heavy-canvas-work', 'repeated-draw-work', 'resize-churn', 'backing-store-mismatch', 'measured', 'associated', 'candidate', 'claimBoundary', 'nextCheck', 'worker and transferred canvases', 'wasted work', 'pixel identity', 'does not prove causality', '<2ms', '<3ms', '<0.75ms'];
  const normalizedRoot = normalizeDocumentText(rootReadme);
  const normalizedPackageText = normalizeDocumentText(packageReadme);
  const missing = required.filter((value) => {
    const phrase = normalizeDocumentText(value);
    return !normalizedRoot.includes(phrase) || !normalizedPackageText.includes(phrase);
  });
  if (rootReadme.trim() !== normalizedPackage.trim()) missing.push('README semantic equality');
  if (!(rootReadme.indexOf('npm install -D canvas-scan') < rootReadme.indexOf('npx canvas-scan init --write') && rootReadme.indexOf('npx canvas-scan init --write') < rootReadme.indexOf("import 'canvas-scan/auto'"))) missing.push('installation and early-load order');
  return { pass: missing.length === 0, missing, rootSha256: sha256(rootReadme), packageSha256: sha256(packageReadme) };
};
const documentCheck = () => checkPublicDocuments(text(path.join(root, 'README.md')), text(path.join(root, 'packages/core/README.md')));
const artifactRecord = (file) => {
  const info = regularFile(file);
  let endedAt;
  if (file.endsWith('.json')) { try { endedAt = json(file).endedAt ?? json(file).when; } catch {} }
  return { path: file, sha256: hashFile(file), stale: Date.now() - info.mtimeMs > maxAgeMs, endedAt };
};
const benchmarkArtifacts = (command) => [...output(command).matchAll(/^BENCH_ARTIFACT: (\/private\/tmp\/[^\s]+)$/gm)].map((match) => { regularFile(match[1]); return json(match[1]); });
const benchmarkPaths = (command) => [...output(command).matchAll(/^BENCH_ARTIFACT: (\/private\/tmp\/[^\s]+)$/gm)].map((match) => match[1]);
const evidenceRecords = (files) => [...new Set(files)].filter((file) => existsSync(file)).map(artifactRecord);
const gateArchives = (gate) => [...(gate?.priorCandidateCycles ?? []), ...(gate?.environmentRetries ?? []), ...(gate?.judgeCorrections ?? []), ...(gate?.judgeCorrectionVerificationRetries ?? [])];
const archiveEvidencePaths = (gate) => gateArchives(gate).map((item) => item.archivePath);
const labEvidencePaths = [`${tmp}/sidproj-55-canvas-lab-v0.4.json`, `${tmp}/sidproj-55-variant-matrix.json`, `${tmp}/sidproj-55-nearest-negatives.json`, `${tmp}/sidproj-55-console-summary.txt`, `${tmp}/sidproj-55-integrated-continuous.png`, `${tmp}/sidproj-55-integrated-burst.png`, mutationPath, `${tmp}/sidproj-55-sha256.txt`];

const formatHash = (gate, file) => gate.evidence.find((item) => item.path === file)?.sha256 ?? 'MISSING';
const benchmarkReport = (gate) => {
  if (gate.benchmarkPolicy === 'absolute') return gate.benchmarkResults.map((item) => `- ${item.stream}: ${item.gates.pass ? 'PASS' : 'FAIL'}; full mean ${item.gates.fullAddedMeanMs} ms; full p95 ${item.gates.fullAddedP95Ms} ms; count mean ${item.gates.countOnlyAddedMeanMs} ms; count p95 ${item.gates.countOnlyAddedP95Ms} ms; Chrome ${item.browserVersion}; ${item.hardware.cpu} (${item.hardware.cores} cores).`).join('\n');
  const paired = gate.benchmarkResults[0];
  return `- Route: approved v0.3.1 paired fallback.\n- Stable-host reason: ${gate.stableHostReason}\n- Baseline: \`${paired?.baselineCommit}\`. Six pairs per stream.\n${['mixed', 'tracked-source'].map((stream) => `- ${stream}: full mean delta ${paired?.streams?.[stream]?.pairedGateValues?.fullAddedMeanMs} ms; full p95 delta ${paired?.streams?.[stream]?.pairedGateValues?.fullAddedP95Ms} ms; candidate count-only absolute PASS.`).join('\n')}\n- Failed absolute attempt artifacts: ${gate.absoluteAttempts[0]?.paths?.map((file) => `\`${file}\``).join(', ') ?? 'MISSING'}.`;
};
const writeReport = (gate, judge = '') => {
  const lab = gate.labResults;
  const manual = gate.manualReleaseResults;
  const bench = gate.benchmarkPolicy === 'absolute' ? gate.benchmarkResults[0] : gate.benchmarkResults[0];
  const judgeSection = gate.judgeState === 'PASS' ? `SHA-256: \`${gate.judgeSha256}\`.\n\n\`\`\`text\n${judge.trim()}\n\`\`\`` : gate.judgeState;
  const issues = Array.from({ length: 11 }, (_, index) => {
    const id = 46 + index;
    const status = id === 56 ? 'In Progress' : 'Done';
    const evidence = id === 56 ? gatePath : id === 46 ? 'Linear evidence; local files do not prove attachment state' : Object.values(PROBE_PATHS).find((file) => file.includes(`sidproj-${id}-`)) ?? (id === 55 ? labPath : 'See issue evidence');
    return `| SIDPROJ-${id} | ${status} | \`${evidence}\` |`;
  }).join('\n');
  writeFileSync(reportPath, `# canvas-scan@0.4.0 release report\n\nStatus: ${gate.finalStatus}. Mechanical status: ${gate.mechanicalStatus}. Gate: \`${gatePath}\`.\n\n## Candidate identity\n\n- Base Git SHA: \`${gate.candidate.baseGitSha}\`\n- Candidate manifest: \`${gate.candidate.candidateManifestSha256}\` (${gate.candidate.candidateInputCount} files)\n- Tarball SHA-256: \`${gate.candidate.tarballSha256}\`\n- IIFE SHA-256: \`${gate.candidate.iifeSha256}\`\n- ESM entry SHA-256: \`${gate.candidate.esmSha256}\`\n- Release harness SHA-256: \`${gate.candidate.releaseHarnessSha256}\`\n- Benchmark harness SHA-256: \`${gate.candidate.benchmarkHarnessSha256}\`\n- Browser: ${lab?.browser?.version ?? bench?.browserVersion ?? 'MISSING'}\n- Hardware: ${bench?.hardware?.cpu ?? bench?.environment?.hardware?.cpu ?? 'MISSING'} (${bench?.hardware?.cores ?? bench?.environment?.hardware?.cores ?? 'MISSING'} cores)\n\n## v0.4 issues\n\n| Issue | Live status | Evidence reference |\n| --- | --- | --- |\n${issues}\n\nLocal files do not prove Linear attachment success.\n\n## Commands and evidence\n\n| Command | Status | Evidence |\n| --- | --- | --- |\n${gate.commandResults.map((item) => `| \`${item.command}\` | ${item.status} | \`${consolePath}\` |`).join('\n')}\n| \`${gate.labCheckResult.command}\` | ${gate.labCheckResult.status} | \`${consolePath}\` |\n| \`${gate.mutationResult.command}\` | ${gate.mutationResult.status} | \`${mutationPath}\` |\n\n## Canvas Performance Lab\n\n- Run ID: \`${lab?.runId}\`; result: ${lab?.scenarios?.length}/53 ${lab?.pass ? 'PASS' : 'FAIL'}.\n- Nearest-negative, variant, and manifest checks: ${gate.labCheckResult.status}.\n- Mutation: ${gate.mutationResult.status}; missing \`${gate.mutationEvidence?.missing}\`.\n${labEvidencePaths.map((file) => `- \`${file}\`: \`${formatHash(gate, file)}\``).join('\n')}\n\n## Probes\n\n${PROBES.map((probe) => `- ${probe}: ${gate.probeResults[probe]?.status ?? 'MISSING'}; \`${PROBE_PATHS[probe]}\`; SHA-256 \`${formatHash(gate, PROBE_PATHS[probe])}\`.`).join('\n')}\n\n## Benchmark\n\n${benchmarkReport(gate)}\n\n## Pack and public documents\n\n- Pack: ${gate.packResults?.finalStatus ?? 'MISSING'}; tarball \`${gate.packResults?.tarballSha256}\`; IIFE \`${gate.packResults?.iifeSha256}\`; ESM \`${gate.packResults?.esmSha256}\`.\n- Clean consumers: ${(gate.packResults?.fixtureResults ?? []).map((item) => `${item.name} ${item.status}`).join('; ')}.\n- Public documents: ${gate.documentationResults?.pass ? 'PASS' : 'FAIL'}; root \`${gate.documentationResults?.rootSha256}\`; package \`${gate.documentationResults?.packageSha256}\`.\n\n## Product failures\n\n${gate.productFailures.length ? gate.productFailures.map((item) => `- ${item}`).join('\n') : 'None'}\n\n## Environment limits\n\n${gate.environmentLimits.length ? gate.environmentLimits.map((item) => `- ${item}`).join('\n') : 'None'}\n\n## Known limits\n\nThe product observes main-realm Canvas2D. Worker and transferred canvases remain outside its boundary. Browser features can be absent. Command signatures do not prove pixel identity. API self-time is synchronous. Temporal overlap does not prove causality. Retention is bounded. Sessions exclude page text, input values, pixels, and live objects.\n\n## Plan deviations\n\n${gate.planDeviations.length ? gate.planDeviations.map((item) => `- ${item}`).join('\n') : 'None'}\n\n## Independent judge\n\n${judgeSection}\n\n## Manual release test\n\n- Result: ${manual?.status ?? 'MISSING'}; exact tarball \`${manual?.tarballSha256 ?? 'MISSING'}\`; IIFE \`${manual?.iifeSha256 ?? 'MISSING'}\`; Chrome ${manual?.browserVersion ?? 'MISSING'}.\n- Continuous recording: ${manual?.checks?.continuousRecording ? 'PASS' : 'FAIL'}; repeated-draw finding and manual stop required.\n- Burst recording: ${manual?.checks?.burstRecording ? 'PASS' : 'FAIL'}; heavy-work finding and manual stop required.\n- Finding copy: ${manual?.checks?.usefulFindingCopy ? 'PASS' : 'FAIL'}; observation, boundary, and next check required.\n- Plain JSON and privacy boundary: ${manual?.checks?.plainJsonExport && manual?.checks?.privacyBoundary ? 'PASS' : 'FAIL'}.\n- Evidence: \`${manualReleasePath}\`; SHA-256 \`${formatHash(gate, manualReleasePath)}\`.\n\nThis test checks user usefulness and product feel. It does not replace the automated gate. This issue does not tag, publish, open a pull request, or start upstream work.\n`);
};

const consoleText = (gate) => [...gate.commandResults, gate.labCheckResult, gate.mutationResult].map((item) => `$ ${item.command}\n${item.stdout}${item.stderr}`).join('\n');
const writeReleaseArtifacts = (gate, judge = '') => {
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`);
  writeFileSync(probeSummaryPath, `${JSON.stringify({ schemaVersion: 1, candidate: gate.candidate, probes: gate.probeResults }, null, 2)}\n`);
  writeFileSync(consolePath, consoleText(gate));
  writeReport(gate, judge);
  writeFileSync(shaPath, `${hashFile(gatePath)}  ${gatePath}\n`);
};

const evaluationFromGate = (gate, judgeState) => {
  const labCommand = gate.commandResults.find((item) => item.command.endsWith('lab:v0.4'));
  return evaluateRelease({ candidate: gate.candidate, expectedCandidate: gate.candidate, commands: gate.commandResults, lab: gate.labResults, labConsole: output(labCommand), labCheckConsole: output(gate.labCheckResult), mutation: gate.mutationEvidence, mutationResult: gate.mutationResult, probes: gate.probeResults, pack: gate.packResults, manual: gate.manualReleaseResults, documents: gate.documentationResults, benchmarkMode: gate.benchmarkPolicy, benchmarks: gate.benchmarkPolicy === 'absolute' ? gate.benchmarkResults : [], pairedArtifact: gate.benchmarkPolicy === 'paired-v0.3.1' ? gate.benchmarkResults[0] : null, stableHostReason: gate.stableHostReason, absoluteAttempts: gate.absoluteAttempts, judgeState, evidence: gate.evidence });
};

export function checkSavedEvidence(gate, judge, requireFinal = true) {
  const failures = [];
  if (gate?.schemaVersion !== 1) return ['release gate schema mismatch'];
  try {
    for (const item of gate.evidence ?? []) {
      regularFile(item.path);
      if (item.sha256 !== hashFile(item.path)) failures.push(`changed evidence hash: ${item.path}`);
      if (Date.now() - lstatSync(item.path).mtimeMs > maxAgeMs) failures.push(`stale evidence: ${item.path}`);
    }
    for (const archive of gateArchives(gate)) {
      regularFile(archive.archivePath);
      if (archive.archiveSha256 !== hashFile(archive.archivePath)) failures.push(`changed archive hash: ${archive.archivePath}`);
      if (!gate.evidence?.some((item) => item.path === archive.archivePath)) failures.push(`archive is missing from current evidence: ${archive.archivePath}`);
    }
    for (const file of [gatePath, consolePath, shaPath, probeSummaryPath]) regularFile(file);
    if (text(shaPath).trim() !== `${hashFile(gatePath)}  ${gatePath}`) failures.push('release gate SHA-256 manifest mismatch');
    if (text(consolePath) !== consoleText(gate)) failures.push('release console does not match command evidence');
    const savedProbeSummary = json(probeSummaryPath);
    if (savedProbeSummary?.schemaVersion !== 1 || !same(savedProbeSummary?.candidate, gate.candidate) || !same(savedProbeSummary?.probes, gate.probeResults)) failures.push('probe summary does not match release evidence');
    const current = candidateIdentity(); current.tarballSha256 = gate.candidate?.tarballSha256 ?? null;
    failures.push(...checkCandidate(current, gate.candidate));
    const evaluation = evaluationFromGate(gate, requireFinal ? 'PASS' : gate.judgeState);
    failures.push(...evaluation.productFailures, ...evaluation.environmentLimits);
    if (!evaluation.mechanicalPass || gate.mechanicalStatus !== 'PASS') failures.push('mechanical release gate did not pass');
    if (requireFinal) {
      regularFile(judgePath);
      if (!/^VERDICT: PASS\b/m.test(judge)) failures.push('judge PASS is missing');
      if (gate.judgeState !== 'PASS' || gate.finalStatus !== 'PASS') failures.push('release gate is not finalized');
      if (gate.judgeSha256 !== hashFile(judgePath)) failures.push('judge hash mismatch');
      const report = text(reportPath);
      for (const value of ['Status: PASS.', gate.candidate.baseGitSha, gate.candidate.candidateManifestSha256, gate.candidate.tarballSha256, gate.candidate.iifeSha256, gate.candidate.esmSha256, gate.judgeSha256, judge.trim()]) if (!report.includes(value)) failures.push(`report is missing final evidence: ${String(value).slice(0, 80)}`);
    }
  } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  return [...new Set(failures)];
}

const buildGate = ({ candidate, commands, labCheckResult, mutationResult, benchmarkPolicy, benchmarkResults, absoluteAttempts, stableHostReason = null, evidence, planDeviations = [], correctionAttempts = [], pairedReplacementAttempts = [], priorCandidateCycles = [], environmentRetries = [], judgeCorrections = [], judgeCorrectionVerificationRetries = [] }) => {
  const labResults = existsSync(labPath) ? json(labPath) : null;
  const mutationEvidence = parseMutation();
  const probeData = probeResults();
  const packResults = existsSync(packPath) ? json(packPath) : null;
  const manualReleaseResults = existsSync(manualReleasePath) ? json(manualReleasePath) : null;
  const documentationResults = documentCheck();
  const labCommand = commands.find((item) => item.command.endsWith('lab:v0.4'));
  const evaluation = evaluateRelease({ candidate, expectedCandidate: candidate, commands, lab: labResults, labConsole: output(labCommand), labCheckConsole: output(labCheckResult), mutation: mutationEvidence, mutationResult, probes: probeData, pack: packResults, manual: manualReleaseResults, documents: documentationResults, benchmarkMode: benchmarkPolicy, benchmarks: benchmarkPolicy === 'absolute' ? benchmarkResults : [], pairedArtifact: benchmarkPolicy === 'paired-v0.3.1' ? benchmarkResults[0] : null, stableHostReason, absoluteAttempts, judgeState: 'PENDING', evidence });
  return { schemaVersion: 1, candidate, commandResults: commands, labCheckResult, mutationResult, mutationEvidence, labResults, benchmarkPolicy, benchmarkResults, absoluteAttempts, stableHostReason, probeResults: probeData, packResults, manualReleaseResults, documentationResults, knownLimits: ['main-realm Canvas2D only', 'worker and transferred-canvas gap', 'browser-feature gaps', 'command-signature limit', 'synchronous timing boundary', 'temporal-association boundary', 'bounded retention', 'privacy exclusions'], planDeviations, correctionAttempts, pairedReplacementAttempts, priorCandidateCycles, environmentRetries, judgeCorrections, judgeCorrectionVerificationRetries, environmentLimits: evaluation.environmentLimits, productFailures: evaluation.productFailures, evidencePaths: evidence.map((item) => item.path), evidence, mechanicalStatus: evaluation.mechanicalPass ? 'PASS' : 'FAIL', judgeState: 'PENDING', judgeSha256: null, finalStatus: 'FAIL' };
};

export function checkResumeCandidate(candidate, expected) {
  const failures = [];
  if (candidate?.version !== '0.4.0') failures.push('candidate version is not 0.4.0');
  for (const key of ['baseGitSha', 'iifeSha256', 'esmSha256', 'tarballSha256', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`candidate ${key} mismatch`);
  }
  if (!same(candidate?.publicReadmeSha256, expected?.publicReadmeSha256)) failures.push('candidate README hashes mismatch');
  return failures;
}

export function checkPairedReplacementCandidate(candidate, expected) {
  const failures = [];
  if (candidate?.version !== '0.4.0') failures.push('candidate version is not 0.4.0');
  for (const key of ['baseGitSha', 'iifeSha256', 'esmSha256', 'tarballSha256', 'benchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`candidate ${key} mismatch`);
  }
  if (!candidate?.pairedBenchmarkHarnessSha256 || candidate.pairedBenchmarkHarnessSha256 === expected?.pairedBenchmarkHarnessSha256) failures.push('paired benchmark harness did not change');
  if (!same(candidate?.publicReadmeSha256, expected?.publicReadmeSha256)) failures.push('candidate README hashes mismatch');
  return failures;
}

export function checkNewCandidateCyclePrior(gate) {
  const failures = [];
  if (gate?.benchmarkPolicy !== 'paired-v0.3.1') failures.push('new candidate cycle needs a paired gate');
  if (gate?.mechanicalStatus !== 'FAIL' || gate?.finalStatus !== 'FAIL') failures.push('new candidate cycle needs a failed release gate');
  if (gate?.judgeState !== 'PENDING') failures.push('new candidate cycle needs an unjudged gate');
  if (gate?.benchmarkResults?.length !== 1 || gate.benchmarkResults[0]?.status !== 'COMPLETE' || gate.benchmarkResults[0]?.verdict?.pass !== false) failures.push('new candidate cycle needs one completed failed paired artifact');
  if (!gate?.candidate?.iifeSha256 || !gate?.candidate?.candidateManifestSha256) failures.push('new candidate cycle prior identity is incomplete');
  return failures;
}

export function checkNewCandidateCycleCandidate(candidate, expected) {
  const failures = [];
  if (candidate?.version !== '0.4.0' || candidate?.version !== expected?.version) failures.push('new candidate version mismatch');
  for (const key of ['baseGitSha', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`new candidate ${key} mismatch`);
  }
  if (!same(candidate?.publicReadmeSha256, expected?.publicReadmeSha256)) failures.push('new candidate README hashes mismatch');
  for (const key of ['iifeSha256', 'esmSha256', 'tarballSha256', 'candidateManifestSha256']) {
    if (!candidate?.[key] || candidate[key] === expected?.[key]) failures.push(`new candidate ${key} did not change`);
  }
  return failures;
}

export function checkEnvironmentRetryPrior(gate) {
  const failures = [];
  if (gate?.benchmarkPolicy !== 'absolute') failures.push('environment retry needs an absolute gate');
  if (gate?.mechanicalStatus !== 'FAIL' || gate?.finalStatus !== 'FAIL' || gate?.judgeState !== 'PENDING') failures.push('environment retry needs a failed unjudged gate');
  if (gate?.benchmarkResults?.length !== 2 || gate.benchmarkResults.some((item) => item?.bundleSha256 !== null || item?.raw?.length !== 0 || item?.perBlock?.length !== 0)) failures.push('environment retry needs two zero-sample benchmark artifacts');
  const results = [...(gate?.commandResults ?? []), gate?.labCheckResult, gate?.mutationResult].filter(Boolean);
  if (!results.some((result) => result.exitCode !== 0 && environmentText(output(result)))) failures.push('environment retry needs a recorded environment failure');
  if (!gate?.candidate?.iifeSha256 || !gate?.candidate?.tarballSha256) failures.push('environment retry prior identity is incomplete');
  return failures;
}

export function checkEnvironmentRetryCandidate(candidate, expected) {
  const failures = [];
  for (const key of ['version', 'baseGitSha', 'iifeSha256', 'esmSha256', 'tarballSha256', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`environment retry ${key} mismatch`);
  }
  if (!same(candidate?.publicReadmeSha256, expected?.publicReadmeSha256)) failures.push('environment retry README hashes mismatch');
  return failures;
}

export function checkJudgeCorrectionPrior(gate, judge) {
  const failures = [];
  if (gate?.benchmarkPolicy !== 'absolute' || gate?.mechanicalStatus !== 'PASS' || gate?.finalStatus !== 'FAIL' || gate?.judgeState !== 'PENDING') failures.push('judge correction needs a mechanically passing unjudged absolute gate');
  if (!/^VERDICT: FAIL\b/m.test(judge)) failures.push('judge correction needs a failed independent verdict');
  if ((gate?.judgeCorrections?.length ?? 0) > 0) failures.push('only one judge correction pass is allowed');
  return failures;
}

export function checkJudgeCorrectionCandidate(candidate, expected) {
  const failures = [];
  for (const key of ['version', 'baseGitSha', 'iifeSha256', 'esmSha256', 'benchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`judge correction ${key} mismatch`);
  }
  return failures;
}

export function checkJudgeCorrectionVerificationPrior(gate) {
  const failures = [];
  if (gate?.benchmarkPolicy !== 'absolute' || gate?.mechanicalStatus !== 'FAIL' || gate?.finalStatus !== 'FAIL' || gate?.judgeState !== 'PENDING') failures.push('judge correction verification needs a failed unjudged absolute gate');
  if ((gate?.judgeCorrections?.length ?? 0) !== 1) failures.push('judge correction verification needs exactly one correction pass');
  if ((gate?.judgeCorrectionVerificationRetries?.length ?? 0) > 0) failures.push('only one judge correction verification retry is allowed');
  if ((gate?.environmentLimits?.length ?? 0) !== 0) failures.push('judge correction verification cannot retry an environment limit');
  if (!same(gate?.productFailures, ['pnpm --filter canvas-scan run test: failed'])) failures.push('judge correction verification needs only the core test failure');
  const failedTest = gate?.commandResults?.find((item) => item.command === 'pnpm --filter canvas-scan run test');
  const failedOutput = output(failedTest);
  if (failedTest?.status !== 'FAIL' || failedTest?.exitCode === 0 || !/claim-discipline\.test\.ts/.test(failedOutput) || !/both READMEs/.test(failedOutput)) failures.push('judge correction verification needs the recorded README claim-discipline failure');
  if (gate?.commandResults?.some((item) => item !== failedTest && item.status !== 'PASS')) failures.push('judge correction verification found another failed command');
  return failures;
}

export function checkJudgeCorrectionVerificationCandidate(candidate, expected) {
  const failures = [];
  for (const key of ['version', 'baseGitSha', 'iifeSha256', 'esmSha256', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256']) {
    if (!candidate?.[key] || candidate[key] !== expected?.[key]) failures.push(`judge correction verification ${key} mismatch`);
  }
  if (same(candidate?.publicReadmeSha256, expected?.publicReadmeSha256)) failures.push('judge correction verification README hashes did not change');
  if (!candidate?.tarballSha256 || candidate.tarballSha256 === expected?.tarballSha256) failures.push('judge correction verification tarball hash did not change');
  if (!candidate?.releaseHarnessSha256 || candidate.releaseHarnessSha256 === expected?.releaseHarnessSha256) failures.push('judge correction verification release harness hash did not change');
  if (!candidate?.candidateManifestSha256 || candidate.candidateManifestSha256 === expected?.candidateManifestSha256) failures.push('judge correction verification candidate manifest did not change');
  return failures;
}

export function checkFailedPairedAttempt(artifact, candidate) {
  const failures = [];
  if (artifact?.status !== 'ERROR' || artifact?.verdict?.pass !== false || !artifact?.errors?.length) failures.push('paired replacement needs one ERROR artifact');
  if (artifact?.baselineCommit !== baselineCommit || artifact?.activeHead !== candidate?.baseGitSha) failures.push('failed paired attempt identity mismatch');
  if (artifact?.hashes?.candidateBundleSha256 !== candidate?.iifeSha256 || artifact?.inputs?.candidateExpectedBundleSha256 !== candidate?.iifeSha256) failures.push('failed paired attempt candidate hash mismatch');
  if (artifact?.hashes?.harnessSha256 !== candidate?.pairedBenchmarkHarnessSha256) failures.push('failed paired attempt harness hash mismatch');
  if (!Object.values(artifact?.cleanup ?? {}).every((item) => item?.ok === true)) failures.push('failed paired attempt cleanup did not pass');
  if ((artifact?.streams?.mixed?.pairs?.length ?? 0) >= 6 && (artifact?.streams?.['tracked-source']?.pairs?.length ?? 0) >= 6) failures.push('failed paired attempt is not incomplete');
  return failures;
}

const runPreparePairedReplacement = (failedPath) => {
  if (!failedPath) throw new Error('paired replacement needs --prepare-paired-replacement=<artifact>');
  regularFile(failedPath);
  const prior = json(gatePath);
  if (prior.benchmarkPolicy !== 'absolute' || prior.absoluteAttempts?.length !== 1 || prior.absoluteAttempts[0]?.status !== 'FAIL') throw new Error('paired replacement needs one failed authoritative absolute gate');
  const failedArtifact = json(failedPath);
  const failedArtifactFailures = checkFailedPairedAttempt(failedArtifact, prior.candidate);
  if (failedArtifactFailures.length) throw new Error(failedArtifactFailures.join('; '));
  const candidate = candidateIdentity(); candidate.tarballSha256 = prior.candidate?.tarballSha256 ?? null;
  const identityFailures = checkPairedReplacementCandidate(candidate, prior.candidate);
  if (identityFailures.length) throw new Error(identityFailures.join('; '));
  const evidence = evidenceRecords([...prior.evidence.map((item) => item.path), failedPath]);
  const attempt = { authorization: 'User approved one replacement paired attempt after the first attempt ended with ERROR.', artifactPath: failedPath, artifactSha256: hashFile(failedPath), status: failedArtifact.status, errors: failedArtifact.errors, completedPairs: Object.fromEntries(Object.entries(failedArtifact.streams ?? {}).map(([stream, result]) => [stream, result.pairs?.length ?? 0])) };
  const planDeviations = [...(prior.planDeviations ?? []), 'The user approved one replacement paired attempt after the first paired run ended with an incomplete page timeout. The first artifact remains immutable evidence.'];
  const gate = buildGate({ candidate, commands: prior.commandResults, labCheckResult: prior.labCheckResult, mutationResult: prior.mutationResult, benchmarkPolicy: 'absolute', benchmarkResults: prior.benchmarkResults, absoluteAttempts: prior.absoluteAttempts, evidence, planDeviations, correctionAttempts: prior.correctionAttempts ?? [], pairedReplacementAttempts: [...(prior.pairedReplacementAttempts ?? []), attempt], priorCandidateCycles: prior.priorCandidateCycles ?? [], environmentRetries: prior.environmentRetries ?? [], judgeCorrections: prior.judgeCorrections ?? [] });
  writeReleaseArtifacts(gate);
  console.log('SIDPROJ_56_PAIRED_REPLACEMENT: READY');
};

const runResumeAbsolute = () => {
  const prior = json(gatePath);
  if (prior.benchmarkPolicy !== 'absolute' || prior.absoluteAttempts?.length !== 1 || prior.absoluteAttempts[0]?.status !== 'FAIL' || prior.absoluteAttempts[0]?.artifacts?.length !== 2) throw new Error('resume mode needs one failed authoritative absolute gate with two artifacts');
  const candidate = candidateIdentity(); candidate.tarballSha256 = prior.candidate?.tarballSha256 ?? null;
  const identityFailures = checkResumeCandidate(candidate, prior.candidate);
  if (identityFailures.length) throw new Error(identityFailures.join('; '));
  const commands = prior.commandResults.map((item) => ({ ...item, status: classifyCommand(item) }));
  const probeIndex = commands.findIndex((item) => item.command.endsWith('probe:v0.4'));
  if (probeIndex < 0 || commands[probeIndex].exitCode === 0) throw new Error('resume mode needs one failed probe command');
  const failedProbe = commands[probeIndex];
  commands[probeIndex] = run(REQUIRED_COMMANDS[8]);
  const evidence = evidenceRecords(prior.evidence.map((item) => item.path));
  const planDeviations = [...(prior.planDeviations ?? []).filter((item) => !item.startsWith('Gate-only correction')), 'Gate-only corrections repaired an ESRCH cleanup defect, a short-circuit runner, and stale frame, action, and label checks in three probe harnesses; the package, IIFE, ESM, README, benchmark harness, and absolute benchmark artifacts did not change.'];
  const correctionAttempts = [...(prior.correctionAttempts ?? []), { command: failedProbe.command, startedAt: failedProbe.startedAt, endedAt: failedProbe.endedAt, exitCode: failedProbe.exitCode, status: failedProbe.status }];
  const gate = buildGate({ candidate, commands, labCheckResult: prior.labCheckResult, mutationResult: prior.mutationResult, benchmarkPolicy: 'absolute', benchmarkResults: prior.benchmarkResults, absoluteAttempts: prior.absoluteAttempts, evidence, planDeviations, correctionAttempts, priorCandidateCycles: prior.priorCandidateCycles ?? [], environmentRetries: prior.environmentRetries ?? [], judgeCorrections: prior.judgeCorrections ?? [] });
  writeReleaseArtifacts(gate);
  console.log(`SIDPROJ_56_RELEASE_GATE: ${gate.mechanicalStatus === 'PASS' ? 'PENDING' : 'FAIL'}`);
  process.exitCode = 1;
};

const runAbsolute = ({ newCandidateCycle = false, retryEnvironmentCycle = false } = {}) => {
  if (newCandidateCycle && retryEnvironmentCycle) throw new Error('choose one candidate-cycle mode');
  let prior = null;
  let priorText = '';
  let priorArchivePath = null;
  if (newCandidateCycle || retryEnvironmentCycle) {
    priorText = text(gatePath);
    prior = JSON.parse(priorText);
    const priorFailures = newCandidateCycle ? checkNewCandidateCyclePrior(prior) : checkEnvironmentRetryPrior(prior);
    if (priorFailures.length) throw new Error(priorFailures.join('; '));
    priorArchivePath = newCandidateCycle
      ? `${tmp}/sidproj-56-release-gate-${prior.candidate.iifeSha256.slice(0, 12)}.json`
      : `${tmp}/sidproj-56-release-gate-environment-${prior.candidate.releaseHarnessSha256.slice(0, 12)}.json`;
    if (existsSync(priorArchivePath) && text(priorArchivePath) !== priorText) throw new Error(`prior candidate archive already exists with different contents: ${priorArchivePath}`);
  }
  const commands = REQUIRED_COMMANDS.slice(0, 4).map(run);
  const candidate = candidateIdentity();
  const labResult = run(REQUIRED_COMMANDS[4]); commands.push(labResult);
  const labCheckResult = run(labCheckCommand);
  const mutationResult = runMutation();
  const benchmarkResult = run(REQUIRED_COMMANDS[5]); commands.push(benchmarkResult);
  commands.push(run(REQUIRED_COMMANDS[6]), run(REQUIRED_COMMANDS[7]), run(REQUIRED_COMMANDS[8]));
  const packResults = existsSync(packPath) ? json(packPath) : null;
  candidate.tarballSha256 = packResults?.tarballSha256 ?? null;
  if (prior) {
    const candidateFailures = newCandidateCycle
      ? checkNewCandidateCycleCandidate(candidate, prior.candidate)
      : checkEnvironmentRetryCandidate(candidate, prior.candidate);
    if (candidateFailures.length) throw new Error(candidateFailures.join('; '));
    if (!existsSync(priorArchivePath)) writeFileSync(priorArchivePath, priorText, { flag: 'wx' });
  }
  const benchmarkResults = benchmarkArtifacts(benchmarkResult);
  const paths = [...labEvidencePaths, ...Object.values(PROBE_PATHS), packPath, manualReleasePath, ...benchmarkPaths(benchmarkResult), ...archiveEvidencePaths(prior), ...(priorArchivePath ? [priorArchivePath] : [])];
  const evidence = evidenceRecords(paths);
  const absoluteFailures = checkAbsoluteBenchmarks(benchmarkResults, candidate);
  const absoluteAttempts = [{ status: absoluteFailures.length ? 'FAIL' : 'PASS', paths: benchmarkPaths(benchmarkResult), artifacts: benchmarkResults, failures: absoluteFailures }];
  const priorCandidateCycles = newCandidateCycle ? [...(prior.priorCandidateCycles ?? []), {
    authorization: 'User approved a new candidate performance-fix and fresh benchmark cycle after the paired gate failed.',
    archivePath: priorArchivePath,
    archiveSha256: hashFile(priorArchivePath),
    candidate: prior.candidate,
    benchmarkPolicy: prior.benchmarkPolicy,
    mechanicalStatus: prior.mechanicalStatus,
    productFailures: prior.productFailures,
    evidencePaths: prior.evidencePaths,
  }] : prior?.priorCandidateCycles ?? [];
  const environmentRetries = retryEnvironmentCycle ? [...(prior.environmentRetries ?? []), {
    reason: 'The sandbox blocked local Vite binds with listen EPERM and clean-consumer registry access with ENOTFOUND before any benchmark samples ran.',
    archivePath: priorArchivePath,
    archiveSha256: hashFile(priorArchivePath),
    candidate: prior.candidate,
    benchmarkPaths: prior.absoluteAttempts?.[0]?.paths ?? [],
  }] : prior?.environmentRetries ?? [];
  const planDeviations = newCandidateCycle
    ? [...(prior.planDeviations ?? []), `The user approved a new performance-fix candidate cycle after the paired mixed full-capture p95 gate failed. The exact prior gate is archived at ${priorArchivePath}.`]
    : retryEnvironmentCycle
      ? [...(prior.planDeviations ?? []), `The first run of the new candidate was blocked by sandbox listen EPERM and network ENOTFOUND before any benchmark samples ran. Its exact gate is archived at ${priorArchivePath}; the same product candidate was retried outside the sandbox.`]
      : [];
  const gate = buildGate({ candidate, commands, labCheckResult, mutationResult, benchmarkPolicy: 'absolute', benchmarkResults, absoluteAttempts, evidence, planDeviations, priorCandidateCycles, environmentRetries, judgeCorrections: prior?.judgeCorrections ?? [] });
  writeReleaseArtifacts(gate);
  console.log(`SIDPROJ_56_RELEASE_GATE: ${gate.mechanicalStatus === 'PASS' ? 'PENDING' : 'FAIL'}`);
  process.exitCode = 1;
};

const runJudgeCorrection = (judgeFailurePath) => {
  if (!judgeFailurePath) throw new Error('judge correction needs --judge-correction=<failed-verdict>');
  regularFile(judgeFailurePath);
  const priorText = text(gatePath);
  const prior = JSON.parse(priorText);
  const failedJudge = text(judgeFailurePath);
  const priorFailures = checkJudgeCorrectionPrior(prior, failedJudge);
  if (priorFailures.length) throw new Error(priorFailures.join('; '));
  const archivePath = `${tmp}/sidproj-56-release-gate-pre-judge-correction-${prior.candidate.releaseHarnessSha256.slice(0, 12)}.json`;
  if (existsSync(archivePath) && text(archivePath) !== priorText) throw new Error(`pre-correction archive already exists with different contents: ${archivePath}`);

  const commands = prior.commandResults.map((item) => ({ ...item }));
  for (let index = 0; index < 4; index++) commands[index] = run(REQUIRED_COMMANDS[index]);
  const candidate = candidateIdentity();
  commands[6] = run(REQUIRED_COMMANDS[6]);
  commands[7] = run(REQUIRED_COMMANDS[7]);
  commands[8] = run(REQUIRED_COMMANDS[8]);
  const packResults = existsSync(packPath) ? json(packPath) : null;
  candidate.tarballSha256 = packResults?.tarballSha256 ?? null;
  const candidateFailures = checkJudgeCorrectionCandidate(candidate, prior.candidate);
  if (candidateFailures.length) throw new Error(candidateFailures.join('; '));
  if (!existsSync(archivePath)) writeFileSync(archivePath, priorText, { flag: 'wx' });

  const paths = [...labEvidencePaths, ...Object.values(PROBE_PATHS), packPath, manualReleasePath, ...prior.absoluteAttempts[0].paths, ...archiveEvidencePaths(prior), archivePath, judgeFailurePath];
  const evidence = evidenceRecords(paths);
  const correction = {
    reason: 'The first independent judge found missing manual evidence, weak package export checks, an unbound recording probe, and unchecked archive hashes.',
    archivePath,
    archiveSha256: hashFile(archivePath),
    failedJudgePath: judgeFailurePath,
    failedJudgeSha256: hashFile(judgeFailurePath),
    preservedIifeSha256: candidate.iifeSha256,
    preservedAbsoluteBenchmarkHarnessSha256: candidate.benchmarkHarnessSha256,
  };
  const planDeviations = [...(prior.planDeviations ?? []), `One bounded post-judge correction added exact-tarball manual evidence, real package export checks, served-IIFE recording-probe binding, and archive hash validation. The measured IIFE and absolute benchmark harness did not change. The pre-correction gate is archived at ${archivePath}.`];
  const gate = buildGate({ candidate, commands, labCheckResult: prior.labCheckResult, mutationResult: prior.mutationResult, benchmarkPolicy: 'absolute', benchmarkResults: prior.benchmarkResults, absoluteAttempts: prior.absoluteAttempts, evidence, planDeviations, correctionAttempts: prior.correctionAttempts ?? [], pairedReplacementAttempts: prior.pairedReplacementAttempts ?? [], priorCandidateCycles: prior.priorCandidateCycles ?? [], environmentRetries: prior.environmentRetries ?? [], judgeCorrections: [...(prior.judgeCorrections ?? []), correction] });
  writeReleaseArtifacts(gate);
  console.log(`SIDPROJ_56_JUDGE_CORRECTION: ${gate.mechanicalStatus === 'PASS' ? 'PENDING' : 'FAIL'}`);
  process.exitCode = 1;
};

const runJudgeCorrectionVerification = () => {
  const priorText = text(gatePath);
  const prior = JSON.parse(priorText);
  const priorFailures = checkJudgeCorrectionVerificationPrior(prior);
  if (priorFailures.length) throw new Error(priorFailures.join('; '));
  const archivePath = `${tmp}/sidproj-56-release-gate-judge-correction-test-fail-${prior.candidate.releaseHarnessSha256.slice(0, 12)}.json`;
  if (existsSync(archivePath) && text(archivePath) !== priorText) throw new Error(`failed correction archive already exists with different contents: ${archivePath}`);
  if (!existsSync(archivePath)) writeFileSync(archivePath, priorText, { flag: 'wx' });

  const commands = prior.commandResults.map((item) => ({ ...item }));
  for (let index = 0; index < 4; index++) commands[index] = run(REQUIRED_COMMANDS[index]);
  const candidate = candidateIdentity();
  commands[6] = run(REQUIRED_COMMANDS[6]);
  commands[7] = run(REQUIRED_COMMANDS[7]);
  const packResults = existsSync(packPath) ? json(packPath) : null;
  candidate.tarballSha256 = packResults?.tarballSha256 ?? null;
  const candidateFailures = checkJudgeCorrectionVerificationCandidate(candidate, prior.candidate);
  if (candidateFailures.length) throw new Error(candidateFailures.join('; '));

  const evidence = evidenceRecords([...prior.evidence.map((item) => item.path), archivePath]);
  const retry = {
    reason: 'The correction gate found one README claim-discipline wording failure after all empirical correction checks passed.',
    archivePath,
    archiveSha256: hashFile(archivePath),
    failedCommand: 'pnpm --filter canvas-scan run test',
    preservedIifeSha256: candidate.iifeSha256,
    preservedEsmSha256: candidate.esmSha256,
    preservedAbsoluteBenchmarkHarnessSha256: candidate.benchmarkHarnessSha256,
    preservedPairedBenchmarkHarnessSha256: candidate.pairedBenchmarkHarnessSha256,
  };
  const planDeviations = [...(prior.planDeviations ?? []), `The bounded judge correction needed one verification retry for its only failed check: README claim-discipline wording. The IIFE, ESM, benchmark harnesses, lab, probes, and absolute benchmark evidence did not change. The failed correction gate is archived at ${archivePath}.`];
  const gate = buildGate({ candidate, commands, labCheckResult: prior.labCheckResult, mutationResult: prior.mutationResult, benchmarkPolicy: 'absolute', benchmarkResults: prior.benchmarkResults, absoluteAttempts: prior.absoluteAttempts, evidence, planDeviations, correctionAttempts: prior.correctionAttempts ?? [], pairedReplacementAttempts: prior.pairedReplacementAttempts ?? [], priorCandidateCycles: prior.priorCandidateCycles ?? [], environmentRetries: prior.environmentRetries ?? [], judgeCorrections: prior.judgeCorrections, judgeCorrectionVerificationRetries: [...(prior.judgeCorrectionVerificationRetries ?? []), retry] });
  writeReleaseArtifacts(gate);
  console.log(`SIDPROJ_56_JUDGE_CORRECTION: ${gate.mechanicalStatus === 'PASS' ? 'PENDING' : 'FAIL'}`);
  process.exitCode = 1;
};

const runPaired = (pairedPath, reasonPath) => {
  if (!pairedPath || !reasonPath) throw new Error('paired mode needs --paired-artifact and --stable-host-reason');
  regularFile(pairedPath); regularFile(reasonPath);
  const prior = json(gatePath);
  if (prior.benchmarkPolicy !== 'absolute' || prior.absoluteAttempts?.length !== 1 || prior.absoluteAttempts[0]?.status !== 'FAIL') throw new Error('paired mode needs one failed authoritative absolute gate');
  const candidate = candidateIdentity(); candidate.tarballSha256 = prior.candidate?.tarballSha256 ?? null;
  const identityFailures = checkCandidate(candidate, prior.candidate);
  if (identityFailures.length) throw new Error(identityFailures.join('; '));
  const pairedArtifact = json(pairedPath);
  const stableHostReason = text(reasonPath).trim();
  const evidence = evidenceRecords([...prior.evidence.map((item) => item.path), pairedPath, reasonPath]);
  const gate = buildGate({ candidate, commands: prior.commandResults, labCheckResult: prior.labCheckResult, mutationResult: prior.mutationResult, benchmarkPolicy: 'paired-v0.3.1', benchmarkResults: [pairedArtifact], absoluteAttempts: prior.absoluteAttempts, stableHostReason, evidence, planDeviations: prior.planDeviations ?? [], correctionAttempts: prior.correctionAttempts ?? [], pairedReplacementAttempts: prior.pairedReplacementAttempts ?? [], priorCandidateCycles: prior.priorCandidateCycles ?? [], environmentRetries: prior.environmentRetries ?? [], judgeCorrections: prior.judgeCorrections ?? [] });
  writeReleaseArtifacts(gate);
  console.log(`SIDPROJ_56_RELEASE_GATE: ${gate.mechanicalStatus === 'PASS' ? 'PENDING' : 'FAIL'}`);
  process.exitCode = 1;
};

const finalizeJudge = () => {
  const gate = json(gatePath); const judge = text(judgePath);
  const failures = checkSavedEvidence(gate, judge, false);
  if (!/^VERDICT: PASS\b/m.test(judge)) failures.push('judge PASS is missing');
  if (failures.length) throw new Error([...new Set(failures)].join('; '));
  gate.judgeState = 'PASS'; gate.judgeSha256 = hashFile(judgePath); gate.finalStatus = 'PASS';
  gate.evidence = evidenceRecords([...gate.evidence.map((item) => item.path), judgePath]);
  gate.evidencePaths = gate.evidence.map((item) => item.path);
  writeReleaseArtifacts(gate, judge);
  console.log('SIDPROJ_56_RELEASE_GATE_FINALIZED: PASS');
};

function main() {
  if (process.argv.includes('--check-evidence')) {
    const gate = existsSync(gatePath) ? json(gatePath) : null;
    const judge = existsSync(judgePath) ? text(judgePath) : '';
    const failures = checkSavedEvidence(gate, judge, true);
    console.log(`SIDPROJ_56_RELEASE_GATE: ${failures.length ? 'FAIL' : 'PASS'}`);
    if (failures.length) console.error(failures.join('\n'));
    process.exitCode = failures.length ? 1 : 0;
    return;
  }
  if (process.argv.includes('--finalize-judge')) { finalizeJudge(); return; }
  const replacementArg = process.argv.find((arg) => arg.startsWith('--prepare-paired-replacement='));
  if (replacementArg) { runPreparePairedReplacement(replacementArg.slice('--prepare-paired-replacement='.length)); return; }
  const judgeCorrectionArg = process.argv.find((arg) => arg.startsWith('--judge-correction='));
  if (judgeCorrectionArg) { runJudgeCorrection(judgeCorrectionArg.slice('--judge-correction='.length)); return; }
  if (process.argv.includes('--resume-judge-correction')) { runJudgeCorrectionVerification(); return; }
  if (process.argv.includes('--resume-absolute')) { runResumeAbsolute(); return; }
  const benchmarkMode = process.argv.find((arg) => arg.startsWith('--benchmark='))?.slice(12) ?? 'absolute';
  if (benchmarkMode === 'absolute') {
    runAbsolute({
      newCandidateCycle: process.argv.includes('--new-candidate-cycle'),
      retryEnvironmentCycle: process.argv.includes('--retry-environment-cycle'),
    });
    return;
  }
  if (benchmarkMode === 'paired-v0.3.1') {
    const pairedPath = process.argv.find((arg) => arg.startsWith('--paired-artifact='))?.slice(18);
    const reasonPath = process.argv.find((arg) => arg.startsWith('--stable-host-reason='))?.slice(21);
    runPaired(pairedPath, reasonPath); return;
  }
  throw new Error(`unknown benchmark mode: ${benchmarkMode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
