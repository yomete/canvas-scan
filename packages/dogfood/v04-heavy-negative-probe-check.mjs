import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRunDirectory, checkRunIndex, parseExactJson, readCurrentArtifact, sha256, verifyReleaseManifest } from './v04-evidence-run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const dropKeys = ['canvasWindowReports', 'canvasLifetimes', 'resetEvents', 'lifecycleEvents', 'documentEvents', 'eventTiming', 'userMarks', 'longAnimationFrames'];
const diagnostics = ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills', 'unsupportedEvidence'];
const failureOrder = ['manifest schema', 'trusted module set', 'trusted module order', 'trusted module digest', 'run directory', 'artifact identity', 'artifact set', 'artifact schema', 'browser scripts', 'browser options', 'bootstrap ready', 'calibration', 'runtime counts', 'artifact truth', 'unknown support', 'diagnostics', 'port'];
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const band = value => finite(value) && value >= 7 && value < 8;
const canonicalTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const median = values => [...values].sort((left, right) => left - right).slice(4, 6).reduce((sum, value) => sum + value, 0) / 2;
const calibrationKeys = [
  'targetMs', 'bandMinimumInclusiveMs', 'bandMaximumExclusiveMs', 'maxIterations', 'maxMeasuredWorkElapsedMs', 'maxPreflightElapsedMs',
  'trailingOperations', 'finalPaintCount', 'finalPaintMethodCallCount', 'finalPaintStyleStepCount', 'workloadScale', 'workloadWidth', 'workloadHeight',
  'trailingXMultiplier', 'trailingYMultiplier', 'trailingEdgeInset', 'trailingRectWidth', 'trailingRectHeight', 'scene', 'finalPaintColors',
  'warmupPolicy', 'calibrationSource', 'timingModel', 'operationPlan', 'cap', 'declaredWarmupCallCount', 'observedWarmupCallCount',
  'declaredPrimitiveSampleCount', 'observedPrimitiveSampleCount', 'declaredFixedPlanSampleCount', 'observedFixedPlanSampleCount', 'maxCallCount',
  'primitiveSamplesMs', 'primitiveMedianMs', 'fixedPlanSamplesMs', 'fixedPlanMedianMs', 'nativeWorkBudgetMs', 'callCount', 'planCallCount',
  'planStyleStepCount', 'calibrationCallDurationsMs', 'calibratedNativeSelfTimeMs', 'modeledNativeSelfTimeMs', 'measuredOuterTimeMs', 'measuredOuterOverrunMs', 'preflightElapsedMs',
];
const countKeys = ['declaredWarmupCallCount', 'observedWarmupCallCount', 'declaredPrimitiveSampleCount', 'observedPrimitiveSampleCount', 'declaredFixedPlanSampleCount', 'observedFixedPlanSampleCount'];
const runtimeCounts = value => value.declaredWarmupCallCount === 2 && value.observedWarmupCallCount === 2 && value.declaredPrimitiveSampleCount === 3 && value.observedPrimitiveSampleCount === 3 && value.declaredFixedPlanSampleCount === 3 && value.observedFixedPlanSampleCount === 3 && value.primitiveSamplesMs?.length === value.observedPrimitiveSampleCount && value.fixedPlanSamplesMs?.length === value.observedFixedPlanSampleCount;
const validCalibrationShape = value => {
  if (!keys(value, calibrationKeys) || !countKeys.every(key => Number.isInteger(value[key]) && value[key] >= 0)) return false;
  const constants = value.targetMs === 7.4 && value.bandMinimumInclusiveMs === 7 && value.bandMaximumExclusiveMs === 8 && value.maxIterations === 2048 && value.maxMeasuredWorkElapsedMs === 12 && value.maxPreflightElapsedMs === 50 && value.trailingOperations === 200 && value.finalPaintCount === 1 && value.finalPaintMethodCallCount === 4 && value.finalPaintStyleStepCount === 4 && value.workloadScale === 4 && value.workloadWidth === 1280 && value.workloadHeight === 560 && value.trailingXMultiplier === 13 && value.trailingYMultiplier === 7 && value.trailingEdgeInset === 8 && value.trailingRectWidth === 3 && value.trailingRectHeight === 2 && value.maxCallCount === 32 && value.planStyleStepCount === 4 && value.warmupPolicy === 'same-realm-native-before-ready' && value.calibrationSource === 'detached-html-canvas-2d-native' && value.timingModel === 'per-native-call' && value.operationPlan === 'heavy-negative-v1' && value.cap === 'call-count';
  if (!constants || JSON.stringify(value.scene) !== JSON.stringify([18, 24, 82, 44, 132, 56]) || JSON.stringify(value.finalPaintColors) !== JSON.stringify(['#07111f', '#38bdf8', '#a78bfa'])) return false;
  if (!Array.isArray(value.primitiveSamplesMs) || !value.primitiveSamplesMs.every(item => finite(item) && item > 0) || !Array.isArray(value.fixedPlanSamplesMs) || !value.fixedPlanSamplesMs.every(item => finite(item) && item >= 0) || !Array.isArray(value.calibrationCallDurationsMs) || !value.calibrationCallDurationsMs.every(item => finite(item) && item >= 0)) return false;
  if (!Number.isInteger(value.callCount) || value.callCount < 1 || value.callCount > value.maxCallCount || value.planCallCount !== value.callCount + 204 || value.calibrationCallDurationsMs.length !== value.planCallCount) return false;
  const middle = items => [...items].sort((left, right) => left - right)[1];
  return value.primitiveMedianMs === middle(value.primitiveSamplesMs) && value.fixedPlanMedianMs === middle(value.fixedPlanSamplesMs) && value.nativeWorkBudgetMs === value.targetMs - value.fixedPlanMedianMs && value.callCount === Math.ceil(value.nativeWorkBudgetMs / value.primitiveMedianMs) && value.modeledNativeSelfTimeMs === value.primitiveMedianMs * value.callCount + value.fixedPlanMedianMs && band(value.modeledNativeSelfTimeMs) && value.calibratedNativeSelfTimeMs === value.calibrationCallDurationsMs.reduce((sum, item) => sum + item, 0) && band(value.calibratedNativeSelfTimeMs) && finite(value.measuredOuterTimeMs) && value.measuredOuterTimeMs >= 0 && value.measuredOuterTimeMs <= value.maxMeasuredWorkElapsedMs && value.measuredOuterOverrunMs === 0 && finite(value.preflightElapsedMs) && value.preflightElapsedMs >= 0 && value.preflightElapsedMs <= value.maxPreflightElapsedMs;
};
export function validCalibration(value) {
  return validCalibrationShape(value) && runtimeCounts(value);
}
export function checkBrowserContract(value) {
  const expected = [
    { role: 'options', kind: 'classic-inline', rawSrc: null, resolvedPath: null, query: '', fragment: '' },
    { role: 'canvas-scan', kind: 'classic-external', rawSrc: '/canvas-scan.iife.js', resolvedPath: '/canvas-scan.iife.js', query: '', fragment: '' },
    { role: 'application', kind: 'module-external', rawSrc: '/src/v04-lab-main.tsx', resolvedPath: '/src/v04-lab-main.tsx', query: '', fragment: '' },
  ];
  if (!keys(value, ['scripts', 'options', 'ready']) || !Array.isArray(value.scripts) || JSON.stringify(value.scripts) !== JSON.stringify(expected)) return 'browser scripts';
  if (!keys(value.options, ['own', 'frozen', 'writable', 'configurable', 'keys', 'overlay']) || JSON.stringify(value.options) !== JSON.stringify({ own: true, frozen: true, writable: false, configurable: false, keys: ['overlay'], overlay: true })) return 'browser options';
  if (!keys(value.ready, ['canvasScan', 'fixture', 'capabilityValidated']) || JSON.stringify(value.ready) !== JSON.stringify({ canvasScan: true, fixture: true, capabilityValidated: true })) return 'bootstrap ready';
  return null;
}
export function parseTargetedArgs(args) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') throw new Error('run directory');
  return args[0];
}
export function checkArtifact(value, identity, listeners = [], now = Date.now()) {
  const failures = []; const top = ['schemaVersion', 'runId', 'startedAt', 'endedAt', 'coordinate', 'band', 'runCount', 'runs', 'values', 'minimum', 'maximum', 'median', 'chromeRevision', 'gitSha', 'bundleSha256', 'manifestSha256', 'modules', 'browserContract', 'diagnostics', 'port'];
  if (!keys(value, top) || value.schemaVersion !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value?.runId ?? '') || !canonicalTime(value?.startedAt) || !canonicalTime(value?.endedAt) || Date.parse(value.startedAt) >= Date.parse(value.endedAt) || Date.parse(value.endedAt) - Date.parse(value.startedAt) > 30 * 60 * 1000 || Date.parse(value.startedAt) > now || Date.parse(value.endedAt) > now || now - Date.parse(value.endedAt) > 24 * 60 * 60 * 1000) failures.push('artifact schema');
  if (!Array.isArray(value?.modules) || JSON.stringify(value.modules) !== JSON.stringify(identity.modules) || value.manifestSha256 !== identity.manifestSha256 || value.chromeRevision !== identity.chromeRevision || value.gitSha !== identity.gitSha || value.bundleSha256 !== identity.bundleSha256) failures.push('artifact identity');
  const browser = checkBrowserContract(value?.browserContract); if (browser) failures.push(browser);
  if (!Array.isArray(value?.runs) || !Array.isArray(value?.values) || value.runCount !== 10 || value.runs.length !== 10 || value.values.length !== 10) failures.push('artifact schema');
  else {
    for (const [index, row] of value.runs.entries()) {
      if (!keys(row, ['iteration', 'canvasApiSelfTimeMs', 'acceptedRunCount', 'droppedEntryCounts', 'calibration']) || row.iteration !== index + 1 || row.canvasApiSelfTimeMs !== value.values[index] || row.acceptedRunCount !== 1 || !keys(row.droppedEntryCounts, dropKeys) || dropKeys.some(key => row.droppedEntryCounts[key] !== 0)) failures.push('artifact schema');
      if (!validCalibrationShape(row?.calibration)) failures.push('calibration');
      if (row?.calibration && !runtimeCounts(row.calibration)) failures.push('runtime counts');
    }
  }
  if (!keys(value?.coordinate, ['scenario', 'variant', 'mode']) || JSON.stringify(value.coordinate) !== JSON.stringify({ scenario: 'heavy-burst', variant: 'nearest-negative', mode: 'negative' }) || !keys(value?.band, ['minimumInclusiveMs', 'maximumExclusiveMs']) || value.band.minimumInclusiveMs !== 7 || value.band.maximumExclusiveMs !== 8 || !Array.isArray(value?.values) || new Set(value.values).size !== 10 || value.values.some(item => !band(item)) || value.minimum !== Math.min(...value.values) || value.maximum !== Math.max(...value.values) || value.median !== median(value.values)) failures.push('artifact truth');
  if (!keys(value?.diagnostics, diagnostics) || diagnostics.some(key => !Array.isArray(value.diagnostics[key]) || value.diagnostics[key].length)) failures.push('diagnostics');
  if (JSON.stringify(value?.port) !== JSON.stringify({ number: 5190, listenersBefore: [], listenersAfter: [] }) || listeners.length) failures.push('port');
  return [...new Set(failures)].sort((left, right) => failureOrder.indexOf(left) - failureOrder.indexOf(right));
}
const listeners = () => { try { return String(execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP@127.0.0.1:5190', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })).trim().split('\n').filter(Boolean); } catch (error) { if (error?.status === 1) return []; throw error; } };
export async function currentIdentity() {
  const modules = await verifyReleaseManifest();
  const chromeRevision = execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version'], { encoding: 'utf8' }).match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const { readFile } = await import('node:fs/promises');
  const bundleSha256 = sha256(await readFile(path.join(root, 'apps/workbench/public/canvas-scan.iife.js')));
  const manifestSha256 = sha256(await readFile(path.join(root, 'packages/dogfood/v04-release-manifest.mjs')));
  return { modules, chromeRevision, gitSha, bundleSha256, manifestSha256 };
}
export async function checkTargetedRun(directory, expectedRun) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('run directory');
  const match = /^\/private\/tmp\/sidproj-102-targeted-([0-9a-f-]{36})$/.exec(directory);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(match[1])) throw new Error('run directory');
  const { lstat } = await import('node:fs/promises'); let stat;
  try { stat = await lstat(directory); } catch { throw new Error('run directory'); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.nlink < 1) throw new Error('run directory');
  const run = expectedRun ?? { kind: 'targeted', runId: match[1], directory, directoryIdentity: { device: String(stat.dev), inode: String(stat.ino) } };
  if (run.kind !== 'targeted' || run.runId !== match[1] || run.directory !== directory || run.directoryIdentity.device !== String(stat.dev) || run.directoryIdentity.inode !== String(stat.ino)) throw new Error('run directory');
  await checkRunDirectory(run); const index = await checkRunIndex(run); const bytes = await readCurrentArtifact(run, 'targeted.json'); const artifact = parseExactJson(bytes.toString('utf8'));
  const failures = checkArtifact(artifact, await currentIdentity(), listeners()); if (failures.length) throw new Error(failures.join(', ')); if (index.runId !== match[1] || artifact.runId !== match[1]) throw new Error('artifact identity');
  if (index.startedAt !== artifact.startedAt || index.endedAt !== artifact.endedAt || index.source.gitSha !== artifact.gitSha || index.source.chromeRevision !== artifact.chromeRevision || index.source.bundleSha256 !== artifact.bundleSha256 || index.source.manifestSha256 !== artifact.manifestSha256 || JSON.stringify(index.source.modules) !== JSON.stringify(artifact.modules)) throw new Error('artifact identity');
  return { run, index, artifact };
}
async function main() {
  await checkTargetedRun(parseTargetedArgs(process.argv.slice(2)));
  console.log('SIDPROJ_102_TARGETED_PROBE: PASS');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
