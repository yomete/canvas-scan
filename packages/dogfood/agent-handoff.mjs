// The agent handoff: one bounded investigation, written so a coding agent can
// read it without parsing overlay text or carrying hidden state from a chat.
//
// Two forms of the same records. JSON is one object with an array; JSONL is one
// record per line, which a consumer can stream and stop reading at the terminal
// result. Both are versioned, and both are checked by the same validator.
//
// What the format refuses to lose: what the run did not finish, what the tool
// could not compare, what a collection limit threw away, and what each finding
// does and does not establish. An agent that reads only the findings gets the
// same evidence discipline a person reading the overlay gets.
//
// The handoff is local. It names one target and refers to nothing else over the
// network — no prompt, no rule file, no score, no explanation from a service.
// The validator enforces that rather than trusting it.
export const HANDOFF_SCHEMA_VERSION = 1;

export const RECORD_KINDS = Object.freeze(['metadata', 'stage', 'finding', 'explanation', 'comparison', 'limit', 'result']);
export const STAGE_STATUSES = Object.freeze(['complete', 'not-observed', 'failed']);
export const RESULT_STATUSES = Object.freeze(['complete', 'incomplete', 'failed']);

const KEYS = Object.freeze({
  metadata: ['kind', 'schemaVersion', 'issue', 'tool', 'toolVersion', 'target', 'startedAt', 'endedAt', 'browserVersion', 'completeness'],
  stage: ['kind', 'id', 'status', 'detail'],
  finding: ['kind', 'sessionId', 'rank', 'type', 'evidenceLevel', 'canvasId', 'owner', 'canvasApiSelfTimeMs', 'rasterOperationCount', 'unknownCoverage', 'claimBoundary', 'nextCheck'],
  explanation: ['kind', 'explanationId', 'sessionId', 'findingIndex', 'canvasId', 'windowCount', 'callsiteCoverage', 'firstGapReason'],
  comparison: ['kind', 'comparisonId', 'baselineSessionId', 'candidateSessionId', 'status', 'incomparableReasons', 'improvementEstablished', 'measureCount'],
  limit: ['kind', 'scope', 'scopeId', 'name', 'droppedCount'],
  result: ['kind', 'status', 'incompleteStages', 'notes'],
});

export class HandoffError extends Error {}

const fail = message => { throw new HandoffError(message); };
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const REMOTE = /\bhttps?:\/\//i;

