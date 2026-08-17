export const scenarioOrder = ['heavy-burst', 'repeated-continuous', 'resize-churn', 'backing-store-mismatch', 'lifecycle-reactivation', 'interaction-association', 'non-react-burst', 'integrated-continuous', 'integrated-burst'];
const knownScenarios = scenarioOrder.slice(0, 7);
const findingTypes = {
  'heavy-burst': 'heavy-canvas-work',
  'repeated-continuous': 'repeated-draw-work',
  'resize-churn': 'resize-churn',
  'backing-store-mismatch': 'backing-store-mismatch',
  'non-react-burst': 'heavy-canvas-work',
};
const changeSets = {
  'heavy-burst': [['ownership:react', 'eventSource:keyboard'], ['methodMix:paths', 'identityOrder:last', 'geometry:wide'], ['methodMix:image', 'devicePixelRatio:2', 'eventSource:wheel', 'idleGapBoundaries:1']],
  'repeated-continuous': [['ownership:react', 'methodMix:paths'], ['identityOrder:last', 'geometry:wide', 'devicePixelRatio:2'], ['methodMix:mixed', 'idleGapBoundaries:2', 'eventSource:keyboard']],
  'resize-churn': [['ownership:react', 'eventSource:keyboard'], ['methodMix:paths', 'identityOrder:last', 'geometry:wide'], ['methodMix:mixed', 'devicePixelRatio:2', 'eventSource:wheel']],
  'backing-store-mismatch': [['ownership:react', 'eventSource:keyboard'], ['methodMix:paths', 'identityOrder:last', 'geometry:wide', 'devicePixelRatio:2'], ['methodMix:image', 'identityOrder:middle', 'geometry:compact', 'eventSource:wheel']],
  'lifecycle-reactivation': [['ownership:react', 'identityOrder:middle'], ['methodMix:paths', 'identityOrder:last', 'geometry:wide'], ['methodMix:image', 'devicePixelRatio:2', 'eventSource:keyboard']],
  'interaction-association': [['ownership:react', 'eventSource:keyboard'], ['methodMix:paths', 'identityOrder:last', 'geometry:wide', 'eventSource:wheel'], ['methodMix:mixed', 'devicePixelRatio:2', 'idleGapBoundaries:2']],
  'non-react-burst': [['methodMix:paths', 'identityOrder:last'], ['methodMix:image', 'geometry:wide', 'devicePixelRatio:2', 'eventSource:wheel'], ['methodMix:mixed', 'identityOrder:middle', 'eventSource:keyboard', 'idleGapBoundaries:1']],
};

