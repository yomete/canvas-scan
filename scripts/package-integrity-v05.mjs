import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = path.join(root, 'packages/core');
const requireFromCore = createRequire(path.join(packageDirectory, 'package.json'));
const ts = requireFromCore('typescript');
const version = '0.5.0';
export const ESM_RUNTIME_EXPORTS = ['start', 'getReports', 'startRecording', 'stopRecording', 'getLastSession', 'mark', 'startExplanation', 'stopExplanation', 'getLastExplanation', 'compareSessions'];
export const IIFE_RUNTIME_FIELDS = ['version', 'getHistory', 'getReports', 'startRecording', 'stopRecording', 'mark', 'getLastSession', 'startExplanation', 'stopExplanation', 'getLastExplanation', 'compareSessions'];
export const TYPE_EXPORTS = ['AttributionKind', 'CanvasMethodEvidence', 'CanvasScanOptions', 'DrawBatchReport', 'SignatureStatus', 'SourceLocation', 'InvestigationSessionV1', 'RecordedCanvasSummary', 'RecordedCanvasWindow', 'RecordedCanvasGeometry', 'CanvasGeometryUnavailableReason', 'RecordedResetEvent', 'CanvasResetSource', 'CanvasLifecycleEventType', 'RecordedCanvasLifecycleEvent', 'RecordedDrawEpisode', 'RecordedEpisodeCanvasSummary', 'RecordedTopMethod', 'HeavyCanvasWorkFinding', 'InvestigationFinding', 'RepeatedDrawWorkFinding', 'ResizeChurnFinding', 'BackingStoreMismatchFinding', 'RecordedRepeatedWindow', 'RecordingState', 'RecordingStopReason', 'RecordedDocumentEvent', 'RecordedEventTiming', 'RecordedUserMark', 'RecordedLongAnimationFrameScript', 'RecordedLongAnimationFrame', 'RecordedBrowserEvidenceEntry', 'RecordedEpisodeAssociation', 'ExplanationSelection', 'ExplanationStartResult', 'ExplanationUnknownReason', 'NormalizedCommandArgument', 'NormalizedCanvasCommand', 'ExplanationCommandWindow', 'CommandDifference', 'ExplanationWindowComparison', 'ExplanationStackFrame', 'ExplanationStackSample', 'ExplanationLimitName', 'ExplanationLimitReason', 'ExplanationLimitCoordinate', 'ExplanationLimitResult', 'ExplanationCallsiteLimitReason', 'ExplanationCallsiteCoverage', 'ExplanationArtifactV1', 'SessionFindingPairing', 'ComparisonMeasureId', 'ComparisonMeasure', 'ComparisonFindingRef', 'ComparisonArtifactV1'];
export const MANIFEST_STATIC = [
  'package/LICENSE',
  'package/dist/auto.js',
  'package/dist/canvas-scan.iife.js',
  'package/dist/index.js',
  'package/package.json',
  'package/README.md',
  'package/bin/canvas-scan.mjs',
  'package/dist/attribution.d.ts',
  'package/dist/auto.d.ts',
  'package/dist/browser-evidence.d.ts',
  'package/dist/build-registry.d.ts',
  'package/dist/command-capture.d.ts',
  'package/dist/comparison.d.ts',
  'package/dist/draw-callsite.d.ts',
  'package/dist/frame-loop.d.ts',
  'package/dist/geometry.d.ts',
  'package/dist/index.d.ts',
  'package/dist/overlay.d.ts',
  'package/dist/recording.d.ts',
  'package/dist/signature.d.ts',
  'package/dist/symbolicate.d.ts',
  'package/dist/types.d.ts',
  'package/dist/wrap-context.d.ts',
  'package/dist/wrap-path2d.d.ts',
];
const gateKeys = [
  'schemaVersion',
  'gitSha',
  'packageVersion',
  'tarballSha256',
  'manifestSha256',
  'manifestEntries',
  'esmSha256',
  'iifeSha256',
  'declarationSha256',
];
const summaryKeys = [
  'schemaVersion',
  'status',
  'gateSha256',
  'gitSha',
  'packageVersion',
  'tarballSha256',
  'checks',
  'consumer',
];
const checkKeys = [
  'cleanWorktree',
  'versionIdentity',
  'exactManifest',
  'labBoundary',
  'esmSurface',
  'iifeSurface',
  'declarationSurface',
  'cleanConsumer',
];
const consumerKeys = [
  'runtimeExports',
  'iifeFields',
  'typeExports',
  'runtimeStatus',
  'typeStatus',
];

const sha256 = value => createHash('sha256').update(value).digest('hex');
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
}
export const canonicalJson = value => `${JSON.stringify(ordered(value), null, 2)}\n`;
const stable = canonicalJson;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const gitSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const manifestSha256 = entries => sha256(`${entries.join('\n')}\n`);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim());
  return result.stdout;
}

