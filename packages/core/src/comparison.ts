import type {
  ComparisonArtifactV1,
  ComparisonFindingRef,
  ComparisonMeasure,
  ComparisonMeasureId,
  ComparisonSpan,
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
  const length = spans(record(baseline), record(candidate));
  return { schemaVersion: 1, ...metadata(baseline, candidate, pairing), pairingMethod: 'user-selected', baseline: ref(baseline, pairing.baselineFindingIndex), candidate: ref(candidate, pairing.candidateFindingIndex), status: 'incomparable', incomparableReasons: [reason], measures: [], ...length, ...coverage(record(baseline), record(candidate)), ...observation(record(baseline), record(candidate)), sessionFallback: fallback(record(baseline), record(candidate), reason, length.spanMismatch), improvementEstablished: false };
}

// When the selected findings cannot be paired, the sessions still measured
// something. A fix that removes the finding it targeted is the commonest case,
// and refusing to say anything there loses the before-and-after the user came
// for. Session-wide totals are reported instead, with the reason the findings
// were not paired kept beside them. A different schema or a different sampling
// rate puts the totals themselves on different scales, so neither gets one.
const fallbackReasons: ReadonlySet<IncomparableReason> = new Set(['finding-not-found', 'finding-type-mismatch', 'incomplete-evidence']);
const fallbackCaveats: Record<string, string> = {
  'finding-not-found': 'The selected finding is missing from one or both sessions, for example because a change removed it.',
  'finding-type-mismatch': 'The selected findings are of different types, so they do not describe the same work.',
  'incomplete-evidence': 'The selected findings lack the evidence a paired comparison needs.',
};
function totals(session: UnknownRecord | undefined): { selfTime: number; raster: number; windows: number; resets: number; unobservable: number } | undefined {
  const canvases = array(session?.canvases); const resets = array(session?.resetEvents); const dropped = record(session?.droppedEntryCounts);
  if (!session || !canvases || !resets || !dropped || !count(dropped.resetEvents)) return undefined;
  let selfTime = 0; let raster = 0; let windows = 0; let unobservable = 0;
  for (const item of canvases) {
    const value = record(item);
    if (!value || !number(value.canvasApiSelfTimeMs) || !count(value.rasterOperationCount) || !count(value.activeWindowCount)) return undefined;
    selfTime += value.canvasApiSelfTimeMs as number; raster += value.rasterOperationCount as number; windows += value.activeWindowCount as number;
    if (value.observability === 'unobservable') unobservable++;
  }
  return { selfTime, raster, windows, resets: resets.length + (dropped.resetEvents as number), unobservable };
}
function fallback(left: UnknownRecord | undefined, right: UnknownRecord | undefined, reason: IncomparableReason, spanMismatch: string | null): ComparisonArtifactV1['sessionFallback'] {
  if (!fallbackReasons.has(reason) || left?.schemaVersion !== 1 || right?.schemaVersion !== 1 || sampling(left) !== sampling(right)) return null;
  const baseline = totals(left); const candidate = totals(right);
  if (!baseline || !candidate) return null;
  const notes = [
    `${fallbackCaveats[reason]} These are session-wide totals over every recorded canvas, not a paired comparison of one finding.`,
    'They describe the same work only if both recordings drove the same interaction.',
    spanMismatch ? 'The two recordings differ markedly in length; see spanMismatch.' : null,
    baseline.unobservable + candidate.unobservable > 0 ? `${baseline.unobservable} canvases in the baseline and ${candidate.unobservable} in the candidate were transferred to a worker; their drawing after the transfer is not in these totals.` : null,
    'Only main-thread Canvas2D API calls are counted. Rendering outside that, such as WebGL, workers, or GPU work, is not in these totals.',
  ].filter((note): note is string => note !== null);
  return {
    caveat: notes.join(' '),
    measures: [
      measure('session-canvas-api-self-time-ms', 'ms', rounded(baseline.selfTime, 'ms'), rounded(candidate.selfTime, 'ms')),
      measure('session-raster-operation-count', 'count', baseline.raster, candidate.raster),
      measure('session-active-window-count', 'count', baseline.windows, candidate.windows),
      measure('session-reset-count', 'count', baseline.resets, candidate.resets),
    ],
  };
}

