import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEvidence as checkBenchmarkEvidence, mean, nearestRankP95 } from './bench-v05-chrome.mjs';
import { checkDirectory as checkExcalidrawEvidence } from './excalidraw-v05-truth.mjs';
import { validateEvidencePayload as validateLabV04 } from './lab-v04.mjs';
import { ESM_RUNTIME_EXPORTS, TYPE_EXPORTS, assertManifestEntries } from '../../scripts/pack-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = '/private/tmp';
const finalDirectory = path.join(tmp, 'sidproj-70-release-evidence');
const reportPath = path.join(root, 'docs/releases/v0.5-report.md');
const commandKeys = ['command', 'class', 'startedAt', 'endedAt', 'exitCode', 'status', 'stdout', 'stderr', 'artifactPath'];
const retryKeys = ['attemptCount', 'status', 'attemptPath', 'attemptManifestSha256', 'priorAttemptPath', 'priorManifestSha256', 'priorError', 'failureFamily', 'checkedConditions', 'changedCondition'];
const candidateKeys = ['schemaVersion', 'issue', 'gitSha', 'branch', 'version', 'dirty', 'status', 'excludedPaths', 'files', 'hashes', 'iifeSha256', 'esmSha256', 'declarationSha256', 'packHarnessSha256', 'passiveBenchmarkHarnessSha256', 'benchmarkHarnessSha256', 'releaseHarnessSha256', 'excalidrawHarnessSha256', 'chromeRevision', 'host', 'tarballSha256'];
const packKeys = ['schemaVersion', 'packageVersion', 'baseGitSha', 'dirty', 'tarballSha256', 'esmSha256', 'runtimeSha256', 'iifeSha256', 'packageManifestVersion', 'declarationHashes', 'manifestEntries', 'runtimeExports', 'typeExports', 'publicContract', 'labBoundary', 'manualReleaseTestSha256', 'fixtureResults', 'publicContractResults', 'labBoundaryResults', 'publicSurfaceProbe', 'environmentErrors', 'finalStatus'];
const passiveKeys = ['schemaVersion', 'when', 'selfContained', 'baseUrl', 'stream', 'git', 'bundleSha256', 'browserVersion', 'hardware', 'thresholds', 'harnessSha256', 'failures', 'raw', 'perBlock', 'gates'];
const passiveThresholds = { fullAddedMeanMs: 2, fullAddedP95Ms: 3, countOnlyAddedMeanMs: 0.75, countOnlyAddedP95Ms: 2 };
const labV04Files = ['sidproj-55-canvas-lab-v0.4.json', 'sidproj-55-variant-matrix.json', 'sidproj-55-nearest-negatives.json', 'sidproj-55-console-summary.txt', 'sidproj-55-integrated-continuous.png', 'sidproj-55-integrated-burst.png', 'sidproj-55-sha256.txt'];

export const RELEASE_NOTES = `# canvas-scan v0.5.0 release notes (draft)\n\nThis draft adds one selected-canvas explanation for the next interaction. The\ncapture is bounded to ten seconds. It can show the first normalized command\ndifference, no observed difference, or an honest unknown. It includes bounded\ngenerated and same-origin mapped callsite evidence, explicit same-type finding\ncomparison with measured pair deltas, and versioned JSON artifacts.\n\nThe v0.4 recording API and its full passive performance gates remain unchanged.\nThis feature does not prove pixels, GPU or compositor work, cause, automatic\nmatching, or improvement. It does not fetch cross-origin source maps. Detail is\nselected only and has fixed collection limits.\n`;
export const HUMAN_TEST = `# v0.5 pre-publication human test\n\nPrerequisites: use the exact tarball hash in \`gate.json\`, real Chrome, no\npublication credentials, and a clean disposable consumer.\n\n1. Confirm the finding has **Explain next interaction**.\n2. Confirm the ten-second boundary and active state are clear.\n3. Confirm the command result gives a difference, honest absence, or honest unknown without raw values.\n4. Confirm the callsite is useful when mapped and honest when unresolved.\n5. Confirm baseline selection and explicit finding pairing are clear.\n6. Confirm comparison text uses measured-pair language and makes no improvement claim.\n7. Confirm explanation and comparison JSON copy works.\n8. Confirm normal recording works after explanation stops.\n\nUse this exact record:\n\n\`\`\`text\nChrome revision:\nTarball SHA-256:\nStep 1: PASS | FAIL\nStep 2: PASS | FAIL\nStep 3: PASS | FAIL\nStep 4: PASS | FAIL\nStep 5: PASS | FAIL\nStep 6: PASS | FAIL\nStep 7: PASS | FAIL\nStep 8: PASS | FAIL\nNotes:\nFinal decision: PASS | FAIL\n\`\`\`\n\nV05-10 owns this human run, signing, authentication, tag creation,\npublication, and final release approval.\n`;

export const REQUIRED_COMMANDS = [
  'pnpm -r run typecheck',
  'pnpm --filter canvas-scan run test',
  'pnpm --filter canvas-scan run build',
  'pnpm --filter demo run build',
  'pnpm --filter dogfood run lab:v0.4',
  'pnpm --filter dogfood run lab:v0.5',
  'pnpm --filter dogfood run bench:chrome',
  'pnpm --filter dogfood run bench:v0.5:chrome',
  'node scripts/verify-pack.mjs',
  'git diff --check',
];

