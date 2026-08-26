import type {
  ComparisonArtifactV1,
  ComparisonFindingRef,
  ComparisonMeasure,
  ComparisonMeasureId,
  InvestigationSessionV1,
  SessionFindingPairing,
} from './types.js';

type UnknownRecord = Record<string, unknown>;
type IncomparableReason = ComparisonArtifactV1['incomparableReasons'][number];
type MeasureUnit = ComparisonMeasure['unit'];

const findingTypes = new Set(['heavy-canvas-work', 'repeated-draw-work', 'resize-churn', 'backing-store-mismatch']);

function record(value: unknown): UnknownRecord | undefined { return value !== null && typeof value === 'object' ? value as UnknownRecord : undefined; }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function index(value: unknown): value is number { return Number.isInteger(value) && (value as number) >= 0; }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value); }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function date(value: unknown): value is string { return text(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)); }
function array(value: unknown): unknown[] | undefined { return Array.isArray(value) ? value : undefined; }

function selected(session: unknown, findingIndex: unknown): UnknownRecord | undefined {
  const value = record(session);
  const findings = array(value?.findings);
  return index(findingIndex) && findings ? record(findings[findingIndex]) : undefined;
}

function ref(session: unknown, findingIndex: unknown): ComparisonFindingRef {
  const value = record(session);
  const finding = selected(session, findingIndex);
  return {
    sessionId: text(value?.sessionId) ? value.sessionId : '',
    findingIndex: typeof findingIndex === 'number' ? findingIndex : -1,
    findingType: finding && findingTypes.has(finding.type as string) ? finding.type as ComparisonFindingRef['findingType'] : null,
    canvasId: text(finding?.canvasId) ? finding.canvasId : null,
  };
}

function metadata(baseline: unknown, candidate: unknown, pairing: UnknownRecord) {
  const left = record(baseline); const right = record(candidate);
  const leftId = text(left?.sessionId) ? left.sessionId : '';
  const rightId = text(right?.sessionId) ? right.sessionId : '';
  const leftEnded = date(left?.endedAt) ? left.endedAt : '';
  const rightEnded = date(right?.endedAt) ? right.endedAt : '';
  return {
    comparisonId: `canvas-scan-comparison-${encodeURIComponent(leftId)}-${typeof pairing.baselineFindingIndex === 'number' ? pairing.baselineFindingIndex : -1}-${encodeURIComponent(rightId)}-${typeof pairing.candidateFindingIndex === 'number' ? pairing.candidateFindingIndex : -1}`,
    createdAt: leftEnded && rightEnded ? (Date.parse(leftEnded) >= Date.parse(rightEnded) ? leftEnded : rightEnded) : leftEnded || rightEnded,
    canvasScanVersion: text(right?.canvasScanVersion) ? right.canvasScanVersion : '',
  };
}

function incomparable(baseline: unknown, candidate: unknown, pairing: UnknownRecord, reason: IncomparableReason): ComparisonArtifactV1 {
  return { schemaVersion: 1, ...metadata(baseline, candidate, pairing), pairingMethod: 'user-selected', baseline: ref(baseline, pairing.baselineFindingIndex), candidate: ref(candidate, pairing.candidateFindingIndex), status: 'incomparable', incomparableReasons: [reason], measures: [], improvementEstablished: false };
}

function statuses(value: unknown): UnknownRecord | undefined {
  const result = record(value);
  return result && count(result.same) && count(result.changed) && count(result.unknown) ? result : undefined;
}

function methods(value: unknown): Map<string, { count: number; time: number | null }> | undefined {
  const result = new Map<string, { count: number; time: number | null }>();
  const entries = Array.isArray(value)
    ? value.map(item => { const method = record(item); return [method?.method, method] as const; })
    : record(value) ? Object.entries(value as UnknownRecord) : undefined;
  if (!entries) return undefined;
  for (const [name, raw] of entries) {
    const item = record(raw);
    if (!text(name) || result.has(name) || !item || !count(item.count) || (item.canvasApiSelfTimeMs !== null && !number(item.canvasApiSelfTimeMs))) return undefined;
    result.set(name, { count: item.count as number, time: item.canvasApiSelfTimeMs as number | null });
  }
  return result;
}

