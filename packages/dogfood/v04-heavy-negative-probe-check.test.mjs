import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkArtifact, checkBrowserContract, checkTargetedRun, parseTargetedArgs, validCalibration } from './v04-heavy-negative-probe-check.mjs';
import { checkRunDirectory, checkRunIndex, createEvidenceRun, parseExactJson, readCurrentArtifact, removeOwnedTemporary, sha256, trustedModuleSpec, verifyReleaseManifest, writeFinalArtifact, writeRunIndex } from './v04-evidence-run.mjs';
import { portListeners, runWithCleanup, stopOwned, writeWithFinalPortProof } from './v04-heavy-negative-probe.mjs';

const rejects = (promise, message) => assert.rejects(promise, error => error.message === message);

const browserContract = { scripts: [{ role: 'options', kind: 'classic-inline', rawSrc: null, resolvedPath: null, query: '', fragment: '' }, { role: 'canvas-scan', kind: 'classic-external', rawSrc: '/canvas-scan.iife.js', resolvedPath: '/canvas-scan.iife.js', query: '', fragment: '' }, { role: 'application', kind: 'module-external', rawSrc: '/src/v04-lab-main.tsx', resolvedPath: '/src/v04-lab-main.tsx', query: '', fragment: '' }], options: { own: true, frozen: true, writable: false, configurable: false, keys: ['overlay'], overlay: true }, ready: { canvasScan: true, fixture: true, capabilityValidated: true } };
const calibration = { targetMs: 7.4, bandMinimumInclusiveMs: 7, bandMaximumExclusiveMs: 8, maxIterations: 2048, maxMeasuredWorkElapsedMs: 12, maxPreflightElapsedMs: 50, trailingOperations: 200, finalPaintCount: 1, finalPaintMethodCallCount: 4, finalPaintStyleStepCount: 4, workloadScale: 4, workloadWidth: 1280, workloadHeight: 560, trailingXMultiplier: 13, trailingYMultiplier: 7, trailingEdgeInset: 8, trailingRectWidth: 3, trailingRectHeight: 2, scene: [18, 24, 82, 44, 132, 56], finalPaintColors: ['#07111f', '#38bdf8', '#a78bfa'], warmupPolicy: 'same-realm-native-before-ready', calibrationSource: 'detached-html-canvas-2d-native', timingModel: 'per-native-call', operationPlan: 'heavy-negative-v1', cap: 'call-count', declaredWarmupCallCount: 2, observedWarmupCallCount: 2, declaredPrimitiveSampleCount: 3, observedPrimitiveSampleCount: 3, declaredFixedPlanSampleCount: 3, observedFixedPlanSampleCount: 3, maxCallCount: 32, primitiveSamplesMs: [1, 1, 1], primitiveMedianMs: 1, fixedPlanSamplesMs: [0.4, 0.4, 0.4], fixedPlanMedianMs: 0.4, nativeWorkBudgetMs: 7, callCount: 7, planCallCount: 211, planStyleStepCount: 4, calibrationCallDurationsMs: [7.4, ...Array(210).fill(0)], calibratedNativeSelfTimeMs: 7.4, modeledNativeSelfTimeMs: 7.4, measuredOuterTimeMs: 8, measuredOuterOverrunMs: 0, preflightElapsedMs: 20 };
const identity = { chromeRevision: '151.0.0.0', gitSha: 'a'.repeat(40), bundleSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64), modules: [] };
const checkedAt = Date.parse('2026-08-13T10:00:02.000Z');
const artifact = () => { const values = [7.01, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9]; return { schemaVersion: 2, runId: '12345678-1234-4123-8123-123456789abc', startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:00:01.000Z', coordinate: { scenario: 'heavy-burst', variant: 'nearest-negative', mode: 'negative' }, band: { minimumInclusiveMs: 7, maximumExclusiveMs: 8 }, runCount: 10, runs: values.map((canvasApiSelfTimeMs, index) => ({ iteration: index + 1, canvasApiSelfTimeMs, acceptedRunCount: 1, droppedEntryCounts: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 }, calibration: structuredClone(calibration) })), values, minimum: 7.01, maximum: 7.9, median: 7.45, chromeRevision: identity.chromeRevision, gitSha: identity.gitSha, bundleSha256: identity.bundleSha256, manifestSha256: identity.manifestSha256, modules: [], browserContract, diagnostics: { warnings: [], consoleErrors: [], pageErrors: [], requestFailures: [], instrumentationKills: [], unsupportedEvidence: [] }, port: { number: 5190, listenersBefore: [], listenersAfter: [] } }; };
test('accepts the closed browser contract', () => assert.equal(checkBrowserContract(browserContract), null));
for (const [label, mutate, failure] of [['a later script', value => value.scripts.push({}), 'browser scripts'], ['a mutable option', value => value.options.writable = true, 'browser options'], ['a missing ready flag', value => value.ready.fixture = false, 'bootstrap ready']]) test(`rejects ${label}`, () => { const value = structuredClone(browserContract); mutate(value); assert.equal(checkBrowserContract(value), failure); });
test('checks runtime counts', () => { assert.equal(validCalibration(calibration), true); assert.equal(validCalibration({ ...calibration, observedWarmupCallCount: 1 }), false); });
test('accepts the closed artifact', () => assert.deepEqual(checkArtifact(artifact(), identity, [], checkedAt), []));
test('rejects a changed trusted module identity', () => { const value = artifact(); value.manifestSha256 = 'd'.repeat(64); assert.deepEqual(checkArtifact(value, identity, [], checkedAt), ['artifact identity']); });
test('rejects a count mutation', () => { const value = artifact(); value.runs[0].calibration.observedPrimitiveSampleCount = 2; assert.deepEqual(checkArtifact(value, identity, [], checkedAt), ['runtime counts']); });
test('orders identity before schema for a combined mutation', () => { const value = artifact(); value.manifestSha256 = 'd'.repeat(64); value.extra = true; assert.deepEqual(checkArtifact(value, identity, [], checkedAt), ['artifact identity', 'artifact schema']); });
test('rejects target evidence that is ten seconds in the future', () => { const value = artifact(); value.startedAt = '2026-08-13T10:00:10.000Z'; value.endedAt = '2026-08-13T10:00:11.000Z'; assert.deepEqual(checkArtifact(value, identity, [], checkedAt), ['artifact schema']); });

async function manifestTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-102-manifest-'));
  const modules = [];
  for (const [index, item] of trustedModuleSpec.entries()) {
    const target = path.join(root, item.path); await mkdir(path.dirname(target), { recursive: true }); const bytes = Buffer.from(`module-${index}\n`); await writeFile(target, bytes); modules.push({ ...item, sha256: sha256(bytes) });
  }
  return { root, manifest: { schemaVersion: 1, algorithm: 'sha256', modules }, close: () => rm(root, { recursive: true }) };
}
const manifestCase = (name, mutate, message) => test(name, async () => {
  const fixture = await manifestTree();
  try { await mutate(fixture); await assert.rejects(verifyReleaseManifest(fixture.root, fixture.manifest), error => error.message === message); }
  finally { await fixture.close(); }
});

for (const [index, item] of trustedModuleSpec.entries()) {
  manifestCase(`rejects changed bytes for ${item.role}`, async ({ root }) => writeFile(path.join(root, item.path), `changed-${index}`), 'trusted module digest');
  manifestCase(`rejects a missing ${item.role}`, async ({ root }) => unlink(path.join(root, item.path)), 'trusted module set');
}
for (let index = 0; index < trustedModuleSpec.length - 1; index++) manifestCase(`rejects manifest order swap ${index + 1}`, async ({ manifest }) => { [manifest.modules[index], manifest.modules[index + 1]] = [manifest.modules[index + 1], manifest.modules[index]]; }, 'trusted module order');
manifestCase('rejects an extra trusted module row', async ({ manifest }) => manifest.modules.push({ ...manifest.modules[0] }), 'trusted module set');
manifestCase('rejects a renamed trusted module path', async ({ manifest }) => { manifest.modules[0].path = 'changed.html'; }, 'trusted module set');
manifestCase('rejects a changed trusted module role', async ({ manifest }) => { manifest.modules[0].role = 'changed'; }, 'trusted module set');
for (const [name, digest] of [['missing', undefined], ['short', 'a'], ['uppercase', 'A'.repeat(64)], ['non-hex', 'z'.repeat(64)]]) manifestCase(`rejects a ${name} digest`, async ({ manifest }) => { if (digest === undefined) delete manifest.modules[0].sha256; else manifest.modules[0].sha256 = digest; }, 'manifest schema');
manifestCase('rejects an extra manifest field', async ({ manifest }) => { manifest.modules[0].extra = true; }, 'manifest schema');
manifestCase('rejects an extra top-level manifest field', async ({ manifest }) => { manifest.extra = true; }, 'manifest schema');
for (const [index, item] of trustedModuleSpec.entries()) manifestCase(`rejects an extra digest field for ${item.role}`, async ({ manifest }) => { manifest.modules[index].sha256Extra = manifest.modules[index].sha256; }, 'manifest schema');

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
async function repositoryManifestTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-102-source-')); const modules = [];
  for (const item of trustedModuleSpec) { const target = path.join(root, item.path); const bytes = await readFile(path.join(projectRoot, item.path)); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); modules.push({ ...item, sha256: sha256(bytes) }); }
  return { root, manifest: { schemaVersion: 1, algorithm: 'sha256', modules }, close: () => rm(root, { recursive: true }) };
}
const semanticMutations = [
  ['moves capability validation after fixture readiness', 'calibration-fixture', "    if (!validNativeCanvas2D(nativeCanvas2D)) throw new Error('invalid native canvas capability');", "    queueMicrotask(() => { if (!validNativeCanvas2D(nativeCanvas2D)) throw new Error('invalid native canvas capability'); });"],
  ['puts capability validation behind dead code', 'calibration-fixture', "    if (!validNativeCanvas2D(nativeCanvas2D)) throw new Error('invalid native canvas capability');", "    if (false && !validNativeCanvas2D(nativeCanvas2D)) throw new Error('invalid native canvas capability');"],
  ['changed warm-up loop bound', 'calibration-fixture', 'for (let index = 0; index < 2; index++) { observedWarmupCallCount++;', 'for (let index = 0; index < 3; index++) { observedWarmupCallCount++;'],
  ['changed primitive sample loop bound', 'calibration-fixture', 'index < HEAVY_NEGATIVE_PRIMITIVE_SAMPLE_COUNT', 'index < HEAVY_NEGATIVE_PRIMITIVE_SAMPLE_COUNT - 1'],
  ['changed fixed-plan sample loop bound', 'calibration-fixture', 'index < HEAVY_NEGATIVE_FIXED_PLAN_SAMPLE_COUNT', 'index < HEAVY_NEGATIVE_FIXED_PLAN_SAMPLE_COUNT - 1'],
  ['changed capability validation', 'calibration-fixture', 'if (!validNativeCanvas2D(nativeCanvas2D))', 'if (validNativeCanvas2D(nativeCanvas2D))'],
  ['changed captured native method', 'bootstrap', 'const putImageData = prototype.putImageData;', 'const putImageData = prototype.clearRect;'],
  ['validates the wrong native context', 'bootstrap', 'if (!context || context.canvas !== canvas || canvas.width !== 1280 || canvas.height !== 560)', 'if (!context || context.canvas !== document.createElement(\'canvas\') || canvas.width !== 1280 || canvas.height !== 560)'],
  ['changed loader URL', 'bootstrap', "script.src = '/canvas-scan.iife.js';", "script.src = '/other-canvas-scan.iife.js';"],
  ['adds a second loader', 'bootstrap', 'await loadCanvasScan();', 'await loadCanvasScan(); await loadCanvasScan();'],
  ['changed application entry', 'bootstrap', "await import('./V04Lab')", "await import('./OtherLab')"],
  ['adds a second dynamic import', 'bootstrap', "const { V04Lab } = await import('./V04Lab');", "const { V04Lab } = await import('./V04Lab'); await import('./V04Lab');"],
  ['changed capability handoff', 'bootstrap', 'createElement(V04Lab, { nativeCanvas2D })', 'createElement(V04Lab, { nativeCanvas2D: { ...nativeCanvas2D } })'],
  ['adds a second capability handoff', 'bootstrap', 'createRoot(document.getElementById(\'root\')!).render(createElement(V04Lab, { nativeCanvas2D }));', "createRoot(document.getElementById('root')!).render(createElement(V04Lab, { nativeCanvas2D })); createElement(V04Lab, { nativeCanvas2D });"],
  ['reads Canvas Scan through globalThis', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); void globalThis.__CANVAS_SCAN__;'],
  ['reads Canvas Scan through window', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); void window.__CANVAS_SCAN__;'],
  ['reads Canvas Scan through self', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); void self.__CANVAS_SCAN__;'],
  ['reads Canvas Scan through document defaultView', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); void document.defaultView?.__CANVAS_SCAN__;'],
  ['reads Canvas Scan through an alias', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); const realm = globalThis; void realm.__CANVAS_SCAN__;'],
  ['reads Canvas Scan through a callback', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); [globalThis].map(realm => realm.__CANVAS_SCAN__);'],
  ['reads Canvas Scan through a computed property', 'bootstrap', '  await loadCanvasScan();', "  await loadCanvasScan(); void globalThis['__CANVAS_SCAN__'];"],
  ['puts a native value in a global sink', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); globalThis.__NATIVE_CANVAS__ = nativeCanvas2D;'],
  ['puts a native value in a DOM sink', 'bootstrap', '  await loadCanvasScan();', "  await loadCanvasScan(); document.body.dataset.nativeCanvas = String(nativeCanvas2D.putImageData);"],
  ['puts a native value in state', 'calibration-fixture', '    const state = { actions: [] as string[],', '    const state = { nativeCanvas2D, actions: [] as string[],'],
  ['exports a native value', 'bootstrap', 'const nativeCanvas2D = Object.freeze({ canvas, context, putImageData, fillRect, clearRect });', 'const nativeCanvas2D = Object.freeze({ canvas, context, putImageData, fillRect, clearRect }); export const leakedNativeCanvas2D = nativeCanvas2D;'],
  ['returns a native value', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); return nativeCanvas2D;'],
  ['logs a native value', 'bootstrap', '  await loadCanvasScan();', '  await loadCanvasScan(); console.log(nativeCanvas2D);'],
  ['puts a native value in an error', 'bootstrap', '  await loadCanvasScan();', "  await loadCanvasScan(); throw new Error(String(nativeCanvas2D.putImageData));"],
  ['puts a native value in diagnostics', 'calibration-fixture', '      capabilityValidated: true,', '      capabilityValidated: true, diagnostic: nativeCanvas2D,'],
  ['hashes a native value', 'bootstrap', '  await loadCanvasScan();', "  await loadCanvasScan(); void crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(nativeCanvas2D.putImageData)));"],
  ['paints a native value into a screenshot', 'calibration-fixture', 'const paint = (canvas = activePrimary, change = 0) => { drawVisible(contextFor(canvas), canvas, preparedFor(canvas), factors.methodMix, change); state.drawCount++; };', 'const paint = (canvas = activePrimary, change = 0) => { drawVisible(contextFor(canvas), canvas, preparedFor(canvas), factors.methodMix, change); contextFor(canvas).fillText(String(nativeCanvas2D.putImageData), 0, 0); state.drawCount++; };'],
  ['adds a second application entry', 'bootstrap', 'void main();', 'void main(); void main();'],
  ['adds a direct old-evidence read', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "void readFile('/private/tmp/sidproj-95-heavy-negative-probe.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence helper call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const readOldEvidence = () => readFile('/private/tmp/sidproj-99-heavy-negative-probe.json'); void readOldEvidence(); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence destructuring call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const { readFile: readOldEvidence } = await import('node:fs/promises'); void readOldEvidence('/private/tmp/sidproj-100-heavy-negative-probe.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence computed filesystem call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const oldFs = await import('node:fs/promises'); void oldFs['readFile']('/private/tmp/sidproj-101-heavy-negative-probe.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an fs.promises old-evidence call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const oldFs = await import('node:fs'); void oldFs.promises.readFile('/private/tmp/sidproj-95-heavy-negative-probe.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence link call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const oldFs = await import('node:fs/promises'); void oldFs.link('/private/tmp/sidproj-95-heavy-negative-probe.json', '/private/tmp/copied.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence rename call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const oldFs = await import('node:fs/promises'); void oldFs.rename('/private/tmp/sidproj-99-heavy-negative-probe.json', '/private/tmp/copied.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence copy call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const oldFs = await import('node:fs/promises'); void oldFs.copyFile('/private/tmp/sidproj-100-heavy-negative-probe.json', '/private/tmp/copied.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
  ['adds an old-evidence removal call', 'release-runner-checker', "const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');", "const oldFs = await import('node:fs/promises'); void oldFs.rm('/private/tmp/sidproj-101-heavy-negative-probe.json'); const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');\nconst manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');"],
];
for (const [name, role, anchor, replacement] of semanticMutations) test(`manifest rejects ${name}`, async () => {
  const fixture = await repositoryManifestTree();
  try {
    const item = fixture.manifest.modules.find(module => module.role === role); const target = path.join(fixture.root, item.path); const source = await readFile(target, 'utf8');
    assert.equal(source.split(anchor).length - 1, 1, `${name} anchor`);
    const changed = source.replace(anchor, replacement);
    assert.equal(changed.split(replacement).length - 1, 1, `${name} replacement`);
    await writeFile(target, changed);
    await assert.rejects(verifyReleaseManifest(fixture.root, fixture.manifest), error => error.message === 'trusted module digest');
  }
  finally { await fixture.close(); }
});

const browserMutations = [
  ['inert options script', value => { value.scripts[0].kind = 'application/json-inline'; }, 'browser scripts'],
  ['later options override', value => value.scripts.push(structuredClone(value.scripts[0])), 'browser scripts'],
  ['another executable inline script', value => value.scripts.push({ role: 'unexpected', kind: 'classic-inline', rawSrc: null, resolvedPath: null, query: '', fragment: '' }), 'browser scripts'],
  ['another executable module script', value => value.scripts.push({ role: 'unexpected', kind: 'module-external', rawSrc: '/other.ts', resolvedPath: '/other.ts', query: '', fragment: '' }), 'browser scripts'],
  ['relative IIFE URL', value => { value.scripts[1].rawSrc = './canvas-scan.iife.js'; }, 'browser scripts'],
  ['entity IIFE URL', value => { value.scripts[1].rawSrc = '&#47;canvas-scan.iife.js'; }, 'browser scripts'],
  ['IIFE query', value => { value.scripts[1].query = '?private=1'; }, 'browser scripts'],
  ['IIFE fragment', value => { value.scripts[1].fragment = '#private'; }, 'browser scripts'],
  ['different IIFE path', value => { value.scripts[1].resolvedPath = '/other.js'; }, 'browser scripts'],
  ['another application entry', value => value.scripts.push(structuredClone(value.scripts[2])), 'browser scripts'],
  ['reordered measured scripts', value => { [value.scripts[1], value.scripts[2]] = [value.scripts[2], value.scripts[1]]; }, 'browser scripts'],
  ['missing option descriptor', value => { value.options.own = false; }, 'browser options'],
  ['unfrozen options', value => { value.options.frozen = false; }, 'browser options'],
  ['extra option key', value => value.options.keys.push('extra'), 'browser options'],
  ['missing Canvas Scan', value => { value.ready.canvasScan = false; }, 'bootstrap ready'],
  ['missing fixture readiness', value => { value.ready.fixture = false; }, 'bootstrap ready'],
  ['missing capability validation', value => { value.ready.capabilityValidated = false; }, 'bootstrap ready'],
];
for (const [name, mutate, expected] of browserMutations) test(`rejects ${name}`, () => { const value = structuredClone(browserContract); mutate(value); assert.equal(checkBrowserContract(value), expected); });
for (const field of ['scripts', 'options', 'ready']) test(`rejects missing browser ${field}`, () => { const value = structuredClone(browserContract); delete value[field]; assert.equal(checkBrowserContract(value), 'browser scripts'); });

const artifactMutations = [
  ['low value', value => { value.values[0] = value.runs[0].canvasApiSelfTimeMs = 6.999; value.minimum = 6.999; }, ['artifact truth']],
  ['upper value', value => { value.values[9] = value.runs[9].canvasApiSelfTimeMs = 8; value.maximum = 8; }, ['artifact truth']],
  ['duplicate value', value => { value.values[1] = value.runs[1].canvasApiSelfTimeMs = value.values[0]; value.minimum = Math.min(...value.values); value.maximum = Math.max(...value.values); value.median = [...value.values].sort((a, b) => a - b).slice(4, 6).reduce((a, b) => a + b) / 2; }, ['artifact truth']],
  ['wrong minimum', value => { value.minimum = 7.02; }, ['artifact truth']],
  ['wrong maximum', value => { value.maximum = 7.8; }, ['artifact truth']],
  ['wrong median', value => { value.median = 7.4; }, ['artifact truth']],
  ['diagnostic', value => { value.diagnostics.warnings.push('warning'); }, ['diagnostics']],
  ['drop', value => { value.runs[0].droppedEntryCounts.resetEvents = 1; }, ['artifact schema']],
  ['extra top field', value => { value.extra = true; }, ['artifact schema']],
  ['extra row', value => { value.runs.push(structuredClone(value.runs[0])); }, ['artifact schema']],
  ['reordered rows', value => { [value.runs[0], value.runs[1]] = [value.runs[1], value.runs[0]]; }, ['artifact schema']],
  ['changed calibration constant', value => { value.runs[0].calibration.workloadWidth = 1; }, ['calibration']],
  ['coordinated runtime count', value => { const item = value.runs[0].calibration; item.declaredPrimitiveSampleCount = 2; item.observedPrimitiveSampleCount = 2; item.primitiveSamplesMs.pop(); }, ['runtime counts']],
  ['live port', value => { value.port.listenersAfter.push('1'); }, ['port']],
];
for (const [name, mutate, expected] of artifactMutations) test(`rejects artifact ${name}`, () => { const value = artifact(); mutate(value); assert.deepEqual(checkArtifact(value, identity, [], checkedAt), expected); });
const missingArtifactFields = {
  schemaVersion: ['artifact schema'], runId: ['artifact schema'], startedAt: ['artifact schema'], endedAt: ['artifact schema'],
  coordinate: ['artifact schema', 'artifact truth'], band: ['artifact schema', 'artifact truth'], runCount: ['artifact schema'], runs: ['artifact schema'], values: ['artifact schema', 'artifact truth'],
  minimum: ['artifact schema', 'artifact truth'], maximum: ['artifact schema', 'artifact truth'], median: ['artifact schema', 'artifact truth'],
  chromeRevision: ['artifact identity', 'artifact schema'], gitSha: ['artifact identity', 'artifact schema'], bundleSha256: ['artifact identity', 'artifact schema'], manifestSha256: ['artifact identity', 'artifact schema'], modules: ['artifact identity', 'artifact schema'],
  browserContract: ['artifact schema', 'browser scripts'], diagnostics: ['artifact schema', 'diagnostics'], port: ['artifact schema', 'port'],
};
for (const [field, expected] of Object.entries(missingArtifactFields)) test(`rejects missing artifact ${field}`, () => { const value = artifact(); delete value[field]; assert.deepEqual(checkArtifact(value, identity, [], checkedAt), expected); });

async function diskRun(kind = 'targeted') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-102-disk-'));
  const run = await createEvidenceRun(kind, { testRoot: root });
  return { root, run, close: () => rm(root, { recursive: true }) };
}
test('uses a selected test UUID and rejects the pre-existing directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-102-selected-')); const runId = '12345678-1234-4123-8123-123456789abc';
  try {
    const run = await createEvidenceRun('targeted', { testRoot: root, runId });
    assert.equal(run.runId, runId);
    await assert.rejects(createEvidenceRun('targeted', { testRoot: root, runId }), error => error.message === 'run directory exists');
    await assert.rejects(createEvidenceRun('targeted', { testRoot: root, runId: 'not-a-uuid' }), error => error.message === 'invalid evidence run');
  } finally { await rm(root, { recursive: true }); }
});
test('rejects non-canonical and non-string test roots', async () => {
  await rejects(createEvidenceRun('targeted', { testRoot: '/private/tmp/' }), 'invalid evidence run');
  await rejects(createEvidenceRun('targeted', { testRoot: 1 }), 'invalid evidence run');
});
test('parses exactly one targeted directory argument', () => {
  assert.equal(parseTargetedArgs(['/private/tmp/sidproj-102-targeted-12345678-1234-4123-8123-123456789abc']), '/private/tmp/sidproj-102-targeted-12345678-1234-4123-8123-123456789abc');
  for (const args of [[], ['one', 'two'], [1]]) assert.throws(() => parseTargetedArgs(args), error => error.message === 'run directory');
});
test('targeted check rejects every non-targeted path shape', async () => {
  for (const directory of ['relative', '/tmp/sidproj-102-targeted-12345678-1234-4123-8123-123456789abc', '/private/tmp/sidproj-999-targeted-12345678-1234-4123-8123-123456789abc', '/private/tmp/sidproj-102-idle-release-12345678-1234-4123-8123-123456789abc', '/private/tmp/sidproj-102-targeted-bad', '/private/tmp/sidproj-102-targeted-12345678-1234-1123-8123-123456789abc']) await rejects(checkTargetedRun(directory), 'run directory');
});
test('targeted check rejects regular, symbolic, wrong-mode, and wrong-identity paths', async () => {
  const paths = [];
  try {
    const regular = `/private/tmp/sidproj-102-targeted-${randomUUID()}`; await writeFile(regular, 'x', { mode: 0o600 }); paths.push(regular);
    const target = `/private/tmp/sidproj-102-targeted-${randomUUID()}`; await mkdir(target, { mode: 0o700 }); paths.push(target);
    const symbolic = `/private/tmp/sidproj-102-targeted-${randomUUID()}`; await symlink(target, symbolic); paths.push(symbolic);
    const wrongMode = `/private/tmp/sidproj-102-targeted-${randomUUID()}`; await mkdir(wrongMode, { mode: 0o700 }); await chmod(wrongMode, 0o755); paths.push(wrongMode);
    await rejects(checkTargetedRun(regular), 'run directory'); await rejects(checkTargetedRun(symbolic), 'run directory'); await rejects(checkTargetedRun(wrongMode), 'run directory');
    const stat = await lstat(target); const runId = path.basename(target).slice('sidproj-102-targeted-'.length);
    await rejects(checkTargetedRun(target, { kind: 'targeted', runId, directory: target, directoryIdentity: { device: String(stat.dev), inode: '0' } }), 'run directory');
  } finally { for (const target of paths.reverse()) await rm(target, { recursive: true }); }
});
const source = () => ({ gitSha: 'a'.repeat(40), chromeRevision: '151.0.0.0', bundleSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64), modules: trustedModuleSpec.map(item => ({ ...item, sha256: 'd'.repeat(64) })) });
test('writes and checks one closed targeted run directory', async () => {
  const fixture = await diskRun();
  try {
    const startedAt = '2026-08-13T10:00:00.000Z'; const endedAt = '2026-08-13T10:00:01.000Z'; const item = await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n');
    await writeRunIndex(fixture.run, { schemaVersion: 1, issue: 'SIDPROJ-102', kind: 'targeted', runId: fixture.run.runId, startedAt, endedAt, directory: { mode: '0700', ...fixture.run.directoryIdentity }, source: source(), artifacts: [{ name: 'targeted.json', role: 'targeted-evidence', device: item.device, inode: item.inode, size: item.size, sha256: item.sha256 }] });
    assert.deepEqual(await checkRunDirectory(fixture.run), ['run.json', 'targeted.json']);
    assert.equal((await checkRunIndex(fixture.run, checkedAt)).runId, fixture.run.runId);
    for (const name of ['targeted.json', 'run.json']) { const stat = await lstat(path.join(fixture.run.directory, name)); assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1); }
  } finally { await fixture.close(); }
});
for (const [kind, prepare] of [
  ['regular file', target => writeFile(target, 'old')],
  ['symbolic link', target => symlink(path.join(path.dirname(target), 'missing'), target)],
  ['directory', target => mkdir(target)],
]) test(`rejects a pre-existing final ${kind}`, async () => {
  const fixture = await diskRun(); try { const target = path.join(fixture.run.directory, 'targeted.json'); await prepare(target); await assert.rejects(writeFinalArtifact(fixture.run, 'targeted.json', 'new'), error => error.message === 'final artifact exists'); } finally { await fixture.close(); }
});
test('rejects a hard-linked final artifact', async () => {
  const fixture = await diskRun(); try { await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); await link(path.join(fixture.run.directory, 'targeted.json'), path.join(fixture.root, 'linked.json')); await assert.rejects(readCurrentArtifact(fixture.run, 'targeted.json'), error => error.message === 'artifact identity'); } finally { await fixture.close(); }
});
test('rejects a replaced final artifact in the writing invocation', async () => {
  const fixture = await diskRun(); try {
    const target = path.join(fixture.run.directory, 'targeted.json'); const moved = path.join(fixture.run.directory, 'original.json');
    await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); await rename(target, moved); await writeFile(target, '{}\n', { mode: 0o600 });
    await assert.rejects(readCurrentArtifact(fixture.run, 'targeted.json'), error => error.message === 'artifact identity');
  } finally { await fixture.close(); }
});
test('rejects unexpected, missing, and copied old artifacts', async () => {
  for (const name of ['extra.json', 'sidproj-95-heavy-negative-probe.json']) {
    const fixture = await diskRun(); try { await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); await writeFile(path.join(fixture.run.directory, name), 'old', { mode: 0o600 }); await assert.rejects(checkRunDirectory(fixture.run), error => error.message === 'artifact set'); } finally { await fixture.close(); }
  }
  const fixture = await diskRun(); try { await assert.rejects(checkRunDirectory(fixture.run), error => error.message === 'artifact set'); } finally { await fixture.close(); }
});
test('rejects another SIDPROJ-102 directory as the current run object', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-102-two-runs-')); const first = await createEvidenceRun('targeted', { testRoot: root }); const second = await createEvidenceRun('targeted', { testRoot: root });
  try { await rejects(checkRunDirectory({ ...first, directory: second.directory }), 'run directory'); }
  finally { await rm(root, { recursive: true }); }
});
test('rejects a replaced run directory', async () => {
  const fixture = await diskRun(); try { const moved = `${fixture.run.directory}-moved`; await rename(fixture.run.directory, moved); await mkdir(fixture.run.directory, { mode: 0o700 }); await rejects(writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'), 'run directory'); } finally { await fixture.close(); }
});
test('rejects a run directory with changed mode', async () => {
  const fixture = await diskRun(); try { await chmod(fixture.run.directory, 0o755); await rejects(writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'), 'run directory'); } finally { await fixture.close(); }
});
test('rejects an unexpected final name and outside run object', async () => {
  const fixture = await diskRun(); try { await rejects(writeFinalArtifact(fixture.run, '../targeted.json', '{}\n'), 'unexpected final artifact'); const forged = { ...fixture.run, directory: fixture.root, root: path.dirname(fixture.root), directoryIdentity: { device: String((await lstat(fixture.root)).dev), inode: String((await lstat(fixture.root)).ino) } }; await rejects(writeFinalArtifact(forged, 'targeted.json', '{}\n'), 'run directory'); } finally { await fixture.close(); }
});
test('removes only the recorded owned temporary', async () => {
  const fixture = await diskRun(); try { const target = path.join(fixture.run.directory, 'temporary.tmp'); await writeFile(target, 'temporary', { mode: 0o600 }); const stat = await lstat(target); await removeOwnedTemporary(fixture.run, 'temporary.tmp', { device: String(stat.dev), inode: String(stat.ino) }); await assert.rejects(lstat(target), error => error.code === 'ENOENT'); await rejects(removeOwnedTemporary(fixture.run, 'targeted.json', { device: '1', inode: '1' }), 'unexpected temporary artifact'); } finally { await fixture.close(); }
});
test('preserves a replacement at an owned temporary path', async () => {
  const fixture = await diskRun(); try {
    const target = path.join(fixture.run.directory, 'temporary.tmp'); const moved = path.join(fixture.run.directory, 'moved.tmp');
    await writeFile(target, 'original', { mode: 0o600 }); const stat = await lstat(target); const recorded = { device: String(stat.dev), inode: String(stat.ino) };
    await rename(target, moved); await writeFile(target, 'replacement', { mode: 0o600 });
    await rejects(removeOwnedTemporary(fixture.run, 'temporary.tmp', recorded), 'artifact identity');
    assert.equal(await readFile(target, 'utf8'), 'replacement');
  } finally { await fixture.close(); }
});
test('rejects duplicate and escaped duplicate artifact keys', () => {
  assert.throws(() => parseExactJson('{"runId":1,"runId":2}'), error => error.message === 'artifact schema');
  assert.throws(() => parseExactJson('{"runId":1,"\\u0072unId":2}'), error => error.message === 'artifact schema');
});

const runIndexValue = (run, item) => ({ schemaVersion: 1, issue: 'SIDPROJ-102', kind: run.kind, runId: run.runId, startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:00:01.000Z', directory: { mode: '0700', ...run.directoryIdentity }, source: source(), artifacts: [{ name: 'targeted.json', role: 'targeted-evidence', device: item.device, inode: item.inode, size: item.size, sha256: item.sha256 }] });
const idleArtifactSpec = [['canvas-lab-v0.4.json', 'matrix-primary'], ['variant-matrix.json', 'matrix-projection'], ['nearest-negatives.json', 'negative-projection'], ['console-summary.txt', 'console-summary'], ['integrated-continuous.png', 'continuous-screenshot'], ['integrated-burst.png', 'burst-screenshot'], ['mutation-output.txt', 'mutation-evidence'], ['idle-boundary.json', 'idle-evidence'], ['release-evidence.json', 'release-evidence'], ['sha256.txt', 'artifact-manifest']];
async function writeIdleRunIndex(fixture, mutate = () => {}) {
  const rows = [];
  for (const [name, role] of idleArtifactSpec) { const item = await writeFinalArtifact(fixture.run, name, `${name}\n`); rows.push({ ...item, role }); }
  const value = { schemaVersion: 1, issue: 'SIDPROJ-102', kind: fixture.run.kind, runId: fixture.run.runId, startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:00:01.000Z', directory: { mode: '0700', ...fixture.run.directoryIdentity }, source: source(), artifacts: rows };
  mutate(value); await writeRunIndex(fixture.run, value); return value;
}

test('checks the complete ordered idle-release run index', async () => {
  const fixture = await diskRun('idle-release');
  try { await writeIdleRunIndex(fixture); assert.equal((await checkRunIndex(fixture.run, checkedAt)).artifacts.length, 10); }
  finally { await fixture.close(); }
});

for (const [name, mutate, message] of [
  ['missing row', value => value.artifacts.pop(), 'artifact set'],
  ['extra row', value => value.artifacts.push(structuredClone(value.artifacts[0])), 'artifact set'],
  ['duplicate row', value => value.artifacts[1] = structuredClone(value.artifacts[0]), 'artifact set'],
  ['reordered rows', value => { [value.artifacts[0], value.artifacts[1]] = [value.artifacts[1], value.artifacts[0]]; }, 'artifact set'],
  ['wrong role', value => { value.artifacts[0].role = 'changed'; }, 'artifact set'],
  ['wrong identity', value => { value.artifacts[0].inode = '1'; }, 'artifact identity'],
  ['wrong size', value => { value.artifacts[0].size = '1'; }, 'artifact identity'],
  ['wrong digest', value => { value.artifacts[0].sha256 = '0'.repeat(64); }, 'artifact identity'],
]) test(`idle-release run index rejects ${name}`, async () => {
  const fixture = await diskRun('idle-release');
  try { await writeIdleRunIndex(fixture, mutate); await rejects(checkRunIndex(fixture.run, checkedAt), message); }
  finally { await fixture.close(); }
});

test('rejects a run directory replaced by a symbolic link and preserves its target', async () => {
  const fixture = await diskRun(); const moved = `${fixture.run.directory}-moved`;
  try {
    await rename(fixture.run.directory, moved); await symlink(moved, fixture.run.directory);
    await rejects(checkRunDirectory(fixture.run), 'run directory');
    assert.equal((await lstat(fixture.run.directory)).isSymbolicLink(), true);
    assert.equal((await lstat(moved)).isDirectory(), true);
  } finally { await fixture.close(); }
});

test('rejects a renamed final artifact and preserves the original inode', async () => {
  const fixture = await diskRun();
  try {
    const target = path.join(fixture.run.directory, 'targeted.json'); const moved = path.join(fixture.run.directory, 'moved.json');
    await writeFinalArtifact(fixture.run, 'targeted.json', 'original'); await rename(target, moved);
    await rejects(readCurrentArtifact(fixture.run, 'targeted.json'), 'artifact identity');
    assert.equal(await readFile(moved, 'utf8'), 'original');
  } finally { await fixture.close(); }
});

test('rejects a copied replacement at a final artifact path', async () => {
  const fixture = await diskRun();
  try {
    const target = path.join(fixture.run.directory, 'targeted.json'); const original = path.join(fixture.run.directory, 'original.json'); const sourceFile = path.join(fixture.root, 'copied.json');
    await writeFinalArtifact(fixture.run, 'targeted.json', 'original'); await rename(target, original); await writeFile(sourceFile, 'replacement', { mode: 0o600 }); await copyFile(sourceFile, target);
    await rejects(readCurrentArtifact(fixture.run, 'targeted.json'), 'artifact identity');
    assert.equal(await readFile(target, 'utf8'), 'replacement'); assert.equal(await readFile(original, 'utf8'), 'original');
  } finally { await fixture.close(); }
});

test('a fresh run object rejects a copied replacement from persisted identity', async () => {
  const fixture = await diskRun();
  try {
    const target = path.join(fixture.run.directory, 'targeted.json'); const original = path.join(fixture.root, 'original-targeted.json');
    const item = await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); await writeRunIndex(fixture.run, runIndexValue(fixture.run, item));
    await rename(target, original); await copyFile(original, target);
    await rejects(checkRunIndex(Object.freeze(Object.create(fixture.run)), checkedAt), 'artifact identity');
  } finally { await fixture.close(); }
});

test('a fresh run object rejects a copied run index from persisted identity', async () => {
  const fixture = await diskRun();
  try {
    const item = await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); await writeRunIndex(fixture.run, runIndexValue(fixture.run, item));
    const target = path.join(fixture.run.directory, 'run.json'); const original = path.join(fixture.root, 'original-run.json');
    await rename(target, original); await copyFile(original, target);
    await rejects(checkRunIndex(Object.freeze(Object.create(fixture.run)), checkedAt), 'artifact identity');
  } finally { await fixture.close(); }
});

test('rejects removal of an expected final artifact', async () => {
  const fixture = await diskRun();
  try {
    const item = await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); await writeRunIndex(fixture.run, runIndexValue(fixture.run, item)); await unlink(path.join(fixture.run.directory, 'targeted.json'));
    await rejects(checkRunDirectory(fixture.run), 'artifact set');
    assert.equal((await lstat(path.join(fixture.run.directory, 'run.json'))).isFile(), true);
  } finally { await fixture.close(); }
});

for (const prior of ['SIDPROJ-95', 'SIDPROJ-99', 'SIDPROJ-100', 'SIDPROJ-101']) test(`rejects a ${prior} copy replacing the current final artifact`, async () => {
  const fixture = await diskRun();
  try {
    const target = path.join(fixture.run.directory, 'targeted.json'); const original = path.join(fixture.run.directory, 'original.json'); const priorFile = path.join(fixture.root, `${prior}.json`);
    await writeFinalArtifact(fixture.run, 'targeted.json', 'current'); await rename(target, original); await writeFile(priorFile, prior, { mode: 0o600 }); await copyFile(priorFile, target);
    await rejects(readCurrentArtifact(fixture.run, 'targeted.json'), 'artifact identity');
    assert.equal(await readFile(target, 'utf8'), prior); assert.equal(await readFile(original, 'utf8'), 'current');
  } finally { await fixture.close(); }
});

const indexCase = (name, mutate, message) => test(name, async () => {
  const fixture = await diskRun();
  try {
    const item = await writeFinalArtifact(fixture.run, 'targeted.json', '{}\n'); const value = runIndexValue(fixture.run, item); mutate(value, fixture.run); await writeRunIndex(fixture.run, value);
    await rejects(checkRunIndex(fixture.run, checkedAt), message);
    assert.equal((await lstat(path.join(fixture.run.directory, 'run.json'))).isFile(), true);
  } finally { await fixture.close(); }
});

indexCase('rejects a missing run-index artifact row', value => value.artifacts.pop(), 'artifact set');
indexCase('rejects an extra run-index artifact row', value => value.artifacts.push({ ...value.artifacts[0] }), 'artifact set');
indexCase('rejects a duplicate run-index artifact row', value => value.artifacts = [value.artifacts[0], { ...value.artifacts[0] }], 'artifact set');
indexCase('rejects a reordered run-index artifact set', value => value.artifacts = [{ ...value.artifacts[0], name: 'run.json' }, value.artifacts[0]], 'artifact set');
indexCase('rejects a wrong run-index kind', value => { value.kind = 'idle-release'; }, 'artifact schema');
indexCase('rejects a wrong run-index UUID', value => { value.runId = '22345678-1234-4123-8123-123456789abc'; }, 'artifact schema');
indexCase('rejects a stale run index', value => { value.startedAt = '2026-08-11T09:00:00.000Z'; value.endedAt = '2026-08-11T09:00:01.000Z'; }, 'artifact schema');
indexCase('rejects a future run index', value => { value.startedAt = '2026-08-13T10:02:00.000Z'; value.endedAt = '2026-08-13T10:02:01.000Z'; }, 'artifact schema');
indexCase('rejects a run index ten seconds in the future', value => { value.startedAt = '2026-08-13T10:00:10.000Z'; value.endedAt = '2026-08-13T10:00:11.000Z'; }, 'artifact schema');
indexCase('rejects reversed run-index timestamps', value => { value.startedAt = '2026-08-13T10:00:01.000Z'; value.endedAt = '2026-08-13T10:00:00.000Z'; }, 'artifact schema');
indexCase('rejects an overlong run index', value => { value.startedAt = '2026-08-13T09:29:59.000Z'; }, 'artifact schema');

const temporaryCase = (name, mutate, message, preserved) => test(name, async () => {
  const fixture = await diskRun();
  try {
    const target = path.join(fixture.run.directory, 'temporary.tmp'); await writeFile(target, 'original', { mode: 0o600 }); const stat = await lstat(target); const recorded = { device: String(stat.dev), inode: String(stat.ino) };
    await mutate({ fixture, target }); await rejects(removeOwnedTemporary(fixture.run, 'temporary.tmp', recorded), message); await preserved({ fixture, target });
  } finally { await fixture.close(); }
});

temporaryCase('rejects a removed temporary before cleanup', async ({ target }) => unlink(target), 'artifact identity', async ({ target }) => assert.rejects(lstat(target), error => error.code === 'ENOENT'));
temporaryCase('rejects a renamed temporary before cleanup', async ({ target }) => rename(target, `${target}.moved`), 'artifact identity', async ({ target }) => assert.equal(await readFile(`${target}.moved`, 'utf8'), 'original'));
temporaryCase('rejects a copy replacing a temporary path', async ({ target }) => { await rename(target, `${target}.moved`); await copyFile(`${target}.moved`, target); }, 'artifact identity', async ({ target }) => assert.equal(await readFile(target, 'utf8'), 'original'));
temporaryCase('rejects a symbolic link replacing a temporary path', async ({ target }) => { await rename(target, `${target}.moved`); await symlink(`${target}.moved`, target); }, 'artifact identity', async ({ target }) => assert.equal((await lstat(target)).isSymbolicLink(), true));
temporaryCase('rejects a hard link added to a temporary', async ({ fixture, target }) => link(target, path.join(fixture.root, 'linked.tmp')), 'artifact identity', async ({ fixture, target }) => { assert.equal((await lstat(target)).nlink, 2); assert.equal((await lstat(path.join(fixture.root, 'linked.tmp'))).isFile(), true); });

for (const name of ['targeted.json', 'run.json']) test(`cleanup refuses final artifact ${name}`, async () => {
  const fixture = await diskRun();
  try { await rejects(removeOwnedTemporary(fixture.run, name, { device: '1', inode: '1' }), 'unexpected temporary artifact'); }
  finally { await fixture.close(); }
});

test('port listener parsing is exact', () => {
  assert.deepEqual(portListeners(() => '12\n34\n'), ['12', '34']);
  assert.deepEqual(portListeners(() => { throw Object.assign(new Error('none'), { status: 1 }); }), []);
  assert.throws(() => portListeners(() => { throw new Error('lsof failed'); }), error => error.message === 'lsof failed');
});

test('owned process cleanup keeps its ownership checks and signal order', async () => {
  await rejects(stopOwned({ pid: 12, exitCode: null, signalCode: null }, () => false, () => assert.fail('signal called')), 'owned Vite process lost ownership');
  const signals = []; let waits = 0;
  await stopOwned({ pid: 12, exitCode: null, signalCode: null }, () => true, (...args) => signals.push(args), async () => ++waits === 2);
  assert.deepEqual(signals, [[-12, 'SIGTERM'], [-12, 'SIGKILL']]);
});

test('cleanup keeps the primary error and each cleanup error in order', async () => {
  const actions = [];
  await assert.rejects(runWithCleanup(async () => { actions.push('operation'); throw new Error('primary'); }, {
    closeBrowser: async () => { actions.push('browser'); throw new Error('browser'); },
    stopVite: async () => { actions.push('vite'); },
    checkPort: async () => { actions.push('port'); return ['12']; },
  }), error => error.message === 'primary; browser; port 5190 remains live');
  assert.deepEqual(actions, ['operation', 'browser', 'vite', 'port']);
});

test('final write keeps its write and port failures in order', async () => {
  await assert.rejects(writeWithFinalPortProof(async () => { throw new Error('write'); }, async () => ['12']), error => error.message === 'write; port 5190 remains live');
});
