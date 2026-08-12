import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWindowObservationTimeEvidence } from './window-observation-time-truth.mjs';

function evidence() {
  const now = Date.now();
  return {
    schemaVersion: 1, runId: '12345678-1234-4234-9234-123456789abc', startedAt: new Date(now - 1000).toISOString(), endedAt: new Date(now).toISOString(),
    chromeRevision: '151.0.7922.137', gitSha: 'a'.repeat(40), bundleSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), harnessSha256: 'd'.repeat(64), injectedCallbackOffsetMs: 1000,
    browserTimeOriginEpochMs: now - 500, interactionStartedAtTimestampMs: 110,
    callback: { nativeTimestampMs: 110, deliveredTimestampMs: -890, executionStartedAtTimestampMs: 120, executionEndedAtTimestampMs: 122 },
    window: { startedAtTimestampMs: 100, endedAtTimestampMs: 121, rasterOperationCount: 1 },
    episode: { startedAtTimestampMs: 100, endedAtTimestampMs: 121, rasterOperationCount: 1 },
    droppedEntryCounts: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 },
    diagnostics: { warnings: [], consoleErrors: [], pageErrors: [] }, port: { number: 5190, listenersBefore: [], listenersAfter: [] },
  };
}
const expected = value => ({ chromeRevision: value.chromeRevision, gitSha: value.gitSha, bundleSha256: value.bundleSha256, sourceSha256: value.sourceSha256, harnessSha256: value.harnessSha256 });

test('window observation-time evidence is closed and ordered', () => {
  const source = evidence();
  assert.deepEqual(checkWindowObservationTimeEvidence(source, expected(source)), []);
  assert.notDeepEqual(checkWindowObservationTimeEvidence(source), []);
  for (const mutate of [
    value => { value.extra = true; },
    value => { value.chromeRevision = 'Chrome'; },
    value => { value.injectedCallbackOffsetMs = 50; },
    value => { value.callback.nativeTimestampMs = 109; },
    value => { value.callback.deliveredTimestampMs = 111; },
    value => { value.window.endedAtTimestampMs = value.callback.deliveredTimestampMs; },
    value => { value.window.endedAtTimestampMs = 1_000_000_000; value.episode.endedAtTimestampMs = 1_000_000_000; },
    value => { value.window.startedAtTimestampMs = 122; },
    value => { value.episode.endedAtTimestampMs = 122; },
    value => { value.window.rasterOperationCount = 2; },
    value => { value.droppedEntryCounts.canvasWindowReports = 1; },
    value => { value.diagnostics.pageErrors.push('bad'); },
    value => { value.port.listenersBefore = null; },
    value => { value.runId = '-'.repeat(36); },
    value => { value.startedAt = new Date(value.startedAt).toUTCString(); },
    value => { value.startedAt = '1970-01-01T00:00:00.000Z'; },
    value => { value.browserTimeOriginEpochMs = Date.parse(value.startedAt) - 1; },
    value => { value.callback.executionEndedAtTimestampMs = 501; },
    value => { value.port.listenersAfter.push(5190); },
  ]) {
    const value = evidence(); const identity = expected(value); mutate(value); assert.notDeepEqual(checkWindowObservationTimeEvidence(value, identity), []);
  }
  for (const key of ['chromeRevision', 'gitSha', 'bundleSha256', 'sourceSha256', 'harnessSha256']) {
    const value = evidence(); const identity = expected(value); value[key] = key === 'chromeRevision' ? '0.0.0.0' : key === 'gitSha' ? 'f'.repeat(40) : '0'.repeat(64);
    assert.notDeepEqual(checkWindowObservationTimeEvidence(value, identity), []);
  }
  {
    const value = evidence(); const identity = expected(value);
    value.callback = { nativeTimestampMs: -10, deliveredTimestampMs: -1010, executionStartedAtTimestampMs: -9, executionEndedAtTimestampMs: -1 };
    value.interactionStartedAtTimestampMs = -9;
    value.window.startedAtTimestampMs = -10; value.window.endedAtTimestampMs = -5;
    value.episode.startedAtTimestampMs = -10; value.episode.endedAtTimestampMs = -5;
    assert.notDeepEqual(checkWindowObservationTimeEvidence(value, identity), []);
  }
  {
    const value = evidence(); const identity = expected(value);
    value.callback.nativeTimestampMs = 1000; value.callback.deliveredTimestampMs = 0;
    assert.notDeepEqual(checkWindowObservationTimeEvidence(value, identity), []);
  }
  {
    const value = evidence(); const identity = expected(value);
    value.endedAt = value.startedAt; value.browserTimeOriginEpochMs = Date.parse(value.startedAt);
    value.interactionStartedAtTimestampMs = 0;
    value.callback = { nativeTimestampMs: 0, deliveredTimestampMs: -1000, executionStartedAtTimestampMs: 0, executionEndedAtTimestampMs: 0 };
    value.window.startedAtTimestampMs = 0; value.window.endedAtTimestampMs = 0;
    value.episode.startedAtTimestampMs = 0; value.episode.endedAtTimestampMs = 0;
    assert.notDeepEqual(checkWindowObservationTimeEvidence(value, identity), []);
  }
});
