// Pure tarball-manifest rules for the canvas-scan package, shared by
// scripts/verify-pack.mjs and its unit regressions.
export const MANIFEST_REQUIRED = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/bin/canvas-scan.mjs',
  'package/dist/index.js',
  'package/dist/auto.js',
  'package/dist/canvas-scan.iife.js',
  'package/dist/index.d.ts',
  'package/dist/auto.d.ts',
  'package/dist/recording.d.ts',
  'package/dist/types.d.ts',
];

export const MANIFEST_ALLOW = [
  ...MANIFEST_REQUIRED.map(
    (entry) => new RegExp(`^${entry.replace(/[.$+]/g, '\\$&')}$`),
  ),
  /^package\/dist\/chunk-[A-Z0-9]+\.js$/,
  /^package\/dist\/[\w-]+\.d\.ts$/,
];

// The runtime version is a literal in src/index.ts, so a stale dist or a
// forgotten bump ships a package that lies about its own version. Both bundles
// and the packed README must agree with package.json.
export function assertPackedVersion(sources, version) {
  // The IIFE ships minified, so the space after the key is not guaranteed.
  const literal = new RegExp(`version:\\s*['"]${version.replace(/\./g, '\\.')}['"]`);
  const wrong = [];
  for (const [name, text] of Object.entries(sources)) {
    if (name === 'manifest') {
      try {
        if (JSON.parse(text).version !== version) wrong.push(`packed manifest version is not ${version}`);
      } catch {
        wrong.push('packed manifest is not valid JSON');
      }
      continue;
    }
    if (name === 'readme') {
      if (!text.includes(`canvas-scan@${version}`)) {
        wrong.push(`packed README does not mention canvas-scan@${version}`);
      }
      continue;
    }
    const required = name === 'recording'
      ? new RegExp(`canvasScanVersion:\\s*['"]${version.replace(/\./g, '\\.')}['"]`)
      : literal;
    if (!required.test(text)) {
      wrong.push(`${name} does not carry runtime version ${version}`);
    }
  }
  if (wrong.length > 0) {
    throw new Error(`packed version mismatch: ${wrong.join('; ')}`);
  }
}