function baseFactors(scenario) {
  return {
    ownership: 'non-react',
    schedule: scenario === 'heavy-burst' || scenario === 'interaction-association' || scenario === 'non-react-burst' || scenario === 'integrated-burst' ? 'interaction' : 'continuous',
    methodMix: 'rects', identityOrder: 'first', geometry: 'standard', devicePixelRatio: 1,
    idleGapBoundaries: 0, eventSource: 'pointer', thresholdNeighborhood: 'at-or-above',
  };
}
function applyChanges(factors, changes) {
  const result = { ...factors };
  for (const change of changes) {
    const [key, raw] = change.split(':');
    result[key] = ['devicePixelRatio', 'idleGapBoundaries'].includes(key) ? Number(raw) : raw;
  }
  return result;
}
function findingExpectation(scenario, mode, type = findingTypes[scenario]) {
  return { id: `${scenario}:${type}`, kind: 'finding', expected: mode === 'bad', findingType: type, evidenceLevel: 'candidate' };
}
function expectationsFor(scenario, mode) {
  if (scenario === 'lifecycle-reactivation') return [{ id: `${scenario}:retire-reactivate`, kind: 'lifecycle', expected: mode === 'bad', evidenceLevel: 'measured' }];
  if (scenario === 'interaction-association') return [{ id: `${scenario}:long-frame-overlap`, kind: 'association', expected: mode === 'bad', entryKind: 'long-animation-frame', evidenceLevel: 'associated' }];
  if (scenario === 'integrated-continuous') return ['repeated-draw-work', 'resize-churn', 'backing-store-mismatch'].map(type => findingExpectation(scenario, mode, type));
  if (scenario === 'integrated-burst') return [findingExpectation(scenario, mode, 'heavy-canvas-work'), findingExpectation(scenario, mode, 'resize-churn'), { id: `${scenario}:canvas-replacement`, kind: 'replacement', expected: mode === 'bad', evidenceLevel: 'measured' }];
  return [findingExpectation(scenario, mode)];
}
function invariantFor(scenario) {
  return {
    behavior: scenario,
    findingTypes: expectationsFor(scenario, 'bad').filter(item => item.kind === 'finding').map(item => item.findingType),
    evidenceLevels: [...new Set(expectationsFor(scenario, 'bad').map(item => item.evidenceLevel))],
    supportedClaim: scenario === 'interaction-association' ? 'overlap-only association' : scenario === 'lifecycle-reactivation' ? 'same-identity retirement and reactivation' : 'measured review candidate',
  };
}
function manifestRow(scenario, variant, mode, changes = []) {
  const base = baseFactors(scenario);
  return {
    scenario, behavior: scenario, application: scenario.startsWith('integrated-') ? 'integrated' : 'known-truth',
    variant, mode, changedFactors: [...changes], factors: applyChanges(base, changes), baseFactors: base,
    invariant: invariantFor(scenario), expectations: expectationsFor(scenario, mode),
  };
}

export const truthManifest = knownScenarios.flatMap(scenario => {
  const variants = ['variant-a', 'variant-b', 'variant-c'].flatMap((variant, index) => ['bad', 'fixed'].map(mode => manifestRow(scenario, variant, mode, changeSets[scenario][index])));
  return [...variants, manifestRow(scenario, 'nearest-negative', 'negative', ['thresholdNeighborhood:below'])];
}).concat(['integrated-continuous', 'integrated-burst'].flatMap(scenario => ['bad', 'fixed'].map(mode => manifestRow(scenario, 'integrated', mode))));

