import assert from 'node:assert/strict';
import test from 'node:test';
import { RITUAL_METHODS } from '../../scripts/pack-manifest.mjs';
import { ACTION_IDS, checkReadinessEvidence } from './readiness-v05.mjs';

function evidence() {
  return {
    schemaVersion: 1,
    issue: 'SIDPROJ-105',
    status: 'PASS',
    gitSha: 'a'.repeat(40),
    branch: 'agent/sidproj-105-v05-ritual',
    packageVersion: '0.5.0',
    tarballSha256: 'b'.repeat(64),
    installedIifeSha256: 'c'.repeat(64),
    browserVersion: '151.0.0.0',
    earlyLoad: true,
    worktreeUnchanged: true,
    publicMethods: [...RITUAL_METHODS],
    actionIds: [...ACTION_IDS],
    baseline: { sessionId: 'baseline', findingIndex: 1, findingType: 'repeated-draw-work' },
    explanation: { sourceSessionId: 'baseline', sourceFindingIndex: 1, followUpSessionId: 'explanation', stopReason: 'manual', clipboardMatched: true },
    candidate: { sessionId: 'candidate', findingIndex: 2, findingType: 'repeated-draw-work' },
    comparison: { pairingMethod: 'user-selected', status: 'comparable', improvementEstablished: false, baselineSessionId: 'baseline', baselineFindingIndex: 1, candidateSessionId: 'candidate', candidateFindingIndex: 2, clipboardMatched: true },
    diagnostics: { warnings: [], errors: [], pageErrors: [], requestFailures: [] },
    failures: [],
  };
}

test('accepts one complete clean-consumer ritual', () => {
  assert.equal(checkReadinessEvidence(evidence()), true);
});

test('rejects missing, extra, and reordered actions', () => {
  const missing = evidence(); missing.actionIds.pop(); assert.throws(() => checkReadinessEvidence(missing), /ritual identity/);
  const extra = evidence(); extra.actionIds.push('extra'); assert.throws(() => checkReadinessEvidence(extra), /ritual identity/);
  const reordered = evidence(); [reordered.actionIds[0], reordered.actionIds[1]] = [reordered.actionIds[1], reordered.actionIds[0]]; assert.throws(() => checkReadinessEvidence(reordered), /ritual identity/);
});

test('rejects every missing public ritual method', () => {
  for (const method of RITUAL_METHODS) {
    const value = evidence(); value.publicMethods = value.publicMethods.filter(name => name !== method);
    assert.throws(() => checkReadinessEvidence(value), /ritual identity/);
  }
});

test('rejects selection and explicit pairing drift', () => {
  for (const mutate of [
    value => { value.explanation.sourceFindingIndex = 0; },
    value => { value.candidate.findingType = 'heavy-canvas-work'; },
    value => { value.comparison.pairingMethod = 'automatic'; },
    value => { value.comparison.baselineFindingIndex = 0; },
    value => { value.comparison.candidateSessionId = 'other'; },
    value => { value.comparison.improvementEstablished = true; },
  ]) {
    const value = evidence(); mutate(value); assert.throws(() => checkReadinessEvidence(value));
  }
});

test('rejects failed copy, diagnostics, and changed worktree state', () => {
  for (const mutate of [
    value => { value.explanation.clipboardMatched = false; },
    value => { value.comparison.clipboardMatched = false; },
    value => { value.diagnostics.errors.push('page error'); },
    value => { value.failures.push('failure'); },
    value => { value.worktreeUnchanged = false; },
  ]) {
    const value = evidence(); mutate(value); assert.throws(() => checkReadinessEvidence(value));
  }
});
