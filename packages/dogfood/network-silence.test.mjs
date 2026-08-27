// Proves canvas-scan makes no network request of its own, three ways:
//
//   1. the contract refuses anything it cannot place
//   2. a complete guided workflow in real Chrome, with external access cut off
//      once the application has loaded, classifies every request it made
//   3. the command's own process opens no socket off this machine
//
// Run: node --test network-silence.test.mjs   (needs apps/demo/dist)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../scripts/browser-driver.mjs';
import { investigate } from './investigate-url.mjs';
import { NetworkContractViolation, REQUEST_OWNERS, checkConnections, checkRequests, classifyRequest, isLoopback } from './network-silence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const demo = path.join(root, 'apps/demo/dist');
const ritual = path.join(root, 'packages/dogfood/fixtures/investigate-url-ritual.mjs');
const refuses = pattern => error => error instanceof NetworkContractViolation && pattern.test(error.message);

const contract = { targetOrigin: 'http://127.0.0.1:5000', navigationUrl: 'http://127.0.0.1:5000/' };
const request = (url, overrides = {}) => ({ method: 'GET', url, resourceType: 'script', hasBody: false, ...overrides });

test('the contract names the target navigation, the application, and canvas-scan', () => {
  assert.deepEqual(REQUEST_OWNERS, ['target-navigation', 'application-asset', 'canvas-scan']);
  assert.equal(classifyRequest(request('http://127.0.0.1:5000/', { resourceType: 'document' }), contract), 'target-navigation');
  assert.equal(classifyRequest(request('http://127.0.0.1:5000/assets/app.js'), contract), 'application-asset');
  assert.equal(classifyRequest(request('http://127.0.0.1:5000/assets/app.js.map'), contract), 'canvas-scan');
  // A document request for some other page of the same app is the app's, not
  // the navigation the run was asked to make.
  assert.equal(classifyRequest(request('http://127.0.0.1:5000/other', { resourceType: 'document' }), contract), 'application-asset');
});

test('rejects an undeclared destination whatever it is called', () => {
  for (const url of [
    'https://telemetry.example/v1/events',
    'https://api.example/upload',
    'https://rules.example/canvas-rules.md',
    'https://registry.npmjs.org/canvas-scan',
    'https://crash.example/report',
  ]) {
    assert.throws(() => classifyRequest(request(url), contract), refuses(/undeclared destination/), `${url} was not refused`);
  }
  assert.throws(() => classifyRequest(request('not a url'), contract), refuses(/unusable URL/));
  assert.throws(() => classifyRequest({}, contract), refuses(/no URL/));
});

test('rejects an unknown request owner', () => {
  assert.throws(() => checkRequests([], { ...contract, expectedOwners: ['telemetry'] }), refuses(/unknown request owner "telemetry"/));
  assert.throws(() => checkRequests([], { ...contract, expectedOwners: ['canvas-scan', 'analytics'] }), refuses(/unknown request owner "analytics"/));
});

test('rejects an extra request the run did not expect', () => {
  const recorded = [
    request('http://127.0.0.1:5000/', { resourceType: 'document' }),
    request('http://127.0.0.1:5000/assets/app.js'),
    request('http://127.0.0.1:5000/assets/app.js.map'),
  ];
  // A run with no explanation has no reason to fetch a source map.
  assert.throws(
    () => checkRequests(recorded, { ...contract, expectedOwners: ['target-navigation', 'application-asset'] }),
    refuses(/owner this run did not expect: canvas-scan/),
  );
  assert.equal(checkRequests(recorded, contract).length, 3);
  // Two navigations means the run went somewhere it was not sent.
  assert.throws(
    () => checkRequests([...recorded, request('http://127.0.0.1:5000/', { resourceType: 'document' })], contract),
    refuses(/exactly one target navigation, recorded 2/),
  );
  assert.throws(
    () => checkRequests([request('http://127.0.0.1:5000/x.map', { hasBody: true, method: 'POST' })], { ...contract, expectedOwners: ['canvas-scan'] }),
    refuses(/canvas-scan sent 1 request carrying a body/),
  );
});

test('the process check refuses a connection off this machine', () => {
  assert.deepEqual(checkConnections([{ host: '127.0.0.1', port: 5000 }, { host: '::1', port: 9222 }]).length, 2);
  assert.throws(() => checkConnections([{ host: '140.82.121.4', port: 443 }]), refuses(/off this machine: 140\.82\.121\.4:443/));
  assert.equal(isLoopback('127.0.0.53'), true);
  assert.equal(isLoopback('10.0.0.1'), false);
  assert.equal(isLoopback(undefined), false);
});

test('a complete workflow passes with external access cut off', { timeout: 240_000 }, async () => {
  assert.ok(existsSync(demo), 'apps/demo/dist is missing. Run: pnpm --filter demo run build');
  const { server, port } = await serve(demo);
  const out = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-network-'));
  const origin = `http://127.0.0.1:${port}`;
  let report;
  try {
    report = await investigate(
      { url: `${origin}/`, origin, out, drive: ritual, handoff: 'none', blockExternal: true, timeoutMs: 180_000 },
      { log: () => {} },
    );
  } finally {
    server.close();
  }

  // The ritual finished with the network cut, which is the point: nothing in
  // the investigation needed to reach anywhere.
  assert.deepEqual(report.notes, [], report.notes.join(' | '));
  for (const id of ['record-baseline', 'explain-baseline', 'record-candidate', 'compare']) {
    assert.equal(report.steps.find(step => step.id === id)?.status, 'complete', `${id} did not complete with the network cut`);
  }
  assert.deepEqual(report.blockedExternalRequests, [], 'something tried to leave the target origin and was blocked');
  assert.equal(report.droppedRequestRecords, 0, 'the request log overflowed, so this run cannot prove what it made');

  // Every request the run made, classified. An unclassifiable one throws.
  const classified = checkRequests(report.requests, { targetOrigin: origin, navigationUrl: `${origin}/` });
  assert.ok(classified.length > 0, 'no requests were recorded at all, so this proves nothing');
  assert.equal(classified.filter(item => item.owner === 'target-navigation').length, 1);
  assert.deepEqual(classified.filter(item => item.hasBody), [], 'a request carried a body');
  const canvasScan = classified.filter(item => item.owner === 'canvas-scan');
  for (const item of canvasScan) {
    assert.ok(item.url.startsWith(origin), `canvas-scan reached outside the target origin: ${item.url}`);
    assert.equal(item.method, 'GET');
  }
});

test('the command opens no socket off this machine', { timeout: 240_000 }, async () => {
  assert.ok(existsSync(demo), 'apps/demo/dist is missing. Run: pnpm --filter demo run build');
  // A separate process, so what is measured is the command's own sockets
  // rather than this test runner's. Chrome is a child process with its own
  // network stack; the browser half is covered by the check above.
  const output = execFileSync(process.execPath, [path.join(root, 'packages/dogfood/fixtures/network-silence-process.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 220_000,
  });
  const result = JSON.parse(output.slice(output.lastIndexOf('\n{')));
  assert.equal(result.ok, true, result.error ?? 'the run failed');
  // The control first: without it, an empty list would prove a broken hook
  // just as well as it proves silence.
  assert.equal(result.hookWorks, true, 'the socket recorder did not record its own control connection, so this run proves nothing');
  assert.ok(result.lookups.every(name => name === 'localhost' || name === '127.0.0.1'), `the command resolved a name it should not need: ${result.lookups.join(', ')}`);
  // Everything the command opened, control connection included, stayed here.
  checkConnections(result.connections);
});