export const expectedMatrixRows = () => structuredClone(truthManifest);
const findings = capture => capture.session?.findings ?? capture.findings ?? [];
const canvases = capture => capture.session?.canvases ?? capture.canvasSummaries ?? [];
const lifecycle = capture => capture.session?.lifecycleEvents ?? capture.lifecycleEvents ?? [];
const associations = capture => capture.session?.episodeAssociations ?? capture.associations ?? [];
const browserEntries = capture => capture.session?.browserEntries ?? capture.browserEntries ?? [];
const episodes = capture => capture.session?.episodes ?? capture.episodes ?? [];
const claimRequirements = {
  'heavy-canvas-work': [['observation', 'measured Canvas2D API self-time'], ['explanation', 'review candidate'], ['nonEstablishedFacts', 'does not establish GPU time'], ['nextCheck', 'top measured methods']],
  'repeated-draw-work': [['observation', 'repeated commands'], ['explanation', 'review candidate'], ['nonEstablishedFacts', 'does not establish that the output stayed unchanged'], ['nextCheck', 'needs to send these repeated commands']],
  'resize-churn': [['observation', 'resets in windows with raster work'], ['explanation', 'review candidate'], ['nonEstablishedFacts', 'does not show that resets made the application slow'], ['nextCheck', 'sizing or reset calls']],
  'backing-store-mismatch': [['observation', 'backing area is larger'], ['explanation', 'review candidate'], ['nonEstablishedFacts', 'does not establish GPU cost'], ['nextCheck', 'canvas sizing policy']],
};
const validClaim = finding => finding?.evidenceLevel === 'candidate' && claimRequirements[finding.type]?.every(([key, text]) => (key === 'nextCheck' ? finding.nextCheck : finding.claimBoundary?.[key])?.includes(text));
const summaryFor = (capture, canvasId) => canvases(capture).find(summary => summary.canvasId === canvasId);
const findingEvidence = (type, finding) => {
  if (!validClaim(finding)) return false;
  if (type === 'heavy-canvas-work') return finding.canvasApiSelfTimeMs >= 8 && finding.rasterOperationCount > 0 && finding.maximumWindow?.canvasApiSelfTimeMs > 0 && finding.topMethods?.length > 0;
  if (type === 'repeated-draw-work') return finding.repeatedWindowCount > 0 && finding.rasterOperationCount >= finding.repeatedWindowCount * 2 && finding.repeatedWindows?.every(window => window.rasterOperationCount >= 2);
  if (type === 'resize-churn') return finding.activeResetCount >= 2 && finding.resetEvents?.length === finding.activeResetCount && new Set(finding.resetEvents.map(event => event.windowIndex)).size >= 2;
  if (type === 'backing-store-mismatch') return finding.affectedWindowCount >= 2 && finding.affectedWindows?.length === finding.affectedWindowCount && finding.affectedWindows.every(window => window.actualToExpectedAreaRatio >= 2);
  return false;
};
function hasFinding(capture, expected) {
  const related = finding => {
    const ids = finding.type === 'heavy-canvas-work' || finding.type === 'repeated-draw-work' ? [finding.episodeId] : finding.affectedEpisodeIds;
    return Array.isArray(ids) && ids.length > 0 && ids.some(id => episodes(capture).some(episode => episode.episodeId === id && episode.canvases?.some(canvas => canvas.canvasId === finding.canvasId)));
  };
  const matches = findings(capture).filter(finding => finding.type === expected.findingType && findingEvidence(expected.findingType, finding) && summaryFor(capture, finding.canvasId) && related(finding));
  if (!matches.length) return false;
  if (!capture.scenario?.startsWith('integrated-')) return canvases(capture)[0]?.canvasId === matches[0].canvasId;
  return true;
}
function hasLifecycle(capture) {
  const retired = lifecycle(capture).filter(event => event.type === 'retired' && event.evidenceLevel === 'measured');
  return retired.some(event => lifecycle(capture).some(candidate => candidate.type === 'reactivated' && candidate.canvasId === event.canvasId && candidate.windowIndex > event.windowIndex) && canvases(capture)[0]?.canvasId === event.canvasId);
}
function hasAssociation(capture, expected) {
  const entries = new Map(browserEntries(capture).map(entry => [entry.entryId, entry]));
  return associations(capture).some(item => {
    const episode = episodes(capture).find(candidate => candidate.episodeId === item.episodeId);
    const supporting = episode?.canvases?.slice().sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs)[0];
    return item.entryKind === expected.entryKind && item.evidenceLevel === 'associated' && item.startedAtTimestampMs <= item.endedAtTimestampMs && entries.get(item.entryId)?.kind === expected.entryKind && supporting && canvases(capture)[0]?.canvasId === supporting.canvasId;
  });
}
function hasReplacement(capture) {
  const detached = lifecycle(capture).filter(event => event.type === 'detached');
  return detached.some(event => canvases(capture).some(summary => summary.canvasId !== event.canvasId));
}
export function heavyNearestNegativeFailures(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 7 && value < 8) return [];
  const observed = value === undefined || value === null ? 'missing' : Number.isNaN(value) ? 'NaN' : value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : `${String(value)} ms`;
  return [`nearest-negative heavy self-time observed=${observed}; required=[7, 8) ms`];
}
function negativeBoundaryFailures(manifest, capture) {
  if (manifest.mode !== 'negative') return [];
  if (manifest.scenario === 'heavy-burst' || manifest.scenario === 'non-react-burst') {
    const measured = canvases(capture)[0]; const value = measured?.canvasApiSelfTimeMs;
    const minimum = manifest.scenario === 'heavy-burst' ? 7 : 0;
    const failures = manifest.scenario === 'heavy-burst' ? heavyNearestNegativeFailures(value) : typeof value === 'number' && value >= minimum && value < 8 ? [] : ['nearest-negative heavy self-time is not in the required range below 8 ms'];
    if (manifest.scenario === 'non-react-burst' && (measured?.nearestReactOwner !== null || measured?.attributionKind !== 'unattributed')) failures.push('nearest-negative non-React owner evidence is invalid');
    return failures;
  }
  if (manifest.scenario === 'repeated-continuous') {
    const same = (capture.session?.windows ?? []).filter(window => window.signatureStatus === 'same').map(window => window.rasterOperationCount);
    return same.length > 0 && Math.max(...same) === 1 ? [] : ['nearest-negative repeated window is not one operation below threshold'];
  }
  if (manifest.scenario === 'resize-churn') {
    const session = capture.session ?? {};
    const active = (session.resetEvents ?? []).filter(event => event.activeRasterOverlap);
    const canvasId = active[0]?.canvasId;
    const retired = (session.lifecycleEvents ?? []).filter(event => event.canvasId === canvasId && event.type === 'retired');
    const work = (session.windows ?? []).filter(window => window.canvasId === canvasId && window.rasterOperationCount > 0);
    return active.length === 2 && new Set(active.map(event => event.windowIndex)).size === 1 && work.length === 1 && retired.length === 1 && !findings(capture).some(item => item.type === 'resize-churn') ? [] : ['nearest-negative setup evidence is invalid'];
  }
  if (manifest.scenario === 'backing-store-mismatch') {
    const ratios = (capture.session?.windows ?? []).filter(window => window.rasterOperationCount > 0).map(window => window.geometry?.actualToExpectedAreaRatio).filter(value => typeof value === 'number');
    return ratios.filter(value => value >= 2).length === 1 && ratios.some(value => value < 2) ? [] : ['nearest-negative backing windows do not straddle the threshold'];
  }
  if (manifest.scenario === 'lifecycle-reactivation') return capture.fixtureBoundaryCount === 119 ? [] : ['nearest-negative lifecycle boundary count is not 119'];
  const eventType = manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
  const event = browserEntries(capture).find(entry => entry.kind === 'document-event' && entry.eventType === eventType);
  const firstEpisode = episodes(capture).slice().sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs)[0];
  return event && firstEpisode && event.endedAtTimestampMs < firstEpisode.startedAtTimestampMs ? [] : ['nearest-negative event does not end before the episode'];
}

