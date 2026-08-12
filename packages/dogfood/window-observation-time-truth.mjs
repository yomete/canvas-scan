const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function checkWindowObservationTimeEvidence(value, expected, now = Date.now()) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  expected = expected && typeof expected === 'object' && !Array.isArray(expected) ? expected : {};
  const failures = [];
  if (!exactKeys(value, ['schemaVersion', 'runId', 'startedAt', 'endedAt', 'chromeRevision', 'gitSha', 'bundleSha256', 'sourceSha256', 'harnessSha256', 'injectedCallbackOffsetMs', 'browserTimeOriginEpochMs', 'interactionStartedAtTimestampMs', 'callback', 'window', 'episode', 'droppedEntryCounts', 'diagnostics', 'port']) || value.schemaVersion !== 1) failures.push('evidence schema changed');
  const started = Date.parse(value.startedAt); const ended = Date.parse(value.endedAt);
  if (!uuid(value.runId) || !iso(value.startedAt) || !iso(value.endedAt) || started >= ended || ended - started > 5 * 60 * 1000 || now - ended >= 24 * 60 * 60 * 1000 || ended > now + 60_000) failures.push('evidence timestamps changed');
  if (!exactKeys(expected, ['chromeRevision', 'gitSha', 'bundleSha256', 'sourceSha256', 'harnessSha256']) || !/^\d+\.\d+\.\d+\.\d+$/.test(value.chromeRevision ?? '') || !/^[0-9a-f]{40}$/.test(value.gitSha ?? '') || !hash(value.bundleSha256) || !hash(value.sourceSha256) || !hash(value.harnessSha256) || value.chromeRevision !== expected.chromeRevision || value.gitSha !== expected.gitSha || value.bundleSha256 !== expected.bundleSha256 || value.sourceSha256 !== expected.sourceSha256 || value.harnessSha256 !== expected.harnessSha256 || value.injectedCallbackOffsetMs !== 1000) failures.push('evidence identity changed');
  const callback = value.callback ?? {};
  const window = value.window ?? {};
  const episode = value.episode ?? {};
  if (!exactKeys(callback, ['nativeTimestampMs', 'deliveredTimestampMs', 'executionStartedAtTimestampMs', 'executionEndedAtTimestampMs']) || !finite(callback.nativeTimestampMs) || !finite(callback.deliveredTimestampMs) || !finite(callback.executionStartedAtTimestampMs) || !finite(callback.executionEndedAtTimestampMs) || Math.abs(callback.nativeTimestampMs - callback.deliveredTimestampMs - value.injectedCallbackOffsetMs) > 0.001 || callback.executionStartedAtTimestampMs > callback.executionEndedAtTimestampMs) failures.push('callback evidence changed');
  if (!exactKeys(window, ['startedAtTimestampMs', 'endedAtTimestampMs', 'rasterOperationCount']) || !finite(window.startedAtTimestampMs) || !finite(window.endedAtTimestampMs) || window.rasterOperationCount !== 1) failures.push('window evidence changed');
  if (!exactKeys(episode, ['startedAtTimestampMs', 'endedAtTimestampMs', 'rasterOperationCount']) || !finite(episode.startedAtTimestampMs) || !finite(episode.endedAtTimestampMs) || episode.rasterOperationCount !== 1) failures.push('episode evidence changed');
  const nativeTimes = [callback.nativeTimestampMs, callback.executionStartedAtTimestampMs, callback.executionEndedAtTimestampMs, value.interactionStartedAtTimestampMs, window.startedAtTimestampMs, window.endedAtTimestampMs, episode.startedAtTimestampMs, episode.endedAtTimestampMs];
  if (!finite(value.browserTimeOriginEpochMs) || value.browserTimeOriginEpochMs < started || value.browserTimeOriginEpochMs > ended || nativeTimes.some(timestampMs => !finite(timestampMs) || timestampMs < 0 || value.browserTimeOriginEpochMs + timestampMs < started || value.browserTimeOriginEpochMs + timestampMs > ended) || callback.nativeTimestampMs > callback.executionStartedAtTimestampMs) failures.push('browser time domain changed');
  if (!finite(value.interactionStartedAtTimestampMs) || !(callback.deliveredTimestampMs < value.interactionStartedAtTimestampMs && value.interactionStartedAtTimestampMs <= callback.executionStartedAtTimestampMs && callback.executionStartedAtTimestampMs <= window.endedAtTimestampMs && window.endedAtTimestampMs <= callback.executionEndedAtTimestampMs) || !(window.startedAtTimestampMs <= value.interactionStartedAtTimestampMs && window.startedAtTimestampMs <= window.endedAtTimestampMs)) failures.push('observation order changed');
  if (episode.startedAtTimestampMs !== window.startedAtTimestampMs || episode.endedAtTimestampMs !== window.endedAtTimestampMs) failures.push('episode bounds changed');
  if (!exactKeys(value.droppedEntryCounts, ['canvasWindowReports', 'canvasLifetimes', 'resetEvents', 'lifecycleEvents', 'documentEvents', 'eventTiming', 'userMarks', 'longAnimationFrames']) || Object.values(value.droppedEntryCounts ?? {}).some(count => count !== 0)) failures.push('drop counts changed');
  if (!exactKeys(value.diagnostics, ['warnings', 'consoleErrors', 'pageErrors']) || Object.values(value.diagnostics ?? {}).some(items => !Array.isArray(items) || items.length)) failures.push('diagnostics changed');
  if (!exactKeys(value.port, ['number', 'listenersBefore', 'listenersAfter']) || value.port.number !== 5190 || !Array.isArray(value.port.listenersBefore) || value.port.listenersBefore.length || !Array.isArray(value.port.listenersAfter) || value.port.listenersAfter.length) failures.push('port state changed');
  return failures;
}