export const ESM_RUNTIME_EXPORTS = ['start', 'getReports', 'startRecording', 'stopRecording', 'getLastSession', 'mark', 'startExplanation', 'stopExplanation', 'getLastExplanation', 'compareSessions'];
export const IIFE_RUNTIME_FIELDS = ['version', 'getHistory', 'getReports', 'startRecording', 'stopRecording', 'mark', 'getLastSession', 'startExplanation', 'stopExplanation', 'getLastExplanation', 'compareSessions'];
export const TYPE_EXPORTS = ['AttributionKind', 'CanvasMethodEvidence', 'CanvasScanOptions', 'DrawBatchReport', 'SignatureStatus', 'SourceLocation', 'InvestigationSessionV1', 'RecordedCanvasSummary', 'RecordedCanvasWindow', 'RecordedCanvasGeometry', 'CanvasGeometryUnavailableReason', 'RecordedResetEvent', 'CanvasResetSource', 'CanvasLifecycleEventType', 'RecordedCanvasLifecycleEvent', 'RecordedDrawEpisode', 'RecordedEpisodeCanvasSummary', 'RecordedTopMethod', 'HeavyCanvasWorkFinding', 'InvestigationFinding', 'RepeatedDrawWorkFinding', 'ResizeChurnFinding', 'BackingStoreMismatchFinding', 'RecordedRepeatedWindow', 'RecordingState', 'RecordingStopReason', 'RecordedDocumentEvent', 'RecordedEventTiming', 'RecordedUserMark', 'RecordedLongAnimationFrameScript', 'RecordedLongAnimationFrame', 'RecordedBrowserEvidenceEntry', 'RecordedEpisodeAssociation', 'ExplanationSelection', 'ExplanationStartResult', 'ExplanationUnknownReason', 'NormalizedCommandArgument', 'NormalizedCanvasCommand', 'ExplanationCommandWindow', 'CommandDifference', 'ExplanationWindowComparison', 'ExplanationStackFrame', 'ExplanationStackSample', 'ExplanationLimitName', 'ExplanationLimitReason', 'ExplanationLimitCoordinate', 'ExplanationLimitResult', 'ExplanationCallsiteLimitReason', 'ExplanationCallsiteCoverage', 'ExplanationArtifactV1', 'SessionFindingPairing', 'ComparisonMeasureId', 'ComparisonMeasure', 'ComparisonFindingRef', 'ComparisonArtifactV1'];
export const RITUAL_METHODS = ['startRecording', 'stopRecording', 'getLastSession', 'mark', 'startExplanation', 'stopExplanation', 'getLastExplanation', 'compareSessions'];
export const RITUAL_STEP_IDS = ['early-load', 'baseline', 'explanation-start', 'explanation-result', 'baseline-selection', 'candidate', 'pairing', 'comparison-copy'];
const labMarkers = ['CANVAS_LAB_V04', 'canvas-performance-lab-v0.4', 'lab-v04-truth'];
const readmeStepTokens = [
  ['canvas-scan/auto', 'before React', 'before application Canvas2D work'],
  ['baseline', 'startRecording()', 'stopRecording()', 'getLastSession()'],
  ['Explain next interaction', 'startExplanation({ sessionId, findingIndex })', 'explicit finding'],
  ['stopExplanation()', 'getLastExplanation()', 'Copy explanation JSON'],
  ['Keep as baseline'],
  ['application change', 'candidate', 'startRecording()', 'stopRecording()'],
  ['same finding type', 'Compare with baseline', 'compareSessions(', 'baselineFindingIndex', 'candidateFindingIndex', 'explicit'],
  ['measured pair', 'Copy comparison JSON', 'plain', 'JSON artifact'],
];
const demoStepTokens = [
  ['loaded before React'],
  ['Start recording', 'Replay interaction', 'Stop recording'],
  ['repeated-draw-work', 'Explain next interaction'],
  ['Replay interaction', 'Stop recording', 'Copy explanation JSON'],
  ['Keep as baseline'],
  ['Apply candidate change', 'Start recording', 'Replay interaction', 'Stop recording'],
  ['same finding type', 'Compare with baseline', 'explicit'],
  ['measured pair', 'Copy comparison JSON'],
];
const readmeBoundaryTokens = ['selected canvas', 'raw argument', 'page text', 'pixels', 'URLs', 'application objects', 'source content', 'honest `unknown`', 'does not prove that the application improved'];
const demoBoundaryTokens = ['selected canvas', 'raw values', 'page text', 'pixels', 'URLs', 'application objects', 'source content', 'honest unknown', 'does not prove improvement'];

function ritualSection(source, label) {
  const heading = '## v0.5 investigation ritual';
  const start = source.indexOf(heading);
  if (start < 0) throw new Error(`${label} has no v0.5 investigation ritual`);
  const end = source.indexOf('\n## ', start + heading.length);
  return source.slice(start, end < 0 ? source.length : end).trim();
}

function numberedSteps(source, label) {
  const matches = [...source.matchAll(/^(\d+)\. /gm)];
  if (matches.length !== RITUAL_STEP_IDS.length) throw new Error(`${label} must have exactly eight ritual steps`);
  const numbers = matches.map(match => Number(match[1]));
  if (JSON.stringify(numbers) !== JSON.stringify(RITUAL_STEP_IDS.map((_, index) => index + 1))) throw new Error(`${label} ritual step order changed`);
  return matches.map((match, index) => source.slice(match.index, matches[index + 1]?.index ?? source.length));
}

function markedSteps(source, label) {
  const matches = [...source.matchAll(/data-ritual-step="([^"]+)"/g)];
  const ids = matches.map(match => match[1]);
  if (JSON.stringify(ids) !== JSON.stringify(RITUAL_STEP_IDS)) throw new Error(`${label} ritual step identity or order changed`);
  return matches.map((match, index) => source.slice(match.index, matches[index + 1]?.index ?? source.length));
}

function assertTokens(source, tokens, label) {
  const missing = tokens.filter(token => !source.includes(token));
  if (missing.length) throw new Error(`${label} is missing ${missing.join(', ')}`);
}