function canvas(session: UnknownRecord, finding: UnknownRecord): UnknownRecord | undefined {
  if (!text(finding.canvasId)) return undefined;
  const matches = array(session.canvases)?.filter(item => record(item)?.canvasId === finding.canvasId) ?? [];
  return matches.length === 1 ? record(matches[0]) : undefined;
}

function validCanvas(value: UnknownRecord | undefined): value is UnknownRecord {
  const commandStatuses = statuses(value?.commandStatuses);
  return !!value && text(value.canvasId) && count(value.activeWindowCount) && count(value.rasterOperationCount) && number(value.canvasApiSelfTimeMs) && number(value.maxWindowSelfTimeMs)
    && !!commandStatuses && commandStatuses.same as number + (commandStatuses.changed as number) + (commandStatuses.unknown as number) === value.activeWindowCount && !!methods(value.methodEvidence);
}

function sampling(value: UnknownRecord): number {
  return count(value.captureEvery) && (value.captureEvery as number) >= 1 ? value.captureEvery as number : 1;
}

function validSession(value: UnknownRecord): boolean {
  const dropped = record(value.droppedEntryCounts);
  return text(value.sessionId) && date(value.endedAt) && text(value.canvasScanVersion) && Array.isArray(value.findings) && Array.isArray(value.canvases)
    && !!dropped && count(dropped.canvasWindowReports) && count(dropped.canvasLifetimes) && count(dropped.resetEvents)
    && dropped.canvasWindowReports === 0 && dropped.canvasLifetimes === 0;
}

function validHeavy(finding: UnknownRecord): boolean {
  const maximum = record(finding.maximumWindow); const topMethods = array(finding.topMethods);
  return text(finding.episodeId) && count(finding.rasterOperationCount) && number(finding.canvasApiSelfTimeMs) && !!topMethods && topMethods.length > 0 && !!methods(topMethods)
    && !!maximum && count(maximum.windowIndex) && number(maximum.timestampMs) && number(maximum.canvasApiSelfTimeMs) && count(maximum.rasterOperationCount) && !!methods(maximum.methodEvidence);
}

function validRepeated(finding: UnknownRecord): boolean {
  const windows = array(finding.repeatedWindows); const coverage = record(finding.unknownCoverage);
  return text(finding.episodeId) && count(finding.repeatedWindowCount) && count(finding.rasterOperationCount) && number(finding.canvasApiSelfTimeMs) && !!windows && finding.repeatedWindowCount === windows.length
    && windows.every(item => { const window = record(item); return !!window && count(window.windowIndex) && number(window.timestampMs) && count(window.rasterOperationCount) && number(window.canvasApiSelfTimeMs) && count(window.comparisonGap) && (window.comparisonGap as number) >= 1; })
    && !!coverage && count(coverage.unknownWindowCount) && count(coverage.activeWindowCount) && (coverage.unknownWindowCount as number) <= (coverage.activeWindowCount as number);
}

function validResize(finding: UnknownRecord, session: UnknownRecord): boolean {
  const events = array(finding.resetEvents); const episodes = array(finding.affectedEpisodeIds); const commandStatuses = statuses(finding.commandStatuses); const dropped = record(session.droppedEntryCounts);
  return !!dropped && dropped.resetEvents === 0 && count(finding.activeResetCount) && count(finding.observedResetCount) && !!events && !!episodes && !!commandStatuses
    && finding.activeResetCount === events.length && (finding.activeResetCount as number) <= (finding.observedResetCount as number)
    && events.every(item => { const event = record(item); return !!event && text(event.source) && number(event.width) && number(event.height) && count(event.windowIndex) && number(event.timestampMs); }) && episodes.every(text)
    && (commandStatuses.same as number) + (commandStatuses.changed as number) + (commandStatuses.unknown as number) === new Set(events.map(item => record(item)!.windowIndex)).size;
}