// Every string in the handoff except the one target is checked for a URL. A
// handoff that carried a second address would be a handoff that could tell an
// agent where to go and what to think, which is the thing this format is not.
function assertLocal(record, index) {
  const walk = (value, path) => {
    if (typeof value === 'string') {
      if (REMOTE.test(value)) fail(`record ${index} (${record.kind}) refers to a remote address at ${path}: the handoff is local`);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item, position) => walk(item, `${path}[${position}]`)); return; }
    if (isRecord(value)) { for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`); }
  };
  for (const [key, value] of Object.entries(record)) {
    if (record.kind === 'metadata' && key === 'target') continue;
    walk(value, key);
  }
}

function assertShape(record, index) {
  if (!isRecord(record)) fail(`record ${index} is not an object`);
  if (!RECORD_KINDS.includes(record.kind)) fail(`record ${index} has unknown kind ${JSON.stringify(record.kind)}. Known kinds: ${RECORD_KINDS.join(', ')}`);
  const expected = KEYS[record.kind];
  const actual = Object.keys(record).sort();
  const extra = actual.filter(key => !expected.includes(key));
  const missing = expected.filter(key => !actual.includes(key));
  if (extra.length) fail(`record ${index} (${record.kind}) has unknown field${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}`);
  if (missing.length) fail(`record ${index} (${record.kind}) is missing ${missing.join(', ')}`);
  assertLocal(record, index);
}

export function validateHandoff(records) {
  if (!Array.isArray(records) || records.length === 0) fail('the handoff has no records');
  records.forEach(assertShape);

  if (records[0].kind !== 'metadata') fail('the first record must be the metadata record');
  if (records[0].schemaVersion !== HANDOFF_SCHEMA_VERSION) fail(`unsupported schema version ${records[0].schemaVersion}; this reader understands ${HANDOFF_SCHEMA_VERSION}`);

  const results = records.filter(record => record.kind === 'result');
  if (results.length === 0) fail('the handoff has no terminal result record, so a reader cannot tell a finished run from a truncated file');
  if (results.length > 1) fail(`the handoff has ${results.length} terminal result records; there must be exactly one`);
  if (records.at(-1).kind !== 'result') fail('the terminal result record must be last');

  const stages = records.filter(record => record.kind === 'stage');
  if (stages.length === 0) fail('the handoff records no stages');
  for (const stage of stages) {
    if (!STAGE_STATUSES.includes(stage.status)) fail(`stage ${stage.id} has unknown status ${JSON.stringify(stage.status)}`);
  }
  const ids = stages.map(stage => stage.id);
  if (new Set(ids).size !== ids.length) fail('a stage id appears more than once');

  const [result] = results;
  if (!RESULT_STATUSES.includes(result.status)) fail(`the result has unknown status ${JSON.stringify(result.status)}`);
  // The result cannot disagree with the stages it summarizes. This is the
  // check that stops a run reporting success over its own unfinished work.
  const unfinished = stages.filter(stage => stage.status !== 'complete').map(stage => stage.id);
  if (JSON.stringify([...result.incompleteStages].sort()) !== JSON.stringify([...unfinished].sort())) {
    fail(`the result lists incomplete stages [${result.incompleteStages.join(', ')}] but the stage records say [${unfinished.join(', ')}]`);
  }
  if (result.status === 'complete' && unfinished.length) fail('the result says complete while stages are unfinished');
  if (result.status !== 'complete' && unfinished.length === 0 && result.notes.length === 0) fail('the result says the run did not complete but names nothing that went wrong');

  // A finding without its boundary is a claim without its limits, which is the
  // failure this whole tool exists to avoid.
  for (const finding of records.filter(record => record.kind === 'finding')) {
    for (const key of ['observation', 'explanation', 'nonEstablishedFacts']) {
      if (typeof finding.claimBoundary?.[key] !== 'string' || finding.claimBoundary[key].length === 0) fail(`finding ${finding.rank} of session ${finding.sessionId} has no ${key} in its claim boundary`);
    }
    if (typeof finding.nextCheck !== 'string' || finding.nextCheck.length === 0) fail(`finding ${finding.rank} of session ${finding.sessionId} has no next check`);
    if (typeof finding.evidenceLevel !== 'string') fail(`finding ${finding.rank} of session ${finding.sessionId} has no evidence level`);
  }
  return records;
}

export function buildHandoff(report, { sessions = [], explanations = [], comparisons = [] } = {}) {
  const records = [{
    kind: 'metadata',
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    issue: 'SIDPROJ-110',
    tool: 'canvas-scan',
    toolVersion: report.install?.version ?? null,
    target: report.target,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    browserVersion: report.browserVersion,
    // Says how much of the investigation exists, so a reader never has to infer
    // it from the absence of a record.
    completeness: {
      sessionCount: sessions.length,
      explanationCount: explanations.length,
      comparisonCount: comparisons.length,
      unknownWindowCount: sessions.reduce((total, session) => total + session.windows.filter(window => window.signatureStatus === 'unknown').length, 0),
      activeWindowCount: sessions.reduce((total, session) => total + session.windows.length, 0),
      summaryOnlyCanvasCount: sessions.reduce((total, session) => total + session.canvases.filter(canvas => canvas.windowDetailDropped).length, 0),
    },
  }];

  for (const step of report.steps ?? []) {
    records.push({ kind: 'stage', id: step.id, status: step.status, detail: step.detail ?? null });
  }

  for (const session of sessions) {
    for (const [index, finding] of session.findings.entries()) {
      records.push({
        kind: 'finding',
        sessionId: session.sessionId,
        rank: index + 1,
        type: finding.type,
        evidenceLevel: finding.evidenceLevel,
        canvasId: finding.canvasId,
        owner: session.canvases.find(canvas => canvas.canvasId === finding.canvasId)?.nearestReactOwner ?? null,
        canvasApiSelfTimeMs: finding.canvasApiSelfTimeMs,
        rasterOperationCount: finding.rasterOperationCount,
        // Present on every finding, not only the ones that carry it natively:
        // "how much of this canvas could not be compared" is part of reading
        // any finding about it.
        unknownCoverage: finding.unknownCoverage ?? {
          unknownWindowCount: session.canvases.find(canvas => canvas.canvasId === finding.canvasId)?.commandStatuses.unknown ?? 0,
          activeWindowCount: session.canvases.find(canvas => canvas.canvasId === finding.canvasId)?.activeWindowCount ?? 0,
        },
        claimBoundary: finding.claimBoundary,
        nextCheck: finding.nextCheck,
      });
    }
    // Dropped observations, one record each, so nothing thrown away is left to
    // be noticed as an absence.
    for (const [name, droppedCount] of Object.entries(session.droppedEntryCounts)) {
      if (droppedCount > 0) records.push({ kind: 'limit', scope: 'session', scopeId: session.sessionId, name, droppedCount });
    }
  }

  for (const explanation of explanations) {
    records.push({
      kind: 'explanation',
      explanationId: explanation.explanationId,
      sessionId: explanation.source.sessionId,
      findingIndex: explanation.source.findingIndex,
      canvasId: explanation.source.canvasId,
      windowCount: explanation.windows.length,
      callsiteCoverage: explanation.callsiteCoverage,
      firstGapReason: explanation.firstGap?.reason ?? null,
    });
    for (const [name, droppedCount] of Object.entries(explanation.droppedEntryCounts)) {
      if (droppedCount > 0) records.push({ kind: 'limit', scope: 'explanation', scopeId: explanation.explanationId, name, droppedCount });
    }
  }

  for (const comparison of comparisons) {
    records.push({
      kind: 'comparison',
      comparisonId: comparison.comparisonId,
      baselineSessionId: comparison.baseline.sessionId,
      candidateSessionId: comparison.candidate.sessionId,
      status: comparison.status,
      incomparableReasons: comparison.incomparableReasons,
      // Carried verbatim. A comparison never establishes an improvement, and
      // an agent reading this must not be able to conclude otherwise.
      improvementEstablished: comparison.improvementEstablished,
      measureCount: comparison.measures.length,
    });
  }

  const incompleteStages = (report.steps ?? []).filter(step => step.status !== 'complete').map(step => step.id);
  const failed = (report.steps ?? []).some(step => step.status === 'failed') || (report.notes ?? []).length > 0;
  records.push({
    kind: 'result',
    status: failed ? 'failed' : incompleteStages.length ? 'incomplete' : 'complete',
    incompleteStages,
    notes: report.notes ?? [],
  });
  return validateHandoff(records);
}

export const toJson = records => `${JSON.stringify({ schemaVersion: HANDOFF_SCHEMA_VERSION, records }, null, 2)}\n`;
export const toJsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';

export function parseJsonl(text) {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  return validateHandoff(lines.map((line, index) => {
    try { return JSON.parse(line); }
    catch { fail(`line ${index + 1} is not JSON`); }
  }));
}

export function parseJson(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { fail('the handoff is not JSON'); }
  if (!isRecord(value) || !Array.isArray(value.records)) fail('the handoff is not { schemaVersion, records }');
  if (value.schemaVersion !== HANDOFF_SCHEMA_VERSION) fail(`unsupported schema version ${value.schemaVersion}; this reader understands ${HANDOFF_SCHEMA_VERSION}`);
  return validateHandoff(value.records);
}