export const ROOT_ENTRIES = ['candidate.json', 'environment-retry.json', 'commands.json', 'command-output', 'bench-v04', 'bench-v05', 'lab-v04', 'lab-v05', 'pack', 'excalidraw', 'release-notes.md', 'human-test.md', 'gate.json', 'evidence-sha256.txt'];
export const CANDIDATE_ALLOWLIST = [
  'apps/workbench/public/bench-v05.html',
  'docs/releases/v0.5-human-test.md',
  'docs/releases/v0.5-release-notes.md',
  'packages/core/test/pack-manifest.test.ts',
  'packages/dogfood/bench-v05-chrome.mjs',
  'packages/dogfood/bench-v05-chrome.test.mjs',
  'packages/dogfood/excalidraw-v05-truth.mjs',
  'packages/dogfood/excalidraw-v05-truth.test.mjs',
  'packages/dogfood/excalidraw-v05.mjs',
  'packages/dogfood/lab-v05-truth.mjs',
  'packages/dogfood/lab-v05.mjs',
  'packages/dogfood/lab-v05.test.mjs',
  'packages/dogfood/package.json',
  'packages/dogfood/release-v05.mjs',
  'packages/dogfood/release-v05.test.mjs',
  'packages/dogfood/v05-bench-diagnostic.ts',
  'scripts/pack-manifest.mjs',
  'scripts/verify-pack.mjs',
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha256(readFileSync(file));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const stable = value => JSON.stringify(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && stable(Object.keys(value).sort()) === stable([...keys].sort());
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const environmentText = value => /EADDRINUSE|ENOTFOUND|EAI_AGAIN|ECONN(?:REFUSED|RESET)|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Chrome unavailable|browserType\.launch|Executable doesn't exist|npm.*(?:cache|EACCES|EPERM)|yarn.*(?:cache|EACCES|EPERM)|server did not|listen EPERM/i.test(String(value));

export const classifyCommand = ({ exitCode, stdout = '', stderr = '', error = '' }) => exitCode === 0 ? 'PASS' : environmentText(`${stdout}\n${stderr}\n${error}`) ? 'ENVIRONMENT_FAILURE' : 'PRODUCT_FAILURE';
export const failureFamily = value => {
  const text = String(value);
  if (/EADDRINUSE|port \d+.*listener|listener ownership|listen EPERM/i.test(text)) return 'ports';
  if (/ENOTFOUND|EAI_AGAIN|ECONN(?:REFUSED|RESET)|EHOSTUNREACH|ENETUNREACH|network/i.test(text)) return 'network';
  if (/Chrome unavailable|browserType\.launch|Executable doesn't exist/i.test(text)) return 'chrome';
  if (/npm.*(?:cache|EACCES|EPERM)|yarn.*(?:cache|EACCES|EPERM)/i.test(text)) return 'cache';
  if (/ETIMEDOUT|server did not|fixture timeout/i.test(text)) return 'timing';
  return null;
};

function listenerPids(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.status === 1) return [];
  if (result.status !== 0) return [`lsof-error-${result.status ?? 1}`];
  return result.stdout.trim().split('\n').filter(Boolean).sort();
}
function resolves(host) { const result = spawnSync('dscacheutil', ['-q', 'host', '-a', 'name', host], { encoding: 'utf8' }); return result.status === 0 && /ip_address:/i.test(result.stdout ?? ''); }
export function environmentCondition() { return { ports: { '4385': listenerPids(4385), '5190': listenerPids(5190), '5199': listenerPids(5199), '5209': listenerPids(5209), '5210': listenerPids(5210) }, network: { github: resolves('github.com'), npm: resolves('registry.npmjs.org') }, chrome: { revision: (() => { try { return execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version'], { encoding: 'utf8' }).trim(); } catch { return null; } })() }, cache: { npm: process.env.npm_config_cache ?? null, yarn: process.env.YARN_CACHE_FOLDER ?? null }, timing: { token: process.env.SIDPROJ_70_FIXTURE_TIMING ?? null } }; }

function trackedStatus() { return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trimEnd().split('\n').filter(Boolean); }
function changedPath(row) { const value = row.slice(3); return value.includes(' -> ') ? value.split(' -> ').at(-1) : value; }
export const changedPaths = rows => rows.map(changedPath);
export function candidateIdentity() {
  const status = trackedStatus();
  const files = status.map(changedPath).filter(file => !['AGENTS.md', '.codex/pbj-plan.md', 'docs/releases/v0.5-report.md'].includes(file)).sort();
  const read = file => existsSync(path.join(root, file)) ? hashFile(path.join(root, file)) : null;
  return { schemaVersion: 1, issue: 'SIDPROJ-70', gitSha: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), version: JSON.parse(readFileSync(path.join(root, 'packages/core/package.json'))).version, dirty: status.length > 0, status, excludedPaths: ['AGENTS.md'], files, hashes: Object.fromEntries(files.map(file => [file, read(file)])), iifeSha256: read('packages/core/dist/canvas-scan.iife.js'), esmSha256: read('packages/core/dist/index.js'), declarationSha256: read('packages/core/dist/index.d.ts'), packHarnessSha256: read('scripts/verify-pack.mjs'), passiveBenchmarkHarnessSha256: read('packages/dogfood/bench-chrome.mjs'), benchmarkHarnessSha256: read('packages/dogfood/bench-v05-chrome.mjs'), releaseHarnessSha256: read('packages/dogfood/release-v05.mjs'), excalidrawHarnessSha256: read('packages/dogfood/excalidraw-v05.mjs'), chromeRevision: environmentCondition().chrome.revision, host: { cpu: os.cpus()[0]?.model ?? process.arch, cores: os.cpus().length }, tarballSha256: null };
}
export function candidateRetryHash(candidate) { const { tarballSha256: _tarballSha256, ...value } = candidate; value.status = value.status?.filter(row => changedPath(row) !== 'docs/releases/v0.5-report.md'); return sha256(stable(value)); }

export function evaluateRelease({ commands, bench, pack, external, passive = true }) {
  const productFailures = []; const environmentFailures = [];
  for (const command of commands ?? []) { if (command.status === 'PRODUCT_FAILURE') productFailures.push(command.command); if (command.status === 'ENVIRONMENT_FAILURE') environmentFailures.push(command.command); }
  if (!passive) productFailures.push('passive benchmark gate');
  if (!bench || !(bench.meanMs < 4) || !(bench.p95Ms < 8) || bench.noSelection?.commandEntryAllocations !== 0 || bench.noSelection?.stackAllocations !== 0) productFailures.push('v0.5 benchmark gate');
  if (pack?.status !== 'PASS') productFailures.push('pack gate'); if (external?.status !== 'PASS') productFailures.push('external gate');
  return { pass: !productFailures.length && !environmentFailures.length, productFailures, environmentFailures };
}

function safeTree(directory, relative = '') {
  const output = [];
  for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name); const info = lstatSync(path.join(directory, child));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error(`unsafe evidence entry: ${child}`);
    if (info.isDirectory()) output.push(...safeTree(directory, child)); else output.push(child);
  }
  return output;
}
export function recursiveManifestHash(directory) { return sha256(safeTree(directory).filter(file => file !== 'environment-retry.json').sort().map(file => `${file}\0${hashFile(path.join(directory, file))}`).join('\n')); }

function validCondition(value) { return exact(value, ['ports', 'network', 'chrome', 'cache', 'timing']) && exact(value.ports, ['4385', '5190', '5199', '5209', '5210']) && Object.values(value.ports).every(Array.isArray) && exact(value.network, ['github', 'npm']) && Object.values(value.network).every(item => typeof item === 'boolean') && exact(value.chrome, ['revision']) && exact(value.cache, ['npm', 'yarn']) && exact(value.timing, ['token']); }
export function checkRetry(retry) {
  if (!exact(retry, retryKeys) || !Array.isArray(retry.checkedConditions) || !retry.checkedConditions.every(validCondition) || !path.isAbsolute(retry.attemptPath ?? '')) throw new Error('retry schema changed');
  if (retry.status === 'not-used') { if (retry.attemptCount !== 1 || retry.attemptManifestSha256 !== null || retry.priorAttemptPath !== null || retry.priorManifestSha256 !== null || retry.priorError !== null || retry.failureFamily !== null || retry.changedCondition !== null || retry.checkedConditions.length !== 1) throw new Error('invalid unused retry record'); return; }
  if (retry.status !== 'used' || retry.attemptCount !== 2 || retry.attemptManifestSha256 !== null || !path.isAbsolute(retry.priorAttemptPath ?? '') || !/^[0-9a-f]{64}$/.test(retry.priorManifestSha256 ?? '') || !retry.priorError || !['ports', 'network', 'chrome', 'cache', 'timing'].includes(retry.failureFamily) || retry.checkedConditions.length !== 2) throw new Error('invalid used retry record');
  const changed = retry.changedCondition; if (!exact(changed, ['name', 'before', 'after']) || changed.name !== retry.failureFamily || stable(changed.before) === stable(changed.after)) throw new Error('retry condition did not change');
  if (!existsSync(retry.priorAttemptPath) || recursiveManifestHash(retry.priorAttemptPath) !== retry.priorManifestSha256) throw new Error('prior retry evidence changed');
}

export function checkPackSummary(pack, candidate) {
  if (!exact(pack, packKeys) || pack.schemaVersion !== 1 || pack.finalStatus !== 'PASS' || pack.packageVersion !== candidate.version || pack.packageManifestVersion !== candidate.version || pack.baseGitSha !== candidate.gitSha || pack.dirty !== true || pack.iifeSha256 !== candidate.iifeSha256 || pack.esmSha256 !== candidate.esmSha256 || pack.tarballSha256 !== candidate.tarballSha256) throw new Error('pack identity or schema changed');
  assertManifestEntries(pack.manifestEntries);
  const declarations = pack.manifestEntries.filter(entry => /^package\/dist\/.*\.d\.ts$/.test(entry));
  if (!exact(pack.declarationHashes, declarations) || Object.values(pack.declarationHashes).some(value => !/^[0-9a-f]{64}$/.test(value)) || pack.declarationHashes['package/dist/index.d.ts'] !== candidate.declarationSha256) throw new Error('pack declaration hashes changed');
  if (!/^[0-9a-f]{64}$/.test(pack.runtimeSha256 ?? '') || !/^[0-9a-f]{64}$/.test(pack.manualReleaseTestSha256 ?? '') || stable(pack.runtimeExports) !== stable(ESM_RUNTIME_EXPORTS) || stable(pack.typeExports) !== stable(TYPE_EXPORTS) || pack.publicContract !== 'PASS' || pack.labBoundary !== 'PASS') throw new Error('pack public surface changed');
  const names = ['public contract', 'lab boundary', 'package', 'clean public surface fixture', 'Vite fixture', 'manual release test', 'Next fixture'];
  if (!Array.isArray(pack.fixtureResults) || stable(pack.fixtureResults.map(item => item.name)) !== stable(names) || pack.fixtureResults.some(item => !exact(item, ['name', 'status']) || item.status !== 'PASS')) throw new Error('pack fixture results changed');
  if (stable(pack.publicContractResults) !== stable(pack.fixtureResults.slice(0, 2)) || stable(pack.labBoundaryResults) !== stable([pack.fixtureResults[1]]) || pack.environmentErrors?.length) throw new Error('pack result summary changed');
  const probe = pack.publicSurfaceProbe;
  if (!exact(probe, ['installCommand', 'importCommand', 'typecheckCommand', 'runtimeExports', 'typeExports', 'importStatus', 'typecheckStatus']) || probe.installCommand !== 'npm install --no-audit --no-fund <exact-tarball> typescript@^5 --cache <temporary-cache>' || probe.importCommand !== 'node --eval <runtime-export-allowlist-probe>' || probe.typecheckCommand !== 'node <fixture-typescript>/bin/tsc --project tsconfig.json' || stable(probe.runtimeExports) !== stable(ESM_RUNTIME_EXPORTS) || stable(probe.typeExports) !== stable(TYPE_EXPORTS) || probe.importStatus !== 'PASS' || probe.typecheckStatus !== 'PASS') throw new Error('pack clean public surface changed');
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
function summarizePassive(raw) {
  if (!Array.isArray(raw) || raw.length !== 5) throw new Error('passive benchmark needs five raw blocks');
  return raw.map(block => {
    if (!exact(block, ['100', '1000', '10000'])) throw new Error('passive raw operation levels changed');
    const result = {};
    for (const operations of [100, 1000, 10000]) {
      const modes = block[operations]; if (!exact(modes, ['off', 'passthrough', 'full', 'countonly'])) throw new Error('passive raw modes changed');
      const stats = {};
      for (const mode of ['off', 'passthrough', 'full', 'countonly']) { const frames = modes[mode]; if (!Array.isArray(frames) || frames.length !== 240 || frames.some(value => !Number.isFinite(value) || value < 0)) throw new Error('passive raw frame samples changed'); stats[mode] = { median: median(frames), p95: p95(frames), mean: mean(frames) }; }
      result[operations] = { ...stats, fullAddedMeanMs: stats.full.mean - stats.off.mean, fullAddedP95Ms: stats.full.p95 - stats.off.p95, countOnlyAddedMeanMs: stats.countonly.mean - stats.off.mean, countOnlyAddedP95Ms: stats.countonly.p95 - stats.off.p95, passthroughAddedMeanMs: stats.passthrough.mean - stats.off.mean };
    }
    return result;
  });
}
export function checkPassiveBenchmarks(directory, candidate, command) {
  const names = readdirSync(directory).sort(); if (names.length !== 2 || names.some(name => !/^sidproj-56-bench-(?:mixed|tracked-source)-.+\.json$/.test(name))) throw new Error('passive benchmark files changed');
  const artifacts = names.map(name => json(path.join(directory, name))); const streams = new Set();
  for (const artifact of artifacts) {
    if (!exact(artifact, passiveKeys) || artifact.schemaVersion !== 1 || artifact.selfContained !== true || artifact.baseUrl !== 'http://localhost:5199' || !['mixed', 'tracked-source'].includes(artifact.stream) || streams.has(artifact.stream)) throw new Error('passive benchmark schema changed'); streams.add(artifact.stream);
    if (!exact(artifact.git, ['sha', 'dirty']) || artifact.git.sha !== candidate.gitSha || artifact.git.dirty !== true || artifact.bundleSha256 !== candidate.iifeSha256 || artifact.harnessSha256 !== candidate.passiveBenchmarkHarnessSha256 || artifact.browserVersion !== candidate.chromeRevision?.match(/\d+\.\d+\.\d+\.\d+/)?.[0]) throw new Error('passive benchmark identity changed');
    if (!exact(artifact.hardware, ['platform', 'arch', 'cpu', 'cores']) || artifact.hardware.platform !== os.platform() || artifact.hardware.arch !== os.arch() || artifact.hardware.cpu !== candidate.host.cpu || artifact.hardware.cores !== candidate.host.cores || stable(artifact.thresholds) !== stable(passiveThresholds) || artifact.failures?.length) throw new Error('passive benchmark environment or threshold changed');
    if (!iso(artifact.when) || (command && (Date.parse(artifact.when) < Date.parse(command.startedAt) - 1000 || Date.parse(artifact.when) > Date.parse(command.endedAt) + 1000))) throw new Error('passive benchmark time changed');
    const perBlock = summarizePassive(artifact.raw); if (stable(artifact.perBlock) !== stable(perBlock)) throw new Error('passive benchmark summary changed');
    const gates = Object.fromEntries(Object.keys(passiveThresholds).map(key => [key, median(perBlock.map(block => block[1000][key]))]));
    if (!exact(artifact.gates, [...Object.keys(passiveThresholds), 'pass']) || Object.entries(passiveThresholds).some(([key, limit]) => artifact.gates[key] !== gates[key] || !(gates[key] < limit)) || artifact.gates.pass !== true) throw new Error('passive benchmark gate changed');
  }
  if (streams.size !== 2) throw new Error('passive benchmark streams changed'); return true;
}

export function checkLabV04(directory, candidate) {
  if (stable(readdirSync(directory).sort()) !== stable([...labV04Files].sort())) throw new Error('v0.4 lab files changed');
  const primary = json(path.join(directory, labV04Files[0])); const matrix = json(path.join(directory, labV04Files[1])); const negatives = json(path.join(directory, labV04Files[2])); const summary = readFileSync(path.join(directory, labV04Files[3]), 'utf8'); const continuousPng = readFileSync(path.join(directory, labV04Files[4])); const burstPng = readFileSync(path.join(directory, labV04Files[5]));
  validateLabV04({ primary, matrix, negatives, summary, continuousPng, burstPng });
  if (primary.gitSha !== candidate.gitSha || primary.product.bundleSha256 !== candidate.iifeSha256) throw new Error('v0.4 lab candidate changed');
  const rows = readFileSync(path.join(directory, labV04Files[6]), 'utf8').trim().split('\n'); const covered = labV04Files.slice(0, 6).sort();
  if (rows.length !== covered.length) throw new Error('v0.4 lab manifest coverage changed');
  for (const [index, row] of rows.entries()) { const match = row.match(/^([a-f0-9]{64})  \/private\/tmp\/(sidproj-55-[A-Za-z0-9.-]+)$/); if (!match || match[2] !== covered[index] || hashFile(path.join(directory, match[2])) !== match[1]) throw new Error('v0.4 lab manifest changed'); }
  return true;
}

export function checkDocuments(releaseNotes, humanTest) { if (releaseNotes !== RELEASE_NOTES || humanTest !== HUMAN_TEST) throw new Error('release documents changed'); return true; }

export function checkCommands(directory, commands) {
  if (!Array.isArray(commands) || commands.length !== REQUIRED_COMMANDS.length || stable(readdirSync(path.join(directory, 'command-output')).sort()) !== stable(Array.from({ length: 10 }, (_, index) => [ `${String(index).padStart(2, '0')}.stderr`, `${String(index).padStart(2, '0')}.stdout` ]).flat().sort())) throw new Error('mechanical command set changed');
  let previousEnd = -Infinity;
  for (const [index, item] of commands.entries()) {
    if (!exact(item, commandKeys) || item.command !== REQUIRED_COMMANDS[index] || item.status !== 'PASS' || item.exitCode !== 0 || item.class !== 'mechanical' || !iso(item.startedAt) || !iso(item.endedAt) || Date.parse(item.startedAt) < previousEnd || Date.parse(item.endedAt) < Date.parse(item.startedAt) || Date.parse(item.endedAt) - Date.parse(item.startedAt) > 2 * 60 * 60 * 1000 || (item.artifactPath !== null && !path.isAbsolute(item.artifactPath))) throw new Error(`mechanical command changed: ${index}`);
    previousEnd = Date.parse(item.endedAt);
    for (const key of ['stdout', 'stderr']) { const file = item[key]; if (file !== `command-output/${String(index).padStart(2, '0')}.${key}` || !lstatSync(path.join(directory, file)).isFile()) throw new Error(`command output changed: ${index}`); }
  }
}

export function checkEvidence(directory, { expectedReportText } = {}) {
  const info = lstatSync(directory); if (!info.isDirectory() || info.isSymbolicLink() || stable(readdirSync(directory).sort()) !== stable([...ROOT_ENTRIES].sort())) throw new Error('evidence root entries changed');
  const candidate = json(path.join(directory, 'candidate.json'));
  if (!exact(candidate, candidateKeys) || candidate.schemaVersion !== 1 || candidate.issue !== 'SIDPROJ-70' || candidate.excludedPaths?.join('|') !== 'AGENTS.md' || candidate.files.join('|') !== [...CANDIDATE_ALLOWLIST].sort().join('|') || !exact(candidate.hashes, candidate.files) || !/^[0-9a-f]{40}$/.test(candidate.gitSha) || !exact(candidate.host, ['cpu', 'cores'])) throw new Error('candidate identity changed');
  const current = candidateIdentity(); if (candidateRetryHash(candidate) !== candidateRetryHash(current)) throw new Error('candidate is stale');
  for (const file of candidate.files) if (hashFile(path.join(root, file)) !== candidate.hashes[file]) throw new Error(`candidate file hash changed: ${file}`);
  checkRetry(json(path.join(directory, 'environment-retry.json')));
  const commands = json(path.join(directory, 'commands.json')); checkCommands(directory, commands);
  if (stable(readdirSync(path.join(directory, 'bench-v05'))) !== stable(['result.json'])) throw new Error('v0.5 benchmark files changed');
  const benchmark = json(path.join(directory, 'bench-v05/result.json'));
  const benchmarkFailures = checkBenchmarkEvidence(benchmark, { gitSha: candidate.gitSha, harnessSha256: candidate.benchmarkHarnessSha256, productionIifeSha256: candidate.iifeSha256, htmlSha256: candidate.hashes['apps/workbench/public/bench-v05.html'], diagnosticSourceSha256: candidate.hashes['packages/dogfood/v05-bench-diagnostic.ts'] });
  if (benchmarkFailures.length) throw new Error(`benchmark evidence failed: ${benchmarkFailures.join('; ')}`);
  checkPassiveBenchmarks(path.join(directory, 'bench-v04'), candidate, commands[6]);
  checkLabV04(path.join(directory, 'lab-v04'), candidate);
  checkExcalidrawEvidence(path.join(directory, 'excalidraw'));
  if (stable(readdirSync(path.join(directory, 'lab-v05'))) !== stable(['evidence'])) throw new Error('v0.5 lab directory changed');
  const labCheck = spawnSync('node', ['packages/dogfood/lab-v05.mjs', '--check-evidence', path.join(directory, 'lab-v05/evidence')], { cwd: root, encoding: 'utf8' });
  if (labCheck.status !== 0 || !labCheck.stdout.includes('CANVAS_LAB_V05_CHECK: PASS')) throw new Error(`copied v0.5 lab evidence failed: ${labCheck.stderr || labCheck.stdout}`);
  if (stable(readdirSync(path.join(directory, 'pack'))) !== stable(['summary.json'])) throw new Error('pack files changed');
  checkPackSummary(json(path.join(directory, 'pack/summary.json')), candidate);
  checkDocuments(readFileSync(path.join(directory, 'release-notes.md'), 'utf8'), readFileSync(path.join(directory, 'human-test.md'), 'utf8'));
  const gate = json(path.join(directory, 'gate.json'));
  if (!exact(gate, ['pass', 'productFailures', 'environmentFailures', 'mechanicalPass', 'candidate', 'report']) || gate.pass !== true || gate.mechanicalPass !== true || gate.productFailures.length || gate.environmentFailures.length || candidateRetryHash(gate.candidate) !== candidateRetryHash(candidate) || !exact(gate.report, ['path', 'sha256']) || gate.report.path !== 'docs/releases/v0.5-report.md') throw new Error('release gate changed');
  const reportText = expectedReportText ?? (existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null); if (reportText === null || sha256(reportText) !== gate.report.sha256) throw new Error('release report changed');
  const rows = readFileSync(path.join(directory, 'evidence-sha256.txt'), 'utf8').trim().split('\n').filter(Boolean); const files = safeTree(directory).filter(file => file !== 'evidence-sha256.txt').sort();
  const expectedRows = files.map(file => `${hashFile(path.join(directory, file))}  ${file}`); if (stable(rows) !== stable(expectedRows)) throw new Error('evidence hash manifest changed');
  return true;
}

function copyArtifact(source, destination) { if (!source || !existsSync(source)) throw new Error(`PRODUCT_FAILURE: missing command artifact: ${source}`); const info = lstatSync(source); if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error(`PRODUCT_FAILURE: unsafe command artifact: ${source}`); cpSync(source, destination, { recursive: statSync(source).isDirectory(), dereference: false, errorOnExist: true }); }
function outputPath(text) { return [...text.matchAll(/(\/private\/tmp\/sidproj-[A-Za-z0-9_.-]+(?:\.json)?)/g)].map(match => match[1]).find(file => existsSync(file)) ?? null; }
function outputPaths(text) { return [...new Set([...text.matchAll(/(\/private\/tmp\/sidproj-[A-Za-z0-9_.-]+(?:\.json)?)/g)].map(match => match[1]).filter(file => existsSync(file)))]; }
function writeJson(file, value, options) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, options); }
function writeManifest(directory) { writeFileSync(path.join(directory, 'evidence-sha256.txt'), `${safeTree(directory).filter(file => file !== 'evidence-sha256.txt').sort().map(file => `${hashFile(path.join(directory, file))}  ${file}`).join('\n')}\n`, { flag: 'wx' }); }
function runCommand(command, index, attempt) {
  const startedAt = new Date().toISOString(); const [bin, ...args] = command.split(' '); const env = command === 'pnpm --filter dogfood run lab:v0.5' ? { ...process.env, SIDPROJ_70_RELEASE: '1' } : process.env;
  const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env }); const endedAt = new Date().toISOString(); const stdout = `command-output/${String(index).padStart(2, '0')}.stdout`; const stderr = `command-output/${String(index).padStart(2, '0')}.stderr`;
  writeFileSync(path.join(attempt, stdout), result.stdout ?? '', { flag: 'wx' }); writeFileSync(path.join(attempt, stderr), result.stderr ?? String(result.error ?? ''), { flag: 'wx' });
  return { command, class: 'mechanical', startedAt, endedAt, exitCode: result.status ?? 1, status: classifyCommand({ exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, error: result.error }), stdout, stderr, artifactPath: outputPath(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) };
}
function matchingPriorAttempts(candidate) { return readdirSync(tmp).filter(name => name.startsWith('sidproj-70-release-attempt-')).map(name => path.join(tmp, name)).filter(directory => { try { return candidateRetryHash(json(path.join(directory, 'candidate.json'))) === candidateRetryHash(candidate) && ['environment-failure', 'product-failure'].includes(json(path.join(directory, 'environment-retry.json')).status); } catch { return false; } }); }
export function retryDecision(prior, currentCandidate, currentCondition) { if (prior.retry.status === 'product-failure') throw new Error('prior product failure cannot retry'); if (prior.retry.status !== 'environment-failure' || candidateRetryHash(prior.candidate) !== candidateRetryHash(currentCandidate)) throw new Error('prior retry candidate changed'); if (recursiveManifestHash(prior.retry.attemptPath) !== prior.retry.attemptManifestSha256) throw new Error('prior attempt manifest changed'); const name = prior.retry.failureFamily; if (!name || stable(prior.retry.checkedConditions[0]?.[name]) === stable(currentCondition[name])) throw new Error('environment condition did not change'); return { name, before: prior.retry.checkedConditions[0][name], after: currentCondition[name] }; }

function report(candidate, commands, benchmark, pack, external, retry, directory) {
  const evidence = safeTree(directory).filter(file => !['gate.json', 'evidence-sha256.txt'].includes(file)).sort().map(file => `- \`${file}\`: \`${hashFile(path.join(directory, file))}\``).join('\n');
  const diagnosticCount = benchmark.pairs.flatMap(pair => pair.states).reduce((count, state) => count + state.diagnostics.length, 0) + Object.values(external.diagnostics).reduce((sum, value) => sum + value, 0);
  return `# canvas-scan@${candidate.version} v0.5 release evidence report\n\nStatus: PASS. This report describes checked local evidence for SIDPROJ-70.\n\n## Candidate\n\n- Git SHA: \`${candidate.gitSha}\`\n- Branch: \`${candidate.branch}\`\n- Tarball SHA-256: \`${candidate.tarballSha256}\`\n- IIFE SHA-256: \`${candidate.iifeSha256}\`\n- Chrome revision: ${benchmark.chromeRevision}\n- Host CPU: ${benchmark.hardware.cpu} (${benchmark.hardware.cores} cores)\n\n## Commands\n\n| Command | Status |\n| --- | --- |\n${commands.map(item => `| \`${item.command}\` | ${item.status} |`).join('\n')}\n\n## Performance and structure\n\n- Selected detail paired mean: ${mean(benchmark.deltas)} ms. Strict limit: less than 4 ms.\n- Selected detail paired p95: ${nearestRankP95(benchmark.deltas)} ms. Strict limit: less than 8 ms.\n- No-selection command allocations: ${benchmark.noSelection.countersAfter.commandEntryAllocations}.\n- No-selection stack allocations: ${benchmark.noSelection.countersAfter.stackAllocations}.\n- The passive v0.4 command passed both published streams. Its copied raw artifacts are in \`bench-v04/\`.\n\n## Package\n\n- Pack status: ${pack.finalStatus}.\n- Runtime exports: ${pack.runtimeExports.length}.\n- Type exports: ${pack.typeExports.length}.\n- Clean runtime import: ${pack.publicSurfaceProbe.importStatus}.\n- Clean type check: ${pack.publicSurfaceProbe.typecheckStatus}.\n\n## External observation\n\nThe Excalidraw result is an external observation. It is not controlled truth.\n\n- Baseline finding index: ${external.baseline.findingIndex}.\n- Candidate finding index: ${external.candidate.findingIndex}.\n- Command status: ${external.explanation.status}${external.explanation.unknownReason ? ` (${external.explanation.unknownReason})` : ''}.\n- Mapping status: ${external.explanation.mappingStatus}${external.explanation.unresolvedReason ? ` (${external.explanation.unresolvedReason})` : ''}.\n- Drop counts: \`${JSON.stringify(external.dropCounts)}\`.\n- Diagnostics: ${diagnosticCount}.\n\n## Run ledger\n\n- Correction rounds: 1/1.\n- Full evidence runs: ${retry.attemptCount}/2.\n- Judge rounds: 1/2.\n\n## Raw evidence\n\n${evidence}\n\nLocal raw evidence does not prove a successful Linear attachment. V05-10 owns the human test and release decision.\n`;
}
function recordFailure(attempt, candidate, condition, previous, error) {
  const text = String(error); const classification = text.includes('PRODUCT_FAILURE:') ? 'product-failure' : text.includes('ENVIRONMENT_FAILURE:') || environmentText(text) ? 'environment-failure' : 'product-failure'; const family = classification === 'environment-failure' ? failureFamily(text) : null;
  const retry = { attemptCount: previous ? 2 : 1, status: classification, attemptPath: attempt, attemptManifestSha256: recursiveManifestHash(attempt), priorAttemptPath: previous?.retry.attemptPath ?? null, priorManifestSha256: previous?.retry.attemptManifestSha256 ?? null, priorError: text, failureFamily: family, checkedConditions: previous ? [previous.retry.checkedConditions[0], condition] : [condition], changedCondition: previous ? { name: previous.retry.failureFamily, before: previous.retry.checkedConditions[0][previous.retry.failureFamily], after: condition[previous.retry.failureFamily] } : null };
  writeJson(path.join(attempt, 'environment-retry.json'), retry); return retry;
}