export function checkScenarioResult(manifest, capture = {}) {
  capture = { ...capture, scenario: manifest.scenario };
  const failures = [];
  const expectationResults = manifest.expectations.map(expected => {
    const actual = expected.kind === 'finding' ? hasFinding(capture, expected) : expected.kind === 'lifecycle' ? hasLifecycle(capture) : expected.kind === 'association' ? hasAssociation(capture, expected) : hasReplacement(capture);
    const unsupported = expected.kind === 'association' && expected.expected && capture.session?.browserFeatures?.longAnimationFrames === false;
    const pass = unsupported || actual === expected.expected;
    if (!pass) failures.push(`${expected.id}: ${expected.expected ? `missing ${expected.kind}` : `seeded ${expected.kind} remains`}`);
    return { ...expected, actual, pass, unsupported };
  });
  const allowed = new Set(manifest.expectations.filter(item => item.expected && item.kind === 'finding').map(item => item.findingType));
  for (const finding of findings(capture)) if (!allowed.has(finding.type)) failures.push(`unexpected finding:${finding.type}`);
  if (manifest.scenario === 'interaction-association') {
    const eventType = manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
    if (!browserEntries(capture).some(entry => entry.kind === 'document-event' && entry.eventType === eventType)) failures.push(`missing document event:${eventType}`);
    if (!canvases(capture).length) failures.push('missing associated canvas summary');
  }
  if (manifest.scenario === 'lifecycle-reactivation' && manifest.mode === 'negative' && lifecycle(capture).some(event => event.type === 'retired' && event.canvasId === canvases(capture)[0]?.canvasId)) failures.push('nearest-negative canvas retired');
  if (manifest.scenario === 'interaction-association' && manifest.mode === 'negative') {
    const documentIds = new Set(browserEntries(capture).filter(entry => entry.kind === 'document-event').map(entry => entry.entryId));
    if (associations(capture).some(item => documentIds.has(item.entryId))) failures.push('nearest-negative document event associated');
  }
  if (manifest.scenario === 'non-react-burst' && manifest.mode === 'bad') {
    const finding = findings(capture).find(item => item.type === 'heavy-canvas-work'); const summary = finding && summaryFor(capture, finding.canvasId);
    if (!summary || summary.nearestReactOwner !== null || summary.attributionKind !== 'unattributed') failures.push('missing unattributed non-React supporting canvas');
  }
  failures.push(...negativeBoundaryFailures(manifest, capture));
  const idleProductActivity = capture.interactionStartedAt !== undefined && capture.interactionStartedAt !== null && ((capture.session?.windows ?? []).some(window => window.endedAtTimestampMs < capture.interactionStartedAt) || (capture.session?.episodes ?? []).some(episode => episode.endedAtTimestampMs < capture.interactionStartedAt));
  if (capture.idleSession?.windows?.length || capture.idleSession?.episodes?.length || capture.idleDrawCount || idleProductActivity) failures.push('idle capture contains draw activity');
  return { pass: failures.length === 0, failures, expectationResults };
}