function validBacking(finding: UnknownRecord): boolean {
  const windows = array(finding.affectedWindows); const episodes = array(finding.affectedEpisodeIds);
  return count(finding.affectedWindowCount) && count(finding.rasterOperationCount) && number(finding.canvasApiSelfTimeMs) && !!windows && !!episodes && finding.affectedWindowCount === windows.length && windows.length > 0
    && episodes.every(text) && windows.every(item => { const window = record(item); return !!window && count(window.windowIndex) && number(window.timestampMs) && count(window.rasterOperationCount) && number(window.canvasApiSelfTimeMs) && number(window.backingWidth) && number(window.backingHeight) && number(window.expectedBackingWidth) && number(window.expectedBackingHeight) && number(window.expectedPixelArea) && number(window.actualToExpectedAreaRatio); });
}

function validFinding(finding: UnknownRecord, session: UnknownRecord): boolean {
  if (!findingTypes.has(finding.type as string) || !text(finding.canvasId)) return false;
  if (finding.type === 'heavy-canvas-work') return validHeavy(finding);
  if (finding.type === 'repeated-draw-work') return validRepeated(finding);
  if (finding.type === 'resize-churn') return validResize(finding, session);
  return validBacking(finding);
}

function rounded(value: number, unit: MeasureUnit): number { return unit === 'count' ? value : Math.round(value * 1000) / 1000; }
function measure(id: ComparisonMeasureId, unit: MeasureUnit, baseline: number | null, candidate: number | null, scope: ComparisonMeasure['scope'] = 'session'): ComparisonMeasure {
  const delta = baseline === null || candidate === null ? null : rounded(candidate - baseline, unit);
  return { id, unit, baseline, candidate, delta, direction: delta === null ? 'unknown' : delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural', scope };
}

function skippedGaps(finding: UnknownRecord): number { return (finding.repeatedWindows as unknown[]).reduce<number>((total, item) => total + Math.max(0, (record(item)!.comparisonGap as number) - 1), 0); }
function maximumRatio(finding: UnknownRecord): number { return Math.max(...(finding.affectedWindows as unknown[]).map(item => record(item)!.actualToExpectedAreaRatio as number)); }
function unknown(finding: UnknownRecord, summary: UnknownRecord): number {
  if (finding.type === 'repeated-draw-work') return record(finding.unknownCoverage)!.unknownWindowCount as number;
  if (finding.type === 'resize-churn') return record(finding.commandStatuses)!.unknown as number;
  return record(summary.commandStatuses)!.unknown as number;
}

function findingMeasures(baseline: UnknownRecord, candidate: UnknownRecord): ComparisonMeasure[] {
  if (baseline.type === 'heavy-canvas-work') return [measure('heavy-episode-operation-count', 'count', baseline.rasterOperationCount as number, candidate.rasterOperationCount as number, 'episode'), measure('heavy-episode-self-time-ms', 'ms', baseline.canvasApiSelfTimeMs as number, candidate.canvasApiSelfTimeMs as number, 'episode')];
  if (baseline.type === 'repeated-draw-work') return [measure('repeated-window-count', 'count', baseline.repeatedWindowCount as number, candidate.repeatedWindowCount as number, 'episode'), measure('repeated-raster-operation-count', 'count', baseline.rasterOperationCount as number, candidate.rasterOperationCount as number, 'episode'), measure('comparison-gap-count', 'count', skippedGaps(baseline), skippedGaps(candidate), 'episode')];
  if (baseline.type === 'resize-churn') { const left = record(baseline.commandStatuses)!; const right = record(candidate.commandStatuses)!; return [measure('active-reset-count', 'count', baseline.activeResetCount as number, candidate.activeResetCount as number), measure('observed-reset-count', 'count', baseline.observedResetCount as number, candidate.observedResetCount as number), measure('affected-episode-count', 'count', new Set(baseline.affectedEpisodeIds as string[]).size, new Set(candidate.affectedEpisodeIds as string[]).size), measure('same-command-window-count', 'count', left.same as number, right.same as number), measure('changed-command-window-count', 'count', left.changed as number, right.changed as number)]; }
  return [measure('affected-backing-window-count', 'count', baseline.affectedWindowCount as number, candidate.affectedWindowCount as number), measure('maximum-backing-area-ratio', 'ratio', maximumRatio(baseline), maximumRatio(candidate))];
}

export function compareSessions(baseline: InvestigationSessionV1, candidate: InvestigationSessionV1, pairing: SessionFindingPairing): ComparisonArtifactV1 {
  const selectedPairing = record(pairing) ?? {};
  const leftSession = record(baseline); const rightSession = record(candidate);
  if (!leftSession || !rightSession || leftSession.schemaVersion !== 1 || rightSession.schemaVersion !== 1) return incomparable(baseline, candidate, selectedPairing, 'unsupported-schema');
  if (!Array.isArray(leftSession.findings) || !Array.isArray(rightSession.findings)) return incomparable(baseline, candidate, selectedPairing, 'incomplete-evidence');
  const left = selected(leftSession, selectedPairing.baselineFindingIndex); const right = selected(rightSession, selectedPairing.candidateFindingIndex);
  if (!left || !right) return incomparable(baseline, candidate, selectedPairing, 'finding-not-found');
  if (left.type !== right.type) return incomparable(baseline, candidate, selectedPairing, 'finding-type-mismatch');
  // Two recordings sampled at different rates report different spans of
  // windows, so their totals are not on one scale. A session written before
  // captureEvery was recorded has no value here and is read as unsampled.
  if (sampling(leftSession) !== sampling(rightSession)) return incomparable(baseline, candidate, selectedPairing, 'sampling-mismatch');
  const leftCanvas = canvas(leftSession, left); const rightCanvas = canvas(rightSession, right);
  if (!validSession(leftSession) || !validSession(rightSession) || !validCanvas(leftCanvas) || !validCanvas(rightCanvas) || !validFinding(left, leftSession) || !validFinding(right, rightSession)) return incomparable(baseline, candidate, selectedPairing, 'incomplete-evidence');
  const leftMethods = methods(left.type === 'heavy-canvas-work' ? left.topMethods : leftCanvas.methodEvidence); const rightMethods = methods(right.type === 'heavy-canvas-work' ? right.topMethods : rightCanvas.methodEvidence);
  if (!leftMethods || !rightMethods) return incomparable(baseline, candidate, selectedPairing, 'incomplete-evidence');
  const result: ComparisonMeasure[] = [measure('active-window-count', 'count', leftCanvas.activeWindowCount as number, rightCanvas.activeWindowCount as number), measure('raster-operation-count', 'count', leftCanvas.rasterOperationCount as number, rightCanvas.rasterOperationCount as number), measure('canvas-api-self-time-ms', 'ms', leftCanvas.canvasApiSelfTimeMs as number, rightCanvas.canvasApiSelfTimeMs as number), measure('maximum-window-self-time-ms', 'ms', leftCanvas.maxWindowSelfTimeMs as number, rightCanvas.maxWindowSelfTimeMs as number)];
  // Per-method evidence comes from the finding's episode for heavy-canvas-work
  // and from the whole session for the other three types, so each measure says
  // which span it covers rather than reading alike for both.
  const methodScope = left.type === 'heavy-canvas-work' ? 'episode' : 'session';
  for (const name of [...new Set([...leftMethods.keys(), ...rightMethods.keys()])].sort()) { const leftMethod = leftMethods.get(name); const rightMethod = rightMethods.get(name); result.push(measure(`method:${name}:operation-count`, 'count', leftMethod?.count ?? 0, rightMethod?.count ?? 0, methodScope), measure(`method:${name}:self-time-ms`, 'ms', leftMethod ? leftMethod.time : 0, rightMethod ? rightMethod.time : 0, methodScope)); }
  result.push(measure('unknown-command-window-count', 'count', unknown(left, leftCanvas), unknown(right, rightCanvas), left.type === 'repeated-draw-work' ? 'episode' : 'session'), ...findingMeasures(left, right));
  return { schemaVersion: 1, ...metadata(baseline, candidate, selectedPairing), pairingMethod: 'user-selected', baseline: ref(baseline, selectedPairing.baselineFindingIndex), candidate: ref(candidate, selectedPairing.candidateFindingIndex), status: 'comparable', incomparableReasons: [], measures: result, improvementEstablished: false };
}