function tarEntries(tarball) {
  return run('tar', ['-tzf', tarball]).trim().split('\n').filter(Boolean);
}

function readTarEntry(tarball, entry) {
  return run('tar', ['-xzOf', tarball, entry]);
}

export function assertExactManifest(entries) {
  if (new Set(entries).size !== entries.length) throw new Error('duplicate tarball entries');
  const chunks = entries.filter(entry => /^package\/dist\/chunk-[A-Z0-9]+\.js$/.test(entry));
  if (chunks.length !== 1) throw new Error('tarball must contain one runtime chunk');
  const expected = [...MANIFEST_STATIC, chunks[0]].sort();
  if (JSON.stringify([...entries].sort()) !== JSON.stringify(expected)) throw new Error('tarball manifest changed');
}

function exportedBindingNames(name, names) {
  if (ts.isIdentifier(name)) names.add(name.text);
  else for (const element of name.elements) exportedBindingNames(element.name, names);
}

export function declarationExportNames(source) {
  const file = ts.createSourceFile('index.d.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) names.add('*');
      else for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default');
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) exportedBindingNames(declaration.name, names);
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) names.add(statement.name.text);
  }
  return [...names].sort();
}

export function assertDeclarationSurface(source) {
  const expected = [...ESM_RUNTIME_EXPORTS, ...TYPE_EXPORTS].sort();
  const actual = declarationExportNames(source);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('declaration exports changed');
}

function literalPropertyValues(source, key) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const values = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node)) {
      let name = null;
      if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) name = node.name.text;
      else if (ts.isComputedPropertyName(node.name) && ts.isStringLiteral(node.name.expression)) name = node.name.expression.text;
      if (name === key && ts.isStringLiteral(node.initializer)) values.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

export function assertSourceLiteralVersion(source, key) {
  const values = literalPropertyValues(source, key);
  if (values.length !== 1 || values[0] !== version) throw new Error(`source ${key} identity changed`);
}

export function assertPackageBoundary(entries, sources) {
  assertExactManifest(entries);
  const markers = [/\bCANVAS_LAB_[A-Z0-9_]+\b/, /\bcanvas-performance-lab-v\d+(?:\.\d+)?\b/i, /\blab-v\d+(?:-truth)?\b/i];
  for (const [name, source] of Object.entries(sources)) {
    if (markers.some(marker => marker.test(source))) throw new Error(`release harness marker in ${name}`);
  }
}