export function assertInvestigationRitual({ sourceReadme, packedReadme, demo, demoEntry, runtimeExports }) {
  const sourceSection = ritualSection(sourceReadme, 'source README');
  const packedSection = ritualSection(packedReadme, 'packed README');
  if (sourceSection !== packedSection) throw new Error('source and packed README rituals differ');

  const sourceSteps = numberedSteps(sourceSection, 'source README');
  const packedSteps = numberedSteps(packedSection, 'packed README');
  for (let index = 0; index < RITUAL_STEP_IDS.length; index++) {
    assertTokens(sourceSteps[index], readmeStepTokens[index], `source README step ${index + 1}`);
    assertTokens(packedSteps[index], readmeStepTokens[index], `packed README step ${index + 1}`);
  }
  assertTokens(sourceSection, readmeBoundaryTokens, 'source README boundaries');
  assertTokens(packedSection, readmeBoundaryTokens, 'packed README boundaries');
  assertTokens(sourceReadme, RITUAL_METHODS, 'source README public API');
  assertTokens(packedReadme, RITUAL_METHODS, 'packed README public API');

  const demoSteps = markedSteps(demo, 'demo');
  for (let index = 0; index < RITUAL_STEP_IDS.length; index++) assertTokens(demoSteps[index], demoStepTokens[index], `demo step ${index + 1}`);
  assertTokens(demo, demoBoundaryTokens, 'demo boundaries');
  assertTokens(demo, ['data-demo-action="replay-interaction"', 'data-demo-action="apply-candidate-change"', 'requestAnimationFrame', 'fillRect'], 'demo actions');

  const firstEntryLine = demoEntry.split('\n').find(line => line.trim() && !line.trim().startsWith('//'))?.trim();
  if (!firstEntryLine?.startsWith("import 'canvas-scan/auto';")) throw new Error('demo must load canvas-scan before application imports');

  const missingMethods = RITUAL_METHODS.filter(method => !runtimeExports.includes(method));
  if (missingMethods.length) throw new Error(`public ritual API is missing ${missingMethods.join(', ')}`);
}

function exportedNames(source, includeTypes = true) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:declare\s+)?function\s+(\w+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (!includeTypes && match[1]) continue;
    for (const item of match[2].split(',')) {
      const value = item.trim().replace(/^type\s+/, '');
      const alias = value.match(/\bas\s+(\w+)$/)?.[1];
      const direct = value.match(/^(\w+)/)?.[1];
      if (alias ?? direct) names.add(alias ?? direct);
    }
  }
  return names;
}

function iifeOperations(source) {
  const body = source.match(/(?:window|globalThis)\.__CANVAS_SCAN__=\{([^}]*)\}/)?.[1] ?? '';
  return new Set(body.split(',').map((item) => item.trim().match(/^(\w+)/)?.[1]).filter(Boolean));
}

function assertExactNames(label, actual, expected) {
  const missing = expected.filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`${label} changed: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`);
  }
}

export function assertPublicContract({ runtime, declarations, iife }) {
  const runtimeExports = exportedNames(runtime, false);
  const declarationExports = exportedNames(declarations);
  assertExactNames('ESM runtime exports', runtimeExports, ESM_RUNTIME_EXPORTS);
  assertExactNames('declaration exports', declarationExports, [...ESM_RUNTIME_EXPORTS, ...TYPE_EXPORTS]);
  const operations = iifeOperations(iife);
  assertExactNames('IIFE public operations', operations, IIFE_RUNTIME_FIELDS);
}

export function assertLabBoundary(entries, sources) {
  const entry = entries.find((name) => /lab-v04|lab-v04-truth|v0\.4.*fixture/i.test(name));
  if (entry) throw new Error(`lab-only tarball entry: ${entry}`);
  for (const [name, text] of Object.entries(sources)) {
    const marker = labMarkers.find((value) => text.includes(value));
    if (marker) throw new Error(`lab-only marker ${marker} in ${name}`);
  }
}

export function assertManifestEntries(entries) {
  const missing = MANIFEST_REQUIRED.filter((entry) => !entries.includes(entry));
  if (missing.length > 0) {
    throw new Error(`missing required tarball entries: ${missing.join(', ')}`);
  }
  const unexpected = entries.filter(
    (entry) => !MANIFEST_ALLOW.some((pattern) => pattern.test(entry)),
  );
  if (unexpected.length > 0) {
    throw new Error(`unexpected tarball entries: ${unexpected.join(', ')}`);
  }
  const chunks = entries.filter((entry) => /dist\/chunk-/.test(entry));
  if (chunks.length !== 1) {
    throw new Error(
      `expected exactly one shared chunk, found: ${chunks.join(', ') || 'none'}`,
    );
  }
}