// Session-scoped measures are raw totals over whatever each recording covered,
// and two hand-driven recordings rarely cover the same span. The artifact
// carries each side's length, and says so when one side ran markedly longer or
// drew markedly more episodes than the other, so a delta between the totals is
// not read as a change on its own.
function marks(session: UnknownRecord): UnknownRecord[] { return browserEntries(session, 'user-mark').filter(entry => text(entry.label) && number(entry.startedAtTimestampMs)); }
function span(session: UnknownRecord | undefined): ComparisonSpan {
  const episodes = array(session?.episodes);
  return { durationMs: number(session?.durationMs) ? session.durationMs : null, episodeCount: episodes ? episodes.length : null, userMarkCount: session && array(session.browserEntries) ? marks(session).length : null };
}
function apart(left: number | null, right: number | null): boolean { return left !== null && right !== null && Math.abs(left - right) > 0.2 * Math.max(left, right); }
function covers(value: ComparisonSpan): string { return `${value.durationMs === null ? 'an unknown duration' : `${value.durationMs} ms`} and ${value.episodeCount === null ? 'an unknown number of' : value.episodeCount} draw episodes`; }
function spans(left: UnknownRecord | undefined, right: UnknownRecord | undefined): Pick<ComparisonArtifactV1, 'span' | 'spanMismatch'> {
  const baseline = span(left); const candidate = span(right);
  const mismatch = apart(baseline.durationMs, candidate.durationMs) || apart(baseline.episodeCount, candidate.episodeCount);
  return { span: { baseline, candidate }, spanMismatch: mismatch ? `The baseline covers ${covers(baseline)}; the candidate covers ${covers(candidate)}. Session-scoped totals are not on one scale. Read measures scoped to the selected finding's draw episode where available.` : null };
}

// A canvas the lifetime cap evicted is kept as a summary and has no frames to
// compare. The artifact says how many such canvases each side left out.
function summaryOnly(session: UnknownRecord | undefined): number { return (array(session?.canvases) ?? []).filter(item => record(item)?.windowDetailDropped === true).length; }
function coverage(left: UnknownRecord | undefined, right: UnknownRecord | undefined): Pick<ComparisonArtifactV1, 'coverageNote'> {
  const baseline = summaryOnly(left); const candidate = summaryOnly(right);
  return { coverageNote: baseline + candidate === 0 ? null : `${baseline} ${baseline === 1 ? 'canvas' : 'canvases'} in the baseline and ${candidate} in the candidate were summary-only and were not compared.` };
}

// A session written before observationCoverage existed has none, and says
// nothing either way. Older sessions are not refused for it.
function unobserved(session: UnknownRecord | undefined): number | null {
  const value = record(session?.observationCoverage);
  return value && count(value.unobservedCanvasCount) ? value.unobservedCanvasCount as number : null;
}
function observation(left: UnknownRecord | undefined, right: UnknownRecord | undefined): Pick<ComparisonArtifactV1, 'observationNote'> {
  const baseline = unobserved(left); const candidate = unobserved(right);
  if (!baseline && !candidate) return { observationNote: null };
  const side = (value: number | null) => value === null ? 'an unknown number of' : String(value);
  return { observationNote: `${side(baseline)} ${baseline === 1 ? 'canvas' : 'canvases'} in the baseline and ${side(candidate)} in the candidate drew through APIs canvas-scan does not observe, such as WebGL or a worker. Their work is in no measure here, and a lower Canvas2D total does not mean they drew less. See observationCoverage in each session.` };
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
  // A canvas the lifetime cap evicted keeps its totals and loses its frames,
  // and what the comparison needs is the frames. The refusal is per canvas:
  // the selected canvas in that state is refused, and any other summary-only
  // canvas in the session is left out and counted in the coverage note.
  return !!value && text(value.canvasId) && value.windowDetailDropped !== true && count(value.activeWindowCount) && count(value.rasterOperationCount) && number(value.canvasApiSelfTimeMs) && number(value.maxWindowSelfTimeMs)
    && !!commandStatuses && commandStatuses.same as number + (commandStatuses.changed as number) + (commandStatuses.unknown as number) === value.activeWindowCount && !!methods(value.methodEvidence);
}