function tarballInspection(tarball) {
  const entries = tarEntries(tarball);
  assertExactManifest(entries);
  const esm = readTarEntry(tarball, 'package/dist/index.js');
  const chunk = esm.match(/from ["']\.\/(chunk-[A-Z0-9]+\.js)["']/)?.[1];
  if (!chunk) throw new Error('ESM entry does not import the packed runtime chunk');
  const runtime = readTarEntry(tarball, `package/dist/${chunk}`);
  const iife = readTarEntry(tarball, 'package/dist/canvas-scan.iife.js');
  const declarations = readTarEntry(tarball, 'package/dist/index.d.ts');
  const manifest = readTarEntry(tarball, 'package/package.json');
  const readme = readTarEntry(tarball, 'package/README.md');
  const parsedManifest = JSON.parse(manifest);
  const readmeVersions = [...readme.matchAll(/canvas-scan@(\d+\.\d+\.\d+)/g)].map(match => match[1]);
  if (parsedManifest.version !== version || readmeVersions.length !== 1 || readmeVersions[0] !== version) throw new Error('packed version identity changed');
  assertDeclarationSurface(declarations);
  const contentEntries = entries.filter(entry => /^(?:package\/(?:dist\/.*\.(?:js|d\.ts)|package\.json|README\.md|bin\/.*))$/.test(entry));
  assertPackageBoundary(entries, Object.fromEntries(contentEntries.map(entry => [entry, readTarEntry(tarball, entry)])));
  const declarationEntries = entries.filter(entry => /^package\/dist\/.*\.d\.ts$/.test(entry)).sort();
  return {
    entries,
    esm,
    iife,
    declarationSha256: Object.fromEntries(declarationEntries.map(entry => [entry, sha256(readTarEntry(tarball, entry))])),
  };
}

export function gateForTarball(tarball, commit) {
  const inspected = tarballInspection(tarball);
  return {
    schemaVersion: 1,
    gitSha: commit,
    packageVersion: version,
    tarballSha256: sha256(fs.readFileSync(tarball)),
    manifestSha256: manifestSha256(inspected.entries),
    manifestEntries: inspected.entries,
    esmSha256: sha256(inspected.esm),
    iifeSha256: sha256(inspected.iife),
    declarationSha256: inspected.declarationSha256,
  };
}

export function checkGate(gate, tarball) {
  if (!exact(gate, gateKeys) || gate.schemaVersion !== 1 || !gitSha(gate.gitSha) || gate.packageVersion !== version) throw new Error('gate schema or identity changed');
  if (![gate.tarballSha256, gate.manifestSha256, gate.esmSha256, gate.iifeSha256].every(hash)) throw new Error('gate hash changed');
  const inspected = tarballInspection(tarball);
  if (gate.tarballSha256 !== sha256(fs.readFileSync(tarball))) throw new Error('tarball hash changed');
  if (JSON.stringify(gate.manifestEntries) !== JSON.stringify(inspected.entries) || gate.manifestSha256 !== manifestSha256(inspected.entries)) throw new Error('manifest changed');
  if (gate.esmSha256 !== sha256(inspected.esm) || gate.iifeSha256 !== sha256(inspected.iife)) throw new Error('bundle hash changed');
  if (JSON.stringify(gate.declarationSha256) !== JSON.stringify(inspected.declarationSha256) || !Object.values(gate.declarationSha256).every(hash)) throw new Error('declaration hash changed');
  return gate;
}

function checkSourceVersion() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  const readmes = [path.join(root, 'README.md'), path.join(packageDirectory, 'README.md')];
  const reported = readmes.map(file => [...fs.readFileSync(file, 'utf8').matchAll(/canvas-scan@(\d+\.\d+\.\d+)/g)].map(match => match[1]));
  if (manifest.version !== version || reported.some(values => values.length !== 1 || values[0] !== version)) throw new Error('source version identity changed');
  assertSourceLiteralVersion(fs.readFileSync(path.join(packageDirectory, 'src/index.ts'), 'utf8'), 'version');
  assertSourceLiteralVersion(fs.readFileSync(path.join(packageDirectory, 'src/recording.ts'), 'utf8'), 'canvasScanVersion');
}

export function assertExactRuntimeNames(value, expected, label) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} exports changed`);
}

export function checkConsumer(tarball) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-v05-consumer-'));
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), stable({ private: true, type: 'module' }));
    const cache = path.join(directory, 'npm-cache');
    run('npm', ['install', '--no-audit', '--no-fund', '--cache', cache, tarball], directory);
    const runtime = `import('canvas-scan').then(value => { const expected=${JSON.stringify(ESM_RUNTIME_EXPORTS)}; if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort()) || !expected.every(name => typeof value[name] === 'function')) process.exit(1) })`;
    run(process.execPath, ['-e', runtime], directory);
    fs.writeFileSync(path.join(directory, 'surface.ts'), `import type { ${TYPE_EXPORTS.join(', ')} } from 'canvas-scan';\ntype PublicTypes = ${TYPE_EXPORTS.join(' | ')};\ndeclare const value: PublicTypes;\nvoid value;\n`);
    fs.writeFileSync(path.join(directory, 'tsconfig.json'), stable({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022', noEmit: true, strict: true, skipLibCheck: false }, files: ['surface.ts'] }));
    run(process.execPath, [path.join(packageDirectory, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'], directory);
    const installedDirectory = path.join(directory, 'node_modules/canvas-scan');
    const installed = JSON.parse(fs.readFileSync(path.join(installedDirectory, 'package.json'), 'utf8'));
    if (installed.version !== version) throw new Error('clean consumer installed the wrong package version');
    const iifeCheck = `
      import fs from 'node:fs';
      import { JSDOM } from 'jsdom';
      const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', pretendToBeVisual: true });
      dom.window.CanvasRenderingContext2D = class {};
      dom.window.Path2D = class {};
      dom.window.__CANVAS_SCAN_OPTS = { overlay: false };
      dom.window.eval(fs.readFileSync(process.argv[1], 'utf8'));
      const api = dom.window.__CANVAS_SCAN__;
      const expected = ${JSON.stringify(IIFE_RUNTIME_FIELDS)};
      const actual = Object.keys(api ?? {}).sort();
      if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) process.exit(1);
      if (api.version !== ${JSON.stringify(version)}) process.exit(1);
      if (!expected.filter(name => name !== 'version').every(name => typeof api[name] === 'function')) process.exit(1);
      api.startRecording();
      const session = api.stopRecording();
      if (session?.canvasScanVersion !== ${JSON.stringify(version)}) process.exit(1);
      dom.window.close();
    `;
    run(process.execPath, ['--input-type=module', '-e', iifeCheck, path.join(installedDirectory, 'dist/canvas-scan.iife.js')], packageDirectory);
    return {
      runtimeExports: ESM_RUNTIME_EXPORTS,
      iifeFields: IIFE_RUNTIME_FIELDS,
      typeExports: TYPE_EXPORTS,
      runtimeStatus: 'PASS',
      typeStatus: 'PASS',
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function checkSummary(summary, gate, consumer) {
  if (!exact(summary, summaryKeys) || summary.schemaVersion !== 1 || summary.status !== 'PASS' || !hash(summary.gateSha256)) throw new Error('summary schema changed');
  if (!exact(summary.checks, checkKeys) || !Object.values(summary.checks).every(value => value === true)) throw new Error('summary checks changed');
  if (!exact(summary.consumer, consumerKeys) || JSON.stringify(summary.consumer.runtimeExports) !== JSON.stringify(ESM_RUNTIME_EXPORTS) || JSON.stringify(summary.consumer.iifeFields) !== JSON.stringify(IIFE_RUNTIME_FIELDS) || JSON.stringify(summary.consumer.typeExports) !== JSON.stringify(TYPE_EXPORTS) || summary.consumer.runtimeStatus !== 'PASS' || summary.consumer.typeStatus !== 'PASS') throw new Error('consumer summary changed');
  if (stable(summary.consumer) !== stable(consumer)) throw new Error('consumer summary does not match the fresh check');
  if (summary.gitSha !== gate.gitSha || summary.packageVersion !== gate.packageVersion || summary.tarballSha256 !== gate.tarballSha256) throw new Error('summary identity changed');
}

export function assertRepositoryState(gateGitSha, currentCommit, dirty) {
  if (dirty || currentCommit !== gateGitSha) throw new Error('gate does not match a clean current commit');
}

export function assertIntegrityNames(names) {
  const expected = ['canvas-scan-0.5.0.tgz', 'gate.json', 'pack-summary.json'];
  if (JSON.stringify([...names].sort()) !== JSON.stringify(expected)) throw new Error('integrity directory changed');
}

export function parseCanonicalJson(text, label) {
  const value = JSON.parse(text);
  if (text !== stable(value)) throw new Error(`${label} file is not canonical JSON`);
  return value;
}

export function assertGateFileHash(summary, gateText) {
  if (summary.gateSha256 !== sha256(gateText)) throw new Error('gate file hash changed');
}

export function checkIntegrityDirectory(directory) {
  const names = fs.readdirSync(directory).sort();
  assertIntegrityNames(names);
  const tarball = path.join(directory, 'canvas-scan-0.5.0.tgz');
  const gatePath = path.join(directory, 'gate.json');
  const gateText = fs.readFileSync(gatePath, 'utf8');
  const gate = parseCanonicalJson(gateText, 'gate');
  checkGate(gate, tarball);
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim();
  assertRepositoryState(gate.gitSha, currentCommit, dirty);
  const summaryText = fs.readFileSync(path.join(directory, 'pack-summary.json'), 'utf8');
  const summary = parseCanonicalJson(summaryText, 'summary');
  const consumer = checkConsumer(tarball);
  checkSummary(summary, gate, consumer);
  assertGateFileHash(summary, gateText);
  return { gate, summary };
}

function createIntegrityDirectory(directory) {
  const dirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty) throw new Error('release worktree is not clean');
  checkSourceVersion();
  fs.mkdirSync(directory);
  run('pnpm', ['--filter', 'canvas-scan', 'pack', '--pack-destination', directory]);
  const tarballs = fs.readdirSync(directory).filter(name => name.endsWith('.tgz'));
  if (tarballs.length !== 1 || tarballs[0] !== 'canvas-scan-0.5.0.tgz') throw new Error('pack did not create the exact v0.5.0 tarball');
  const tarball = path.join(directory, tarballs[0]);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const gate = gateForTarball(tarball, commit);
  const consumer = checkConsumer(tarball);
  const gateText = stable(gate);
  const summary = {
    schemaVersion: 1,
    status: 'PASS',
    gateSha256: sha256(gateText),
    gitSha: gate.gitSha,
    packageVersion: gate.packageVersion,
    tarballSha256: gate.tarballSha256,
    checks: Object.fromEntries(checkKeys.map(name => [name, true])),
    consumer,
  };
  fs.writeFileSync(path.join(directory, 'gate.json'), gateText, { flag: 'wx' });
  fs.writeFileSync(path.join(directory, 'pack-summary.json'), stable(summary), { flag: 'wx' });
  checkIntegrityDirectory(directory);
  checkIntegrityDirectory(directory);
  return { gate, summary };
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(3).find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const directory = argument('directory');
  if (!directory || !path.isAbsolute(directory)) throw new Error('use an absolute --directory path');
  if (command === 'create') {
    createIntegrityDirectory(directory);
    console.log(`SIDPROJ_104_PACKAGE_INTEGRITY: PASS\n${directory}`);
  } else if (command === 'check') {
    checkIntegrityDirectory(directory);
    console.log('SIDPROJ_104_PACKAGE_INTEGRITY_CHECK: PASS');
  } else throw new Error('use create or check');
}