export function checkMatrixCoverage(rows) {
  const axes = { ownership: ['react', 'non-react'], schedule: ['continuous', 'interaction'], methodMix: ['rects', 'paths', 'image', 'mixed'], identityOrder: ['first', 'middle', 'last'], geometry: ['compact', 'standard', 'wide'], devicePixelRatio: [1, 2], idleGapBoundaries: [1, 2], eventSource: ['pointer', 'wheel', 'keyboard'], thresholdNeighborhood: ['below', 'at-or-above'] };
  const missing = Object.entries(axes).flatMap(([axis, values]) => values.filter(value => !rows.some(row => row.factors?.[axis] === value)).map(value => `${axis}:${value}`));
  return { pass: rows.length === 53 && missing.length === 0, missing };
}
export function checkVariantInvariance(rows) {
  const failures = [];
  for (const scenario of knownScenarios) {
    const source = rows.filter(row => row.scenario === scenario && row.variant?.startsWith('variant-'));
    if (source.length !== 6) failures.push(`${scenario}:row-count`);
    const invariant = JSON.stringify(source[0]?.invariant);
    for (const row of source) if (row.changedFactors?.length < 2 || JSON.stringify(row.invariant) !== invariant) failures.push(`${scenario}:${row.variant}:${row.mode}`);
  }
  return { pass: failures.length === 0, failures };
}
export function checkNearestNegatives(rows) {
  const negatives = rows.filter(row => row.mode === 'negative');
  const failures = negatives.length === 7 && negatives.every(row => row.variant === 'nearest-negative' && row.factors?.thresholdNeighborhood === 'below' && row.pass !== false) ? [] : ['nearest-negative matrix'];
  return { pass: failures.length === 0, failures };
}
export function applyMutation(manifest, mutationName) {
  if (mutationName !== 'heavy-burst-seed-off') throw new Error(`unknown mutation: ${mutationName}`);
  return manifest.map(row => row.scenario === 'heavy-burst' && row.variant === 'variant-a' && row.mode === 'bad' ? { ...row, mutation: mutationName } : row);
}