function sampling(value: UnknownRecord): number {
  return count(value.captureEvery) && (value.captureEvery as number) >= 1 ? value.captureEvery as number : 1;
}

function validSession(value: UnknownRecord): boolean {
  const dropped = record(value.droppedEntryCounts);
  return text(value.sessionId) && date(value.endedAt) && text(value.canvasScanVersion) && Array.isArray(value.findings) && Array.isArray(value.canvases)
    && !!dropped && count(dropped.canvasWindowReports) && count(dropped.canvasLifetimes) && count(dropped.resetEvents)
    // canvasWindowReports counts frames the window cap dropped from a canvas
    // still in the session, so any count is a truncated recording. A dropped
    // lifetime is a canvas with no frames that was forgotten; it cannot be the
    // selected canvas, so it does not refuse the session.
    && dropped.canvasWindowReports === 0;
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

// Browser evidence is recorded for the whole session, so both measures are
// session scoped. A browser that did not supply the feature reports null: a
// zero here would read as a recording with no slow interaction.
function browserEntries(session: UnknownRecord, kind: string): UnknownRecord[] { return (array(session.browserEntries) ?? []).map(record).filter((entry): entry is UnknownRecord => entry?.kind === kind); }
function worstInteraction(session: UnknownRecord): number | null {
  if (record(session.browserFeatures)?.eventTiming !== true) return null;
  return browserEntries(session, 'event-timing').reduce((worst, entry) => number(entry.durationMs) && entry.durationMs > worst ? entry.durationMs : worst, 0);
}
function longFrames(session: UnknownRecord): number | null { return record(session.browserFeatures)?.longAnimationFrames === true ? browserEntries(session, 'long-animation-frame').length : null; }
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
  const length = spans(leftSession, rightSession);
  const result: ComparisonMeasure[] = [measure('active-window-count', 'count', leftCanvas.activeWindowCount as number, rightCanvas.activeWindowCount as number), measure('raster-operation-count', 'count', leftCanvas.rasterOperationCount as number, rightCanvas.rasterOperationCount as number), measure('canvas-api-self-time-ms', 'ms', leftCanvas.canvasApiSelfTimeMs as number, rightCanvas.canvasApiSelfTimeMs as number), measure('maximum-window-self-time-ms', 'ms', leftCanvas.maxWindowSelfTimeMs as number, rightCanvas.maxWindowSelfTimeMs as number), measure('worst-interaction-duration-ms', 'ms', worstInteraction(leftSession), worstInteraction(rightSession)), measure('long-animation-frame-count', 'count', longFrames(leftSession), longFrames(rightSession))];
  // Per-method evidence comes from the finding's episode for heavy-canvas-work
  // and from the whole session for the other three types, so each measure says
  // which span it covers rather than reading alike for both.
  const methodScope = left.type === 'heavy-canvas-work' ? 'episode' : 'session';
  for (const name of [...new Set([...leftMethods.keys(), ...rightMethods.keys()])].sort()) { const leftMethod = leftMethods.get(name); const rightMethod = rightMethods.get(name); result.push(measure(`method:${name}:operation-count`, 'count', leftMethod?.count ?? 0, rightMethod?.count ?? 0, methodScope), measure(`method:${name}:self-time-ms`, 'ms', leftMethod ? leftMethod.time : 0, rightMethod ? rightMethod.time : 0, methodScope)); }
  result.push(measure('unknown-command-window-count', 'count', unknown(left, leftCanvas), unknown(right, rightCanvas), left.type === 'repeated-draw-work' ? 'episode' : 'session'), ...findingMeasures(left, right));
  return { schemaVersion: 1, ...metadata(baseline, candidate, selectedPairing), pairingMethod: 'user-selected', baseline: ref(baseline, selectedPairing.baselineFindingIndex), candidate: ref(candidate, selectedPairing.candidateFindingIndex), status: 'comparable', incomparableReasons: [], measures: result, ...length, ...coverage(leftSession, rightSession), ...observation(leftSession, rightSession), sessionFallback: null, improvementEstablished: false };
}