function main() {
  if (existsSync(finalDirectory)) throw new Error(`final evidence directory already exists: ${finalDirectory}`); if (existsSync(reportPath)) throw new Error(`release report already exists: ${reportPath}`);
  checkDocuments(readFileSync(path.join(root, 'docs/releases/v0.5-release-notes.md'), 'utf8'), readFileSync(path.join(root, 'docs/releases/v0.5-human-test.md'), 'utf8'));
  const candidate = candidateIdentity(); if (candidate.files.join('|') !== [...CANDIDATE_ALLOWLIST].sort().join('|')) throw new Error('candidate scope changed');
  const condition = environmentCondition(); const matches = matchingPriorAttempts(candidate); if (matches.length > 1) throw new Error('more than one prior attempt exists for this candidate');
  const previous = matches.length ? { candidate: json(path.join(matches[0], 'candidate.json')), retry: json(path.join(matches[0], 'environment-retry.json')) } : null; const changedCondition = previous ? retryDecision(previous, candidate, condition) : null;
  const attempt = path.join(tmp, `sidproj-70-release-attempt-${Date.now()}-${process.pid}-${randomUUID()}`); mkdirSync(attempt, { recursive: false }); mkdirSync(path.join(attempt, 'command-output')); writeJson(path.join(attempt, 'candidate.json'), candidate, { flag: 'wx' });
  const initialRetry = { attemptCount: previous ? 2 : 1, status: previous ? 'used' : 'not-used', attemptPath: finalDirectory, attemptManifestSha256: null, priorAttemptPath: previous?.retry.attemptPath ?? null, priorManifestSha256: previous?.retry.attemptManifestSha256 ?? null, priorError: previous?.retry.priorError ?? null, failureFamily: previous?.retry.failureFamily ?? null, checkedConditions: previous ? [previous.retry.checkedConditions[0], condition] : [condition], changedCondition };
  writeJson(path.join(attempt, 'environment-retry.json'), initialRetry, { flag: 'wx' });
  try {
    const commands = [];
    for (const [index, command] of REQUIRED_COMMANDS.entries()) { const record = runCommand(command, index, attempt); commands.push(record); if (record.status !== 'PASS') break; }
    writeJson(path.join(attempt, 'commands.json'), commands, { flag: 'wx' });
    if (commands.length !== REQUIRED_COMMANDS.length || commands.some(record => record.status !== 'PASS')) { const failed = commands.at(-1); throw new Error(`${failed.status}: ${failed.command}: ${readFileSync(path.join(attempt, failed.stdout), 'utf8')}\n${readFileSync(path.join(attempt, failed.stderr), 'utf8')}`); }
    const byCommand = command => commands.find(record => record.command === command)?.artifactPath;
    for (const directory of ['bench-v04', 'bench-v05', 'lab-v04', 'lab-v05', 'pack']) mkdirSync(path.join(attempt, directory));
    for (const name of labV04Files) copyArtifact(path.join(tmp, name), path.join(attempt, 'lab-v04', name));
    copyArtifact(byCommand('pnpm --filter dogfood run lab:v0.5'), path.join(attempt, 'lab-v05/evidence'));
    const passiveRecord = commands[6]; const passivePaths = outputPaths(`${readFileSync(path.join(attempt, passiveRecord.stdout), 'utf8')}\n${readFileSync(path.join(attempt, passiveRecord.stderr), 'utf8')}`).filter(file => /^\/private\/tmp\/sidproj-56-bench-(?:mixed|tracked-source)-.+\.json$/.test(file));
    if (passivePaths.length !== 2) throw new Error('PRODUCT_FAILURE: passive benchmark output paths changed'); for (const source of passivePaths) copyArtifact(source, path.join(attempt, 'bench-v04', path.basename(source)));
    copyArtifact(byCommand('pnpm --filter dogfood run bench:v0.5:chrome'), path.join(attempt, 'bench-v05/result.json')); copyArtifact(path.join(tmp, 'sidproj-70-pack-summary.json'), path.join(attempt, 'pack/summary.json')); copyArtifact(path.join(root, 'docs/releases/v0.5-release-notes.md'), path.join(attempt, 'release-notes.md')); copyArtifact(path.join(root, 'docs/releases/v0.5-human-test.md'), path.join(attempt, 'human-test.md'));
    const external = spawnSync('node', ['packages/dogfood/excalidraw-v05.mjs', path.join(attempt, 'excalidraw')], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); if (external.status !== 0) throw new Error(`${environmentText(`${external.stdout}\n${external.stderr}`) ? 'ENVIRONMENT_FAILURE' : 'PRODUCT_FAILURE'}: external evidence: ${external.stderr || external.stdout}`);
    const benchmark = json(path.join(attempt, 'bench-v05/result.json')); const benchmarkFailures = checkBenchmarkEvidence(benchmark, { gitSha: candidate.gitSha, harnessSha256: candidate.benchmarkHarnessSha256, productionIifeSha256: candidate.iifeSha256, htmlSha256: candidate.hashes['apps/workbench/public/bench-v05.html'], diagnosticSourceSha256: candidate.hashes['packages/dogfood/v05-bench-diagnostic.ts'] }); if (benchmarkFailures.length) throw new Error(`PRODUCT_FAILURE: ${benchmarkFailures.join('; ')}`);
    checkPassiveBenchmarks(path.join(attempt, 'bench-v04'), candidate, commands[6]); checkLabV04(path.join(attempt, 'lab-v04'), candidate); checkExcalidrawEvidence(path.join(attempt, 'excalidraw'));
    const labCheck = spawnSync('node', ['packages/dogfood/lab-v05.mjs', '--check-evidence', path.join(attempt, 'lab-v05/evidence')], { cwd: root, encoding: 'utf8' }); if (labCheck.status !== 0) throw new Error(`PRODUCT_FAILURE: copied v0.5 lab evidence failed: ${labCheck.stderr || labCheck.stdout}`);
    const pack = json(path.join(attempt, 'pack/summary.json')); candidate.tarballSha256 = pack.tarballSha256 ?? null; writeJson(path.join(attempt, 'candidate.json'), candidate); checkPackSummary(pack, candidate);
    const externalEvidence = json(path.join(attempt, 'excalidraw/evidence.json')); const gateResult = evaluateRelease({ commands, bench: { meanMs: mean(benchmark.deltas), p95Ms: nearestRankP95(benchmark.deltas), noSelection: benchmark.noSelection.countersAfter }, pack: { status: pack.finalStatus }, external: { status: 'PASS' } }); if (!gateResult.pass) throw new Error(`PRODUCT_FAILURE: ${gateResult.productFailures.concat(gateResult.environmentFailures).join(', ')}`);
    writeJson(path.join(attempt, 'environment-retry.json'), initialRetry); const reportText = report(candidate, commands, benchmark, pack, externalEvidence, initialRetry, attempt); writeJson(path.join(attempt, 'gate.json'), { ...gateResult, mechanicalPass: true, candidate, report: { path: 'docs/releases/v0.5-report.md', sha256: sha256(reportText) } }, { flag: 'wx' }); writeManifest(attempt);
    checkEvidence(attempt, { expectedReportText: reportText }); renameSync(attempt, finalDirectory); writeFileSync(reportPath, reportText, { flag: 'wx' }); checkEvidence(finalDirectory); console.log(finalDirectory);
  } catch (error) {
    const value = error instanceof Error ? error.stack ?? error.message : String(error);
    if (existsSync(attempt)) { const retry = recordFailure(attempt, candidate, condition, previous, value); console.error(`${retry.status === 'environment-failure' ? 'ENVIRONMENT_FAILURE' : 'PRODUCT_FAILURE'}: ${value}`); console.error(`ATTEMPT: ${attempt}`); } else console.error(`PRODUCT_FAILURE: final promotion failed: ${value}`);
    process.exitCode = 1;
  }
}

if (process.argv[2] === '--check-evidence') { checkEvidence(process.argv[3]); console.log('SIDPROJ_70_EVIDENCE: PASS'); } else if (process.argv[1] === fileURLToPath(import.meta.url)) main();
